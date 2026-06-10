import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { AccountProfile, AppSettings, AuthStatus, User, Role, Environment, Task, TaskStatus, Priority, TaskType, Notification, TaskComment, TaskVersion, UploadedTaskFile, ReviewMode } from './types';
import { initialUsers, initialTasks, userRoleLabels } from './mockData';
import { supabase } from './supabaseClient';
import { clearAppState, loadAppState, saveAppState } from './localDb';
import { shouldAutoArchiveTask } from './archiveUtils';
import { sanitizeHandledBy } from './handlerUtils';
import {
  canManageAppSettings,
  defaultAppSettings,
  getResponsibilityLabelForRole,
  mergeAppSettings,
  normalizeSettingId,
  sanitizeHandledByWithSettings,
} from './appSettings';
import { enrichLinkedTaskFileMetadata, needsLinkedTaskFileMetadata } from './linkAttachments';
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
import { canCreateWorkAssignment, canManageWorkAssignment, getAssignmentPeriodFromDeadline } from './workAssignmentUtils';
import {
  fetchDriveNotifications,
  fetchDriveSettings,
  fetchDriveTasks,
  importDriveSelectionToTasks,
  uploadTaskFiles,
  upsertDriveSettings,
  upsertDriveNotifications,
  upsertDriveTask,
  USE_SHARED_DRIVE_DATA,
  deleteDriveTask,
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

type WorkAssignmentInput = {
  name: string;
  description: string;
  priority: Priority;
  deadlineAt: string;
  assignmentLinks: string[];
  handledByIds: string[];
  isOvertime?: boolean;
  taskType?: string;
  needsContentRevision?: boolean;
};

type WorkAssignmentUploadPayload = {
  taskType: TaskType;
  reviewMode: ReviewMode;
  scheduledPublishAt: string | null;
  publishNote: string | null;
  version: TaskVersion;
  thumbnailUrl: string;
  thumbnailStoragePath?: string;
  driveFolderId?: string;
};

const SHARED_DATA_POLL_INTERVAL_MS = 60 * 1000;
const GUEST_SEED_ID_PREFIX = 'guest_seed_';
const HUMAN_COMMENT_ACTIONS = new Set<TaskComment['action']>([
  'review_note',
  'request_edits',
  'sent_to_marwa',
  'marwa_rejection',
  'content_approved',
  'content_rejected',
]);
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

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}



function isGuestSeedTask(task: Pick<Task, 'id' | 'code'> | null | undefined) {
  return Boolean(task?.id?.startsWith(GUEST_SEED_ID_PREFIX) || task?.code?.startsWith('GST-'));
}

function isPlaceholderTask(task: Pick<Task, 'id' | 'code' | 'name'> | null | undefined) {
  return Boolean(
    task?.id?.startsWith('placeholder_') ||
    task?.code?.startsWith('TMP-') ||
    task?.name?.startsWith('Placeholder - ')
  );
}

function isAdminUser(user: Pick<User, 'role' | 'isAdmin'>) {
  return Boolean(user.isAdmin) || user.role === 'admin';
}

function canEditOrDeleteComment(comment: TaskComment, user: Pick<User, 'id' | 'role' | 'isAdmin'>) {
  if (comment.isDeleted) return false;
  return HUMAN_COMMENT_ACTIONS.has(comment.action)
    ? comment.authorId === user.id
    : isAdminUser(user);
}

function cloneCommentSections(sections: TaskComment['sections']) {
  return sections.map(section => ({ ...section }));
}

function coerceTaskComment(comment: Partial<TaskComment> & { id?: string }, fallbackAuthorId: string): TaskComment | null {
  if (!comment || !comment.id) return null;

  return {
    id: comment.id,
    authorId: comment.authorId || fallbackAuthorId,
    action: comment.action || 'review_note',
    message: comment.message,
    sections: Array.isArray(comment.sections) ? comment.sections.map(section => ({ ...section })) : [],
    createdAt: comment.createdAt || new Date().toISOString(),
    updatedAt: comment.updatedAt,
    editedBy: comment.editedBy,
    isEdited: Boolean(comment.isEdited || (Array.isArray(comment.editHistory) && comment.editHistory.length > 0)),
    editHistory: Array.isArray(comment.editHistory)
      ? comment.editHistory.map(version => ({
          ...version,
          previousSections: Array.isArray(version.previousSections) ? cloneCommentSections(version.previousSections) : [],
          nextSections: Array.isArray(version.nextSections) ? cloneCommentSections(version.nextSections) : [],
        }))
      : [],
    deletedAt: comment.deletedAt,
    deletedBy: comment.deletedBy,
    isDeleted: Boolean(comment.isDeleted || comment.deletedAt),
  };
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
  return sortTasksByUpdate(reviveTaskFiles(tasks.filter(task => !isGuestSeedTask(task) && !isPlaceholderTask(task)), users));
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

function createTaskCode(prefix = 'TSK') {
  return `${prefix}-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

function formatDeadlineText(deadlineAt?: string | null) {
  if (!deadlineAt) return null;
  const parsed = new Date(deadlineAt);
  return Number.isNaN(parsed.getTime()) ? deadlineAt : parsed.toLocaleString();
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
  const currentOwnerRole = task.currentOwnerRole ?? null;
  const rawCurrentOwnerUserIds = uniqueIds([
    ...(Array.isArray(task.currentOwnerUserIds) ? task.currentOwnerUserIds : []),
    task.currentOwnerUserId,
  ]);
  const currentOwnerUserIds = currentOwnerRole === 'team_member'
    ? sanitizeHandledBy(rawCurrentOwnerUserIds)
    : rawCurrentOwnerUserIds;

  return {
    id: task.id,
    code: task.code || `TSK-${task.id}`,
    name: task.name || 'Untitled task',
    description: task.description ?? null,
    taskType: task.taskType || 'others',
    reviewMode: task.reviewMode || 'full_review',
    environment: task.environment || 'production',
    createdBy: task.createdBy || initialUsers[0]?.id || 'unknown_user',
    handledBy: sanitizeHandledBy(Array.isArray(task.handledBy) ? task.handledBy : [task.createdBy || initialUsers[0]?.id || 'unknown_user']),
    status: task.status || 'submitted',
    currentOwnerRole,
    currentOwnerUserId: currentOwnerUserIds[0] || null,
    currentOwnerUserIds,
    priority: task.priority || 'not_set',
    deadlineText: task.deadlineText ?? null,
    assignmentPeriod: task.assignmentPeriod ?? null,
    assignmentLinks: Array.isArray(task.assignmentLinks) ? task.assignmentLinks : [],
    deadlineAt: task.deadlineAt ?? null,
    assignmentUploadedAt: task.assignmentUploadedAt ?? null,
    scheduledPublishAt: task.scheduledPublishAt ?? null,
    publishNote: task.publishNote ?? null,
    publishedAt: task.publishedAt ?? null,
    publishReminderSentAt: task.publishReminderSentAt ?? null,
    versions,
    comments: Array.isArray(task.comments)
      ? task.comments.map(comment => coerceTaskComment(comment, task.createdBy || initialUsers[0]?.id || 'unknown_user')).filter(Boolean)
      : [],
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
      const files = version.files?.map((file, idx) => {
        let name = file.name;
        if (!name || name === 'Google Drive file' || name === 'Google Docs file' || name === 'Google Drive folder' || name === 'Uploaded file' || name === 'Drive file') {
          name = version.files && version.files.length > 1 ? `${task.name} (${idx + 1})` : task.name;
        }
        return {
          ...file,
          name,
          storageProvider: file.storageProvider || (file.driveFileId ? 'drive' : file.blob || file.url?.startsWith('blob:') ? 'local' : file.storageProvider),
          url: file.blob ? URL.createObjectURL(file.blob) : file.url,
        };
      });

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
    task.description || '',
    task.assignmentPeriod || '',
    (task.assignmentLinks || []).join(','),
    task.deadlineAt || '',
    task.assignmentUploadedAt || '',
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
  customResponsibilities: string[];
  appSettings: AppSettings;
  canManageSettings: boolean;
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
  toggleTaskHold: (taskId: string) => void;
  updateTaskPriority: (taskId: string, priority: Priority, deadline: string | null) => void;
  updateTaskAssignment: (taskId: string, handledByIds: string[], currentOwnerUserIds: string[]) => void;
  updateTaskReviewMode: (taskId: string, reviewMode: ReviewMode) => void;
  updateTaskPublishSchedule: (taskId: string, schedule: { scheduledPublishAt: string | null; publishNote: string | null }) => void;
  markCampaignPublished: (taskId: string) => void;
  markPublishReminderSent: (taskId: string) => void;
  markWeekReminderSent: (taskId: string) => void;
  submitScheduledCampaign: (input: { name: string; taskType: 'campaign' | 'media_buying'; scheduledPublishAt: string; publishNote?: string | null; platform?: string | null; budgetAmount?: number | null; budgetCurrency?: string | null }) => void;
  editScheduledCampaign: (taskId: string, input: { name: string; taskType: 'campaign' | 'media_buying'; scheduledPublishAt: string; publishNote?: string | null; platform?: string | null; budgetAmount?: number | null; budgetCurrency?: string | null }) => void;
  createWorkAssignment: (input: WorkAssignmentInput) => void;
  updateWorkAssignment: (taskId: string, input: WorkAssignmentInput) => void;
  submitWorkAssignmentUpload: (taskId: string, payload: WorkAssignmentUploadPayload) => void;
  addTaskComment: (taskId: string, comment: Omit<TaskComment, 'id' | 'createdAt'>) => void;
  updateTaskComment: (taskId: string, commentId: string, changes: Pick<TaskComment, 'message' | 'sections'>) => void;
  deleteTaskComment: (taskId: string, commentId: string) => void;
  addTaskVersion: (taskId: string, version: TaskVersion) => void;
  replaceTaskVersionFiles: (taskId: string, versionId: string, files: UploadedTaskFile[]) => void;
  updateTaskMediaPreviews: (taskId: string, updates: { versions: TaskVersion[]; comments?: TaskComment[]; thumbnailUrl: string; thumbnailStoragePath?: string }) => void;
  addTask: (task: Task) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void;
  markNotificationAsRead: (id: string) => void;
  loginWithPassword: (identifier: string, password: string) => Promise<AuthActionResult>;
  signupWithEmail: (email: string, password: string, name?: string) => Promise<AuthActionResult>;
  updateUserRole: (userId: string, role: Role) => void;
  updateUserResponsibility: (userId: string, responsibility: string, permissionRole?: Role) => void;
  addCustomResponsibility: (responsibility: string) => void;
  updateAppSettings: (updater: AppSettings | ((settings: AppSettings) => AppSettings)) => void;
  deleteUserAccount: (userId: string) => void;
  logout: () => Promise<void>;
  archiveTask: (taskId: string, reason?: string) => void;
  unarchiveTask: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
  connectGoogleDrive: () => Promise<void>;
  disconnectGoogleDrive: () => void;
  chooseDriveRoot: () => Promise<void>;
  importDriveTasks: () => Promise<void>;
  migrateLocalDataToDrive: () => Promise<void>;
  dismissLocalMigration: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const hasLoadedPersistedState = useRef(false);
  const sharedDataLoadFailedRef = useRef(false);
  const pendingTaskBroadcastIdsRef = useRef<Set<string>>(new Set());
  const pendingNotificationBroadcastIdsRef = useRef<Set<string>>(new Set());
  const pendingSettingsBroadcastRef = useRef(false);
  const linkedMetadataBackfillAttemptsRef = useRef<Set<string>>(new Set());
  const [accountProfiles, setAccountProfiles] = useState<AccountProfile[]>([]);
  const [customResponsibilities, setCustomResponsibilities] = useState<string[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => mergeAppSettings(defaultAppSettings));
  const [authProfile, setAuthProfile] = useState<AccountProfile | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [authError, setAuthError] = useState<string | null>(null);
  const [userList, setUserList] = useState<User[]>([]);
  const usersObj = userList.reduce((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {} as Record<string, User>);

  const [currentUserState, setCurrentUserState] = useState<User>(GUEST_USER);
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
  const [isMinaSettingsUnlocked, setIsMinaSettingsUnlocked] = useState(() => {
    try {
      return window.sessionStorage.getItem('national-care-settings-unlocked-for-mina') === '1';
    } catch {
      return false;
    }
  });
  const currentUser = currentUserState;
  const canManageSettings = (() => {
    const isMina = currentUser.email === 'minamagdy5555@gmail.com' || currentUser.id === 'user_1';
    if (isMina) {
      return isMinaSettingsUnlocked;
    }
    return canManageAppSettings(currentUser, appSettings);
  })();
  const isSharedWorkspaceActive = isSharedWorkspaceStatus(authStatus);
  const isDriveWorkspaceReady = isSharedWorkspaceActive && hasDriveToken && Boolean(driveRootFolder);
  const driveStatus: DriveAuthStatus = !USE_SHARED_DRIVE_DATA
    ? 'disabled'
    : !isGoogleDriveConfigured
      ? 'needs_auth'
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

  const queueSettingsBroadcast = () => {
    pendingSettingsBroadcastRef.current = true;
  };

  const fetchProfiles = async () => {
    try {
      const { data, error } = await supabase.from('profiles').select('*');
      if (error) {
        console.error('Error fetching profiles from Supabase:', error.message);
        return;
      }
      if (data) {
        const list: User[] = data.map(profile => ({
          id: profile.id,
          email: profile.email,
          name: profile.name,
          role: profile.role as Role,
          jobTitle: profile.job_title || userRoleLabels[profile.role] || 'Content Creator',
          isAdmin: profile.is_admin,
        }));
        setUserList(list);
        
        const profilesList: AccountProfile[] = data.map(profile => ({
          id: profile.id,
          email: profile.email,
          name: profile.name,
          role: profile.role as Role,
          jobTitle: profile.job_title || userRoleLabels[profile.role] || 'Content Creator',
          requestedRole: profile.role as Role,
          approvalStatus: 'approved',
          isAdmin: profile.is_admin,
          approvedBy: 'system',
          approvedAt: profile.created_at,
          createdAt: profile.created_at,
          updatedAt: profile.updated_at,
        }));
        setAccountProfiles(profilesList);
      }
    } catch (err) {
      console.error('Exception fetching profiles from Supabase:', err);
    }
  };

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase.from('app_settings').select('settings').eq('id', 'current').single();
      if (data?.settings) {
        setAppSettings(mergeAppSettings(data.settings));
      } else {
        setAppSettings(defaultAppSettings);
      }
    } catch (err) {
      console.warn('Exception loading settings from Supabase, using defaults:', err);
      setAppSettings(defaultAppSettings);
    }
  };

  useEffect(() => {
    let isMounted = true;
    
    fetchProfiles();
    fetchSettings();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;

      if (session?.user) {
        try {
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

          if (profile) {
            const user: User = {
              id: profile.id,
              email: profile.email,
              name: profile.name,
              role: profile.role as Role,
              jobTitle: profile.job_title || userRoleLabels[profile.role] || 'Content Creator',
              isAdmin: profile.is_admin,
            };
            setCurrentUserState(user);
            setAuthStatus('approved');
          } else {
            const user: User = {
              id: session.user.id,
              email: session.user.email || '',
              name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User',
              role: session.user.email === 'minamagdy5555@gmail.com' ? 'reviewer' : 'team_member',
              jobTitle: session.user.email === 'minamagdy5555@gmail.com' ? 'Senior Brand Designer & Video Editor' : 'Content Creator',
              isAdmin: session.user.email === 'minamagdy5555@gmail.com',
            };
            setCurrentUserState(user);
            setAuthStatus('approved');
            setTimeout(() => {
              fetchProfiles();
            }, 1000);
          }
        } catch (err) {
          console.error('Error loading session profile:', err);
          setAuthStatus('signed_out');
        }
      } else {
        setCurrentUserState(GUEST_USER);
        setAuthStatus('signed_out');
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || event.key.toLowerCase() !== 's') return;
      const isMina = currentUser.email === 'minamagdy5555@gmail.com' || currentUser.id === 'user_1';
      if (!isMina) return;
      event.preventDefault();
      setIsMinaSettingsUnlocked(prev => {
        const next = !prev;
        try {
          window.sessionStorage.setItem('national-care-settings-unlocked-for-mina', next ? '1' : '0');
        } catch {}

        return next;
      });
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [currentUser.email, currentUser.id]);

  useEffect(() => {
    if (!isLocalWorkspaceActive) return;

    let isMounted = true;
    sharedDataLoadFailedRef.current = false;
    hasLoadedPersistedState.current = false;

    loadAppState()
      .then(localState => {
        if (!isMounted) return;

        const localTasks = Array.isArray(localState?.tasks) && localState.tasks.length > 0 ? localState.tasks : initialTasks;
        setAppSettings(mergeAppSettings(localState?.settings));
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
    if (authStatus !== 'approved' || !hasLoadedPersistedState.current || tasks.length === 0) return;

    const candidates = tasks.flatMap(task => (
      task.versions.flatMap(version => (
        (version.files || [])
          .filter(file => needsLinkedTaskFileMetadata(file))
          .map(file => ({ taskId: task.id, fileId: file.id, fileKey: file.driveFileId || file.webViewLink || file.url }))
      ))
    )).filter(candidate => !linkedMetadataBackfillAttemptsRef.current.has(`${candidate.taskId}:${candidate.fileKey}`));

    if (candidates.length === 0) return;

    candidates.forEach(candidate => linkedMetadataBackfillAttemptsRef.current.add(`${candidate.taskId}:${candidate.fileKey}`));
    let isCancelled = false;

    Promise.all(candidates.map(async candidate => {
      const task = tasks.find(item => item.id === candidate.taskId);
      const file = task?.versions.flatMap(version => version.files || []).find(item => item.id === candidate.fileId);
      if (!task || !file) return null;

      const enrichedFile = await enrichLinkedTaskFileMetadata(file);
      const changed = [
        'name',
        'type',
        'size',
        'url',
        'previewUrl',
        'previewStoragePath',
        'driveFileId',
        'webViewLink',
        'downloadUrl',
      ].some(key => String(file[key as keyof UploadedTaskFile] || '') !== String(enrichedFile[key as keyof UploadedTaskFile] || ''));

      return changed ? { taskId: task.id, fileId: file.id, file: enrichedFile } : null;
    })).then(updates => {
      if (isCancelled) return;
      const validUpdates = updates.filter(Boolean) as Array<{ taskId: string; fileId: string; file: UploadedTaskFile }>;
      if (validUpdates.length === 0) return;

      const updatedTaskIds = new Set(validUpdates.map(update => update.taskId));
      updatedTaskIds.forEach(queueTaskBroadcast);
      setTasks(prev => prev.map(task => {
        const taskUpdates = validUpdates.filter(update => update.taskId === task.id);
        if (taskUpdates.length === 0) return task;

        const versions = task.versions.map(version => ({
          ...version,
          files: version.files?.map(file => taskUpdates.find(update => update.fileId === file.id)?.file || file),
        }));
        const thumbnailFile = versions[0]?.files?.find(file => file.previewUrl && file.previewStoragePath);

        return {
          ...task,
          versions,
          thumbnailUrl: thumbnailFile?.previewUrl || task.thumbnailUrl,
          thumbnailStoragePath: thumbnailFile?.previewStoragePath || task.thumbnailStoragePath,
          updatedAt: new Date().toISOString(),
        };
      }));
    }).catch(error => {
      console.warn('Could not update linked Drive metadata', error);
    });

    return () => {
      isCancelled = true;
    };
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

    Promise.all([fetchDriveTasks(), fetchDriveNotifications(), fetchDriveSettings(), loadAppState()])
      .then(([loadedTasks, loadedNotifications, loadedSettings, localState]) => {
        if (!isMounted) return;

        const sharedTasks = reviveWorkspaceTasks(loadedTasks.length > 0 ? loadedTasks : initialTasks, usersObj);
        const sharedNotifications = removeGuestSeedNotifications(loadedNotifications);
        const sharedSettings = mergeAppSettings(loadedSettings || localState?.settings);
        const localTasks = Array.isArray(localState?.tasks) ? localState.tasks.filter(task => !isGuestSeedTask(task) && !isPlaceholderTask(task)) : [];
        const localNotifications = Array.isArray(localState?.notifications) ? removeGuestSeedNotifications(localState.notifications) : [];

        sharedDataLoadFailedRef.current = false;
        setAppSettings(sharedSettings);
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
    const hasPendingSettings = pendingSettingsBroadcastRef.current;
    if (pendingTaskIds.length === 0 && pendingNotificationIds.length === 0 && !hasPendingSettings) return;

    pendingTaskBroadcastIdsRef.current.clear();
    pendingNotificationBroadcastIdsRef.current.clear();
    pendingSettingsBroadcastRef.current = false;

    const pendingTasks = pendingTaskIds
      .map(taskId => tasks.find(item => item.id === taskId))
      .filter(Boolean) as Task[];
    const pendingNotifications = pendingNotificationIds
      .map(notificationId => notifications.find(item => item.id === notificationId))
      .filter(Boolean) as Notification[];

    const saveState = Promise.all([
      ...pendingTasks.map(task => upsertDriveTask(task)),
      upsertDriveNotifications(pendingNotifications),
      ...(hasPendingSettings ? [upsertDriveSettings(appSettings)] : []),
    ]);

    saveState
      .then(() => {
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to save app state', error);
        pendingTaskIds.forEach(taskId => pendingTaskBroadcastIdsRef.current.add(taskId));
        pendingNotificationIds.forEach(notificationId => pendingNotificationBroadcastIdsRef.current.add(notificationId));
        if (hasPendingSettings) pendingSettingsBroadcastRef.current = true;
        setPersistenceError(getSharedDataErrorMessage(error, 'Failed to save app state.'));
      });
  }, [tasks, notifications, appSettings, isDriveWorkspaceReady]);

  useEffect(() => {
    if (!isLocalWorkspaceActive || !hasLoadedPersistedState.current) return;

    saveAppState({ tasks, notifications, settings: appSettings })
      .then(() => {
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to save local demo workspace', error);
        setPersistenceError(getErrorMessage(error, 'Failed to save local demo workspace.'));
      });
  }, [tasks, notifications, appSettings, isLocalWorkspaceActive]);

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
        setTasks(prev => mergeTasksIntoState(prev.filter(task => !isGuestSeedTask(task) && !isPlaceholderTask(task)), reviveWorkspaceTasks(latestTasks, usersObj)));
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
    if (role === 'team_member' && task) return sanitizeHandledByWithSettings(appSettings, [task.createdBy, ...task.handledBy]);
    return [];
  };

  const normalizeOwnerIdsForRole = (role: Role | null, ids: string[], assignerId?: string) => (
    role === 'team_member' ? sanitizeHandledByWithSettings(appSettings, ids, assignerId) : uniqueIds(ids)
  );

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
        editHistory: [],
        isDeleted: false,
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
      return { ok: false, message: 'Enter your email or account name and password.' };
    }

    let email = identifier.trim();
    if (!email.includes('@')) {
      const { data, error } = await supabase
        .from('profiles')
        .select('email')
        .ilike('name', email)
        .limit(1);
      
      if (data && data.length > 0) {
        email = data[0].email;
      }
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true };
  };

  const signupWithEmail = async (email: string, password: string, name?: string): Promise<AuthActionResult> => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password.trim()) {
      return { ok: false, message: 'Enter your email address and create a password.' };
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return { ok: false, message: 'Enter a valid email address.' };
    }

    if (password.length < 8) {
      return { ok: false, message: 'Password must be at least 8 characters.' };
    }

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          name: name || normalizedEmail.split('@')[0],
        }
      }
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: 'Account created successfully! Welcome.' };
  };

  const updateUserRole = async (userId: string, role: Role) => {
    const jobTitle = getResponsibilityLabelForRole(appSettings, role) || role;
    await updateUserResponsibility(userId, jobTitle, role);
  };

  const updateUserResponsibility = async (userId: string, responsibility: string, permissionRole: Role = 'team_member') => {
    const jobTitle = responsibility.trim() || getResponsibilityLabelForRole(appSettings, permissionRole) || 'Content Creator';
    
    const { error } = await supabase
      .from('profiles')
      .update({
        role: permissionRole,
        job_title: jobTitle,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);
      
    if (error) {
      console.error('Failed to update user profile in Supabase', error);
      return;
    }
    
    await fetchProfiles();
    
    if (currentUser.id === userId) {
      setCurrentUserState(prev => ({
        ...prev,
        role: permissionRole,
        jobTitle,
      }));
    }
  };

  const addCustomResponsibility = async (responsibility: string) => {
    const label = responsibility.trim();
    if (!label) return;
    
    const nextAppSettings = mergeAppSettings({
      ...appSettings,
      responsibilities: [
        ...appSettings.responsibilities.filter(item => item.label.trim().toLowerCase() !== label.toLowerCase()),
        {
          id: normalizeSettingId(label),
          label,
          permissionRole: 'team_member',
        }
      ],
      updatedAt: new Date().toISOString()
    });
    
    setAppSettings(nextAppSettings);
    setCustomResponsibilities(prev => Array.from(new Set([...prev, label])));
    
    await supabase.from('app_settings').upsert({
      id: 'current',
      settings: nextAppSettings,
      updated_at: new Date().toISOString()
    });
  };

  const updateAppSettings = async (updater: AppSettings | ((settings: AppSettings) => AppSettings)) => {
    if (!canManageSettings) return;
    
    let nextSettings: AppSettings;
    if (typeof updater === 'function') {
      nextSettings = updater(appSettings);
    } else {
      nextSettings = updater;
    }
    
    const merged = mergeAppSettings({
      ...nextSettings,
      updatedAt: new Date().toISOString(),
    });
    
    setAppSettings(merged);
    
    await supabase.from('app_settings').upsert({
      id: 'current',
      settings: merged,
      updated_at: new Date().toISOString()
    });
  };

  const deleteUserAccount = async (userId: string) => {
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);
      
    if (error) {
      console.error('Failed to delete profile from Supabase', error);
      return;
    }
    
    await fetchProfiles();
    
    if (currentUser.id === userId) {
      await logout();
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setCurrentUserState(GUEST_USER);
    setAuthStatus('signed_out');
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

  const deleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(task => task.id !== taskId));
    if (isDriveWorkspaceReady) {
      deleteDriveTask(taskId).catch(error => console.error('Failed to delete task from Drive', error));
    }
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
        const nextOwnerIds = normalizeOwnerIdsForRole(newOwnerRole, newOwnerUserIds ?? getDefaultOwnerIdsForRole(newOwnerRole, t));
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

  const toggleTaskHold = (taskId: string) => {
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];
    const isOnHold = task.status === 'on_hold';
    
    const newStatus = isOnHold 
      ? (task.previousStatusBeforeHold || 'submitted') 
      : 'on_hold';

    const reviewerIds = getUserIdsByRole(userList, ['reviewer', 'admin']);
    const artDirectorIds = getUserIdsByRole(userList, ['art_director']);
    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const contributorIds = uniqueIds([task.createdBy, ...task.handledBy]);
    
    if (newStatus === 'on_hold') {
      addNotifications([...artDirectorIds, ...teamLeaderIds, ...reviewerIds, ...contributorIds], taskId, `"${task.name}" has been placed ON HOLD.`);
    } else {
      addNotifications([...artDirectorIds, ...teamLeaderIds, ...reviewerIds, ...contributorIds], taskId, `"${task.name}" has been RESUMED.`);
    }

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          status: newStatus,
          previousStatusBeforeHold: isOnHold ? null : t.status,
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

    const nextHandledBy = sanitizeHandledByWithSettings(appSettings, handledByIds, currentUser.id);
    const nextOwnerIds = normalizeOwnerIdsForRole(task.currentOwnerRole, currentOwnerUserIds, currentUser.id);
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
    if (!task || (task.taskType !== 'campaign' && task.taskType !== 'media_buying') || !task.scheduledPublishAt || task.publishedAt || task.publishReminderSentAt) return;

    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = getTaskParticipantIds(task, teamLeaderIds);
    const publishDate = new Date(task.scheduledPublishAt);
    const isOverdue = publishDate.getTime() < Date.now();
    const eventTypeLabel = task.taskType === 'media_buying' ? 'media buying event' : 'campaign publish';
    addNotifications(recipients, taskId, `${isOverdue ? 'Overdue' : 'Upcoming'} ${eventTypeLabel}: "${task.name}" is scheduled for ${publishDate.toLocaleString()}.`);

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => (
      t.id === taskId
        ? { ...t, publishReminderSentAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        : t
    )));
  };

  const markWeekReminderSent = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.publishedAt || task.weekReminderSentAt) return;

    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = uniqueIds([
      ...getTaskParticipantIds(task, teamLeaderIds),
      'user_1', // Mina
      'user_2', // Marwa
      'user_3', // Dina
      'user_9', // Sobeeh
      'user_7', // Fawzy
    ]);
    const publishDate = new Date(task.scheduledPublishAt!);
    const eventTypeLabel = task.taskType === 'media_buying' ? 'Media buying event' : 'Campaign publish';
    addNotifications(
      recipients.filter(id => id !== currentUser.id),
      taskId,
      `Upcoming 1-week reminder: "${task.name}" (${eventTypeLabel}) is scheduled for ${publishDate.toLocaleString()}.`
    );

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => (
      t.id === taskId
        ? { ...t, weekReminderSentAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        : t
    )));
  };

  const submitScheduledCampaign = (input: {
    name: string;
    taskType: 'campaign' | 'media_buying';
    scheduledPublishAt: string;
    publishNote?: string | null;
    platform?: string | null;
    budgetAmount?: number | null;
    budgetCurrency?: string | null;
  }) => {
    const now = new Date().toISOString();
    const taskId = Math.random().toString(36).substring(7);
    const newCampaign: Task = {
      id: taskId,
      code: createTaskCode(input.taskType === 'media_buying' ? 'MDB' : 'CMP'),
      name: input.name.trim(),
      description: input.publishNote?.trim() || null,
      taskType: input.taskType,
      reviewMode: 'full_review',
      environment,
      createdBy: currentUser.id,
      handledBy: [],
      status: 'completed',
      currentOwnerRole: 'team_leader',
      currentOwnerUserId: null,
      currentOwnerUserIds: [],
      priority: 'normal',
      deadlineText: null,
      deadlineAt: null,
      scheduledPublishAt: input.scheduledPublishAt,
      publishNote: input.publishNote || null,
      platform: input.platform || null,
      budgetAmount: input.budgetAmount || null,
      budgetCurrency: input.budgetCurrency || null,
      versions: [],
      comments: [],
      thumbnailUrl: '',
      createdAt: now,
      updatedAt: now,
    };

    queueTaskBroadcast(taskId);
    setTasks(prev => [newCampaign, ...prev]);

    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = uniqueIds([
      ...teamLeaderIds,
      'user_1', // Mina
      'user_2', // Marwa
      'user_3', // Dina
      'user_9', // Sobeeh
      'user_7', // Fawzy
    ]).filter(id => id !== currentUser.id);

    const typeLabel = input.taskType === 'media_buying' ? 'Media Buying Ad' : 'Campaign';
    addNotifications(
      recipients,
      taskId,
      `New ${typeLabel} scheduled for ${new Date(input.scheduledPublishAt).toLocaleString()}: "${input.name}".`
    );
  };

  const editScheduledCampaign = (taskId: string, input: {
    name: string;
    taskType: 'campaign' | 'media_buying';
    scheduledPublishAt: string;
    publishNote?: string | null;
    platform?: string | null;
    budgetAmount?: number | null;
    budgetCurrency?: string | null;
  }) => {
    setTasks(prev => prev.map(t => (
      t.id === taskId
        ? {
            ...t,
            name: input.name.trim(),
            taskType: input.taskType,
            scheduledPublishAt: input.scheduledPublishAt,
            publishNote: input.publishNote || null,
            platform: input.platform || null,
            budgetAmount: input.budgetAmount || null,
            budgetCurrency: input.budgetCurrency || null,
            description: input.publishNote?.trim() || null,
            updatedAt: new Date().toISOString()
          }
        : t
    )));
    queueTaskBroadcast(taskId);

    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = uniqueIds([
      ...teamLeaderIds,
      'user_1', // Mina
      'user_2', // Marwa
      'user_3', // Dina
      'user_9', // Sobeeh
      'user_7', // Fawzy
    ]).filter(id => id !== currentUser.id);

    const typeLabel = input.taskType === 'media_buying' ? 'Media Buying Ad' : 'Campaign';
    addNotifications(
      recipients,
      taskId,
      `Scheduled ${typeLabel} "${input.name}" has been updated.`
    );
  };

  const createWorkAssignment = (input: WorkAssignmentInput) => {
    if (!canCreateWorkAssignment(currentUser, appSettings)) return;

    const handledBy = sanitizeHandledByWithSettings(appSettings, input.handledByIds, currentUser.id);
    if (!input.name.trim() || !input.description.trim() || !input.deadlineAt || handledBy.length === 0) return;

    const now = new Date().toISOString();
    const taskId = Math.random().toString(36).substring(7);
    const normalizedLinks = input.assignmentLinks.map(link => link.trim()).filter(Boolean);
    const deadlineText = formatDeadlineText(input.deadlineAt);
    const assignmentPeriod = getAssignmentPeriodFromDeadline(input.deadlineAt);
    const task: Task = {
      id: taskId,
      code: createTaskCode('WRK'),
      name: input.name.trim(),
      description: input.description.trim() || null,
      taskType: (input.taskType as TaskType) || 'others',
      reviewMode: 'full_review',
      environment,
      createdBy: currentUser.id,
      handledBy,
      status: 'assigned_work',
      currentOwnerRole: 'team_member',
      currentOwnerUserId: handledBy[0] || null,
      currentOwnerUserIds: handledBy,
      priority: input.priority,
      deadlineText,
      assignmentPeriod,
      assignmentLinks: normalizedLinks,
      deadlineAt: input.deadlineAt || null,
      assignmentUploadedAt: null,
      scheduledPublishAt: null,
      publishNote: null,
      publishedAt: null,
      publishReminderSentAt: null,
      versions: [],
      comments: [],
      thumbnailUrl: '',
      isOvertime: input.isOvertime || false,
      needsContentRevision: input.needsContentRevision || false,
      createdAt: now,
      updatedAt: now,
    };

    addNotifications(handledBy.filter(userId => userId !== currentUser.id), taskId, `You were assigned "${task.name}".`);
    queueTaskBroadcast(taskId);
    setTasks(prev => [
      addAuditComment(task, currentUser.id, 'work_assignment_created', `Assigned work created for ${handledBy.map(userId => getUserDisplayName(usersObj, userId)).join(', ')}.`, now),
      ...prev,
    ]);
  };

  const updateWorkAssignment = (taskId: string, input: WorkAssignmentInput) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !canManageWorkAssignment(task, currentUser, appSettings)) return;

    const handledBy = sanitizeHandledByWithSettings(appSettings, input.handledByIds, currentUser.id);
    if (!input.name.trim() || !input.description.trim() || !input.deadlineAt || handledBy.length === 0) return;

    const previousAssignees = new Set(task.handledBy);
    const addedAssignees = handledBy.filter(userId => !previousAssignees.has(userId));
    if (addedAssignees.length > 0) {
      addNotifications(addedAssignees.filter(userId => userId !== currentUser.id), taskId, `You were assigned "${input.name.trim()}".`);
    }

    const normalizedLinks = input.assignmentLinks.map(link => link.trim()).filter(Boolean);
    const assignmentPeriod = getAssignmentPeriodFromDeadline(input.deadlineAt);
    const message = `Assigned work updated for ${handledBy.map(userId => getUserDisplayName(usersObj, userId)).join(', ')}.`;

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const now = new Date().toISOString();
      return addAuditComment({
        ...t,
        name: input.name.trim(),
        description: input.description.trim() || null,
        taskType: (input.taskType as TaskType) || t.taskType,
        handledBy,
        currentOwnerRole: 'team_member',
        currentOwnerUserId: handledBy[0] || null,
        currentOwnerUserIds: handledBy,
        priority: input.priority,
        deadlineText: formatDeadlineText(input.deadlineAt),
        assignmentPeriod,
        assignmentLinks: normalizedLinks,
        deadlineAt: input.deadlineAt || null,
        isOvertime: input.isOvertime || false,
        needsContentRevision: input.needsContentRevision || false,
        updatedAt: now,
      }, currentUser.id, 'work_assignment_updated', message, now);
    }));
  };

  const submitWorkAssignmentUpload = (taskId: string, payload: WorkAssignmentUploadPayload) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status !== 'assigned_work') return;

    const target = getReviewRouteTarget(payload.reviewMode);
    const contentCreatorIds = userList.filter(user => user.jobTitle === 'Content Creator' || (user.role === 'team_member' && user.jobTitle === 'Content Creator')).map(user => user.id);
    const contentReviewerIds = contentCreatorIds.length > 0 ? contentCreatorIds : getUserIdsByRole(userList, ['team_leader']);
    
    const isContentRevNeeded = task.needsContentRevision;
    const nextStatus = isContentRevNeeded ? 'waiting_content_revision' : target.status;
    const nextOwnerRole = isContentRevNeeded ? 'team_member' : target.ownerRole;
    const nextOwnerUserIds = isContentRevNeeded ? contentReviewerIds : getDefaultOwnerIdsForRole(target.ownerRole, task);

    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = uniqueIds([
      ...nextOwnerUserIds,
      ...teamLeaderIds,
      task.createdBy,
      ...task.handledBy,
    ]).filter(userId => userId !== payload.version.submittedBy);

    addNotifications(recipients, taskId, `${getUserDisplayName(usersObj, payload.version.submittedBy)} uploaded finished work for "${task.name}".`);

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const now = new Date().toISOString();
      const updatedTask: Task = {
        ...t,
        taskType: payload.taskType,
        reviewMode: payload.reviewMode,
        status: nextStatus,
        currentOwnerRole: nextOwnerRole,
        currentOwnerUserId: nextOwnerUserIds[0] || null,
        currentOwnerUserIds: nextOwnerUserIds,
        scheduledPublishAt: payload.taskType === 'campaign' ? payload.scheduledPublishAt : null,
        publishNote: payload.taskType === 'campaign' ? payload.publishNote : null,
        publishedAt: null,
        publishReminderSentAt: null,
        versions: [payload.version, ...t.versions],
        thumbnailUrl: payload.thumbnailUrl || t.thumbnailUrl,
        thumbnailStoragePath: payload.thumbnailStoragePath || t.thumbnailStoragePath,
        driveFolderId: payload.driveFolderId || t.driveFolderId,
        assignmentUploadedAt: now,
        updatedAt: now,
      };

      const auditMsg = isContentRevNeeded 
        ? 'Finished work uploaded and sent into the Content Revision flow.' 
        : 'Finished work uploaded and sent into the normal review flow.';

      return addAuditComment(updatedTask, payload.version.submittedBy, 'work_assignment_uploaded', auditMsg, now);
    }));
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

    const isContentRevNeeded = task.needsContentRevision && (task.status === 'waiting_content_revision' || task.status === 'changes_requested_by_content');
    
    let nextStatus: TaskStatus;
    let nextOwnerRole: Role;
    let nextOwnerIds: string[];
    let auditMsg = '';
    let sendToMarwa = false;

    if (isContentRevNeeded) {
      const contentCreatorIds = userList.filter(user => user.jobTitle === 'Content Creator' || (user.role === 'team_member' && user.jobTitle === 'Content Creator')).map(user => user.id);
      nextOwnerIds = contentCreatorIds.length > 0 ? contentCreatorIds : getUserIdsByRole(userList, ['team_leader']);
      nextStatus = 'waiting_content_revision';
      nextOwnerRole = 'team_member';
      auditMsg = 'New version resubmitted for Content Revision.';
    } else {
      sendToMarwa = isReviewerCreatedTask(task, usersObj) || task.status === 'changes_requested_by_art_director' || task.reviewMode === 'direct_to_ad';
      nextStatus = sendToMarwa
        ? 'sent_to_art_director'
        : task.reviewMode === 'quick_look'
          ? 'waiting_reviewer_quick_look'
          : 'waiting_reviewer_full_review';
      nextOwnerRole = sendToMarwa ? 'art_director' : 'reviewer';
      nextOwnerIds = getDefaultOwnerIdsForRole(nextOwnerRole, task);
      auditMsg = `New version resubmitted for ${nextOwnerRole === 'art_director' ? 'Final' : 'First'} Review.`;
    }

    const creatorName = usersObj[task.createdBy]?.name || 'Someone';
    const reviewerIds = getUserIdsByRole(userList, ['reviewer', 'admin']);
    const artDirectorIds = getUserIdsByRole(userList, ['art_director']);
    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = (isContentRevNeeded
      ? [...nextOwnerIds, ...teamLeaderIds]
      : sendToMarwa
        ? [...nextOwnerIds, ...artDirectorIds, ...teamLeaderIds, ...reviewerIds]
        : [...nextOwnerIds, ...reviewerIds, ...teamLeaderIds]
    ).filter(userId => userId !== task.createdBy);

    addNotifications(recipients, taskId, `${creatorName} uploaded V${version.versionNumber} for "${task.name}".`);

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;

      const thumbnailFile = version.files?.find(file => file.type.startsWith('image/'));
      const previewFile = version.files?.find(file => file.previewUrl && file.previewStoragePath);

      const updatedTask: Task = {
        ...t,
        versions: [version, ...t.versions],
        handledBy: sanitizeHandledByWithSettings(appSettings, [...t.handledBy, version.submittedBy]),
        status: nextStatus,
        currentOwnerRole: nextOwnerRole,
        currentOwnerUserId: nextOwnerIds[0] || null,
        currentOwnerUserIds: nextOwnerIds,
        thumbnailUrl: previewFile?.previewUrl || thumbnailFile?.previewUrl || '',
        thumbnailStoragePath: previewFile?.previewStoragePath || thumbnailFile?.previewStoragePath,
        updatedAt: new Date().toISOString(),
      };

      return addAuditComment(updatedTask, version.submittedBy, 'version_added', auditMsg, new Date().toISOString());
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
        editHistory: [],
        isDeleted: false,
      };

      return {
        ...task,
        comments: [...(task.comments || []), newComment],
        updatedAt: new Date().toISOString(),
      };
    }));
  };

  const updateTaskComment = (taskId: string, commentId: string, changes: Pick<TaskComment, 'message' | 'sections'>) => {
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;

      let didUpdate = false;
      const now = new Date().toISOString();
      const comments = (task.comments || []).map(comment => {
        if (comment.id !== commentId || !canEditOrDeleteComment(comment, currentUser)) return comment;
        didUpdate = true;
        const nextMessage = changes.message?.trim() || undefined;
        const nextSections = cloneCommentSections(changes.sections || []);

        return {
          ...comment,
          message: nextMessage,
          sections: nextSections,
          updatedAt: now,
          editedBy: currentUser.id,
          isEdited: true,
          editHistory: [
            ...(comment.editHistory || []),
            {
              id: Math.random().toString(36).substring(7),
              previousMessage: comment.message,
              previousSections: cloneCommentSections(comment.sections || []),
              nextMessage,
              nextSections: cloneCommentSections(nextSections),
              editedBy: currentUser.id,
              editedAt: now,
            },
          ],
        };
      });

      return didUpdate
        ? { ...task, comments, updatedAt: now }
        : task;
    }));
  };

  const deleteTaskComment = (taskId: string, commentId: string) => {
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;

      let didDelete = false;
      const now = new Date().toISOString();
      const comments = (task.comments || []).map(comment => {
        if (comment.id !== commentId || !canEditOrDeleteComment(comment, currentUser)) return comment;
        didDelete = true;
        return {
          ...comment,
          deletedAt: now,
          deletedBy: currentUser.id,
          isDeleted: true,
          updatedAt: now,
        };
      });

      return didDelete
        ? { ...task, comments, updatedAt: now }
        : task;
    }));
  };

  return (
    <AppContext.Provider value={{
      currentUser,
      authStatus,
      authProfile,
      authError,
      accountProfiles,
      customResponsibilities,
      appSettings,
      canManageSettings,
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
      toggleTaskHold,
      updateTaskPriority,
      updateTaskAssignment,
      updateTaskReviewMode,
      updateTaskPublishSchedule,
      markCampaignPublished,
      markPublishReminderSent,
      markWeekReminderSent,
      submitScheduledCampaign,
      editScheduledCampaign,
      createWorkAssignment,
      updateWorkAssignment,
      submitWorkAssignmentUpload,
      addTaskComment,
      updateTaskComment,
      deleteTaskComment,
      addTaskVersion,
      replaceTaskVersionFiles,
      updateTaskMediaPreviews,
      addTask,
      addNotification,
      markNotificationAsRead,
      loginWithPassword,
      signupWithEmail,
      updateUserRole,
      updateUserResponsibility,
      addCustomResponsibility,
      updateAppSettings,
      deleteUserAccount,
      logout,
      archiveTask,
      unarchiveTask,
      deleteTask,
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
