import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { AccountProfile, AuthStatus, User, Role, Environment, Task, TaskStatus, Priority, TaskType, Notification, TaskComment, TaskVersion, UploadedTaskFile } from './types';
import { demoAccounts, guestTasks, initialUsers, initialTasks } from './mockData';
import { clearAppState, loadAppState, saveAppState } from './localDb';
import { shouldAutoArchiveTask } from './archiveUtils';
import { sanitizeHandledBy } from './handlerUtils';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import {
  fetchSupabaseNotifications,
  fetchSupabaseTasks,
  uploadTaskFiles,
  upsertSupabaseNotifications,
  upsertSupabaseTask,
} from './supabaseDb';
import { addLowResPreviewsToFiles, getTaskFiles } from './previewUtils';

const REVIEWER_WAITING_STATUSES: TaskStatus[] = ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'];
const CURRENT_USER_STORAGE_KEY = 'national-care-current-user-id';
const USE_SHARED_SUPABASE_DATA = true;
const SHARED_DATA_CHANNEL = 'approval-flow-shared-data';
const SHARED_DATA_EVENT = 'state-change';
const SHARED_DATA_POLL_INTERVAL_MS = 2500;
const GUEST_USER: User = {
  id: 'guest',
  name: 'Guest',
  role: 'team_member',
  jobTitle: 'Not signed in',
};

function isSharedWorkspaceStatus(status: AuthStatus) {
  return USE_SHARED_SUPABASE_DATA && isSupabaseConfigured && status === 'approved';
}

function isLocalWorkspaceStatus(status: AuthStatus) {
  return !isSharedWorkspaceStatus(status) && status === 'approved';
}

type AuthActionResult = {
  ok: boolean;
  message?: string;
  needsEmailConfirmation?: boolean;
};

type SharedDataPayload =
  | { type: 'task_upsert'; task: Task }
  | { type: 'notification_upsert'; notification: Notification };

type SharedDataMessage = SharedDataPayload & { originClientId: string };

function createClientId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}

function getSharedDataErrorMessage(error: unknown, fallback: string) {
  const message = getErrorMessage(error, fallback);
  const normalizedMessage = message.toLowerCase();
  const isPolicyError = normalizedMessage.includes('permission denied') || normalizedMessage.includes('row-level security');
  const isWorkflowTableError = normalizedMessage.includes('approval_tasks') || normalizedMessage.includes('approval_notifications');

  if (isPolicyError && isWorkflowTableError) {
    return 'Supabase policies need updating. Run the updated supabase.sql in this project, then refresh.';
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
    const acceptedNames = [
      user.id,
      user.name,
      user.name.split(/\s+/)[0],
      user.email || '',
    ].filter(Boolean).map(normalizeCredentialValue);

    return acceptedNames.includes(normalizedIdentifier) && normalizeCredentialValue(account.password) === normalizedPassword;
  }) || null;
}

function getStoredDemoUser() {
  if (typeof window === 'undefined') return GUEST_USER;
  const storedUserId = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);
  return demoAccounts.find(account => account.user.id === storedUserId)?.user || GUEST_USER;
}

function createDemoSeedTasks(): Task[] {
  const ownerByTaskId: Record<string, string> = {
    guest_seed_waiting_reviewer: 'user_4',
    guest_seed_waiting_ad: 'user_5',
    guest_seed_returned: 'user_6',
    guest_seed_approved: 'user_4',
  };

  return guestTasks.map(task => {
    const ownerId = ownerByTaskId[task.id] || 'user_4';

    return {
      ...task,
      createdBy: ownerId,
      handledBy: task.handledBy.map(userId => userId === 'guest' ? ownerId : userId),
      currentOwnerUserId: task.currentOwnerUserId === 'guest' ? ownerId : task.currentOwnerUserId,
      versions: task.versions.map(version => ({
        ...version,
        submittedBy: version.submittedBy === 'guest' ? ownerId : version.submittedBy,
      })),
    };
  });
}

function mergeDemoSeedTasks(tasks: Task[], users: Record<string, User>) {
  const existingIds = new Set(tasks.map(task => task.id));
  const missingSeedTasks = createDemoSeedTasks().filter(task => !existingIds.has(task.id));

  return sortTasksByUpdate(reviveTaskFiles([...tasks, ...missingSeedTasks], users));
}

function getUserIdsByRole(users: User[], roles: Role[]) {
  return users
    .filter(user => roles.includes(user.role))
    .map(user => user.id);
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
  };
}

function coerceTask(task: Partial<Task> & { id?: string }): Task | null {
  if (!task || !task.id) return null;

  const now = new Date().toISOString();
  const versions = Array.isArray(task.versions) ? task.versions : [];

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
    priority: task.priority || 'not_set',
    deadlineText: task.deadlineText ?? null,
    versions,
    comments: Array.isArray(task.comments) ? task.comments : [],
    thumbnailUrl: task.thumbnailUrl || '',
    thumbnailStoragePath: task.thumbnailStoragePath,
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

  return `${task.id}:${task.updatedAt}:${task.status}:${task.archivedAt || ''}:${task.thumbnailStoragePath || ''}:${previewKey}:${commentImageKey}`;
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

    const uploadedFiles = await uploadTaskFiles(task.id, version.files);
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
  persistenceMode: 'supabase' | 'local';
  persistenceError: string | null;
  localMigrationCount: number;
  isMigratingLocalData: boolean;
}

interface AppContextType extends AppState {
  setEnvironment: (env: Environment) => void;
  updateTaskStatus: (taskId: string, newStatus: TaskStatus, newOwnerRole: Role | null) => void;
  updateTaskPriority: (taskId: string, priority: Priority, deadline: string | null) => void;
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
  migrateLocalDataToSupabase: () => Promise<void>;
  dismissLocalMigration: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const initialDemoUser = getStoredDemoUser();
  const hasLoadedPersistedState = useRef(false);
  const clientIdRef = useRef(createClientId());
  const sharedDataChannelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const isSharedDataChannelReadyRef = useRef(false);
  const pendingTaskBroadcastIdsRef = useRef<Set<string>>(new Set());
  const pendingNotificationBroadcastIdsRef = useRef<Set<string>>(new Set());
  const queuedSharedDataMessagesRef = useRef<SharedDataMessage[]>([]);
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
  const currentUser = currentUserState;

  const sendSharedDataMessage = (message: SharedDataPayload) => {
    if (!isSupabaseConfigured || !supabase) return;

    const sharedMessage = {
      ...message,
      originClientId: clientIdRef.current,
    } as SharedDataMessage;

    if (!isSharedDataChannelReadyRef.current || !sharedDataChannelRef.current) {
      queuedSharedDataMessagesRef.current.push(sharedMessage);
      return;
    }

    void sharedDataChannelRef.current
      .send({
        type: 'broadcast',
        event: SHARED_DATA_EVENT,
        payload: sharedMessage,
      })
      .catch(error => {
        console.error('Failed to broadcast shared data change', error);
      });
  };

  const flushQueuedSharedDataMessages = () => {
    if (!isSharedDataChannelReadyRef.current || !sharedDataChannelRef.current) return;

    const queuedMessages = queuedSharedDataMessagesRef.current.splice(0);
    queuedMessages.forEach(message => {
      void sharedDataChannelRef.current
        ?.send({
          type: 'broadcast',
          event: SHARED_DATA_EVENT,
          payload: message,
        })
        .catch(error => {
          console.error('Failed to broadcast queued shared data change', error);
        });
    });
  };

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
    if (!isLocalWorkspaceStatus(authStatus)) return;

    let isMounted = true;
    hasLoadedPersistedState.current = false;

    loadAppState()
      .then(localState => {
        if (!isMounted) return;

        const localTasks = Array.isArray(localState?.tasks) ? localState.tasks : initialTasks;
        setTasks(mergeDemoSeedTasks(localTasks, usersObj));
        setNotifications(Array.isArray(localState?.notifications) ? localState.notifications.filter(notification => notification?.id) : []);
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
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== 'approved' || !hasLoadedPersistedState.current) return;

    const autoArchiveTasks = tasks.filter(task => shouldAutoArchiveTask(task));
    if (autoArchiveTasks.length === 0) return;

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
    if (!isSharedWorkspaceStatus(authStatus)) return;

    let isMounted = true;
    hasLoadedPersistedState.current = false;

    Promise.all([fetchSupabaseTasks(), fetchSupabaseNotifications(), loadAppState()])
      .then(([loadedTasks, loadedNotifications, localState]) => {
        if (!isMounted) return;

        const sharedTasks = mergeDemoSeedTasks(loadedTasks, usersObj);
        const sharedNotifications = loadedNotifications.filter(notification => notification?.id);
        const localTasks = Array.isArray(localState?.tasks) ? reviveTaskFiles(localState.tasks, usersObj) : [];
        const localNotifications = Array.isArray(localState?.notifications)
          ? localState.notifications.filter(notification => notification?.id)
          : [];

        setTasks(mergeTasksIntoState(sharedTasks, localTasks));
        setNotifications(mergeNotificationsIntoState(sharedNotifications, localNotifications));
        setLocalMigrationState(null);
        setPersistenceError(null);
      })
      .catch(async error => {
        console.error('Failed to load persisted app state', error);
        if (!isMounted) return;

        try {
          const localState = await loadAppState();
          if (!isMounted) return;

          const localTasks = Array.isArray(localState?.tasks) ? localState.tasks : initialTasks;
          const localNotifications = Array.isArray(localState?.notifications)
            ? localState.notifications.filter(notification => notification?.id)
            : [];

          setTasks(mergeDemoSeedTasks(localTasks, usersObj));
          setNotifications(localNotifications);
        } catch (localError) {
          console.error('Failed to load local fallback workspace', localError);
        }

        setPersistenceError(getSharedDataErrorMessage(error, 'Failed to load persisted app state.'));
      })
      .finally(() => {
        if (isMounted) hasLoadedPersistedState.current = true;
      });

    return () => {
      isMounted = false;
    };
  }, [authStatus, currentUser.id]);

  useEffect(() => {
    if (!isSharedWorkspaceStatus(authStatus) || !hasLoadedPersistedState.current) return;

    const pendingTaskIds = Array.from(pendingTaskBroadcastIdsRef.current);
    const pendingNotificationIds = Array.from(pendingNotificationBroadcastIdsRef.current);
    pendingTaskBroadcastIdsRef.current.clear();
    pendingNotificationBroadcastIdsRef.current.clear();

    pendingTaskIds.forEach(taskId => {
      const task = tasks.find(item => item.id === taskId);
      if (task) sendSharedDataMessage({ type: 'task_upsert', task });
    });
    pendingNotificationIds.forEach(notificationId => {
      const notification = notifications.find(item => item.id === notificationId);
      if (notification) sendSharedDataMessage({ type: 'notification_upsert', notification });
    });

    const saveState = Promise.all([
      ...tasks.map(task => upsertSupabaseTask(task)),
      upsertSupabaseNotifications(notifications),
    ]);

    saveState
      .then(() => {
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to save app state', error);
        setPersistenceError(getSharedDataErrorMessage(error, 'Failed to save app state.'));
      });
  }, [tasks, notifications, authStatus]);

  useEffect(() => {
    if (!isLocalWorkspaceStatus(authStatus) || !hasLoadedPersistedState.current) return;

    saveAppState({ tasks, notifications })
      .then(() => {
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to save local demo workspace', error);
        setPersistenceError(getErrorMessage(error, 'Failed to save local demo workspace.'));
      });
  }, [tasks, notifications, authStatus]);

  useEffect(() => {
    if (!isSharedWorkspaceStatus(authStatus) || !supabase) return;

    const channel = supabase
      .channel(SHARED_DATA_CHANNEL, {
        config: {
          broadcast: { ack: true, self: false },
        },
      })
      .on('broadcast', { event: SHARED_DATA_EVENT }, payload => {
        const message = payload.payload as SharedDataMessage | undefined;
        if (!message || message.originClientId === clientIdRef.current) return;

        if (message.type === 'task_upsert') {
          const revivedTask = reviveTaskFiles([message.task], usersObj)[0];
          if (revivedTask) {
            setTasks(prev => mergeTaskIntoState(prev, revivedTask));
          }
          return;
        }

        if (message.type === 'notification_upsert') {
          setNotifications(prev => mergeNotificationIntoState(prev, message.notification));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_tasks' }, payload => {
        if (payload.eventType === 'DELETE') {
          const row = payload.old as { id?: string } | null;
          if (row?.id) {
            setTasks(prev => prev.filter(task => task.id !== row.id));
          }
          return;
        }

        const row = payload.new as { payload?: Task } | null;
        const task = row?.payload;
        if (!task) return;

        setTasks(prev => {
          const revivedTask = reviveTaskFiles([task], usersObj)[0];
          return revivedTask ? mergeTaskIntoState(prev, revivedTask) : prev;
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_notifications' }, payload => {
        if (payload.eventType === 'DELETE') {
          const row = payload.old as { id?: string } | null;
          if (row?.id) {
            setNotifications(prev => prev.filter(notification => notification.id !== row.id));
          }
          return;
        }

        const row = payload.new as { payload?: Notification } | null;
        const notification = row?.payload;
        if (!notification) return;

        setNotifications(prev => mergeNotificationIntoState(prev, notification));
      })
      .subscribe(status => {
        isSharedDataChannelReadyRef.current = status === 'SUBSCRIBED';
        if (status === 'SUBSCRIBED') {
          flushQueuedSharedDataMessages();
        }
      });

    sharedDataChannelRef.current = channel;

    return () => {
      isSharedDataChannelReadyRef.current = false;
      sharedDataChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [authStatus, currentUser.id]);

  useEffect(() => {
    if (!isSharedWorkspaceStatus(authStatus)) return;

    let isMounted = true;
    let isPolling = false;

    const syncLatestSharedData = async () => {
      if (!hasLoadedPersistedState.current || isPolling) return;

      isPolling = true;
      try {
        const [latestTasks, latestNotifications] = await Promise.all([
          fetchSupabaseTasks(),
          fetchSupabaseNotifications(),
        ]);

        if (!isMounted) return;

        setTasks(prev => mergeTasksIntoState(prev, reviveTaskFiles(latestTasks, usersObj)));
        setNotifications(prev => mergeNotificationsIntoState(prev, latestNotifications.filter(notification => notification?.id)));
        setPersistenceError(null);
      } catch (error) {
        console.error('Failed to sync latest shared data', error);
        if (isMounted) {
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

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authStatus, currentUser.id]);

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

  const migrateLocalDataToSupabase = async () => {
    if (!isSharedWorkspaceStatus(authStatus) || !localMigrationState || isMigratingLocalData) return;

    setIsMigratingLocalData(true);
    setPersistenceError(null);

    try {
      const uploadedTasks = await Promise.all(localMigrationState.tasks.map(uploadMigratedTaskFiles));

      await Promise.all([
        ...uploadedTasks.map(task => upsertSupabaseTask(task)),
        upsertSupabaseNotifications(localMigrationState.notifications),
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
      console.error('Failed to migrate local data to Supabase', error);
      setPersistenceError(getSharedDataErrorMessage(error, 'Failed to migrate local data.'));
    } finally {
      setIsMigratingLocalData(false);
    }
  };

  const dismissLocalMigration = () => {
    setLocalMigrationState(null);
  };

  const updateTaskStatus = (taskId: string, newStatus: TaskStatus, newOwnerRole: Role | null) => {
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
      const task = tasks[taskIndex];
      const reviewerIds = getUserIdsByRole(userList, ['reviewer', 'admin']);
      const artDirectorIds = getUserIdsByRole(userList, ['art_director']);
      const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
      if (newStatus === 'approved_by_art_director' && task.status !== newStatus) {
        addNotifications([...artDirectorIds, ...teamLeaderIds, ...reviewerIds, task.createdBy, ...task.handledBy], taskId, `Art director approved "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_reviewer' && task.status !== newStatus) {
        addNotifications([...artDirectorIds, ...teamLeaderIds, task.createdBy], taskId, `Reviewer requested changes on "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_art_director' && task.status !== newStatus) {
        addNotifications([...teamLeaderIds, ...reviewerIds, task.createdBy], taskId, `Art director rejected "${task.name}" and requested changes.`);
      } else if ((newStatus === 'reviewer_approved' || newStatus === 'sent_to_art_director') && task.status !== newStatus) {
        addNotifications([...artDirectorIds, ...teamLeaderIds], taskId, `Reviewer sent "${task.name}" to art director for approval.`);
      }
    }

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, status: newStatus, currentOwnerRole: newOwnerRole, updatedAt: new Date().toISOString() };
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

  const addTask = (task: Task) => {
    const normalizedTask = normalizeReviewerCreatedTask(task, usersObj);
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
    const creatorName = usersObj[task.createdBy]?.name || 'Someone';
    const reviewerIds = getUserIdsByRole(userList, ['reviewer', 'admin']);
    const artDirectorIds = getUserIdsByRole(userList, ['art_director']);
    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = (sendToMarwa
      ? [...artDirectorIds, ...teamLeaderIds, ...reviewerIds]
      : [...reviewerIds, ...teamLeaderIds]
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
        currentOwnerUserId: null,
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
      persistenceMode: isSharedWorkspaceStatus(authStatus) ? 'supabase' : 'local',
      persistenceError,
      localMigrationCount: (localMigrationState?.tasks.length || 0) + (localMigrationState?.notifications.length || 0),
      isMigratingLocalData,
      setEnvironment,
      updateTaskStatus,
      updateTaskPriority,
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
      migrateLocalDataToSupabase,
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
