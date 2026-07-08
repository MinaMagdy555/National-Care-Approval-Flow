import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { AccountProfile, AppSettings, AuthStatus, User, Role, Environment, Task, TaskStatus, Priority, TaskType, Notification, TaskComment, TaskVersion, UploadedTaskFile, ReviewMode, WorkflowDefinition, WorkflowPhaseHistoryEntry } from './types';
import { initialUsers, initialTasks, userRoleLabels } from './mockData';
import { supabase } from './supabaseClient';
import { clearAppState, loadAppState, saveAppState } from './localDb';
import { fetchNeonAppState, saveNeonAppState, USE_NEON_DATA } from './neonDb';
import { shouldAutoArchiveTask } from './archiveUtils';
import { sanitizeHandledBy } from './handlerUtils';
import {
  canManageAppSettings,
  defaultAppSettings,
  getResponsibilityLabelForRole,
  mergeAppSettings,
  normalizeSettingId,
  sanitizeHandledByWithSettings,
  resolveAppSettingsWithRealIds,
  resolveLegacyIds,
  MINA_ID,
  MARWA_ID,
  DINA_ID,
  AHMED_SOBEEH_ID,
  FAWZY_ID,
  getTaskTypeConfigs,
  cleanTaskTypeKey,
} from './appSettings';
import { enrichLinkedTaskFileMetadata, needsLinkedTaskFileMetadata } from './linkAttachments';
import {
  ART_DIRECTOR_WAITING_STATUSES,
  CLOSED_STATUSES,
  RETURNED_STATUSES,
  REVIEWER_WAITING_STATUSES,
  canReviewRouteUpdateStatus,
  canManageWorkflowBuilder,
  cloneWorkflow,
  getPhaseOwnerRole,
  getCurrentOwnerUserIds,
  getReviewRouteTarget,
  getReviewModeForWorkflowPhase,
  getStatusForWorkflowPhase,
  getTaskParticipantIds,
  getWorkflowForTaskType,
  getWorkflowPhase,
  getWorkflowPhaseIndex,
  hasUserApprovedWorkflowPhase,
  isDirectToFinalReviewUploader,
  resolveWorkflowPhaseReviewerIds,
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
  contentRevisionAssigneeIds?: string[];
};

type WorkAssignmentUploadPayload = {
  taskType: TaskType;
  reviewMode: ReviewMode;
  workflowId?: string | null;
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
  'clarification_needed',
]);
const GUEST_USER: User = {
  id: 'guest',
  name: 'Guest',
  role: 'team_member',
  jobTitle: 'Not signed in',
};

function isSharedWorkspaceStatus(status: AuthStatus) {
  return (USE_NEON_DATA || USE_SHARED_DRIVE_DATA) && status === 'approved';
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
    return USE_NEON_DATA
      ? 'Neon database connection failed. Check the deployment environment variables and network access, then refresh.'
      : 'Google Drive connection failed. Check Google access, Drive permissions, and network access, then refresh.';
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

function normalizeDirectToFinalTask(task: Task, users: Record<string, User>): Task {
  const latestSubmitterId = task.versions[0]?.submittedBy;
  const latestSubmitter = latestSubmitterId ? users[latestSubmitterId] || initialUsers.find(user => user.id === latestSubmitterId) : null;
  const creator = users[task.createdBy] || initialUsers.find(user => user.id === task.createdBy);
  const shouldRouteDirect =
    task.reviewMode === 'direct_to_ad' &&
    task.status === 'waiting_content_revision' &&
    (isDirectToFinalReviewUploader(latestSubmitter) || isDirectToFinalReviewUploader(creator));

  if (!shouldRouteDirect) return task;

  return {
    ...task,
    workflowId: null,
    workflowSnapshot: null,
    workflowCurrentPhaseId: null,
    workflowCurrentPhaseIndex: null,
    workflowPhaseApprovals: {},
    status: 'sent_to_art_director',
    currentOwnerRole: 'art_director',
    currentOwnerUserId: null,
    currentOwnerUserIds: getUserIdsByRoleRecord(users, ['art_director']),
    updatedAt: new Date().toISOString(),
  };
}

function reviveWorkspaceTasks(tasks: Task[], users: Record<string, User>) {
  return sortTasksByUpdate(reviveTaskFiles(tasks.filter(task => !isGuestSeedTask(task) && !isPlaceholderTask(task)), users).map(task => normalizeDirectToFinalTask(task, users)));
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
  const creator = users[task.createdBy] || initialUsers.find(user => user.id === task.createdBy);
  return isDirectToFinalReviewUploader(creator);
}

function normalizeReviewerCreatedTask(task: Task, users: Record<string, User>): Task {
  if (task.workflowSnapshot || !isReviewerCreatedTask(task, users) || !REVIEWER_WAITING_STATUSES.includes(task.status)) {
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
    workflowId: task.workflowId ?? null,
    workflowSnapshot: task.workflowSnapshot ?? null,
    workflowCurrentPhaseId: task.workflowCurrentPhaseId ?? null,
    workflowCurrentPhaseIndex: typeof task.workflowCurrentPhaseIndex === 'number' ? task.workflowCurrentPhaseIndex : null,
    workflowPhaseApprovals: task.workflowPhaseApprovals && typeof task.workflowPhaseApprovals === 'object' ? task.workflowPhaseApprovals : {},
    workflowPhaseHistory: Array.isArray(task.workflowPhaseHistory) ? task.workflowPhaseHistory : [],
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
    isOvertime: task.isOvertime || false,
    needsContentRevision: task.needsContentRevision || false,
    contentRevisionAssigneeIds: Array.isArray(task.contentRevisionAssigneeIds) ? task.contentRevisionAssigneeIds : ((task as any).contentRevisionAssigneeId ? [(task as any).contentRevisionAssigneeId] : []),
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
    task.workflowId || '',
    task.workflowCurrentPhaseId || '',
    String(task.workflowCurrentPhaseIndex ?? ''),
    JSON.stringify(task.workflowPhaseApprovals || {}),
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
  persistenceMode: 'neon' | 'drive' | 'local';
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
  applyTaskWorkflow: (taskId: string, workflowId: string, phaseId?: string) => void;
  approveWorkflowPhase: (taskId: string, note?: string) => void;
  updateTaskPublishSchedule: (taskId: string, schedule: { scheduledPublishAt: string | null; publishNote: string | null }) => void;
  markCampaignPublished: (taskId: string) => void;
  markPublishReminderSent: (taskId: string) => void;
  markWeekReminderSent: (taskId: string) => void;
  submitScheduledCampaign: (input: { name: string; taskType: 'campaign' | 'media_buying'; scheduledPublishAt: string; publishNote?: string | null; platform?: string | null; budgetAmount?: number | null; budgetCurrency?: string | null }) => void;
  editScheduledCampaign: (taskId: string, input: { name: string; taskType: 'campaign' | 'media_buying'; scheduledPublishAt: string; publishNote?: string | null; platform?: string | null; budgetAmount?: number | null; budgetCurrency?: string | null }) => void;
  createWorkAssignment: (input: WorkAssignmentInput) => void;
  updateWorkAssignment: (taskId: string, input: WorkAssignmentInput) => void;
  updateTaskContentRevisionAssignees: (taskId: string, assigneeIds: string[]) => void;
  submitWorkAssignmentUpload: (taskId: string, payload: WorkAssignmentUploadPayload) => void;
  addTaskComment: (taskId: string, comment: Omit<TaskComment, 'id' | 'createdAt'>) => void;
  updateTaskComment: (taskId: string, commentId: string, changes: Pick<TaskComment, 'message' | 'sections'>) => void;
  deleteTaskComment: (taskId: string, commentId: string) => void;
  addTaskVersion: (taskId: string, version: TaskVersion) => void;
  replaceTaskVersionFiles: (taskId: string, versionId: string, files: UploadedTaskFile[]) => void;
  updateTaskMediaPreviews: (taskId: string, updates: { versions: TaskVersion[]; comments?: TaskComment[]; thumbnailUrl: string; thumbnailStoragePath?: string }) => void;
  addTask: (task: Task) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void;
  addNotifications: (userIds: string[], taskId: string, message: string) => void;
  markNotificationAsRead: (id: string) => void;
  loginWithPassword: (identifier: string, password: string) => Promise<AuthActionResult>;
  signupWithEmail: (email: string, password: string, name?: string) => Promise<AuthActionResult>;
  updateUserRole: (userId: string, role: Role) => void;
  updateUserResponsibility: (userId: string, responsibility: string, permissionRole?: Role) => void;
  addCustomResponsibility: (responsibility: string) => void;
  getEffectiveReviewMode: (taskType: string, isContentCreatorTask: boolean, selectedMode: 'full_review' | 'quick_look' | 'direct_to_ad') => 'full_review' | 'quick_look' | 'direct_to_ad';
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
      return isMinaSettingsUnlocked || canManageWorkflowBuilder(currentUser, appSettings);
    }
    return canManageAppSettings(currentUser, appSettings) ||
      appSettings.workAssignmentCreatorIds.includes(currentUser.id) ||
      canManageWorkflowBuilder(currentUser, appSettings);
  })();
  const isSharedWorkspaceActive = isSharedWorkspaceStatus(authStatus);
  const isNeonWorkspaceActive = USE_NEON_DATA && authStatus === 'approved';
  const isDriveWorkspaceActive = !USE_NEON_DATA && USE_SHARED_DRIVE_DATA && authStatus === 'approved';
  const isDriveWorkspaceReady = isDriveWorkspaceActive && hasDriveToken && Boolean(driveRootFolder);
  const driveStatus: DriveAuthStatus = USE_NEON_DATA || !USE_SHARED_DRIVE_DATA
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
    if (!isNeonWorkspaceActive) return;

    let isMounted = true;
    sharedDataLoadFailedRef.current = false;
    hasLoadedPersistedState.current = false;

    Promise.all([fetchNeonAppState(), loadAppState()])
      .then(([neonState, localState]) => {
        if (!isMounted) return;

        const sharedTasks = reviveWorkspaceTasks(
          Array.isArray(neonState?.tasks) && neonState.tasks.length > 0 ? neonState.tasks : initialTasks,
          usersObj
        );
        const sharedNotifications = removeGuestSeedNotifications(neonState?.notifications || []);
        const sharedSettings = mergeAppSettings(neonState?.settings || localState?.settings);
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
        console.error('Failed to load Neon app state', error);
        if (!isMounted) return;

        sharedDataLoadFailedRef.current = true;
        setLocalMigrationState(null);
        setPersistenceError(getSharedDataErrorMessage(error, 'Failed to load Neon app state.'));
      })
      .finally(() => {
        if (isMounted) hasLoadedPersistedState.current = true;
      });

    return () => {
      isMounted = false;
    };
  }, [isNeonWorkspaceActive, currentUser.id]);

  useEffect(() => {
    if (!isDriveWorkspaceActive) return;
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
  }, [isDriveWorkspaceActive, isDriveWorkspaceReady, currentUser.id, driveRootFolder?.id]);

  useEffect(() => {
    if (!isNeonWorkspaceActive || !hasLoadedPersistedState.current || sharedDataLoadFailedRef.current) return;

    saveNeonAppState({ tasks, notifications, settings: appSettings })
      .then(() => {
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to save Neon app state', error);
        sharedDataLoadFailedRef.current = true;
        setPersistenceError(getSharedDataErrorMessage(error, 'Failed to save Neon app state.'));
      });
  }, [tasks, notifications, appSettings, isNeonWorkspaceActive]);

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
    if (!isNeonWorkspaceActive) return;

    let isMounted = true;
    let isPolling = false;

    const syncLatestSharedData = async () => {
      if (!hasLoadedPersistedState.current || isPolling) return;

      isPolling = true;
      try {
        const latestState = await fetchNeonAppState();
        if (!isMounted || !latestState) return;

        sharedDataLoadFailedRef.current = false;
        setTasks(prev => mergeTasksIntoState(prev.filter(task => !isGuestSeedTask(task) && !isPlaceholderTask(task)), reviveWorkspaceTasks(latestState.tasks || [], usersObj)));
        setNotifications(prev => mergeNotificationsIntoState(removeGuestSeedNotifications(prev), removeGuestSeedNotifications(latestState.notifications || [])));
        if (latestState.settings) {
          setAppSettings(mergeAppSettings(latestState.settings));
        }
        setPersistenceError(null);
      } catch (error) {
        console.error('Failed to sync latest Neon data', error);
        if (isMounted) {
          sharedDataLoadFailedRef.current = true;
          setPersistenceError(getSharedDataErrorMessage(error, 'Failed to sync latest Neon data.'));
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
  }, [isNeonWorkspaceActive, currentUser.id]);

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

  const checkIsContentCreatorTask = (task: Task) => {
    return task.handledBy.some(id => {
      const u = usersObj[id];
      return u && (u.jobTitle === 'Content Creator' || (u.role === 'team_member' && u.jobTitle === 'Content Creator'));
    }) || (task.contentRevisionAssigneeIds || []).some(id => {
      const u = usersObj[id];
      return u && (u.jobTitle === 'Content Creator' || (u.role === 'team_member' && u.jobTitle === 'Content Creator'));
    }) || (() => {
      const creator = usersObj[task.createdBy];
      return creator && (creator.jobTitle === 'Content Creator' || (creator.role === 'team_member' && creator.jobTitle === 'Content Creator'));
    })();
  };

  const getEffectiveReviewMode = (taskType: string, isContentCreatorTask: boolean, selectedMode: 'full_review' | 'quick_look' | 'direct_to_ad'): 'full_review' | 'quick_look' | 'direct_to_ad' => {
    if (isContentCreatorTask) {
      return selectedMode;
    }
    const configs = getTaskTypeConfigs(appSettings);
    const config = configs.find(c => cleanTaskTypeKey(c.id) === cleanTaskTypeKey(taskType));
    if (config) {
      return config.isDetailedReview ? 'full_review' : 'quick_look';
    }
    const clean = cleanTaskTypeKey(taskType);
    const isFullReviewType = clean === 'video' || 
                             clean === 'ai packet' || 
                             clean === 'ai packets' || 
                             clean === 'new products add' || 
                             clean === 'new product add' ||
                             clean === 'new product' ||
                             clean === 'new products';
    if (isFullReviewType) {
      return 'full_review';
    }
    return 'quick_look';
  };

  const getDefaultOwnerIdsForRole = (role: Role | null, task?: Task) => {
    if (!role) return [];

    const isContentCreatorTask = task && checkIsContentCreatorTask(task);

    if (task && task.taskType) {
      const config = getTaskTypeConfigs(appSettings).find(c => cleanTaskTypeKey(c.id) === cleanTaskTypeKey(task.taskType));
      if (config) {
        if (role === 'reviewer') {
          if (isContentCreatorTask) {
            return getUserIdsByRole(userList, ['team_leader']);
          }
          if (task.status === 'waiting_reviewer_quick_look') {
            if (config.quickLookUserIds && config.quickLookUserIds.length > 0) {
              return config.quickLookUserIds;
            }
          } else {
            if (config.fullReviewerUserIds && config.fullReviewerUserIds.length > 0) {
              return config.fullReviewerUserIds;
            }
          }
        }
        if (role === 'art_director') {
          if (config.finalReviewerUserIds && config.finalReviewerUserIds.length > 0) {
            return config.finalReviewerUserIds;
          }
        }
      }
    }
    if (role === 'reviewer') {
      if (isContentCreatorTask) {
        return getUserIdsByRole(userList, ['team_leader']);
      }
      return getUserIdsByRole(userList, ['reviewer', 'admin']);
    }
    if (role === 'art_director') return getUserIdsByRole(userList, ['art_director']);
    if (role === 'team_leader') return getUserIdsByRole(userList, ['team_leader']);
    if (role === 'team_member' && task) return sanitizeHandledByWithSettings(appSettings, [task.createdBy, ...task.handledBy]);
    return [];
  };

  const normalizeOwnerIdsForRole = (role: Role | null, ids: string[], assignerId?: string) => (
    role === 'team_member' ? sanitizeHandledByWithSettings(appSettings, ids, assignerId) : uniqueIds(ids)
  );

  const getWorkflowBySelection = (taskType: string, workflowId?: string | null) => {
    const selected = workflowId ? (appSettings.workflows || []).find(workflow => workflow.id === workflowId && workflow.active !== false) : null;
    return selected || getWorkflowForTaskType(appSettings, taskType);
  };

  const getFallbackOwnerIdsForWorkflowPhase = (role: Role | null, task: Task) => {
    if (role === 'team_member') {
      return uniqueIds([...(task.contentRevisionAssigneeIds || []), task.createdBy, ...task.handledBy]);
    }
    if (role === 'art_director') return getUserIdsByRole(userList, ['art_director']);
    if (role === 'team_leader') return getUserIdsByRole(userList, ['team_leader']);
    if (role === 'reviewer') return uniqueIds([...getUserIdsByRole(userList, ['reviewer', 'admin']), ...(appSettings.firstReviewerUserIds || [])]);
    return [];
  };

  const getActiveWorkflowOwnerIds = (task: Task, phase = getWorkflowPhase(task), approvals: string[] = []) => {
    const ownerRole = getPhaseOwnerRole(phase);
    const configuredReviewerIds = resolveWorkflowPhaseReviewerIds(phase, appSettings, userList, task);
    const allReviewerIds = configuredReviewerIds.length > 0
      ? uniqueIds(configuredReviewerIds)
      : uniqueIds(getFallbackOwnerIdsForWorkflowPhase(ownerRole, task));
    const pendingReviewerIds = allReviewerIds.filter(userId => !approvals.includes(userId));

    if (!phase) return [];
    if (phase.mode === 'sequential') {
      return pendingReviewerIds.length > 0 ? [pendingReviewerIds[0]] : allReviewerIds.slice(0, 1);
    }
    return pendingReviewerIds.length > 0 ? pendingReviewerIds : allReviewerIds;
  };

  const buildTaskWithWorkflowPhase = (task: Task, workflow: WorkflowDefinition, phaseIndex: number, approvals: Record<string, string[]> = {}, history: WorkflowPhaseHistoryEntry[] = [], actorId = currentUser.id, note?: string): Task => {
    const phase = workflow.phases[phaseIndex] || workflow.phases[0];
    if (!phase) return task;

    const phaseApprovals = approvals[phase.id] || [];
    const nextTaskBase: Task = {
      ...task,
      workflowId: workflow.id,
      workflowSnapshot: cloneWorkflow(workflow),
      workflowCurrentPhaseId: phase.id,
      workflowCurrentPhaseIndex: phaseIndex,
      workflowPhaseApprovals: approvals,
      workflowPhaseHistory: [
        ...history,
        {
          phaseId: phase.id,
          phaseName: phase.name,
          action: note === 'workflow_changed' ? 'workflow_changed' : 'started',
          actorId,
          createdAt: new Date().toISOString(),
          note: note === 'workflow_changed' ? `Workflow changed to ${workflow.name}.` : undefined,
        },
      ],
      reviewMode: getReviewModeForWorkflowPhase(phase),
      status: getStatusForWorkflowPhase(phase),
      currentOwnerRole: getPhaseOwnerRole(phase),
    };
    const ownerIds = getActiveWorkflowOwnerIds(nextTaskBase, phase, phaseApprovals);
    return {
      ...nextTaskBase,
      currentOwnerUserId: ownerIds[0] || null,
      currentOwnerUserIds: ownerIds,
    };
  };

  const initializeTaskWorkflow = (task: Task, workflowId?: string | null, phaseId?: string | null, actorId = currentUser.id) => {
    const workflow = getWorkflowBySelection(task.taskType, workflowId || task.workflowId);
    if (!workflow || workflow.phases.length === 0) return task;
    const selectedPhaseIndex = phaseId ? getWorkflowPhaseIndex(workflow, phaseId) : -1;
    const phaseIndex = selectedPhaseIndex >= 0 ? selectedPhaseIndex : 0;
    return buildTaskWithWorkflowPhase(task, workflow, phaseIndex, {}, task.workflowPhaseHistory || [], actorId, task.workflowSnapshot ? 'workflow_changed' : undefined);
  };

  const advanceWorkflowAfterApproval = (task: Task, actorId: string): Task => {
    const workflow = task.workflowSnapshot || getWorkflowBySelection(task.taskType, task.workflowId);
    if (!workflow || workflow.phases.length === 0) {
      return {
        ...task,
        status: 'approved_by_art_director',
        currentOwnerRole: null,
        currentOwnerUserId: null,
        currentOwnerUserIds: [],
      };
    }

    const phase = getWorkflowPhase(task) || workflow.phases[0];
    const phaseIndex = Math.max(0, getWorkflowPhaseIndex(workflow, phase.id));
    const existingApprovals = task.workflowPhaseApprovals || {};
    const nextApprovals = {
      ...existingApprovals,
      [phase.id]: uniqueIds([...(existingApprovals[phase.id] || []), actorId]),
    };
    const configuredReviewerIds = resolveWorkflowPhaseReviewerIds(phase, appSettings, userList, task);
    const allReviewerIds = configuredReviewerIds.length > 0
      ? uniqueIds(configuredReviewerIds)
      : uniqueIds(getFallbackOwnerIdsForWorkflowPhase(getPhaseOwnerRole(phase), task));
    const approvedIds = nextApprovals[phase.id] || [];
    const phaseComplete = allReviewerIds.length === 0 || allReviewerIds.every(userId => approvedIds.includes(userId));
    const now = new Date().toISOString();
    const approvedHistory: WorkflowPhaseHistoryEntry[] = [
      ...(task.workflowPhaseHistory || []),
      {
        phaseId: phase.id,
        phaseName: phase.name,
        action: 'approved',
        actorId,
        createdAt: now,
      },
    ];

    if (!phaseComplete) {
      const ownerIds = getActiveWorkflowOwnerIds(task, phase, approvedIds);
      return {
        ...task,
        workflowSnapshot: cloneWorkflow(workflow),
        workflowId: workflow.id,
        workflowPhaseApprovals: nextApprovals,
        workflowPhaseHistory: approvedHistory,
        currentOwnerRole: getPhaseOwnerRole(phase),
        currentOwnerUserId: ownerIds[0] || null,
        currentOwnerUserIds: ownerIds,
        updatedAt: now,
      };
    }

    const completedHistory: WorkflowPhaseHistoryEntry[] = [
      ...approvedHistory,
      {
        phaseId: phase.id,
        phaseName: phase.name,
        action: 'completed',
        actorId,
        createdAt: now,
      },
    ];
    const nextPhaseIndex = phaseIndex + 1;
    if (nextPhaseIndex < workflow.phases.length) {
      return buildTaskWithWorkflowPhase({
        ...task,
        workflowPhaseApprovals: nextApprovals,
      }, workflow, nextPhaseIndex, nextApprovals, completedHistory, actorId);
    }

    return {
      ...task,
      workflowSnapshot: cloneWorkflow(workflow),
      workflowId: workflow.id,
      workflowPhaseApprovals: nextApprovals,
      workflowPhaseHistory: completedHistory,
      status: 'approved_by_art_director',
      currentOwnerRole: null,
      currentOwnerUserId: null,
      currentOwnerUserIds: [],
      updatedAt: now,
    };
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
    if ((!isDriveWorkspaceReady && !isNeonWorkspaceActive) || !localMigrationState || isMigratingLocalData) return;
    setIsMigratingLocalData(true);
    setPersistenceError(null);

    try {
      const uploadedTasks = isDriveWorkspaceReady
        ? await Promise.all(localMigrationState.tasks.map(uploadMigratedTaskFiles))
        : localMigrationState.tasks;

      if (isDriveWorkspaceReady) {
        await Promise.all([
          ...uploadedTasks.map(task => upsertDriveTask(task)),
          upsertDriveNotifications(localMigrationState.notifications),
        ]);
      }

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
      console.error('Failed to migrate local data to shared storage', error);
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
      const reviewerIds = uniqueIds([
        ...getUserIdsByRole(userList, ['reviewer', 'admin']),
        ...(appSettings.firstReviewerUserIds || [])
      ]);
      const artDirectorIds = uniqueIds([
        ...getUserIdsByRole(userList, ['art_director']),
        ...(appSettings.finalReviewerUserIds || [])
      ]);
      const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
      const contributorIds = uniqueIds([
        task.createdBy,
        ...task.handledBy,
        ...(task.contentRevisionAssigneeIds || [])
      ]);
      const allRecipients = uniqueIds([
        ...reviewerIds,
        ...artDirectorIds,
        ...teamLeaderIds,
        ...contributorIds
      ]);

      if (newStatus === 'approved_by_art_director' && task.status !== newStatus) {
        addNotifications(allRecipients, taskId, `Final Approvement approved "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_reviewer' && task.status !== newStatus) {
        addNotifications(allRecipients, taskId, `Reviewer requested changes on "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_art_director' && task.status !== newStatus) {
        addNotifications(allRecipients, taskId, `Final Approvement rejected "${task.name}" and requested changes.`);
      } else if ((newStatus === 'reviewer_approved' || newStatus === 'sent_to_art_director') && task.status !== newStatus) {
        addNotifications(allRecipients, taskId, `Reviewer approved "${task.name}" and sent to Final Approvement.`);
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
    const reviewerLabel = reviewMode === 'full_review' ? 'Full Review' : reviewMode === 'quick_look' ? 'Quick Look' : 'Direct to Final Approvement';

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

  const applyTaskWorkflow = (taskId: string, workflowId: string, phaseId?: string) => {
    const task = tasks.find(t => t.id === taskId);
    const workflow = (appSettings.workflows || []).find(item => item.id === workflowId && item.active !== false);
    if (!task || !workflow) return;

    const updatedTask = initializeTaskWorkflow({
      ...task,
      workflowId,
      workflowSnapshot: cloneWorkflow(workflow),
      workflowPhaseApprovals: {},
    }, workflowId, phaseId, currentUser.id);
    const phase = getWorkflowPhase(updatedTask);
    const ownerIds = getCurrentOwnerUserIds(updatedTask);
    if (ownerIds.length > 0) {
      addNotifications(ownerIds.filter(userId => userId !== currentUser.id), taskId, `"${task.name}" is now in ${phase?.name || workflow.name}.`);
    }

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const now = new Date().toISOString();
      return addAuditComment({
        ...updatedTask,
        updatedAt: now,
      }, currentUser.id, 'review_route_change', `Workflow changed to ${workflow.name}${phase ? ` at ${phase.name}` : ''}.`, now);
    }));
  };

  const approveWorkflowPhase = (taskId: string, note?: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const taskWithWorkflow = task.workflowSnapshot ? task : initializeTaskWorkflow(task, task.workflowId, undefined, currentUser.id);
    const beforePhase = getWorkflowPhase(taskWithWorkflow);
    if (beforePhase && hasUserApprovedWorkflowPhase(taskWithWorkflow, beforePhase.id, currentUser.id)) return;
    const updatedTask = advanceWorkflowAfterApproval(taskWithWorkflow, currentUser.id);
    const afterPhase = getWorkflowPhase(updatedTask);
    const ownerIds = getCurrentOwnerUserIds(updatedTask);

    if (updatedTask.status === 'approved_by_art_director') {
      const recipients = uniqueIds([
        task.createdBy,
        ...task.handledBy,
        ...getUserIdsByRole(userList, ['team_leader']),
        ...getUserIdsByRole(userList, ['reviewer', 'admin']),
        ...getUserIdsByRole(userList, ['art_director']),
      ]).filter(userId => userId !== currentUser.id);
      addNotifications(recipients, taskId, `"${task.name}" was approved.`);
    } else if (ownerIds.length > 0) {
      addNotifications(ownerIds.filter(userId => userId !== currentUser.id), taskId, `"${task.name}" is ready for ${afterPhase?.name || 'the next review phase'}.`);
    }

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const now = new Date().toISOString();
      return addAuditComment({
        ...updatedTask,
        updatedAt: now,
      }, currentUser.id, beforePhase?.reviewStyle === 'final_approval' ? 'sent_to_marwa' : 'review_note', note || `${beforePhase?.name || 'Review phase'} approved.`, now);
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
      MINA_ID,
      MARWA_ID,
      DINA_ID,
      AHMED_SOBEEH_ID,
      FAWZY_ID,
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
      MINA_ID,
      MARWA_ID,
      DINA_ID,
      AHMED_SOBEEH_ID,
      FAWZY_ID,
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
      MINA_ID,
      MARWA_ID,
      DINA_ID,
      AHMED_SOBEEH_ID,
      FAWZY_ID,
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
    if (!input.name.trim() || !input.description.trim() || handledBy.length === 0) return;

    const now = new Date().toISOString();
    const taskId = Math.random().toString(36).substring(7);
    const normalizedLinks = input.assignmentLinks.map(link => link.trim()).filter(Boolean);
    const deadlineText = formatDeadlineText(input.deadlineAt);
    const assignmentPeriod = getAssignmentPeriodFromDeadline(input.deadlineAt);
    const isContentCreatorTask = handledBy.some(id => {
      const u = usersObj[id];
      return u && (u.jobTitle === 'Content Creator' || (u.role === 'team_member' && u.jobTitle === 'Content Creator'));
    }) || (() => {
      const creator = usersObj[currentUser.id];
      return creator && (creator.jobTitle === 'Content Creator' || (creator.role === 'team_member' && creator.jobTitle === 'Content Creator'));
    })();
    const task: Task = {
      id: taskId,
      code: createTaskCode('WRK'),
      name: input.name.trim(),
      description: input.description.trim() || null,
      taskType: (input.taskType as TaskType) || 'others',
      reviewMode: getEffectiveReviewMode(input.taskType || 'others', isContentCreatorTask, 'full_review'),
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
      contentRevisionAssigneeIds: input.needsContentRevision ? (input.contentRevisionAssigneeIds || []) : [],
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
    if (!input.name.trim() || !input.description.trim() || handledBy.length === 0) return;

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
      const isAlreadyUploaded = t.status !== 'assigned_work';
      const isContentCreatorTask = handledBy.some(id => {
        const u = usersObj[id];
        return u && (u.jobTitle === 'Content Creator' || (u.role === 'team_member' && u.jobTitle === 'Content Creator'));
      }) || (t.contentRevisionAssigneeIds || []).some(id => {
        const u = usersObj[id];
        return u && (u.jobTitle === 'Content Creator' || (u.role === 'team_member' && u.jobTitle === 'Content Creator'));
      }) || (() => {
        const creator = usersObj[t.createdBy];
        return creator && (creator.jobTitle === 'Content Creator' || (creator.role === 'team_member' && creator.jobTitle === 'Content Creator'));
      })();
      return addAuditComment({
        ...t,
        name: input.name.trim(),
        description: input.description.trim() || null,
        taskType: (input.taskType as TaskType) || t.taskType,
        reviewMode: getEffectiveReviewMode((input.taskType as TaskType) || t.taskType, isContentCreatorTask, t.reviewMode),
        handledBy,
        currentOwnerRole: isAlreadyUploaded ? t.currentOwnerRole : 'team_member',
        currentOwnerUserId: isAlreadyUploaded ? t.currentOwnerUserId : (handledBy[0] || null),
        currentOwnerUserIds: isAlreadyUploaded ? t.currentOwnerUserIds : handledBy,
        priority: input.priority,
        deadlineText: formatDeadlineText(input.deadlineAt),
        assignmentPeriod,
        assignmentLinks: normalizedLinks,
        deadlineAt: input.deadlineAt || null,
        isOvertime: input.isOvertime || false,
        needsContentRevision: input.needsContentRevision || false,
        contentRevisionAssigneeIds: input.needsContentRevision ? (input.contentRevisionAssigneeIds || []) : [],
        updatedAt: now,
      }, currentUser.id, 'work_assignment_updated', message, now);
    }));
  };

  const updateTaskContentRevisionAssignees = (taskId: string, assigneeIds: string[]) => {
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;

      const now = new Date().toISOString();
      const previousAssigneeIds = t.contentRevisionAssigneeIds || [];

      const updatedTask = {
        ...t,
        contentRevisionAssigneeIds: assigneeIds,
        currentOwnerUserIds: t.status === 'waiting_content_revision' ? assigneeIds : t.currentOwnerUserIds,
        currentOwnerUserId: t.status === 'waiting_content_revision' ? (assigneeIds[0] || null) : t.currentOwnerUserId,
        updatedAt: now,
      };

      // Notify newly added assignees
      assigneeIds.forEach(id => {
        if (!previousAssigneeIds.includes(id)) {
          addNotification({
            userId: id,
            taskId,
            message: `You have a new content revision task: "${t.name}".`,
          });
        }
      });

      const assigneeNames = assigneeIds.length > 0
        ? assigneeIds.map(id => getUserDisplayName(usersObj, id)).join(', ')
        : 'Decide Later';
      const auditMsg = `Content revision assignees updated to: ${assigneeNames}.`;

      return addAuditComment(updatedTask, currentUser.id, 'work_assignment_updated', auditMsg, now);
    }));
  };

  const submitWorkAssignmentUpload = (taskId: string, payload: WorkAssignmentUploadPayload) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status !== 'assigned_work') return;

    const isContentCreatorTask = checkIsContentCreatorTask(task);
    const workflow = getWorkflowBySelection(payload.taskType, payload.workflowId || task.workflowId);
    const effectiveReviewMode = payload.reviewMode || task.reviewMode || 'full_review';
    const target = getReviewRouteTarget(effectiveReviewMode);
    const contentCreatorIds = userList.filter(user => user.jobTitle === 'Content Creator' || (user.role === 'team_member' && user.jobTitle === 'Content Creator')).map(user => user.id);
    const contentReviewerIds = contentCreatorIds.length > 0 ? contentCreatorIds : getUserIdsByRole(userList, ['team_leader']);
    
    const isContentRevNeeded = task.needsContentRevision;
    const nextStatus = isContentRevNeeded ? 'waiting_content_revision' : target.status;
    const nextOwnerRole = isContentRevNeeded ? 'team_member' : target.ownerRole;
    const nextOwnerUserIds = isContentRevNeeded 
      ? (task.contentRevisionAssigneeIds || [])
      : getDefaultOwnerIdsForRole(target.ownerRole, task);

    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = uniqueIds([
      ...nextOwnerUserIds,
      ...teamLeaderIds,
      task.createdBy,
      ...task.handledBy,
    ]).filter(userId => userId !== payload.version.submittedBy);

    addNotifications(recipients, taskId, `${getUserDisplayName(usersObj, payload.version.submittedBy)} uploaded finished work for "${task.name}".`);

    if (isContentRevNeeded && task.contentRevisionAssigneeIds && task.contentRevisionAssigneeIds.length > 0) {
      task.contentRevisionAssigneeIds.forEach(userId => {
        addNotification({
          userId,
          taskId,
          message: `You have a new content revision task: "${task.name}".`,
        });
      });
    }

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const now = new Date().toISOString();
      const updatedTaskBase: Task = {
        ...t,
        taskType: payload.taskType,
        reviewMode: effectiveReviewMode,
        workflowId: workflow?.id || payload.workflowId || t.workflowId || null,
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
      const updatedTask = workflow && !isContentRevNeeded
        ? initializeTaskWorkflow(updatedTaskBase, workflow.id, undefined, payload.version.submittedBy)
        : updatedTaskBase;

      const auditMsg = isContentRevNeeded 
        ? 'Finished work uploaded and sent into the Content Revision flow.' 
        : 'Finished work uploaded and sent into the normal review flow.';

      return addAuditComment(updatedTask, payload.version.submittedBy, 'work_assignment_uploaded', auditMsg, now);
    }));
  };

  const addTask = (task: Task) => {
    const taskWithWorkflow = task.workflowSnapshot ? task : initializeTaskWorkflow(task, task.workflowId, undefined, task.createdBy);
    const normalizedTaskBase = normalizeReviewerCreatedTask(taskWithWorkflow, usersObj);
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
      nextOwnerIds = task.contentRevisionAssigneeIds || [];
      nextStatus = 'waiting_content_revision';
      nextOwnerRole = 'team_member';
      auditMsg = 'New version resubmitted for Content Revision.';
    } else if (task.workflowSnapshot || task.workflowId) {
      const workflow = task.workflowSnapshot || getWorkflowBySelection(task.taskType, task.workflowId);
      const phase = getWorkflowPhase(task);
      const phaseId = phase?.id || workflow?.phases[0]?.id;
      const routedTask = workflow
        ? initializeTaskWorkflow({
            ...task,
            workflowSnapshot: cloneWorkflow(workflow),
            workflowId: workflow.id,
            workflowPhaseApprovals: {
              ...(task.workflowPhaseApprovals || {}),
              ...(phaseId ? { [phaseId]: [] } : {}),
            },
          }, workflow.id, phaseId, version.submittedBy)
        : task;
      nextStatus = routedTask.status;
      nextOwnerRole = routedTask.currentOwnerRole || 'reviewer';
      nextOwnerIds = routedTask.currentOwnerUserIds;
      auditMsg = `New version resubmitted for ${phase?.name || 'review'}.`;
    } else {
      sendToMarwa = isReviewerCreatedTask(task, usersObj) || 
        task.status === 'changes_requested_by_art_director' || 
        task.reviewMode === 'direct_to_ad' ||
        ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(task.status);
      nextStatus = sendToMarwa
        ? 'sent_to_art_director'
        : task.reviewMode === 'quick_look'
          ? 'waiting_reviewer_quick_look'
          : 'waiting_reviewer_full_review';
      nextOwnerRole = sendToMarwa ? 'art_director' : 'reviewer';
      nextOwnerIds = getDefaultOwnerIdsForRole(nextOwnerRole, task);
      auditMsg = `New version resubmitted for ${nextOwnerRole === 'art_director' ? 'Final Approvement' : 'First Review'}.`;
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

      let updatedTask: Task = {
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

      if (!isContentRevNeeded && (t.workflowSnapshot || t.workflowId)) {
        const workflow = t.workflowSnapshot || getWorkflowBySelection(t.taskType, t.workflowId);
        const phase = getWorkflowPhase(t);
        const phaseId = phase?.id || workflow?.phases[0]?.id;
        if (workflow) {
          updatedTask = initializeTaskWorkflow({
            ...updatedTask,
            workflowSnapshot: cloneWorkflow(workflow),
            workflowId: workflow.id,
            workflowPhaseApprovals: {
              ...(updatedTask.workflowPhaseApprovals || {}),
              ...(phaseId ? { [phaseId]: [] } : {}),
            },
          }, workflow.id, phaseId, version.submittedBy);
        }
      }

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
      appSettings: resolveAppSettingsWithRealIds(appSettings, userList),
      canManageSettings,
      environment,
      tasks,
      users: usersObj,
      userList,
      notifications,
      persistenceMode: isNeonWorkspaceActive ? 'neon' : isDriveWorkspaceActive ? 'drive' : 'local',
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
      applyTaskWorkflow,
      approveWorkflowPhase,
      updateTaskPublishSchedule,
      markCampaignPublished,
      markPublishReminderSent,
      markWeekReminderSent,
      submitScheduledCampaign,
      editScheduledCampaign,
      createWorkAssignment,
      updateWorkAssignment,
      updateTaskContentRevisionAssignees,
      submitWorkAssignmentUpload,
      addTaskComment,
      updateTaskComment,
      deleteTaskComment,
      addTaskVersion,
      replaceTaskVersionFiles,
      updateTaskMediaPreviews,
      addTask,
      addNotification,
      addNotifications,
      markNotificationAsRead,
      loginWithPassword,
      signupWithEmail,
      updateUserRole,
      updateUserResponsibility,
      addCustomResponsibility,
      getEffectiveReviewMode,
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
