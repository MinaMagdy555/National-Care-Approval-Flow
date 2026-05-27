import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { AccountProfile, AuthStatus, User, Role, Environment, Task, TaskStatus, Priority, TaskType, Notification, TaskComment, TaskVersion, UploadedTaskFile, ReviewMode } from './types';
import { demoAccounts, initialUsers, initialTasks } from './mockData';
import { clearAppState, loadAppState, saveAppState } from './localDb';
import { shouldAutoArchiveTask } from './archiveUtils';
import { sanitizeHandledBy } from './handlerUtils';
import {
  ART_DIRECTOR_WAITING_STATUSES,
  CLOSED_STATUSES,
  RETURNED_STATUSES,
  REVIEWER_WAITING_STATUSES,
  canReviewRouteUpdateStatus,
  getCurrentOwnerUserIds,
  getReviewRouteTarget,
  getTaskParticipantIds,
  uniqueIds,
} from './workflowUtils';
import {
  fetchDriveNotifications,
  fetchDriveTasks,
  importDriveSelectionToTasks,
  uploadTaskFiles,
  upsertDriveNotifications,
  upsertDriveTask,
  USE_SHARED_DRIVE_DATA,
} from './driveDb';
import {
  clearDriveSession,
  getStoredDriveRoot,
  getStoredDriveUserEmail,
  hasUsableDriveToken,
  isGoogleDriveConfigured,
  pickDriveDocuments,
  requestDriveAccessToken,
  setStoredDriveRoot,
  type DriveAuthStatus,
  type DriveRootFolder,
} from './driveAuth';
import { addLowResPreviewsToFiles, getTaskFiles } from './previewUtils';

const CURRENT_USER_STORAGE_KEY = 'national-care-current-user-id';
const SHARED_DATA_POLL_INTERVAL_MS = 60 * 1000;
const GUEST_SEED_ID_PREFIX = 'guest_seed_';
const GUEST_USER: User = {
  id: 'guest',
  name: 'Guest',
  role: 'team_member',
  jobTitle: 'Not signed in',
};

function isSharedWorkspaceStatus(status: AuthStatus) {
  return USE_SHARED_DRIVE_DATA && status === 'approved';
}

type AuthActionResult = {
  ok: boolean;
  message?: string;
  needsEmailConfirmation?: boolean;
};

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}

function getSharedDataErrorMessage(error: unknown, fallback: string) {
  const message = getErrorMessage(error, fallback);
  const normalizedMessage = message.toLowerCase();
  const isNetworkError = normalizedMessage.includes('failed to fetch') || normalizedMessage.includes('networkerror') || normalizedMessage.includes('network error');

  if (isNetworkError) {
    return 'Google Drive connection failed. Check Google access, Drive permissions, and network access, then refresh.';
  }

  return message;
}

function normalizeCredentialValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function findDemoAccount(identifier: string, password: string) {
  const normalizedIdentifier = normalizeCredentialValue(identifier);
  const normalizedPassword = normalizeCredentialValue(password);

  return demoAccounts.find(account => {
    const user = account.user;
    const acceptedNames = (user.email
      ? [user.email]
      : [
          user.id,
          user.name,
          user.name.split(/\s+/)[0],
        ]
    ).filter(Boolean).map(normalizeCredentialValue);

    return acceptedNames.includes(normalizedIdentifier) && normalizeCredentialValue(account.password) === normalizedPassword;
  }) || null;
}

function getStoredDemoUser() {
  if (typeof window === 'undefined') return GUEST_USER;
  const storedUserId = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);
  return demoAccounts.find(account => account.user.id === storedUserId)?.user || GUEST_USER;
}

function isGuestSeedTask(task: Pick<Task, 'id' | 'code'> | null | undefined) {
  return Boolean(task?.id?.startsWith(GUEST_SEED_ID_PREFIX) || task?.code?.startsWith('GST-'));
}

function isGuestSeedNotification(notification: Notification | null | undefined) {
  return Boolean(
    notification?.id?.startsWith(GUEST_SEED_ID_PREFIX) ||
    notification?.taskId?.startsWith(GUEST_SEED_ID_PREFIX)
  );
}

function removeGuestSeedNotifications(notifications: Notification[]) {
  return notifications.filter(notification => notification?.id && !isGuestSeedNotification(notification));
}

function reviveWorkspaceTasks(tasks: Task[], users: Record<string, User>) {
  return sortTasksByUpdate(reviveTaskFiles(tasks.filter(task => !isGuestSeedTask(task)), users));
}

function getUserIdsByRole(users: User[], roles: Role[]) {
  return users
    .filter(user => roles.includes(user.role))
    .map(user => user.id);
}

function getUserIdsByRoleRecord(users: Record<string, User>, roles: Role[]) {
  return Object.values(users)
    .filter(user => roles.includes(user.role))
    .map(user => user.id);
}

function getUserDisplayName(users: Record<string, User>, userId: string) {
  return users[userId]?.name || initialUsers.find(user => user.id === userId)?.name || userId;
}

function isReviewerCreatedTask(task: Task, users: Record<string, User>) {
  const creatorRole = users[task.createdBy]?.role || initialUsers.find(user => user.id === task.createdBy)?.role;
  return creatorRole === 'reviewer' || creatorRole === 'admin';
}

function normalizeReviewerCreatedTask(task: Task, users: Record<string, User>): Task {
  if (!isReviewerCreatedTask(task, users) || !REVIEWER_WAITING_STATUSES.includes(task.status)) {
    return task;
  }

  return {
    ...task,
    handledBy: sanitizeHandledBy(task.handledBy),
    reviewMode: 'direct_to_ad',
    status: 'sent_to_art_director',
    currentOwnerRole: 'art_director',
    currentOwnerUserId: null,
    currentOwnerUserIds: getUserIdsByRoleRecord(users, ['art_director']),
  };
}

function coerceTask(task: Partial<Task> & { id?: string }): Task | null {
  if (!task || !task.id) return null;

  const now = new Date().toISOString();
  const versions = Array.isArray(task.versions) ? task.versions : [];
  const currentOwnerUserIds = uniqueIds([
    ...(Array.isArray(task.currentOwnerUserIds) ? task.currentOwnerUserIds : []),
    task.currentOwnerUserId,
  ]);

  return {
    id: task.id,
    code: task.code || `TSK-${task.id}`,
    name: task.name || 'Untitled task',
    taskType: task.taskType || 'others',
    reviewMode: task.reviewMode || 'full_review',
    environment: task.environment || 'production',
    createdBy: task.createdBy || initialUsers[0]?.id || 'unknown_user',
    handledBy: sanitizeHandledBy(Array.isArray(task.handledBy) ? task.handledBy : [task.createdBy || initialUsers[0]?.id || 'unknown_user']),
    status: task.status || 'submitted',
    currentOwnerRole: task.currentOwnerRole ?? null,
    currentOwnerUserId: task.currentOwnerUserId ?? null,
    currentOwnerUserIds,
    priority: task.priority || 'not_set',
    deadlineText: task.deadlineText ?? null,
    scheduledPublishAt: task.scheduledPublishAt ?? null,
    publishNote: task.publishNote ?? null,
    publishedAt: task.publishedAt ?? null,
    publishReminderSentAt: task.publishReminderSentAt ?? null,
    versions,
    comments: Array.isArray(task.comments) ? task.comments : [],
    thumbnailUrl: task.thumbnailUrl || '',
    thumbnailStoragePath: task.thumbnailStoragePath,
    driveFolderId: task.driveFolderId,
    driveMetadataFileId: task.driveMetadataFileId,
    archivedAt: task.archivedAt ?? null,
    archivedReason: task.archivedReason ?? null,
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || task.createdAt || now,
  };
}

function reviveTaskFiles(tasks: Task[], users: Record<string, User> = {}): Task[] {
  return tasks.map(task => coerceTask(task)).filter(Boolean).map(task => {
    const versions = task.versions.map(version => {
      const files = version.files?.map(file => ({
        ...file,
        storageProvider: file.storageProvider || (file.driveFileId ? 'drive' : file.blob || file.url?.startsWith('blob:') ? 'local' : file.storageProvider),
        url: file.blob ? URL.createObjectURL(file.blob) : file.url,
      }));

      return {
        ...version,
        files,
        fileUrl: files?.[0]?.url || version.fileUrl,
      };
    });
    const thumbnailFile = versions[0]?.files?.find(file => file.previewUrl && file.previewStoragePath);

    return normalizeReviewerCreatedTask({
      ...task,
      versions,
      thumbnailUrl: thumbnailFile?.previewUrl || task.thumbnailUrl,
      thumbnailStoragePath: thumbnailFile?.previewStoragePath || task.thumbnailStoragePath,
    }, users);
  }) as Task[];
}

function sortTasksByUpdate(tasks: Task[]) {
  return [...tasks].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function sortNotificationsByCreatedAt(notifications: Notification[]) {
  return [...notifications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function taskSyncKey(task: Task) {
  const previewKey = task.versions
    .flatMap(version => version.files || [])
    .map(file => file.previewStoragePath || '')
    .join('|');
  const commentImageKey = (task.comments || [])
    .flatMap(comment => comment.sections)
    .map(section => section.imageStoragePath || '')
    .join('|');

  return [
    task.id,
    task.updatedAt,
    task.status,
    task.reviewMode,
    task.handledBy.join(','),
    getCurrentOwnerUserIds(task).join(','),
    task.scheduledPublishAt || '',
    task.publishedAt || '',
    task.publishReminderSentAt || '',
    task.archivedAt || '',
    task.thumbnailStoragePath || '',
    previewKey,
    commentImageKey,
  ].join(':');
}

function preserveStoredMediaPreviews(currentTask: Task, incomingTask: Task): Task {
  const currentFilesById = new Map(
    currentTask.versions
      .flatMap(version => getTaskFiles(version))
      .filter(file => file.previewUrl && file.previewStoragePath)
      .map(file => [file.id, file])
  );

  const versions = incomingTask.versions.map(version => ({
    ...version,
    files: version.files?.map(file => {
      if (file.previewUrl && file.previewStoragePath) return file;

      const currentFile = currentFilesById.get(file.id);
      return currentFile?.previewUrl && currentFile.previewStoragePath
        ? {
            ...file,
            previewUrl: currentFile.previewUrl,
            previewStoragePath: currentFile.previewStoragePath,
          }
        : file;
    }),
  }));
  const thumbnailFile = versions[0]?.files?.find(file => file.previewUrl && file.previewStoragePath);

  return {
    ...incomingTask,
    versions,
    thumbnailUrl: incomingTask.thumbnailUrl || thumbnailFile?.previewUrl || currentTask.thumbnailUrl,
    thumbnailStoragePath: incomingTask.thumbnailStoragePath || thumbnailFile?.previewStoragePath || currentTask.thumbnailStoragePath,
  };
}

function notificationSyncKey(notification: Notification) {
  return `${notification.id}:${notification.read ? 'read' : 'unread'}:${notification.message}:${notification.createdAt}`;
}

function mergeTaskIntoState(currentTasks: Task[], incomingTask: Task) {
  let changed = false;
  const nextTasks = currentTasks.map(task => {
    if (task.id !== incomingTask.id) return task;
    if (new Date(task.updatedAt).getTime() > new Date(incomingTask.updatedAt).getTime()) return task;
    const mergedIncomingTask = preserveStoredMediaPreviews(task, incomingTask);
    if (taskSyncKey(task) === taskSyncKey(mergedIncomingTask)) return task;
    changed = true;
    return mergedIncomingTask;
  });

  if (!currentTasks.some(task => task.id === incomingTask.id)) {
    changed = true;
    nextTasks.unshift(incomingTask);
  }

  return changed ? sortTasksByUpdate(nextTasks) : currentTasks;
}

function mergeTasksIntoState(currentTasks: Task[], incomingTasks: Task[]) {
  return incomingTasks.reduce(mergeTaskIntoState, currentTasks);
}

function mergeNotificationIntoState(currentNotifications: Notification[], incomingNotification: Notification) {
  let changed = false;
  const nextNotifications = currentNotifications.map(notification => {
    if (notification.id !== incomingNotification.id) return notification;
    if (notification.read && !incomingNotification.read) return notification;
    if (notificationSyncKey(notification) === notificationSyncKey(incomingNotification)) return notification;
    changed = true;
    return incomingNotification;
  });

  if (!currentNotifications.some(notification => notification.id === incomingNotification.id)) {
    changed = true;
    nextNotifications.unshift(incomingNotification);
  }

  return changed ? sortNotificationsByCreatedAt(nextNotifications) : currentNotifications;
}

function mergeNotificationsIntoState(currentNotifications: Notification[], incomingNotifications: Notification[]) {
  return incomingNotifications.reduce(mergeNotificationIntoState, currentNotifications);
}

async function uploadMigratedTaskFiles(task: Task): Promise<Task> {
  const versions = await Promise.all(task.versions.map(async version => {
    if (!version.files || version.files.length === 0) return version;

    const uploadedFiles = await uploadTaskFiles(task.id, version.files, {
      taskCode: task.code,
      taskName: task.name,
      taskFolderId: task.driveFolderId,
    });
    const previewedFiles = await addLowResPreviewsToFiles(task.id, uploadedFiles, version.files);

    return {
      ...version,
      files: previewedFiles,
      fileUrl: previewedFiles[0]?.url || version.fileUrl,
    };
  }));
  const newestPreviewFile = versions[0]?.files?.find(file => file.previewUrl && file.previewStoragePath);

  return {
    ...task,
    versions,
    thumbnailUrl: newestPreviewFile?.previewUrl || task.thumbnailUrl,
    thumbnailStoragePath: newestPreviewFile?.previewStoragePath || task.thumbnailStoragePath,
  };
}

interface AppState {
  currentUser: User;
  authStatus: AuthStatus;
  authProfile: AccountProfile | null;
  authError: string | null;
  accountProfiles: AccountProfile[];
  environment: Environment;
  tasks: Task[];
  users: Record<string, User>;
  userList: User[];
  notifications: Notification[];
  persistenceMode: 'drive' | 'local';
  persistenceError: string | null;
  localMigrationCount: number;
  isMigratingLocalData: boolean;
  driveStatus: DriveAuthStatus;
  driveUserEmail: string | null;
  driveRootFolder: DriveRootFolder | null;
  isConnectingDrive: boolean;
  isChoosingDriveRoot: boolean;
  isImportingDriveTasks: boolean;
}

interface AppContextType extends AppState {
  setEnvironment: (env: Environment) => void;
  updateTaskStatus: (taskId: string, newStatus: TaskStatus, newOwnerRole: Role | null, newOwnerUserIds?: string[]) => void;
  updateTaskPriority: (taskId: string, priority: Priority, deadline: string | null) => void;
  updateTaskAssignment: (taskId: string, handledByIds: string[], currentOwnerUserIds: string[]) => void;
  updateTaskReviewMode: (taskId: string, reviewMode: ReviewMode) => void;
  updateTaskPublishSchedule: (taskId: string, schedule: { scheduledPublishAt: string | null; publishNote: string | null }) => void;
  markCampaignPublished: (taskId: string) => void;
  markPublishReminderSent: (taskId: string) => void;
  addTaskComment: (taskId: string, comment: Omit<TaskComment, 'id' | 'createdAt'>) => void;
  addTaskVersion: (taskId: string, version: TaskVersion) => void;
  replaceTaskVersionFiles: (taskId: string, versionId: string, files: UploadedTaskFile[]) => void;
  updateTaskMediaPreviews: (taskId: string, updates: { versions: TaskVersion[]; comments?: TaskComment[]; thumbnailUrl: string; thumbnailStoragePath?: string }) => void;
  addTask: (task: Task) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void;
  markNotificationAsRead: (id: string) => void;
  loginWithPassword: (identifier: string, password: string) => Promise<AuthActionResult>;
  logout: () => Promise<void>;
  archiveTask: (taskId: string, reason?: string) => void;
  unarchiveTask: (taskId: string) => void;
  connectGoogleDrive: () => Promise<void>;
  disconnectGoogleDrive: () => void;
  chooseDriveRoot: () => Promise<void>;
  importDriveTasks: () => Promise<void>;
  migrateLocalDataToDrive: () => Promise<void>;
  dismissLocalMigration: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const initialDemoUser = getStoredDemoUser();
  const hasLoadedPersistedState = useRef(false);
  const sharedDataLoadFailedRef = useRef(false);
  const pendingTaskBroadcastIdsRef = useRef<Set<string>>(new Set());
  const pendingNotificationBroadcastIdsRef = useRef<Set<string>>(new Set());
  const [accountProfiles, setAccountProfiles] = useState<AccountProfile[]>([]);
  const [authProfile, setAuthProfile] = useState<AccountProfile | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(initialDemoUser.id === GUEST_USER.id ? 'signed_out' : 'approved');
  const [authError, setAuthError] = useState<string | null>(null);
  const [userList, setUserList] = useState<User[]>(initialUsers);
  const usersObj = userList.reduce((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {} as Record<string, User>);

  const [currentUserState, setCurrentUserState] = useState<User>(initialDemoUser);
  const [environment, setEnvironment] = useState<Environment>('production');
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [localMigrationState, setLocalMigrationState] = useState<{ tasks: Task[]; notifications: Notification[] } | null>(null);
  const [isMigratingLocalData, setIsMigratingLocalData] = useState(false);
  const [driveRootFolder, setDriveRootFolder] = useState<DriveRootFolder | null>(() => getStoredDriveRoot());
  const [driveUserEmail, setDriveUserEmail] = useState<string | null>(() => getStoredDriveUserEmail());
  const [hasDriveToken, setHasDriveToken] = useState(() => hasUsableDriveToken());
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [isChoosingDriveRoot, setIsChoosingDriveRoot] = useState(false);
  const [isImportingDriveTasks, setIsImportingDriveTasks] = useState(false);
  const currentUser = currentUserState;
  const isSharedWorkspaceActive = isSharedWorkspaceStatus(authStatus);
  const isDriveWorkspaceReady = isSharedWorkspaceActive && hasDriveToken && Boolean(driveRootFolder);
  const driveStatus: DriveAuthStatus = !USE_SHARED_DRIVE_DATA
    ? 'disabled'
    : !isGoogleDriveConfigured
      ? 'needs_config'
      : !hasDriveToken
        ? 'needs_auth'
        : !driveRootFolder
          ? 'needs_root'
          : 'ready';
  const isLocalWorkspaceActive = authStatus === 'approved' && !isSharedWorkspaceActive;

  const queueTaskBroadcast = (taskId: string) => {
    pendingTaskBroadcastIdsRef.current.add(taskId);
  };

  const queueNotificationBroadcast = (notificationId: string) => {
    pendingNotificationBroadcastIdsRef.current.add(notificationId);
  };

  useEffect(() => {
    const storedDemoUser = getStoredDemoUser();
    setCurrentUserState(storedDemoUser);
    setUserList(initialUsers);
    setAccountProfiles([]);
    setAuthProfile(null);
    setAuthStatus(storedDemoUser.id === GUEST_USER.id ? 'signed_out' : 'approved');
    setAuthError(null);
  }, []);

  useEffect(() => {
    if (!isLocalWorkspaceActive) return;

    let isMounted = true;
    sharedDataLoadFailedRef.current = false;
    hasLoadedPersistedState.current = false;

    loadAppState()
      .then(localState => {
        if (!isMounted) return;

        const localTasks = Array.isArray(localState?.tasks) ? localState.tasks : initialTasks;
        setTasks(reviveWorkspaceTasks(localTasks, usersObj));
        setNotifications(Array.isArray(localState?.notifications) ? removeGuestSeedNotifications(localState.notifications) : []);
        setLocalMigrationState(null);
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to load local demo workspace', error);
        if (isMounted) {
          setPersistenceError(getErrorMessage(error, 'Failed to load local demo workspace.'));
        }
      })
      .finally(() => {
        if (isMounted) hasLoadedPersistedState.current = true;
      });

    return () => {
      isMounted = false;
    };
  }, [isLocalWorkspaceActive]);

  useEffect(() => {
    if (authStatus !== 'approved' || !hasLoadedPersistedState.current) return;

    const autoArchiveTasks = tasks.filter(task => shouldAutoArchiveTask(task));
    if (autoArchiveTasks.length === 0) return;

    autoArchiveTasks.forEach(task => queueTaskBroadcast(task.id));
    setTasks(prev => prev.map(task => (
      autoArchiveTasks.some(item => item.id === task.id)
        ? {
            ...task,
            archivedAt: new Date().toISOString(),
            archivedReason: 'Auto archived after 3 months of inactivity',
            updatedAt: new Date().toISOString(),
          }
        : task
    )));
  }, [tasks, authStatus]);

  useEffect(() => {
    if (!isSharedWorkspaceActive) return;
    if (!isDriveWorkspaceReady) {
      sharedDataLoadFailedRef.current = false;
      hasLoadedPersistedState.current = true;
      setTasks(initialTasks);
      setNotifications([]);
      setLocalMigrationState(null);
      setPersistenceError(null);
      return;
    }

    let isMounted = true;
    sharedDataLoadFailedRef.current = false;
    hasLoadedPersistedState.current = false;

    Promise.all([fetchDriveTasks(), fetchDriveNotifications(), loadAppState()])
      .then(([loadedTasks, loadedNotifications, localState]) => {
        if (!isMounted) return;

        const sharedTasks = reviveWorkspaceTasks(loadedTasks, usersObj);
        const sharedNotifications = removeGuestSeedNotifications(loadedNotifications);
        const localTasks = Array.isArray(localState?.tasks) ? localState.tasks.filter(task => !isGuestSeedTask(task)) : [];
        const localNotifications = Array.isArray(localState?.notifications) ? removeGuestSeedNotifications(localState.notifications) : [];

        sharedDataLoadFailedRef.current = false;
        setTasks(sharedTasks);
        setNotifications(sharedNotifications);
        setLocalMigrationState(localTasks.length || localNotifications.length
          ? { tasks: localTasks, notifications: localNotifications }
          : null);
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to load Drive app state', error);
        if (!isMounted) return;

        sharedDataLoadFailedRef.current = true;
        setLocalMigrationState(null);
        setPersistenceError(getSharedDataErrorMessage(error, 'Failed to load Drive app state.'));
      })
      .finally(() => {
        if (isMounted) hasLoadedPersistedState.current = true;
      });

    return () => {
      isMounted = false;
    };
  }, [isSharedWorkspaceActive, isDriveWorkspaceReady, currentUser.id, driveRootFolder?.id]);

  useEffect(() => {
    if (!isDriveWorkspaceReady || !hasLoadedPersistedState.current || sharedDataLoadFailedRef.current) return;

    const pendingTaskIds = Array.from(pendingTaskBroadcastIdsRef.current);
    const pendingNotificationIds = Array.from(pendingNotificationBroadcastIdsRef.current);
    if (pendingTaskIds.length === 0 && pendingNotificationIds.length === 0) return;

    pendingTaskBroadcastIdsRef.current.clear();
    pendingNotificationBroadcastIdsRef.current.clear();

    const pendingTasks = pendingTaskIds
      .map(taskId => tasks.find(item => item.id === taskId))
      .filter(Boolean) as Task[];
    const pendingNotifications = pendingNotificationIds
      .map(notificationId => notifications.find(item => item.id === notificationId))
      .filter(Boolean) as Notification[];

    const saveState = Promise.all([
      ...pendingTasks.map(task => upsertDriveTask(task)),
      upsertDriveNotifications(pendingNotifications),
    ]);

    saveState
      .then(() => {
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to save app state', error);
        pendingTaskIds.forEach(taskId => pendingTaskBroadcastIdsRef.current.add(taskId));
        pendingNotificationIds.forEach(notificationId => pendingNotificationBroadcastIdsRef.current.add(notificationId));
        setPersistenceError(getSharedDataErrorMessage(error, 'Failed to save app state.'));
      });
  }, [tasks, notifications, isDriveWorkspaceReady]);

  useEffect(() => {
    if (!isLocalWorkspaceActive || !hasLoadedPersistedState.current) return;

    saveAppState({ tasks, notifications })
      .then(() => {
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to save local demo workspace', error);
        setPersistenceError(getErrorMessage(error, 'Failed to save local demo workspace.'));
      });
  }, [tasks, notifications, isLocalWorkspaceActive]);

  useEffect(() => {
    if (!isDriveWorkspaceReady) return;

    let isMounted = true;
    let isPolling = false;

    const syncLatestSharedData = async () => {
      if (!hasLoadedPersistedState.current || isPolling) return;

      isPolling = true;
      try {
        const [latestTasks, latestNotifications] = await Promise.all([
          fetchDriveTasks(),
          fetchDriveNotifications(),
        ]);

        if (!isMounted) return;

        sharedDataLoadFailedRef.current = false;
        setTasks(prev => mergeTasksIntoState(prev.filter(task => !isGuestSeedTask(task)), reviveWorkspaceTasks(latestTasks, usersObj)));
        setNotifications(prev => mergeNotificationsIntoState(removeGuestSeedNotifications(prev), removeGuestSeedNotifications(latestNotifications)));
        setPersistenceError(null);
      } catch (error) {
        console.error('Failed to sync latest shared data', error);
        if (isMounted) {
          sharedDataLoadFailedRef.current = true;
          setPersistenceError(getSharedDataErrorMessage(error, 'Failed to sync latest shared data.'));
        }
      } finally {
        isPolling = false;
      }
    };

    const intervalId = window.setInterval(syncLatestSharedData, SHARED_DATA_POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void syncLatestSharedData();
      }
    };
    const handleFocus = () => {
      void syncLatestSharedData();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isDriveWorkspaceReady, currentUser.id, driveRootFolder?.id]);

  const addNotification = (notif: Omit<Notification, 'id' | 'createdAt' | 'read'>) => {
    const notification: Notification = {
      ...notif,
      id: Math.random().toString(36).substring(7),
      createdAt: new Date().toISOString(),
      read: false
    };

    queueNotificationBroadcast(notification.id);
    setNotifications(prev => [notification, ...prev]);
  };

  const addNotifications = (userIds: string[], taskId: string, message: string) => {
    Array.from(new Set(userIds)).forEach(userId => {
      addNotification({ userId, taskId, message });
    });
  };

  const getDefaultOwnerIdsForRole = (role: Role | null, task?: Task) => {
    if (!role) return [];
    if (role === 'reviewer') return getUserIdsByRole(userList, ['reviewer', 'admin']);
    if (role === 'art_director') return getUserIdsByRole(userList, ['art_director']);
    if (role === 'team_leader') return getUserIdsByRole(userList, ['team_leader']);
    if (role === 'team_member' && task) return uniqueIds([task.createdBy, ...task.handledBy]);
    return [];
  };

  const addAuditComment = (task: Task, authorId: string, action: TaskComment['action'], message: string, createdAt = new Date().toISOString()): Task => ({
    ...task,
    comments: [
      ...(task.comments || []),
      {
        id: Math.random().toString(36).substring(7),
        authorId,
        action,
        message,
        sections: [],
        createdAt,
      },
    ],
  });

  const markNotificationAsRead = (id: string) => {
    const notification = notifications.find(item => item.id === id);
    if (!notification || notification.read) return;

    queueNotificationBroadcast(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const loginWithPassword = async (identifier: string, password: string): Promise<AuthActionResult> => {
    if (!identifier.trim() || !password.trim()) {
      return { ok: false, message: 'Choose a demo account and enter its password.' };
    }

    const account = findDemoAccount(identifier, password);
    if (!account) {
      return { ok: false, message: 'That demo account name or password does not match.' };
    }

    window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, account.user.id);
    setAuthProfile(null);
    setCurrentUserState(account.user);
    setUserList(initialUsers);
    setAccountProfiles([]);
    setAuthStatus('approved');
    setAuthError(null);
    return { ok: true };
  };

  const logout = async () => {
    window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    hasLoadedPersistedState.current = false;
    setAuthProfile(null);
    setCurrentUserState(GUEST_USER);
    setUserList(initialUsers);
    setAccountProfiles([]);
    setLocalMigrationState(null);
    setPersistenceError(null);
    setAuthStatus('signed_out');
    setAuthError(null);
  };

  const connectGoogleDrive = async () => {
    if (!isGoogleDriveConfigured || isConnectingDrive) return;

    setIsConnectingDrive(true);
    setPersistenceError(null);
    try {
      await requestDriveAccessToken('consent');
      setHasDriveToken(hasUsableDriveToken());
      setDriveUserEmail(getStoredDriveUserEmail());
    } catch (error) {
      console.error('Failed to connect Google Drive', error);
      setPersistenceError(getSharedDataErrorMessage(error, 'Failed to connect Google Drive.'));
    } finally {
      setIsConnectingDrive(false);
    }
  };

  const disconnectGoogleDrive = () => {
    clearDriveSession();
    setHasDriveToken(false);
    setDriveUserEmail(null);
    hasLoadedPersistedState.current = false;
    setTasks(initialTasks);
    setNotifications([]);
  };

  const chooseDriveRoot = async () => {
    if (!isGoogleDriveConfigured || isChoosingDriveRoot) return;

    setIsChoosingDriveRoot(true);
    setPersistenceError(null);
    try {
      if (!hasUsableDriveToken()) {
        await requestDriveAccessToken('consent');
      }

      const [folder] = await pickDriveDocuments('root');
      if (!folder?.id) return;

      const root = {
        id: folder.id,
        name: folder.name || 'Shared Drive folder',
      };
      setStoredDriveRoot(root);
      setDriveRootFolder(root);
      setHasDriveToken(hasUsableDriveToken());
      setDriveUserEmail(getStoredDriveUserEmail());
      hasLoadedPersistedState.current = false;
    } catch (error) {
      console.error('Failed to choose Drive root folder', error);
      setPersistenceError(getSharedDataErrorMessage(error, 'Failed to choose Drive root folder.'));
    } finally {
      setIsChoosingDriveRoot(false);
    }
  };

  const importDriveTasks = async () => {
    if (!isDriveWorkspaceReady || isImportingDriveTasks) return;

    setIsImportingDriveTasks(true);
    setPersistenceError(null);
    try {
      const documents = await pickDriveDocuments('import');
      const importedTasks = await importDriveSelectionToTasks(documents, currentUser, environment);
      if (importedTasks.length > 0) {
        setTasks(prev => mergeTasksIntoState(prev, reviveWorkspaceTasks(importedTasks, usersObj)));
      }
    } catch (error) {
      console.error('Failed to import Drive tasks', error);
      setPersistenceError(getSharedDataErrorMessage(error, 'Failed to import Drive tasks.'));
    } finally {
      setIsImportingDriveTasks(false);
    }
  };

  const archiveTask = (taskId: string, reason = 'Archived manually') => {
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(task => task.id === taskId
      ? { ...task, archivedAt: new Date().toISOString(), archivedReason: reason, updatedAt: new Date().toISOString() }
      : task
    ));
  };

  const unarchiveTask = (taskId: string) => {
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(task => task.id === taskId
      ? { ...task, archivedAt: null, archivedReason: null, updatedAt: new Date().toISOString() }
      : task
    ));
  };

  const migrateLocalDataToDrive = async () => {
    if (!isDriveWorkspaceReady || !localMigrationState || isMigratingLocalData) return;

    setIsMigratingLocalData(true);
    setPersistenceError(null);

    try {
      const uploadedTasks = await Promise.all(localMigrationState.tasks.map(uploadMigratedTaskFiles));

      await Promise.all([
        ...uploadedTasks.map(task => upsertDriveTask(task)),
        upsertDriveNotifications(localMigrationState.notifications),
      ]);

      setTasks(prev => {
        const existingIds = new Set(prev.map(task => task.id));
        return [...uploadedTasks.filter(task => !existingIds.has(task.id)), ...prev];
      });
      setNotifications(prev => {
        const existingIds = new Set(prev.map(notification => notification.id));
        return [...localMigrationState.notifications.filter(notification => !existingIds.has(notification.id)), ...prev];
      });
      setLocalMigrationState(null);
      await clearAppState();
    } catch (error) {
      console.error('Failed to migrate local data to Google Drive', error);
      setPersistenceError(getSharedDataErrorMessage(error, 'Failed to migrate local data.'));
    } finally {
      setIsMigratingLocalData(false);
    }
  };

  const dismissLocalMigration = () => {
    setLocalMigrationState(null);
  };

  const updateTaskStatus = (taskId: string, newStatus: TaskStatus, newOwnerRole: Role | null, newOwnerUserIds?: string[]) => {
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
      const task = tasks[taskIndex];
      const reviewerIds = getUserIdsByRole(userList, ['reviewer', 'admin']);
      const artDirectorIds = getUserIdsByRole(userList, ['art_director']);
      const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
      const contributorIds = uniqueIds([task.createdBy, ...task.handledBy]);
      if (newStatus === 'approved_by_art_director' && task.status !== newStatus) {
        addNotifications([...artDirectorIds, ...teamLeaderIds, ...reviewerIds, ...contributorIds], taskId, `Art director approved "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_reviewer' && task.status !== newStatus) {
        addNotifications([...artDirectorIds, ...teamLeaderIds, ...contributorIds], taskId, `Reviewer requested changes on "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_art_director' && task.status !== newStatus) {
        addNotifications([...teamLeaderIds, ...reviewerIds, ...contributorIds], taskId, `Art director rejected "${task.name}" and requested changes.`);
      } else if ((newStatus === 'reviewer_approved' || newStatus === 'sent_to_art_director') && task.status !== newStatus) {
        addNotifications([...artDirectorIds, ...teamLeaderIds], taskId, `Reviewer sent "${task.name}" to art director for approval.`);
      }
    }

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const nextOwnerIds = uniqueIds(newOwnerUserIds ?? getDefaultOwnerIdsForRole(newOwnerRole, t));
        return {
          ...t,
          status: newStatus,
          currentOwnerRole: newOwnerRole,
          currentOwnerUserId: nextOwnerIds[0] || null,
          currentOwnerUserIds: nextOwnerIds,
          updatedAt: new Date().toISOString(),
        };
      }
      return t;
    }));
  };

  const updateTaskPriority = (taskId: string, priority: Priority, deadline: string | null) => {
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, priority, deadlineText: deadline, updatedAt: new Date().toISOString() };
      }
      return t;
    }));
  };

  const updateTaskAssignment = (taskId: string, handledByIds: string[], currentOwnerUserIds: string[]) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const nextHandledBy = sanitizeHandledBy([task.createdBy, ...handledByIds]);
    const nextOwnerIds = uniqueIds(currentOwnerUserIds);
    const previousAssignees = new Set([...task.handledBy, ...getCurrentOwnerUserIds(task)]);
    const addedAssignees = uniqueIds([...nextHandledBy, ...nextOwnerIds]).filter(userId => !previousAssignees.has(userId));
    if (addedAssignees.length > 0) {
      addNotifications(addedAssignees, taskId, `You were assigned to "${task.name}".`);
    }

    const message = [
      `Assigned contributors: ${nextHandledBy.map(userId => getUserDisplayName(usersObj, userId)).join(', ') || 'None'}.`,
      `Current owners: ${nextOwnerIds.map(userId => getUserDisplayName(usersObj, userId)).join(', ') || 'Role queue'}.`,
    ].join(' ');

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const now = new Date().toISOString();
      return addAuditComment({
        ...t,
        handledBy: nextHandledBy,
        currentOwnerUserId: nextOwnerIds[0] || null,
        currentOwnerUserIds: nextOwnerIds,
        updatedAt: now,
      }, currentUser.id, 'assignment_change', message, now);
    }));
  };

  const updateTaskReviewMode = (taskId: string, reviewMode: ReviewMode) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const target = getReviewRouteTarget(reviewMode);
    const shouldUpdateStatus = canReviewRouteUpdateStatus(task);
    const nextOwnerRole = shouldUpdateStatus ? target.ownerRole : task.currentOwnerRole;
    const nextOwnerIds = shouldUpdateStatus ? getDefaultOwnerIdsForRole(target.ownerRole, task) : getCurrentOwnerUserIds(task);
    const reviewerLabel = reviewMode === 'full_review' ? 'Full Review' : reviewMode === 'quick_look' ? 'Quick Look' : 'Direct to Art Director';

    if (shouldUpdateStatus && nextOwnerIds.length > 0) {
      addNotifications(nextOwnerIds, taskId, `"${task.name}" is now routed to ${reviewerLabel}.`);
    }

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const now = new Date().toISOString();
      const updatedTask = {
        ...t,
        reviewMode,
        status: shouldUpdateStatus ? target.status : t.status,
        currentOwnerRole: nextOwnerRole,
        currentOwnerUserId: nextOwnerIds[0] || null,
        currentOwnerUserIds: nextOwnerIds,
        updatedAt: now,
      };
      return addAuditComment(updatedTask, currentUser.id, 'review_route_change', `Review route changed to ${reviewerLabel}.`, now);
    }));
  };

  const updateTaskPublishSchedule = (taskId: string, schedule: { scheduledPublishAt: string | null; publishNote: string | null }) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.taskType !== 'campaign') return;

    const normalizedAt = schedule.scheduledPublishAt?.trim() || null;
    const normalizedNote = schedule.publishNote?.trim() || null;
    const scheduleChanged = task.scheduledPublishAt !== normalizedAt;
    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = getTaskParticipantIds(task, teamLeaderIds).filter(userId => userId !== currentUser.id);
    addNotifications(recipients, taskId, normalizedAt ? `Campaign publish schedule updated for "${task.name}".` : `Campaign publish schedule cleared for "${task.name}".`);

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const now = new Date().toISOString();
      const message = normalizedAt
        ? `Publish scheduled for ${new Date(normalizedAt).toLocaleString()}${normalizedNote ? `: ${normalizedNote}` : '.'}`
        : 'Publish schedule cleared.';
      return addAuditComment({
        ...t,
        scheduledPublishAt: normalizedAt,
        publishNote: normalizedNote,
        publishedAt: scheduleChanged ? null : t.publishedAt,
        publishReminderSentAt: scheduleChanged ? null : t.publishReminderSentAt,
        updatedAt: now,
      }, currentUser.id, 'publish_schedule_change', message, now);
    }));
  };

  const markCampaignPublished = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.taskType !== 'campaign') return;

    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = getTaskParticipantIds(task, teamLeaderIds).filter(userId => userId !== currentUser.id);
    addNotifications(recipients, taskId, `Campaign "${task.name}" was marked as published.`);

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const now = new Date().toISOString();
      return addAuditComment({
        ...t,
        publishedAt: now,
        updatedAt: now,
      }, currentUser.id, 'campaign_published', `Campaign marked as published at ${new Date(now).toLocaleString()}.`, now);
    }));
  };

  const markPublishReminderSent = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.taskType !== 'campaign' || !task.scheduledPublishAt || task.publishedAt || task.publishReminderSentAt) return;

    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = getTaskParticipantIds(task, teamLeaderIds);
    const publishDate = new Date(task.scheduledPublishAt);
    const isOverdue = publishDate.getTime() < Date.now();
    addNotifications(recipients, taskId, `${isOverdue ? 'Overdue' : 'Upcoming'} campaign publish: "${task.name}" is scheduled for ${publishDate.toLocaleString()}.`);

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => (
      t.id === taskId
        ? { ...t, publishReminderSentAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        : t
    )));
  };

  const addTask = (task: Task) => {
    const normalizedTaskBase = normalizeReviewerCreatedTask(task, usersObj);
    const ownerIds = getCurrentOwnerUserIds(normalizedTaskBase);
    const finalOwnerIds = ownerIds.length > 0 ? ownerIds : getDefaultOwnerIdsForRole(normalizedTaskBase.currentOwnerRole, normalizedTaskBase);
    const normalizedTask = {
      ...normalizedTaskBase,
      currentOwnerUserId: finalOwnerIds[0] || null,
      currentOwnerUserIds: finalOwnerIds,
    };
    queueTaskBroadcast(normalizedTask.id);
    setTasks(prev => [normalizedTask, ...prev]);
  };

  const addTaskVersion = (taskId: string, version: TaskVersion) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const sendToMarwa = isReviewerCreatedTask(task, usersObj) || task.status === 'changes_requested_by_art_director' || task.reviewMode === 'direct_to_ad';
    const nextStatus: TaskStatus = sendToMarwa
      ? 'sent_to_art_director'
      : task.reviewMode === 'quick_look'
        ? 'waiting_reviewer_quick_look'
        : 'waiting_reviewer_full_review';
    const nextOwnerRole: Role = sendToMarwa ? 'art_director' : 'reviewer';
    const nextOwnerIds = getDefaultOwnerIdsForRole(nextOwnerRole, task);
    const creatorName = usersObj[task.createdBy]?.name || 'Someone';
    const reviewerIds = getUserIdsByRole(userList, ['reviewer', 'admin']);
    const artDirectorIds = getUserIdsByRole(userList, ['art_director']);
    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = (sendToMarwa
      ? [...nextOwnerIds, ...artDirectorIds, ...teamLeaderIds, ...reviewerIds]
      : [...nextOwnerIds, ...reviewerIds, ...teamLeaderIds]
    ).filter(userId => userId !== task.createdBy);

    addNotifications(recipients, taskId, `${creatorName} uploaded V${version.versionNumber} for "${task.name}".`);

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;

      const thumbnailFile = version.files?.find(file => file.type.startsWith('image/'));
      const previewFile = version.files?.find(file => file.previewUrl && file.previewStoragePath);

      return {
        ...t,
        versions: [version, ...t.versions],
        handledBy: sanitizeHandledBy([...t.handledBy, version.submittedBy]),
        status: nextStatus,
        currentOwnerRole: nextOwnerRole,
        currentOwnerUserId: nextOwnerIds[0] || null,
        currentOwnerUserIds: nextOwnerIds,
        thumbnailUrl: previewFile?.previewUrl || thumbnailFile?.previewUrl || '',
        thumbnailStoragePath: previewFile?.previewStoragePath || thumbnailFile?.previewStoragePath,
        updatedAt: new Date().toISOString(),
      };
    }));
  };

  const replaceTaskVersionFiles = (taskId: string, versionId: string, files: UploadedTaskFile[]) => {
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;

      const versions = task.versions.map(version => (
        version.id === versionId
          ? {
              ...version,
              files,
              fileUrl: files[0]?.url || version.fileUrl,
          }
        : version
      ));
      const thumbnailFile = versions[0]?.files?.find(file => file.previewUrl && file.previewStoragePath);

      return {
        ...task,
        versions,
        thumbnailUrl: thumbnailFile?.previewUrl || task.thumbnailUrl,
        thumbnailStoragePath: thumbnailFile?.previewStoragePath || task.thumbnailStoragePath,
        updatedAt: new Date().toISOString(),
      };
    }));
  };

  const updateTaskMediaPreviews = (taskId: string, updates: { versions: TaskVersion[]; comments?: TaskComment[]; thumbnailUrl: string; thumbnailStoragePath?: string }) => {
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      const incomingVersionsById = new Map(updates.versions.map(version => [version.id, version]));
      const versions = task.versions.map(version => incomingVersionsById.get(version.id) || version);
      const incomingCommentsById = new Map((updates.comments || []).map(comment => [comment.id, comment]));
      const comments = updates.comments
        ? (task.comments || []).map(comment => incomingCommentsById.get(comment.id) || comment)
        : task.comments;
      const latestPreviewFile = versions[0]?.files?.find(file => file.previewUrl && file.previewStoragePath);
      const updateMatchesLatestVersion = task.versions[0]?.id === updates.versions[0]?.id;

      return {
        ...task,
        versions,
        comments,
        thumbnailUrl: latestPreviewFile?.previewUrl || (updateMatchesLatestVersion ? updates.thumbnailUrl : task.thumbnailUrl),
        thumbnailStoragePath: latestPreviewFile?.previewStoragePath || (updateMatchesLatestVersion ? updates.thumbnailStoragePath : task.thumbnailStoragePath),
      };
    }));
  };

  const addTaskComment = (taskId: string, comment: Omit<TaskComment, 'id' | 'createdAt'>) => {
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;

      const newComment: TaskComment = {
        ...comment,
        id: Math.random().toString(36).substring(7),
        createdAt: new Date().toISOString(),
      };

      return {
        ...task,
        comments: [...(task.comments || []), newComment],
        updatedAt: new Date().toISOString(),
      };
    }));
  };

  return (
    <AppContext.Provider value={{
      currentUser,
      authStatus,
      authProfile,
      authError,
      accountProfiles,
      environment,
      tasks,
      users: usersObj,
      userList,
      notifications,
      persistenceMode: isSharedWorkspaceActive ? 'drive' : 'local',
      persistenceError,
      localMigrationCount: (localMigrationState?.tasks.length || 0) + (localMigrationState?.notifications.length || 0),
      isMigratingLocalData,
      driveStatus,
      driveUserEmail,
      driveRootFolder,
      isConnectingDrive,
      isChoosingDriveRoot,
      isImportingDriveTasks,
      setEnvironment,
      updateTaskStatus,
      updateTaskPriority,
      updateTaskAssignment,
      updateTaskReviewMode,
      updateTaskPublishSchedule,
      markCampaignPublished,
      markPublishReminderSent,
      addTaskComment,
      addTaskVersion,
      replaceTaskVersionFiles,
      updateTaskMediaPreviews,
      addTask,
      addNotification,
      markNotificationAsRead,
      loginWithPassword,
      logout,
      archiveTask,
      unarchiveTask,
      connectGoogleDrive,
      disconnectGoogleDrive,
      chooseDriveRoot,
      importDriveTasks,
      migrateLocalDataToDrive,
      dismissLocalMigration,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppStore() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppStore must be used within AppProvider');
  return ctx;
}
