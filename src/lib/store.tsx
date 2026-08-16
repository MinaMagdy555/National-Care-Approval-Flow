import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { AccountProfile, AppSettings, AuthStatus, User, Role, Environment, Task, TaskStatus, Priority, TaskType, Notification, TaskComment, TaskVersion, UploadedTaskFile, ReviewMode, WorkflowDefinition, WorkflowPhaseHistoryEntry, DailyReport, DailyReportEditVersion, DailyReportEntry } from './types';
import { initialUsers, initialTasks, userRoleLabels } from './mockData';
import { supabase } from './supabaseClient';
import { clearAppState, loadAppState, saveAppState } from './localDb';
import { fetchNeonAppState, saveNeonAppState, USE_NEON_DATA } from './neonDb';
import { isTaskArchived, shouldAutoArchiveTask } from './archiveUtils';
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
  computePhaseAvailableAt,
  evaluateSkipRule,
  getNextPhaseIndex,
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
  isPhaseAvailable,
  resolveWorkflowPhaseReviewerIds,
  uniqueIds,
} from './workflowUtils';
import { canCreateWorkAssignment, canDeleteWorkAssignment, canManageWorkAssignment, canSetActiveWorkForMember, getAssignmentPeriodFromDeadline, isLeaderboardUser } from './workAssignmentUtils';
import { buildTaskEditDiff, isPastWorkDate } from './workAssignmentUtils';
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
  assignmentDate?: string | null;
  deadlineAt?: string | null;
  assignmentLinks: string[];
  handledByIds: string[];
  workflowNodeAssigneeIds?: Record<string, string[]>;
  isOvertime?: boolean;
  taskType?: string;
  needsContentRevision?: boolean;
  contentRevisionAssigneeIds?: string[];
  isTemporarySelfTask?: boolean;
  submittedOnBehalfOfIds?: string[];
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

export function getDefaultDailyReportReceivers(userList: User[]) {
  return userList.filter(user => (
    user.id !== 'guest' && (
      user.role === 'team_leader' ||
      user.role === 'art_director' ||
      user.role === 'marketing_manager' ||
      user.role === 'admin' ||
      isLeaderboardUser(user.id)
    )
  )).map(user => user.id);
}

export function getDailyReportReceiverIds(report: Pick<DailyReport, 'userId'>, settings: AppSettings, userList: User[]) {
  const explicit = Array.isArray(settings.dailyReportReceiverUserIds) ? settings.dailyReportReceiverUserIds : [];
  const fallback = explicit.length > 0 ? explicit : getDefaultDailyReportReceivers(userList);
  return Array.from(new Set(fallback.filter(id => id && id !== report.userId)));
}

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

function mergeAppSettingsPreservingWorkflowDeletions(
  incomingSettings?: Partial<AppSettings> | null,
  currentSettings?: AppSettings | null,
) {
  const currentDeletedWorkflowIds = Array.isArray(currentSettings?.deletedWorkflowIds)
    ? currentSettings.deletedWorkflowIds
    : [];
  const incomingDeletedWorkflowIds = Array.isArray(incomingSettings?.deletedWorkflowIds)
    ? incomingSettings.deletedWorkflowIds
    : [];

  return mergeAppSettings({
    ...(incomingSettings || {}),
    deletedWorkflowIds: Array.from(new Set([
      ...currentDeletedWorkflowIds,
      ...incomingDeletedWorkflowIds,
    ])),
  });
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
    versionId: comment.versionId,
    versionNumber: typeof comment.versionNumber === 'number' ? comment.versionNumber : undefined,
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
    parentId: comment.parentId,
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
    assignmentDate: task.assignmentDate ?? null,
    workflowNodeAssigneeIds: task.workflowNodeAssigneeIds && typeof task.workflowNodeAssigneeIds === 'object' ? task.workflowNodeAssigneeIds : {},
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
    task.assignmentDate || '',
    JSON.stringify(task.workflowNodeAssigneeIds || {}),
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

function dailyReportSyncKey(report: DailyReport) {
  return [
    report.id,
    report.sentAt || '',
    report.sentBy || '',
    report.autoSent ? 'auto' : 'manual',
    report.note,
    report.entries.map(entry => `${entry.taskId}:${entry.startTime || ''}:${entry.endTime || ''}:${entry.durationMinutes || ''}:${entry.note || ''}`).join('|'),
    report.editHistory.length,
    report.updatedAt,
  ].join('::');
}

function coerceDailyReport(report: Partial<DailyReport> & { id?: string }): DailyReport | null {
  if (!report || !report.id || !report.date || !report.userId) return null;
  return {
    id: report.id,
    date: report.date,
    userId: report.userId,
    note: typeof report.note === 'string' ? report.note : '',
    entries: Array.isArray(report.entries) ? report.entries.map(entry => ({
      taskId: entry.taskId,
      startTime: entry.startTime ?? null,
      endTime: entry.endTime ?? null,
      durationMinutes: typeof entry.durationMinutes === 'number' ? entry.durationMinutes : null,
      note: entry.note,
    })) : [],
    sentAt: report.sentAt ?? null,
    sentBy: report.sentBy ?? null,
    autoSent: Boolean(report.autoSent),
    editHistory: Array.isArray(report.editHistory) ? report.editHistory.map(version => ({
      id: version.id,
      editedBy: version.editedBy,
      editedAt: version.editedAt,
      previousNote: version.previousNote ?? null,
      nextNote: version.nextNote ?? null,
      changedEntries: Array.isArray(version.changedEntries) ? version.changedEntries : [],
      autoSent: Boolean(version.autoSent),
    })) : [],
    createdAt: report.createdAt || new Date().toISOString(),
    updatedAt: report.updatedAt || new Date().toISOString(),
  };
}

function mergeDailyReportIntoState(currentReports: DailyReport[], incomingReport: DailyReport) {
  let changed = false;
  const nextReports = currentReports.map(report => {
    if (report.id !== incomingReport.id) return report;
    if (new Date(report.updatedAt).getTime() > new Date(incomingReport.updatedAt).getTime()) return report;
    if (dailyReportSyncKey(report) === dailyReportSyncKey(incomingReport)) return report;
    changed = true;
    return incomingReport;
  });

  if (!currentReports.some(report => report.id === incomingReport.id)) {
    changed = true;
    nextReports.unshift(incomingReport);
  }

  return changed ? nextReports : currentReports;
}

function mergeDailyReportsIntoState(currentReports: DailyReport[], incomingReports: DailyReport[]) {
  return incomingReports.reduce(mergeDailyReportIntoState, currentReports);
}

const DAILY_REPORT_LOCALSTORAGE_PREFIX = 'national-care-daily-report-';

function migrateDailyReportsFromLocalStorage(): DailyReport[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  const reports: DailyReport[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(DAILY_REPORT_LOCALSTORAGE_PREFIX)) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { note?: string; savedAt?: string; sentAt?: string | null };
      const remainder = key.slice(DAILY_REPORT_LOCALSTORAGE_PREFIX.length);
      const lastDash = remainder.lastIndexOf('-');
      if (lastDash < 0) continue;
      const date = remainder.slice(0, lastDash);
      const userId = remainder.slice(lastDash + 1);
      if (!date || !userId) continue;
      reports.push({
        id: `${date}:${userId}`,
        date,
        userId,
        note: parsed.note || '',
        entries: [],
        sentAt: parsed.sentAt || null,
        sentBy: null,
        autoSent: false,
        editHistory: [],
        createdAt: parsed.savedAt || new Date().toISOString(),
        updatedAt: parsed.savedAt || new Date().toISOString(),
      });
      window.localStorage.removeItem(key);
    } catch {
      // Ignore bad localStorage entries.
    }
  }
  return reports;
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
  dailyReports: DailyReport[];
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
  updateTaskBasicDetails: (taskId: string, input: { name: string; description?: string; taskType: string; priority: Priority; deadlineAt?: string | null; assignmentDate?: string | null }) => void;
  updateTaskAssignment: (taskId: string, handledByIds: string[], currentOwnerUserIds: string[]) => void;
  updateTaskReviewMode: (taskId: string, reviewMode: ReviewMode) => void;
  updateTaskActiveWork: (taskId: string, active: boolean, note?: string) => void;
  applyTaskWorkflow: (taskId: string, workflowId: string, phaseId?: string) => void;
  approveWorkflowPhase: (taskId: string, note?: string) => void;
  rejectWorkflowPhase: (taskId: string, note?: string) => void;
  skipWorkflowPhase: (taskId: string) => void;
  manuallyApproveTask: (taskId: string, note?: string) => void;
  updateTaskPublishSchedule: (taskId: string, schedule: { scheduledPublishAt: string | null; publishNote: string | null }) => void;
  markCampaignPublished: (taskId: string) => void;
  markPublishReminderSent: (taskId: string) => void;
  markWeekReminderSent: (taskId: string) => void;
  submitScheduledCampaign: (input: { name: string; taskType: 'campaign' | 'media_buying'; scheduledPublishAt: string; publishNote?: string | null; platform?: string | null; budgetAmount?: number | null; budgetCurrency?: string | null }) => void;
  editScheduledCampaign: (taskId: string, input: { name: string; taskType: 'campaign' | 'media_buying'; scheduledPublishAt: string; publishNote?: string | null; platform?: string | null; budgetAmount?: number | null; budgetCurrency?: string | null }) => void;
  createWorkAssignment: (input: WorkAssignmentInput) => void;
  updateWorkAssignment: (taskId: string, input: WorkAssignmentInput) => void;
  deleteWorkAssignment: (taskId: string) => void;
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
  upsertDailyReport: (report: { date: string; userId: string; note?: string; entries?: DailyReportEntry[] }) => DailyReport | null;
  upsertDailyReportEntry: (reportId: string, taskId: string, patch: { startTime?: string | null; endTime?: string | null; note?: string }) => void;
  sendDailyReport: (reportId: string, options?: { auto?: boolean; actorId?: string }) => void;
  setTaskActiveWorkByLeader: (taskId: string, memberId: string | null) => void;
  loginWithPassword: (identifier: string, password: string) => Promise<AuthActionResult>;
  signupWithEmail: (email: string, password: string, name?: string) => Promise<AuthActionResult>;
  updateUserRole: (userId: string, role: Role) => void;
  updateUserResponsibility: (userId: string, responsibility: string, permissionRole?: Role) => void;
  createManualUser: (input: { name: string; email?: string; role?: Role; jobTitle?: string; password?: string }) => void;
  updateUserProfile: (userId: string, input: { name: string; email?: string; role?: Role; jobTitle?: string; password?: string }) => void;
  addCustomResponsibility: (responsibility: string) => void;
  getEffectiveReviewMode: (taskType: string, isContentCreatorTask: boolean, selectedMode: 'full_review' | 'quick_look' | 'direct_to_ad') => 'full_review' | 'quick_look' | 'direct_to_ad';
  updateAppSettings: (updater: AppSettings | ((settings: AppSettings) => AppSettings)) => Promise<void>;
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

const normalizeLoginIdentifier = (value: string) => value.trim().toLowerCase();

async function hashToolPassword(password: string) {
  const value = password.trim();
  if (!value) return '';

  const data = new TextEncoder().encode(`national-care-tool-login:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function AppProvider({ children }: { children: ReactNode }) {
  const hasLoadedPersistedState = useRef(false);
  const sharedDataLoadFailedRef = useRef(false);
  const pendingTaskBroadcastIdsRef = useRef<Set<string>>(new Set());
  const pendingNotificationBroadcastIdsRef = useRef<Set<string>>(new Set());
  const pendingSettingsBroadcastRef = useRef(false);
  const pendingDailyReportBroadcastIdsRef = useRef<Set<string>>(new Set());
  const linkedMetadataBackfillAttemptsRef = useRef<Set<string>>(new Set());
  const dailyReportMigratedRef = useRef(false);
  const [accountProfiles, setAccountProfiles] = useState<AccountProfile[]>([]);
  const [customResponsibilities, setCustomResponsibilities] = useState<string[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => mergeAppSettings(defaultAppSettings));
  const [authProfile, setAuthProfile] = useState<AccountProfile | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileUserList, setProfileUserList] = useState<User[]>([]);
  const manualUserList = Array.isArray(appSettings.manualUsers) ? appSettings.manualUsers : [];
  const userList = React.useMemo(() => {
    const manualEmails = new Set(
      manualUserList
        .map(user => normalizeLoginIdentifier(user.email || ''))
        .filter(Boolean)
    );
    const visibleProfiles = profileUserList.filter(user => {
      const email = normalizeLoginIdentifier(user.email || '');
      return !email || !manualEmails.has(email);
    });
    const profileIds = new Set(visibleProfiles.map(user => user.id));
    return [
      ...visibleProfiles,
      ...manualUserList.filter(user => !profileIds.has(user.id)),
    ];
  }, [profileUserList, manualUserList]);
  const usersObj = userList.reduce((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {} as Record<string, User>);

  const [currentUserState, setCurrentUserState] = useState<User>(GUEST_USER);
  const [environment, setEnvironment] = useState<Environment>('production');
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dailyReports, setDailyReports] = useState<DailyReport[]>([]);
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

  const queueDailyReportBroadcast = (reportId: string) => {
    pendingDailyReportBroadcastIdsRef.current.add(reportId);
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
        setProfileUserList(list);
        
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
    if (USE_NEON_DATA) {
      try {
        const neonState = await fetchNeonAppState();
        if (neonState?.settings) {
          setAppSettings(prev => mergeAppSettingsPreservingWorkflowDeletions(neonState.settings, prev));
          return;
        }
      } catch (err) {
        console.warn('Exception loading settings from Neon before login, trying Supabase settings:', err);
      }
    }

    try {
      const { data, error } = await supabase.from('app_settings').select('settings').eq('id', 'current').single();
      if (data?.settings) {
        setAppSettings(prev => mergeAppSettingsPreservingWorkflowDeletions(data.settings, prev));
      } else {
        setAppSettings(prev => mergeAppSettingsPreservingWorkflowDeletions(defaultAppSettings, prev));
      }
    } catch (err) {
      console.warn('Exception loading settings from Supabase, using defaults:', err);
      setAppSettings(prev => mergeAppSettingsPreservingWorkflowDeletions(defaultAppSettings, prev));
    }
  };

  useEffect(() => {
    let isMounted = true;
    const codexPreviewAuth = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('codexPreview') === '1';
    
    fetchProfiles();
    fetchSettings();

    if (codexPreviewAuth) {
      setCurrentUserState({
        id: MINA_ID,
        email: 'minamagdy5555@gmail.com',
        name: 'Mina M. Bashir',
        role: 'reviewer',
        jobTitle: 'Senior Brand Designer & Video Editor',
        isAdmin: true,
      });
      setAuthStatus('approved');
      return () => {
        isMounted = false;
      };
    }

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
        setAppSettings(prev => mergeAppSettingsPreservingWorkflowDeletions(localState?.settings, prev));
        setTasks(reviveWorkspaceTasks(localTasks, usersObj));
        setNotifications(Array.isArray(localState?.notifications) ? removeGuestSeedNotifications(localState.notifications) : []);
        const storedReports = Array.isArray(localState?.dailyReports) ? localState.dailyReports.map(coerceDailyReport).filter(Boolean) as DailyReport[] : [];
        let mergedReports = storedReports;
        if (!dailyReportMigratedRef.current) {
          dailyReportMigratedRef.current = true;
          const migratedReports = migrateDailyReportsFromLocalStorage();
          if (migratedReports.length > 0) {
            mergedReports = mergeDailyReportsIntoState(storedReports, migratedReports);
          }
        }
        setDailyReports(mergedReports);
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
        const sharedSettings = mergeAppSettingsPreservingWorkflowDeletions(neonState?.settings || localState?.settings, appSettings);
        const localTasks = Array.isArray(localState?.tasks) ? localState.tasks.filter(task => !isGuestSeedTask(task) && !isPlaceholderTask(task)) : [];
        const localNotifications = Array.isArray(localState?.notifications) ? removeGuestSeedNotifications(localState.notifications) : [];
        const sharedReports = Array.isArray(neonState?.dailyReports) ? neonState.dailyReports.map(coerceDailyReport).filter(Boolean) as DailyReport[] : [];
        const localReports = Array.isArray(localState?.dailyReports) ? localState.dailyReports.map(coerceDailyReport).filter(Boolean) as DailyReport[] : [];
        let combinedReports = mergeDailyReportsIntoState(sharedReports, localReports);
        if (!dailyReportMigratedRef.current) {
          dailyReportMigratedRef.current = true;
          const migratedReports = migrateDailyReportsFromLocalStorage();
          if (migratedReports.length > 0) {
            combinedReports = mergeDailyReportsIntoState(combinedReports, migratedReports);
          }
        }

        sharedDataLoadFailedRef.current = false;
        setAppSettings(sharedSettings);
        setTasks(sharedTasks);
        setNotifications(sharedNotifications);
        setDailyReports(combinedReports);
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
        const sharedSettings = mergeAppSettingsPreservingWorkflowDeletions(loadedSettings || localState?.settings, appSettings);
        const localTasks = Array.isArray(localState?.tasks) ? localState.tasks.filter(task => !isGuestSeedTask(task) && !isPlaceholderTask(task)) : [];
        const localNotifications = Array.isArray(localState?.notifications) ? removeGuestSeedNotifications(localState.notifications) : [];

        sharedDataLoadFailedRef.current = false;
        setAppSettings(sharedSettings);
        setTasks(sharedTasks);
        setNotifications(sharedNotifications);
        const localReports = Array.isArray(localState?.dailyReports) ? localState.dailyReports.map(coerceDailyReport).filter(Boolean) as DailyReport[] : [];
        let combinedReports = localReports;
        if (!dailyReportMigratedRef.current) {
          dailyReportMigratedRef.current = true;
          const migratedReports = migrateDailyReportsFromLocalStorage();
          if (migratedReports.length > 0) {
            combinedReports = mergeDailyReportsIntoState(localReports, migratedReports);
          }
        }
        setDailyReports(combinedReports);
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

    saveNeonAppState({ tasks, notifications, settings: appSettings, dailyReports })
      .then(() => {
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to save Neon app state', error);
        sharedDataLoadFailedRef.current = true;
        setPersistenceError(getSharedDataErrorMessage(error, 'Failed to save Neon app state.'));
      });
  }, [tasks, notifications, appSettings, dailyReports, isNeonWorkspaceActive]);

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

    saveAppState({ tasks, notifications, settings: appSettings, dailyReports })
      .then(() => {
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to save local demo workspace', error);
        setPersistenceError(getErrorMessage(error, 'Failed to save local demo workspace.'));
      });
  }, [tasks, notifications, appSettings, dailyReports, isLocalWorkspaceActive]);

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
        if (Array.isArray(latestState.dailyReports)) {
          setDailyReports(prev => mergeDailyReportsIntoState(prev, latestState.dailyReports!.map(coerceDailyReport).filter(Boolean) as DailyReport[]));
        }
        if (latestState.settings) {
          setAppSettings(prev => mergeAppSettingsPreservingWorkflowDeletions(latestState.settings, prev));
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

  useEffect(() => {
    if (authStatus !== 'approved' || !hasLoadedPersistedState.current) return;
    if (appSettings.dailyReportAutoSendEnabled === false) return;
    const sendTime = (appSettings.dailyReportAutoSendTime || '17:29').trim();
    const [sh, sm] = sendTime.split(':').map(part => Number(part));
    if (Number.isNaN(sh) || Number.isNaN(sm)) return;

    const tick = () => {
      const now = new Date();
      const localTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const targetMinutes = sh * 60 + sm;
      const targetKey = `${today}:${sh}:${sm}`;
      const warningKey = `${targetKey}:warning`;
      const alreadyTicked = (() => {
        try {
          return window.sessionStorage.getItem('national-care-daily-report-auto-tick') === targetKey;
        } catch {
          return false;
        }
      })();
      const alreadyWarned = (() => {
        try {
          return window.sessionStorage.getItem('national-care-daily-report-auto-warning') === warningKey;
        } catch {
          return false;
        }
      })();
      const minutesUntilSend = targetMinutes - currentMinutes;
      if (minutesUntilSend > 0 && minutesUntilSend <= 20 && !alreadyWarned) {
        try {
          window.sessionStorage.setItem('national-care-daily-report-auto-warning', warningKey);
        } catch {
          // Ignore storage errors.
        }
        const warningUserIds = Array.from(new Set([
          currentUser.id,
          ...userList.filter(user => user.id !== 'guest').map(user => user.id),
        ]));
        warningUserIds.forEach(userId => {
          const reportId = `${today}:${userId}`;
          const existing = dailyReports.find(report => report.id === reportId);
          if (existing?.sentAt) return;
          addNotifications(
            [userId],
            'daily-report',
            `Your daily report for ${today} will auto-send at ${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}. Open it now to review before it is sent.`
          );
        });
      }
      if (localTime !== `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`) return;
      if (alreadyTicked) return;
      try {
        window.sessionStorage.setItem('national-care-daily-report-auto-tick', targetKey);
      } catch {
        // Ignore storage errors.
      }
      const allUserIds = Array.from(new Set([
        currentUser.id,
        ...userList.filter(user => user.id !== 'guest').map(user => user.id),
      ]));
      allUserIds.forEach(userId => {
        const reportId = `${today}:${userId}`;
        const existing = dailyReports.find(report => report.id === reportId);
        if (existing && existing.sentAt) return;
        if (!existing) {
          const nowIso = new Date().toISOString();
          const newReport: DailyReport = {
            id: reportId,
            date: today,
            userId,
            note: '',
            entries: [],
            sentAt: nowIso,
            sentBy: userId,
            autoSent: true,
            editHistory: [],
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          queueDailyReportBroadcast(reportId);
          setDailyReports(prev => mergeDailyReportIntoState(prev, newReport));
          const receivers = getDailyReportReceiverIds(newReport, appSettings, userList);
          const ownerName = usersObj[userId]?.name || userId;
          addNotifications(receivers, 'daily-report', `${ownerName}'s daily report for ${today} was auto-sent.`);
        } else {
          sendDailyReport(reportId, { auto: true, actorId: userId });
        }
      });
    };

    tick();
    const intervalId = window.setInterval(tick, 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [authStatus, appSettings.dailyReportAutoSendEnabled, appSettings.dailyReportAutoSendTime, dailyReports, currentUser.id, userList, appSettings, usersObj]);

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

  const computeEntryDurationMinutes = (startTime?: string | null, endTime?: string | null) => {
    if (!startTime) return null;
    const [sh, sm] = startTime.split(':').map(part => Number(part));
    if (Number.isNaN(sh) || Number.isNaN(sm)) return null;
    const startMinutes = sh * 60 + sm;
    let endMinutes: number;
    if (endTime) {
      const [eh, em] = endTime.split(':').map(part => Number(part));
      if (Number.isNaN(eh) || Number.isNaN(em)) return null;
      endMinutes = eh * 60 + em;
    } else {
      const now = new Date();
      endMinutes = now.getHours() * 60 + now.getMinutes();
    }
    const diff = endMinutes - startMinutes;
    return diff > 0 ? diff : 0;
  };

  const upsertDailyReport = (input: { date: string; userId: string; note?: string; entries?: DailyReportEntry[] }) => {
    if (!input.date || !input.userId) return null;
    const reportId = `${input.date}:${input.userId}`;
    const now = new Date().toISOString();
    let result: DailyReport | null = null;

    setDailyReports(prev => {
      const existing = prev.find(report => report.id === reportId);
      const next: DailyReport = {
        id: reportId,
        date: input.date,
        userId: input.userId,
        note: input.note !== undefined ? input.note : (existing?.note || ''),
        entries: Array.isArray(input.entries) ? input.entries : (existing?.entries || []),
        sentAt: existing?.sentAt ?? null,
        sentBy: existing?.sentBy ?? null,
        autoSent: existing?.autoSent ?? false,
        editHistory: existing?.editHistory || [],
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      result = next;
      const nextReports = mergeDailyReportIntoState(prev, next);
      if (nextReports === prev) return prev;
      queueDailyReportBroadcast(reportId);
      return nextReports;
    });

    return result;
  };

  const upsertDailyReportEntry = (reportId: string, taskId: string, patch: { startTime?: string | null; endTime?: string | null; note?: string }) => {
    if (!reportId || !taskId) return;
    const now = new Date().toISOString();
    setDailyReports(prev => {
      const report = prev.find(item => item.id === reportId) || (() => {
        const [date, ...userIdParts] = reportId.split(':');
        const userId = userIdParts.join(':');
        return {
          id: reportId,
          date,
          userId,
          note: '',
          entries: [],
          sentAt: null,
          sentBy: null,
          autoSent: false,
          editHistory: [],
          createdAt: now,
          updatedAt: now,
        } as DailyReport;
      })();
      const previousEntry = report.entries.find(entry => entry.taskId === taskId) || null;
      const previousStart = previousEntry?.startTime ?? null;
      const previousEnd = previousEntry?.endTime ?? null;
      const previousNote = previousEntry?.note ?? null;
      const nextStart = patch.startTime !== undefined ? (patch.startTime || null) : previousStart;
      const nextEnd = patch.endTime !== undefined ? (patch.endTime || null) : previousEnd;
      const nextNote = patch.note !== undefined ? (patch.note || '') : (previousNote || '');
      if (nextStart && nextEnd && nextStart > nextEnd) {
        console.warn('End time must be after start time');
        return prev;
      }
      const durationMinutes = computeEntryDurationMinutes(nextStart, nextEnd);
      const entries = previousEntry
        ? report.entries.map(entry => entry.taskId === taskId
          ? { taskId, startTime: nextStart, endTime: nextEnd, durationMinutes, note: nextNote }
          : entry)
        : [...report.entries, { taskId, startTime: nextStart, endTime: nextEnd, durationMinutes, note: nextNote }];

      const changedEntries: DailyReportEditVersion['changedEntries'] = [];
      if (previousStart !== nextStart) {
        changedEntries.push({ taskId, field: 'startTime', oldValue: previousStart, newValue: nextStart });
      }
      if (previousEnd !== nextEnd) {
        changedEntries.push({ taskId, field: 'endTime', oldValue: previousEnd, newValue: nextEnd });
      }
      if (previousNote !== nextNote) {
        changedEntries.push({ taskId, field: 'note', oldValue: previousNote, newValue: nextNote });
      }

      let editHistory = report.editHistory;
      if (report.sentAt && changedEntries.length > 0) {
        editHistory = [
          ...editHistory,
          {
            id: Math.random().toString(36).substring(7),
            editedBy: currentUser.id,
            editedAt: now,
            previousNote: report.note,
            nextNote: report.note,
            changedEntries,
          },
        ];
      }

      const updatedReport: DailyReport = {
        ...report,
        entries,
        editHistory,
        updatedAt: now,
      };

      const nextReports = mergeDailyReportIntoState(prev, updatedReport);
      if (nextReports === prev) return prev;
      queueDailyReportBroadcast(reportId);

      if (report.sentAt && changedEntries.length > 0) {
        const receivers = getDailyReportReceiverIds(updatedReport, appSettings, userList);
        const summary = changedEntries
          .map(change => {
            if (change.field === 'startTime' || change.field === 'endTime') {
              const task = tasks.find(item => item.id === change.taskId);
              const label = task ? `${task.code} ${task.name}` : change.taskId;
              return `${label} ${change.field === 'startTime' ? 'start' : 'end'} ${change.oldValue || 'unset'} -> ${change.newValue || 'unset'}`;
            }
            return `${change.taskId} note changed`;
          })
          .join('; ');
        addNotifications(
          receivers,
          tasks.find(item => item.id === changedEntries[0]?.taskId)?.id || 'daily-report',
          `${currentUser.name} updated their daily report for ${report.date}: ${summary}`
        );
      }

      return nextReports;
    });
  };

  const sendDailyReport = (reportId: string, options?: { auto?: boolean; actorId?: string }) => {
    const now = new Date().toISOString();
    const actorId = options?.actorId || currentUser.id;
    setDailyReports(prev => {
      const report = prev.find(item => item.id === reportId);
      if (!report) return prev;
      if (report.sentAt) return prev;
      const updatedReport: DailyReport = {
        ...report,
        sentAt: now,
        sentBy: actorId,
        autoSent: Boolean(options?.auto),
        updatedAt: now,
      };
      const receivers = getDailyReportReceiverIds(updatedReport, appSettings, userList);
      const ownerName = usersObj[report.userId]?.name || initialUsers.find(user => user.id === report.userId)?.name || 'Member';
      addNotifications(
        receivers,
        tasks.find(item => item.id === report.entries[0]?.taskId)?.id || 'daily-report',
        `${ownerName}'s daily report for ${report.date} was ${options?.auto ? 'auto-sent' : 'sent'}.`
      );
      const nextReports = mergeDailyReportIntoState(prev, updatedReport);
      if (nextReports === prev) return prev;
      queueDailyReportBroadcast(reportId);
      return nextReports;
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
    const requiredApprovals = typeof phase.requiredApprovals === 'number' && phase.requiredApprovals > 0
      ? phase.requiredApprovals
      : (allReviewerIds.length || 1);
    const phaseComplete = approvedIds.length >= requiredApprovals;
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

    let completedHistory: WorkflowPhaseHistoryEntry[] = [
      ...approvedHistory,
      {
        phaseId: phase.id,
        phaseName: phase.name,
        action: 'completed',
        actorId,
        createdAt: now,
      },
    ];
    let nextIndex = phase.passToPhaseId
      ? getWorkflowPhaseIndex(workflow, phase.passToPhaseId)
      : getNextPhaseIndex(workflow, phaseIndex, { ...task, workflowPhaseApprovals: nextApprovals });
    if (nextIndex < 0) {
      nextIndex = getNextPhaseIndex(workflow, phaseIndex, { ...task, workflowPhaseApprovals: nextApprovals });
    }

    while (nextIndex < workflow.phases.length) {
      const candidate = workflow.phases[nextIndex];
      if (candidate.nodeType !== 'step') {
        completedHistory = [...completedHistory, {
          phaseId: candidate.id,
          phaseName: candidate.name,
          action: 'skipped',
          actorId,
          createdAt: now,
          note: 'Non-step node skipped automatically.',
        }];
        nextIndex += 1;
        continue;
      }
      if (evaluateSkipRule(candidate.skipRule, { ...task, workflowPhaseApprovals: nextApprovals })) {
        completedHistory = [...completedHistory, {
          phaseId: candidate.id,
          phaseName: candidate.name,
          action: 'skipped',
          actorId,
          createdAt: now,
          note: `Skipped by rule: ${candidate.skipRule}.`,
        }];
        nextIndex = getNextPhaseIndex(workflow, nextIndex, { ...task, workflowPhaseApprovals: nextApprovals });
        continue;
      }
      break;
    }

    if (nextIndex < workflow.phases.length) {
      const targetPhase = workflow.phases[nextIndex];
      const availableAt = computePhaseAvailableAt(now, targetPhase.delayDays, appSettings.businessCalendar);
      const routedTask = buildTaskWithWorkflowPhase({
        ...task,
        workflowPhaseApprovals: nextApprovals,
      }, workflow, nextIndex, nextApprovals, completedHistory, actorId);
      if (availableAt && new Date(availableAt).getTime() > Date.now()) {
        return {
          ...routedTask,
          workflowPhaseAvailableAt: availableAt,
          updatedAt: now,
        };
      }
      return routedTask;
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

    const normalizedIdentifier = normalizeLoginIdentifier(identifier);
    let toolManagedUsers = manualUserList;
    let manualUser = toolManagedUsers.find(user => {
      const email = normalizeLoginIdentifier(user.email || '');
      const name = normalizeLoginIdentifier(user.name);
      return normalizedIdentifier === email || normalizedIdentifier === name;
    });

    if (!manualUser && USE_NEON_DATA) {
      try {
        const neonState = await fetchNeonAppState();
        const sharedSettings = mergeAppSettingsPreservingWorkflowDeletions(neonState?.settings, appSettings);
        setAppSettings(sharedSettings);
        toolManagedUsers = sharedSettings.manualUsers || [];
        manualUser = toolManagedUsers.find(user => {
          const email = normalizeLoginIdentifier(user.email || '');
          const name = normalizeLoginIdentifier(user.name);
          return normalizedIdentifier === email || normalizedIdentifier === name;
        });
      } catch (err) {
        console.warn('Could not load Neon users during login fallback:', err);
      }
    }

    if (manualUser) {
      if (!manualUser.passwordHash) {
        return { ok: false, message: 'This member has no tool password yet. Ask an admin to set one in Members Roles and Positions.' };
      }

      const passwordHash = await hashToolPassword(password);
      if (passwordHash !== manualUser.passwordHash) {
        return { ok: false, message: 'Invalid email/name or password.' };
      }

      setAuthError(null);
      setAuthProfile({
        id: manualUser.id,
        email: manualUser.email || '',
        name: manualUser.name,
        role: manualUser.role,
        jobTitle: manualUser.jobTitle,
        requestedRole: manualUser.role,
        approvalStatus: 'approved',
        isAdmin: Boolean(manualUser.isAdmin),
        legacyId: manualUser.legacyId || null,
        approvedBy: 'tool',
        approvedAt: manualUser.passwordUpdatedAt || new Date().toISOString(),
        createdAt: manualUser.passwordUpdatedAt || new Date().toISOString(),
        updatedAt: manualUser.passwordUpdatedAt || new Date().toISOString(),
      });
      setCurrentUserState(manualUser);
      setAuthStatus('approved');
      return { ok: true };
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

    if (manualUserList.some(user => user.id === userId)) {
      await updateAppSettings(settings => ({
        ...settings,
        manualUsers: (settings.manualUsers || []).map(user => (
          user.id === userId
            ? { ...user, role: permissionRole, jobTitle }
            : user
        )),
      }));
      if (currentUser.id === userId) {
        setCurrentUserState(prev => ({ ...prev, role: permissionRole, jobTitle }));
      }
      return;
    }
    
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

  const createManualUser = async (input: { name: string; email?: string; role?: Role; jobTitle?: string; password?: string }) => {
    const name = input.name.trim();
    if (!name || !canManageSettings) return;
    const passwordHash = input.password?.trim() ? await hashToolPassword(input.password) : undefined;
    const now = new Date().toISOString();

    const user: User = {
      id: `manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      email: input.email?.trim() || undefined,
      role: input.role || 'team_member',
      jobTitle: input.jobTitle?.trim() || 'Content Creator',
      isAdmin: false,
      passwordHash,
      passwordUpdatedAt: passwordHash ? now : undefined,
    };

    await updateAppSettings(settings => ({
      ...settings,
      manualUsers: [...(settings.manualUsers || []), user],
    }));
    addNotification({
      userId: user.id,
      taskId: 'members',
      message: `${currentUser.name} added you to Members Roles and Positions as ${user.jobTitle}.`,
    });
  };

  const updateUserProfile = async (userId: string, input: { name: string; email?: string; role?: Role; jobTitle?: string; password?: string }) => {
    const name = input.name.trim();
    if (!name || !canManageSettings) return;

    const role = input.role || usersObj[userId]?.role || 'team_member';
    const jobTitle = input.jobTitle?.trim() || usersObj[userId]?.jobTitle || getResponsibilityLabelForRole(appSettings, role) || 'Content Creator';
    const email = input.email?.trim() || undefined;
    const passwordHash = input.password?.trim() ? await hashToolPassword(input.password) : undefined;
    const passwordUpdatedAt = passwordHash ? new Date().toISOString() : undefined;

    if (manualUserList.some(user => user.id === userId)) {
      await updateAppSettings(settings => ({
        ...settings,
        manualUsers: (settings.manualUsers || []).map(user => (
          user.id === userId
            ? { ...user, name, email, role, jobTitle, ...(passwordHash ? { passwordHash, passwordUpdatedAt } : {}) }
            : user
        )),
      }));
      if (currentUser.id === userId) {
        setCurrentUserState(prev => ({ ...prev, name, email, role, jobTitle, ...(passwordHash ? { passwordHash, passwordUpdatedAt } : {}) }));
      }
      addNotification({
        userId,
        taskId: 'members',
        message: `${currentUser.name} updated your member role, position, or responsibilities.`,
      });
      return;
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        name,
        email: email || null,
        role,
        job_title: jobTitle,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      console.error('Failed to update user profile in Supabase', error);
      return;
    }

    await fetchProfiles();

    if (currentUser.id === userId) {
      setCurrentUserState(prev => ({ ...prev, name, email, role, jobTitle }));
    }
    addNotification({
      userId,
      taskId: 'members',
      message: `${currentUser.name} updated your member role, position, or responsibilities.`,
    });
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

    const nextState = { tasks, notifications, settings: merged, dailyReports };
    
    try {
      if (isNeonWorkspaceActive && hasLoadedPersistedState.current && !sharedDataLoadFailedRef.current) {
        await saveNeonAppState(nextState);
      } else if (isDriveWorkspaceReady && hasLoadedPersistedState.current && !sharedDataLoadFailedRef.current) {
        await upsertDriveSettings(merged);
      } else if (isLocalWorkspaceActive && hasLoadedPersistedState.current) {
        await saveAppState(nextState);
      }

      await supabase.from('app_settings').upsert({
        id: 'current',
        settings: merged,
        updated_at: new Date().toISOString()
      });

      setPersistenceError(null);
    } catch (error) {
      console.error('Failed to save app settings', error);
      setPersistenceError(getSharedDataErrorMessage(error, 'Failed to save app settings.'));
    }
  };

  const deleteUserAccount = async (userId: string) => {
    if (manualUserList.some(user => user.id === userId)) {
      await updateAppSettings(settings => {
        const removeUserId = (ids: string[] = []) => ids.filter(id => id !== userId);
        return {
          ...settings,
          manualUsers: (settings.manualUsers || []).filter(user => user.id !== userId),
          settingsManagerUserIds: removeUserId(settings.settingsManagerUserIds),
          workAssignmentCreatorIds: removeUserId(settings.workAssignmentCreatorIds),
          contributorAssignerIds: removeUserId(settings.contributorAssignerIds),
          neverHandlerIds: removeUserId(settings.neverHandlerIds),
          selfAssignmentBlockedIds: removeUserId(settings.selfAssignmentBlockedIds),
          videoOnlyHandlerIds: removeUserId(settings.videoOnlyHandlerIds),
          alwaysAssignableHandlerIds: removeUserId(settings.alwaysAssignableHandlerIds),
          firstReviewerUserIds: removeUserId(settings.firstReviewerUserIds || []),
          finalReviewerUserIds: removeUserId(settings.finalReviewerUserIds || []),
          viewAllWorkloadUserIds: removeUserId(settings.viewAllWorkloadUserIds || []),
          customPermissions: (settings.customPermissions || []).map(permission => ({
            ...permission,
            userIds: removeUserId(permission.userIds),
          })),
          workflows: (settings.workflows || []).map(workflow => ({
            ...workflow,
            phases: workflow.phases.map(phase => ({
              ...phase,
              userIds: removeUserId(phase.userIds),
            })),
          })),
        };
      });
      return;
    }

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
        addNotifications(allRecipients, taskId, `Art Director approved "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_reviewer' && task.status !== newStatus) {
        addNotifications(allRecipients, taskId, `Reviewer requested changes on "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_art_director' && task.status !== newStatus) {
        addNotifications(allRecipients, taskId, `Art Director rejected "${task.name}" and requested changes.`);
      } else if ((newStatus === 'reviewer_approved' || newStatus === 'sent_to_art_director') && task.status !== newStatus) {
        addNotifications(allRecipients, taskId, `Reviewer approved "${task.name}" and sent to Art Director.`);
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

  const updateTaskActiveWork = (taskId: string, active: boolean, note?: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const isAssignee = task.handledBy.includes(currentUser.id);
    const isHighboardOrLeader = canSetActiveWorkForMember(currentUser);
    if (!isAssignee && !isHighboardOrLeader) return;

    const now = new Date().toISOString();
    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const reviewerIds = uniqueIds([
      ...getUserIdsByRole(userList, ['reviewer', 'admin']),
      ...(appSettings.firstReviewerUserIds || []),
    ]);
    const artDirectorIds = uniqueIds([
      ...getUserIdsByRole(userList, ['art_director']),
      ...(appSettings.finalReviewerUserIds || []),
    ]);
    const recipients = uniqueIds([
      task.createdBy,
      ...task.handledBy,
      ...(task.contentRevisionAssigneeIds || []),
      ...teamLeaderIds,
      ...reviewerIds,
      ...artDirectorIds,
    ]).filter(userId => userId !== currentUser.id);

    addNotifications(
      recipients,
      taskId,
      active
        ? `${currentUser.name} started working on "${task.name}".`
        : `${currentUser.name} finished active work on "${task.name}".`
    );

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const prevStarter = t.activeWorkBy;
      const prevFinisher = t.activeWorkFinishedById;
      return addAuditComment({
        ...t,
        activeWorkBy: active ? currentUser.id : t.activeWorkBy,
        activeWorkStartedAt: active ? now : t.activeWorkStartedAt,
        activeWorkFinishedAt: active ? null : now,
        activeWorkFinishedById: active ? null : currentUser.id,
        activeWorkNote: note?.trim() || t.activeWorkNote || null,
        updatedAt: now,
      }, currentUser.id, active ? 'active_work_started' : 'active_work_finished', active ? 'Marked as actively working.' : 'Marked active work as finished.', now);
    }));
  };

  const setTaskActiveWorkByLeader = (taskId: string, memberId: string | null) => {
    if (!canSetActiveWorkForMember(currentUser)) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const now = new Date().toISOString();

    if (!memberId) {
      queueTaskBroadcast(taskId);
      setTasks(prev => prev.map(t => (
        t.id !== taskId
          ? t
          : addAuditComment({
              ...t,
              activeWorkSetById: null,
              activeWorkSetAt: null,
              updatedAt: now,
            }, currentUser.id, 'assignment_change', `${currentUser.name} cleared the active task marker.`, now)
      )));
      return;
    }

    addNotifications(
      [memberId],
      taskId,
      `${currentUser.name} set "${task.name}" as your active task.`
    );

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return addAuditComment({
        ...t,
        activeWorkSetById: currentUser.id,
        activeWorkSetAt: now,
        updatedAt: now,
      }, currentUser.id, 'assignment_change', `${currentUser.name} set this task as active for ${getUserDisplayName(usersObj, memberId)}.`, now);
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

  const updateTaskBasicDetails = (taskId: string, input: { name: string; description?: string; taskType: string; priority: Priority; deadlineAt?: string | null; assignmentDate?: string | null }) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const today = new Date();
    const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (input.assignmentDate && input.assignmentDate < todayValue) {
      console.warn('Assignment date cannot be in the past.');
      return;
    }

    const now = new Date().toISOString();
    const isLiveTask = !['assigned_work', 'draft', 'approved_by_art_director', 'completed', 'archived'].includes(task.status);
    const typeChanged = input.taskType && input.taskType !== task.taskType;
    const diffs = buildTaskEditDiff(task, {
      name: input.name.trim() || task.name,
      description: input.description ?? task.description,
      taskType: input.taskType,
      priority: input.priority,
      assignmentDate: input.assignmentDate,
      deadlineAt: input.deadlineAt,
    });

    const recipients = uniqueIds([
      task.createdBy,
      ...task.handledBy,
      ...(task.contentRevisionAssigneeIds || []),
      ...getCurrentOwnerUserIds(task),
    ]).filter(userId => userId !== currentUser.id);

    const summary = diffs.length > 0 ? diffs.join('; ') : 'no changes';
    if (recipients.length > 0) {
      addNotifications(recipients, taskId, `${currentUser.name} edited "${task.name}": ${summary}`);
    }

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      let nextOwners: string[] = t.currentOwnerUserIds;
      let nextRole = t.currentOwnerRole;
      const newWorkflow = typeChanged ? getWorkflowBySelection(input.taskType, t.workflowId) : null;
      if (isLiveTask && typeChanged && newWorkflow) {
        const phase = newWorkflow.phases[0] || null;
        if (phase) {
          nextRole = getPhaseOwnerRole(phase);
          nextOwners = resolveWorkflowPhaseReviewerIds(phase, appSettings, userList, { ...t, taskType: input.taskType, workflowSnapshot: cloneWorkflow(newWorkflow) });
        }
      }
      const updatedTask = {
        ...t,
        name: input.name.trim() || t.name,
        description: input.description ?? t.description,
        taskType: input.taskType || t.taskType,
        priority: input.priority,
        deadlineAt: input.deadlineAt || null,
        assignmentDate: input.assignmentDate || t.assignmentDate || null,
        currentOwnerRole: typeChanged ? nextRole : t.currentOwnerRole,
        currentOwnerUserIds: typeChanged ? nextOwners : t.currentOwnerUserIds,
        currentOwnerUserId: typeChanged ? (nextOwners[0] || null) : t.currentOwnerUserId,
        workflowId: typeChanged ? (newWorkflow?.id || t.workflowId) : t.workflowId,
        workflowSnapshot: typeChanged ? (newWorkflow ? cloneWorkflow(newWorkflow) : t.workflowSnapshot) : t.workflowSnapshot,
        updatedAt: now,
      };
      return addAuditComment(updatedTask, currentUser.id, 'assignment_change', `Task edited by ${currentUser.name}: ${summary}.`, now);
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

  const rejectWorkflowPhase = (taskId: string, noteText?: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const workflow = task.workflowSnapshot || getWorkflowBySelection(task.taskType, task.workflowId);
    if (!workflow || workflow.phases.length === 0) return;
    const phase = getWorkflowPhase(task);
    if (!phase) return;
    const now = new Date().toISOString();
    const rejectionTargetId = phase.failToPhaseId || phase.returnToPhaseId || null;
    const revisionKey = rejectionTargetId || phase.id;
    const previousRevisions = (task.workflowPhaseRevisionCounts || {})[revisionKey] || 0;
    const newRevisions = previousRevisions + 1;
    const reachedMax = typeof phase.maxRevisionRounds === 'number' && phase.maxRevisionRounds > 0 && newRevisions > phase.maxRevisionRounds;
    const fallbackStatus: TaskStatus = phase.reviewStyle === 'final_approval' || (phase.roleIds || []).includes('art_director')
      ? 'changes_requested_by_art_director'
      : 'changes_requested_by_reviewer';

    let routedTask: Task;
    if (rejectionTargetId) {
      const targetIndex = getWorkflowPhaseIndex(workflow, rejectionTargetId);
      if (targetIndex >= 0) {
        const targetPhase = workflow.phases[targetIndex];
        const clearedApprovals = { ...(task.workflowPhaseApprovals || {}) };
        delete clearedApprovals[targetPhase.id];
        const returnHistory: WorkflowPhaseHistoryEntry[] = [
          ...(task.workflowPhaseHistory || []),
          {
            phaseId: phase.id,
            phaseName: phase.name,
            action: 'changes_requested',
            actorId: currentUser.id,
            createdAt: now,
            note: noteText || `Returned to ${targetPhase.name} (round ${newRevisions}).`,
          },
        ];
        routedTask = buildTaskWithWorkflowPhase({
          ...task,
          workflowPhaseApprovals: clearedApprovals,
          workflowPhaseRevisionCounts: { ...(task.workflowPhaseRevisionCounts || {}), [revisionKey]: newRevisions },
        }, workflow, targetIndex, clearedApprovals, returnHistory, currentUser.id);
        routedTask = {
          ...routedTask,
          workflowPhaseAvailableAt: computePhaseAvailableAt(now, targetPhase.delayDays, appSettings.businessCalendar),
        };
      } else {
        routedTask = {
          ...task,
          status: fallbackStatus,
          currentOwnerRole: 'team_member',
          currentOwnerUserIds: [task.createdBy, ...task.handledBy],
          updatedAt: now,
        };
      }
    } else {
      routedTask = {
        ...task,
        status: fallbackStatus,
        currentOwnerRole: 'team_member',
        currentOwnerUserIds: [task.createdBy, ...task.handledBy],
        updatedAt: now,
      };
    }

    if (reachedMax) {
      const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
      const artDirectorIds = uniqueIds([
        ...getUserIdsByRole(userList, ['art_director']),
        ...(appSettings.finalReviewerUserIds || []),
      ]);
      addNotifications(
        uniqueIds([...teamLeaderIds, ...artDirectorIds]).filter(userId => userId !== currentUser.id),
        taskId,
        `${currentUser.name} reported "${task.name}" exceeds ${phase.maxRevisionRounds} revision rounds in ${phase.name}.`
      );
    }

    const targetOwnerIds = uniqueIds([
      ...getCurrentOwnerUserIds(routedTask),
      task.createdBy,
      ...task.handledBy,
    ]).filter(userId => userId !== currentUser.id);
    addNotifications(
      targetOwnerIds,
      taskId,
      `${currentUser.name} requested changes on "${task.name}"${rejectionTargetId ? ` and routed it to ${getWorkflowPhase(routedTask)?.name || 'the selected workflow phase'}` : ''}.`
    );

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => (
      t.id !== taskId ? t : addAuditComment({
        ...routedTask,
        updatedAt: now,
      }, currentUser.id, 'request_edits', noteText || `Phase rejected${rejectionTargetId ? ` and routed to ${workflow.phases[getWorkflowPhaseIndex(workflow, rejectionTargetId)]?.name || 'previous phase'}` : ''}.`, now)
    )));
  };

  const skipWorkflowPhase = (taskId: string) => {
    if (!isLeaderboardUser(currentUser.id)) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const workflow = task.workflowSnapshot || getWorkflowBySelection(task.taskType, task.workflowId);
    if (!workflow || workflow.phases.length === 0) return;
    const phase = getWorkflowPhase(task);
    if (!phase) return;
    const phaseIndex = getWorkflowPhaseIndex(workflow, phase.id);
    if (phaseIndex < 0) return;
    const now = new Date().toISOString();
    const nextIndex = getNextPhaseIndex(workflow, phaseIndex, task);
    const historyEntry: WorkflowPhaseHistoryEntry = {
      phaseId: phase.id,
      phaseName: phase.name,
      action: 'skipped',
      actorId: currentUser.id,
      createdAt: now,
      note: 'Skipped manually by leaderboard.',
    };
    const mergedHistory: WorkflowPhaseHistoryEntry[] = [...(task.workflowPhaseHistory || []), historyEntry];
    if (nextIndex < workflow.phases.length) {
      const targetPhase = workflow.phases[nextIndex];
      const nextTask = buildTaskWithWorkflowPhase(task, workflow, nextIndex, task.workflowPhaseApprovals || {}, mergedHistory, currentUser.id);
      const availableAt = computePhaseAvailableAt(now, targetPhase.delayDays, appSettings.businessCalendar);
      queueTaskBroadcast(taskId);
      setTasks(prev => prev.map(t => (
        t.id !== taskId ? t : {
          ...nextTask,
          workflowPhaseAvailableAt: availableAt,
          updatedAt: now,
        }
      )));
    } else {
      queueTaskBroadcast(taskId);
      setTasks(prev => prev.map(t => (
        t.id !== taskId ? t : addAuditComment({
          ...t,
          status: 'approved_by_art_director',
          currentOwnerRole: null,
          currentOwnerUserId: null,
          currentOwnerUserIds: [],
          workflowPhaseHistory: mergedHistory,
          updatedAt: now,
        }, currentUser.id, 'manual_approval', 'Phase skipped by leaderboard.', now)
      )));
    }
  };

  const manuallyApproveTask = (taskId: string, note?: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || ['approved_by_art_director', 'completed', 'archived'].includes(task.status) || isTaskArchived(task)) return;

    const recipients = uniqueIds([
      task.createdBy,
      ...task.handledBy,
      ...(task.currentOwnerUserIds || []),
      ...(task.contentRevisionAssigneeIds || []),
      ...getUserIdsByRole(userList, ['team_leader']),
      ...getUserIdsByRole(userList, ['reviewer', 'admin']),
      ...getUserIdsByRole(userList, ['art_director']),
    ]).filter(userId => userId !== currentUser.id);
    addNotifications(recipients, taskId, `${currentUser.name} marked "${task.name}" as approved.`);

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const now = new Date().toISOString();
      return addAuditComment({
        ...t,
        status: 'approved_by_art_director',
        currentOwnerRole: null,
        currentOwnerUserId: null,
        currentOwnerUserIds: [],
        workflowCurrentPhaseId: null,
        workflowCurrentPhaseIndex: null,
        updatedAt: now,
      }, currentUser.id, 'manual_approval', note?.trim() || 'Marked approved manually. Approval happened outside the tool.', now);
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

    const handledBy = input.isTemporarySelfTask
      ? uniqueIds(input.handledByIds.filter(Boolean))
      : sanitizeHandledByWithSettings(appSettings, input.handledByIds, currentUser.id);
    if (!input.name.trim() || handledBy.length === 0) return;

    const now = new Date().toISOString();
    const taskId = Math.random().toString(36).substring(7);
    const normalizedLinks = input.assignmentLinks.map(link => link.trim()).filter(Boolean);
    const deadlineText = formatDeadlineText(input.deadlineAt);
    const assignmentPeriod = getAssignmentPeriodFromDeadline(input.deadlineAt);
    const workflow = getWorkflowBySelection(input.taskType || 'others', null);
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
      assignmentDate: input.assignmentDate || null,
      workflowNodeAssigneeIds: input.workflowNodeAssigneeIds || {},
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
      isTemporarySelfTask: input.isTemporarySelfTask || false,
      selfAssignedBy: currentUser.id,
      submittedOnBehalfOfIds: input.submittedOnBehalfOfIds || [],
      createdAt: now,
      updatedAt: now,
      workflowId: workflow?.id || null,
      workflowSnapshot: null,
      workflowCurrentPhaseId: null,
      workflowCurrentPhaseIndex: null,
      workflowPhaseApprovals: {},
      workflowPhaseHistory: [],
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

    const today = new Date();
    const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (input.assignmentDate && input.assignmentDate < todayValue) {
      console.warn('Assignment date cannot be in the past.');
      return;
    }

    const handledBy = input.isTemporarySelfTask
      ? uniqueIds(input.handledByIds.filter(Boolean))
      : sanitizeHandledByWithSettings(appSettings, input.handledByIds, currentUser.id);
    if (!input.name.trim() || handledBy.length === 0) return;

    const previousAssignees = new Set(task.handledBy);
    const addedAssignees = handledBy.filter(userId => !previousAssignees.has(userId));
    const removedAssignees = task.handledBy.filter(userId => !handledBy.includes(userId));
    if (addedAssignees.length > 0) {
      addNotifications(addedAssignees.filter(userId => userId !== currentUser.id), taskId, `${currentUser.name} edited "${input.name.trim()}". You are now assigned to work on it.`);
    }
    if (removedAssignees.length > 0) {
      addNotifications(removedAssignees.filter(userId => userId !== currentUser.id), taskId, `${currentUser.name} edited "${input.name.trim()}". You are no longer assigned to this task and it is not in your workflow right now.`);
    }

    const normalizedLinks = input.assignmentLinks.map(link => link.trim()).filter(Boolean);
    const assignmentPeriod = getAssignmentPeriodFromDeadline(input.deadlineAt);
    const diffs = buildTaskEditDiff(task, {
      name: input.name.trim(),
      description: input.description.trim() || null,
      taskType: input.taskType,
      priority: input.priority,
      assignmentDate: input.assignmentDate,
      deadlineAt: input.deadlineAt,
      handledBy,
    });
    const summary = diffs.length > 0 ? diffs.join('; ') : 'no changes';
    const message = `Assigned work updated for ${handledBy.map(userId => getUserDisplayName(usersObj, userId)).join(', ')}. (${summary})`;
    const workflow = getWorkflowBySelection(input.taskType || task.taskType || 'others', null);

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
      const typeChanged = (input.taskType as TaskType) && input.taskType !== t.taskType;
      const newWorkflow = typeChanged ? workflow : (t.workflowSnapshot || null);
      const newPhase = newWorkflow ? (newWorkflow.phases[0] || null) : null;
      const recomputedOwners = isAlreadyUploaded && typeChanged && newPhase
        ? resolveWorkflowPhaseReviewerIds(newPhase, appSettings, userList, { ...t, taskType: (input.taskType as TaskType) || t.taskType, workflowSnapshot: cloneWorkflow(newWorkflow) })
        : null;
      const recomputedRole = isAlreadyUploaded && typeChanged && newPhase ? getPhaseOwnerRole(newPhase) : null;
      return addAuditComment({
        ...t,
        name: input.name.trim(),
        description: input.description.trim() || null,
        taskType: (input.taskType as TaskType) || t.taskType,
        workflowId: workflow?.id || null,
        workflowSnapshot: t.workflowSnapshot && workflow?.id === t.workflowSnapshot.id ? t.workflowSnapshot : (typeChanged && workflow ? cloneWorkflow(workflow) : t.workflowSnapshot),
        workflowCurrentPhaseId: typeChanged ? null : (t.workflowSnapshot && workflow?.id === t.workflowSnapshot.id ? t.workflowCurrentPhaseId : null),
        workflowCurrentPhaseIndex: typeChanged ? null : (t.workflowSnapshot && workflow?.id === t.workflowSnapshot.id ? t.workflowCurrentPhaseIndex : null),
        workflowPhaseApprovals: typeChanged ? {} : (t.workflowSnapshot && workflow?.id === t.workflowSnapshot.id ? t.workflowPhaseApprovals : {}),
        reviewMode: getEffectiveReviewMode((input.taskType as TaskType) || t.taskType, isContentCreatorTask, t.reviewMode),
        handledBy,
        currentOwnerRole: recomputedRole || (isAlreadyUploaded ? t.currentOwnerRole : 'team_member'),
        currentOwnerUserId: recomputedOwners ? (recomputedOwners[0] || null) : (isAlreadyUploaded ? t.currentOwnerUserId : (handledBy[0] || null)),
        currentOwnerUserIds: recomputedOwners || (isAlreadyUploaded ? t.currentOwnerUserIds : handledBy),
        priority: input.priority,
        deadlineText: formatDeadlineText(input.deadlineAt),
        assignmentPeriod,
        assignmentLinks: normalizedLinks,
        assignmentDate: input.assignmentDate || null,
        workflowNodeAssigneeIds: input.workflowNodeAssigneeIds || {},
        deadlineAt: input.deadlineAt || null,
        isOvertime: input.isOvertime || false,
        needsContentRevision: input.needsContentRevision || false,
        contentRevisionAssigneeIds: input.needsContentRevision ? (input.contentRevisionAssigneeIds || []) : [],
        isTemporarySelfTask: input.isTemporarySelfTask || false,
        selfAssignedBy: t.selfAssignedBy || (t.createdBy === currentUser.id ? currentUser.id : null),
        submittedOnBehalfOfIds: input.submittedOnBehalfOfIds || t.submittedOnBehalfOfIds || [],
        updatedAt: now,
      }, currentUser.id, 'work_assignment_updated', message, now);
    }));
  };

  const deleteWorkAssignment = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !canDeleteWorkAssignment(task, currentUser)) return;

    setTasks(prev => prev.filter(t => t.id !== taskId));
    setNotifications(prev => prev.filter(notification => notification.taskId !== taskId));
    if (isDriveWorkspaceReady) {
      deleteDriveTask(taskId).catch(error => console.error('Failed to delete assigned task from Drive', error));
    }
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
      auditMsg = `New version resubmitted for ${nextOwnerRole === 'art_director' ? 'Art Director' : 'First Review'}.`;
    }

    const uploaderName = getUserDisplayName(usersObj, version.submittedBy);
    const reviewerIds = getUserIdsByRole(userList, ['reviewer', 'admin']);
    const artDirectorIds = getUserIdsByRole(userList, ['art_director']);
    const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
    const recipients = (isContentRevNeeded
      ? [...nextOwnerIds, ...teamLeaderIds]
      : sendToMarwa
        ? [...nextOwnerIds, ...artDirectorIds, ...teamLeaderIds, ...reviewerIds]
        : [...nextOwnerIds, ...reviewerIds, ...teamLeaderIds]
    ).filter(userId => userId !== version.submittedBy);

    addNotifications(recipients, taskId, `${uploaderName} uploaded V${version.versionNumber} for "${task.name}".`);

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

  const addTaskComment = (taskId: string, comment: Omit<TaskComment, 'id' | 'createdAt'>, options?: { skipNotificationUserIds?: string[] }) => {
    const task = tasks.find(item => item.id === taskId);
    if (task) {
      const author = usersObj[currentUser.id] || currentUser;
      const reviewerLikeRoles: Role[] = ['reviewer', 'art_director', 'team_leader', 'manager', 'admin'];
      const isReviewerComment = reviewerLikeRoles.includes(author.role) || isLeaderboardUser(author.id);
      const hasCommentContent = Boolean(
        comment.message?.trim() ||
        (comment.sections || []).some(section => section.note?.trim() || section.imageUrl)
      );

      if (isReviewerComment && hasCommentContent) {
        const teamLeaderIds = getUserIdsByRole(userList, ['team_leader']);
        const reviewerIds = uniqueIds([
          ...getUserIdsByRole(userList, ['reviewer', 'admin']),
          ...(appSettings.firstReviewerUserIds || []),
        ]);
        const artDirectorIds = uniqueIds([
          ...getUserIdsByRole(userList, ['art_director']),
          ...(appSettings.finalReviewerUserIds || []),
        ]);
        const seniorIds = Array.isArray(appSettings.seniorReviewerUserIds) ? appSettings.seniorReviewerUserIds : [];
        const recipients = uniqueIds([
          task.createdBy,
          ...task.handledBy,
          ...(task.contentRevisionAssigneeIds || []),
          ...seniorIds,
          ...teamLeaderIds,
          ...reviewerIds,
          ...artDirectorIds,
        ]).filter(userId => userId && userId !== currentUser.id);
        const dedupedRecipients = recipients.filter(userId => !(options?.skipNotificationUserIds || []).includes(userId));
        addNotifications(dedupedRecipients, taskId, `${currentUser.name} put a comment on "${task.name}".`);
      }
    }

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
      dailyReports,
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
      updateTaskBasicDetails,
      updateTaskAssignment,
      updateTaskReviewMode,
      updateTaskActiveWork,
      applyTaskWorkflow,
      approveWorkflowPhase,
      rejectWorkflowPhase,
      skipWorkflowPhase,
      manuallyApproveTask,
      updateTaskPublishSchedule,
      markCampaignPublished,
      markPublishReminderSent,
      markWeekReminderSent,
      submitScheduledCampaign,
      editScheduledCampaign,
      createWorkAssignment,
      updateWorkAssignment,
      deleteWorkAssignment,
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
      upsertDailyReport,
      upsertDailyReportEntry,
      sendDailyReport,
      setTaskActiveWorkByLeader,
      loginWithPassword,
      signupWithEmail,
      updateUserRole,
      updateUserResponsibility,
      createManualUser,
      updateUserProfile,
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
