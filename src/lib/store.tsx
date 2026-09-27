import { planDailyReports } from './dailyReportScheduler';
import { buildActualWorkEntries, cairoTime, mergeWorkReportEntries } from './dailyReportWork';
import { getCompletedPhaseIdsFromHistory } from './workflowRuntime';
import { getReassignmentNotifications, getHandoffNotifications, mergeHandoffNotifications } from './reassignmentNotifications';
import { canReassignWorkflowTask } from './workAssignmentUtils';
import { canStartTaskWork, getTaskWorkSessions, hasStartedPhase, reconcileWorkSessions } from './workSessions';
import { canManageWorkflowOmissions, reconcileWorkflowOmissions, validateWorkflowOmissionSelection } from './workflowOmissions';
import { canViewDailyReport, canEditDailyReport, isReportExempt, getDailyReportReceiverIds } from './reportPolicy';
import { isReportNotification, projectReportNotifications } from '../../server/reportAccess';
import { planDeadlineReminders, projectDeadlineNotifications } from './deadlinePolicy';
import { canViewTask, canEditTask, canDeleteTask, projectTaskNotifications } from './taskPolicy';
import { applyMemberDeletions, isMemberDeleted, mergeMemberDeletions, visibleMemberRoster } from './memberIdentity';
import { canRemoveMember, prepareMemberDeletion } from './memberDeletion';
import { applyContentReviewChoice, normalizeReviewMode } from './reviewPolicy';
import { prepareWorkflowAssignmentOwners, resolveWorkflowAssignment, type WorkflowAssignmentResult } from './workflowAssignment';
import { isVoiceOverPhase, getVoiceOverProvider, getVoiceOverDeliveryOwnerId, hasVoiceOverProviderSelection, validateVoiceOverTaskChanges } from './voiceOverPolicy';
import { resolveFixedArtDirector, resolveTaskFinalArtDirector } from './finalApprovalPolicy';
import type { MemberDeletionResult } from './types';
import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { AccountProfile, AppSettings, AuthStatus, User, Role, Environment, Task, TaskStatus, Priority, TaskType, Notification, TaskComment, TaskVersion, UploadedTaskFile, ReviewMode, WorkflowDefinition, WorkflowPhaseHistoryEntry, DailyReport, DailyReportEditVersion, DailyReportEntry } from './types';
import { initialUsers, initialTasks, userRoleLabels } from './mockData';
import { supabase } from './supabaseClient';
import { clearAppState, filterLocallyResetNotifications, loadAppState, saveAppState, type PersistedAppState } from './localDb';
import { fetchNeonAppSettings, fetchNeonAppStateMeta, fetchNeonAppStateResponse, saveNeonAppState, NeonAppStateError, setNeonAccessToken, loginNeonWorkspace, fetchNeonSession, logoutNeonWorkspace, USE_NEON_DATA } from './neonDb';
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
  canUserActAsCurrentOwner,
  canSkipWorkflowPhase,
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
  isMandatoryFinalReview,
  resolveWorkflowPhaseReviewerIds,
  resolveWorkflowPhaseOwnerIds,
  uniqueIds,
} from './workflowUtils';
import { canCreateWorkAssignment, canDeleteWorkAssignment, canManageWorkAssignment, canSetActiveWorkForMember, getAssignmentPeriodFromDeadline, isLeaderboardUser } from './workAssignmentUtils';
import {
  appendStartedEntries,
  computeWorkflowAdvance,
  computeWorkflowInitialization,
  computeWorkflowReturn,
  getPhaseAssignableOwnerIds,
  splitHandoffsByDelay,
} from './workflowRuntime';
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
  workflowNodeAIAssigneeIds?: Record<string, string>;
  workflowNodeVoiceOverDeliveryOwnerIds?: Record<string, string>;
  workContributorIds?: string[];
  workflowSkippedPhaseIds?: string[];
  isOvertime?: boolean;
  taskType?: string;
  needsContentRevision?: boolean;
  contentRevisionAssigneeIds?: string[];
  isTemporarySelfTask?: boolean;
  submittedOnBehalfOfIds?: string[];
};

type WorkAssignmentUploadPayload = {
  phaseId?: string;
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
function reportFreeFallback(state: PersistedAppState): PersistedAppState {
  return { ...state, tasks: [], dailyReports: [], notifications: [] };
}

async function loadNeonFallbackState() {
  const state = await loadAppState();
  if (!state) return null;
  const safeState = reportFreeFallback(state);
  if (state.tasks.length || state.dailyReports?.length || state.notifications.length) {
    await saveAppState(safeState, { expectedState: state });
  }
  return safeState;
}
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

function sanitizeWorkflowSkippedPhaseIds(workflow: WorkflowDefinition | null | undefined, phaseIds?: string[]) {
  if (!workflow || !Array.isArray(phaseIds)) return [];
  const phasesById = new Map(workflow.phases.map(phase => [phase.id, phase]));
  return uniqueIds(phaseIds).filter(phaseId => canSkipWorkflowPhase(phasesById.get(phaseId)));
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
  const isNeonQuotaError =
    normalizedMessage.includes('data transfer quota') ||
    normalizedMessage.includes('transfer limit') ||
    normalizedMessage.includes('transfer quota') ||
    normalizedMessage.includes('quota exceeded') ||
    normalizedMessage.includes('http status 402');

  if (isNeonQuotaError) {
    return 'Shared database transfer limit has been reached. Shared data is paused until the Neon quota is restored.';
  }

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
    deletedMembers: mergeMemberDeletions(currentSettings?.deletedMembers, incomingSettings?.deletedMembers),
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
    !task.workflowSnapshot &&
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
    reviewMode: 'final_review',
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
  const currentOwnerUserIds = currentOwnerRole === 'team_member' && !task.workflowSnapshot
    ? sanitizeHandledBy(rawCurrentOwnerUserIds)
    : rawCurrentOwnerUserIds;

  return {
    id: task.id,
    code: task.code || `TSK-${task.id}`,
    name: task.name || 'Untitled task',
    description: task.description ?? null,
    taskType: task.taskType || 'others',
    reviewMode: normalizeReviewMode(task.reviewMode),
    workflowId: task.workflowId ?? null,
    workflowSnapshot: task.workflowSnapshot ?? null,
    workflowCurrentPhaseId: task.workflowCurrentPhaseId ?? null,
    workflowCurrentPhaseIndex: typeof task.workflowCurrentPhaseIndex === 'number' ? task.workflowCurrentPhaseIndex : null,
    workflowPhaseApprovals: task.workflowPhaseApprovals && typeof task.workflowPhaseApprovals === 'object' ? task.workflowPhaseApprovals : {},
    workflowPhaseHistory: Array.isArray(task.workflowPhaseHistory) ? task.workflowPhaseHistory : [],
    workflowActivePhaseIds: Array.isArray(task.workflowActivePhaseIds) ? task.workflowActivePhaseIds : (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []),
    workflowSkippedPhaseIds: sanitizeWorkflowSkippedPhaseIds(
      task.workflowSnapshot,
      Array.isArray(task.workflowSkippedPhaseIds) ? task.workflowSkippedPhaseIds : [],
    ),
    environment: task.environment || 'production',
    createdBy: task.createdBy || initialUsers[0]?.id || 'unknown_user',
    handledBy: sanitizeHandledBy(Array.isArray(task.handledBy) ? task.handledBy : [task.createdBy || initialUsers[0]?.id || 'unknown_user']),
    status: task.status === 'waiting_reviewer_quick_look'
      ? 'waiting_reviewer_full_review'
      : task.status || 'submitted',
    currentOwnerRole,
    currentOwnerUserId: currentOwnerUserIds[0] || null,
    currentOwnerUserIds,
    priority: task.priority || 'not_set',
    deadlineText: task.deadlineText ?? null,
    assignmentPeriod: task.assignmentPeriod ?? null,
    assignmentLinks: Array.isArray(task.assignmentLinks) ? task.assignmentLinks : [],
    assignmentDate: task.assignmentDate ?? null,
    workflowNodeAssigneeIds: task.workflowNodeAssigneeIds && typeof task.workflowNodeAssigneeIds === 'object' ? task.workflowNodeAssigneeIds : {},
    workflowNodeAIAssigneeIds: task.workflowNodeAIAssigneeIds && typeof task.workflowNodeAIAssigneeIds === 'object' ? task.workflowNodeAIAssigneeIds : {},
    workflowNodeVoiceOverDeliveryOwnerIds: task.workflowNodeVoiceOverDeliveryOwnerIds && typeof task.workflowNodeVoiceOverDeliveryOwnerIds === 'object' ? task.workflowNodeVoiceOverDeliveryOwnerIds : {},
    workflowFinalApproverIdsByPhaseId: task.workflowFinalApproverIdsByPhaseId && typeof task.workflowFinalApproverIdsByPhaseId === 'object' ? task.workflowFinalApproverIdsByPhaseId : undefined,
    workContributorIds: Array.isArray(task.workContributorIds) ? task.workContributorIds : undefined,
    deadlineAt: task.deadlineAt ?? null,
    deadlineReminderSentAt: task.deadlineReminderSentAt ?? null,
    deadlineReminderReceipts: task.deadlineReminderReceipts || {},
    assignmentUploadedAt: task.assignmentUploadedAt ?? null,
    scheduledPublishAt: task.scheduledPublishAt ?? null,
    publishNote: task.publishNote ?? null,
    publishedAt: task.publishedAt ?? null,
    publishReminderSentAt: task.publishReminderSentAt ?? null,
    platform: task.platform ?? null,
    weekReminderSentAt: task.weekReminderSentAt ?? null,
    budgetAmount: task.budgetAmount ?? null,
    budgetCurrency: task.budgetCurrency ?? null,
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
    needsContentRevision: typeof task.needsContentRevision === 'boolean' ? task.needsContentRevision : undefined,
    contentRevisionAssigneeIds: Array.isArray(task.contentRevisionAssigneeIds) ? task.contentRevisionAssigneeIds : ((task as any).contentRevisionAssigneeId ? [(task as any).contentRevisionAssigneeId] : []),
    workSessions: task.workSessions || [],
    activeWorkBy: task.activeWorkBy ?? null,
    activeWorkStartedAt: task.activeWorkStartedAt ?? null,
    activeWorkFinishedAt: task.activeWorkFinishedAt ?? null,
    activeWorkNote: task.activeWorkNote ?? null,
    isTemporarySelfTask: task.isTemporarySelfTask ?? null,
    selfAssignedBy: task.selfAssignedBy ?? null,
    submittedOnBehalfOfIds: Array.isArray(task.submittedOnBehalfOfIds) ? task.submittedOnBehalfOfIds : [],
    previousStatusBeforeHold: task.previousStatusBeforeHold ?? null,
    activeWorkSetById: task.activeWorkSetById ?? null,
    activeWorkSetAt: task.activeWorkSetAt ?? null,
    activeWorkFinishedById: task.activeWorkFinishedById ?? null,
    workflowPhaseAvailableAt: task.workflowPhaseAvailableAt ?? null,
    workflowPhaseAvailableAtByPhaseId: task.workflowPhaseAvailableAtByPhaseId,
    workflowPendingHandoffPhaseIds: task.workflowPendingHandoffPhaseIds || (task.workflowPhaseAvailableAt && task.workflowPhaseAvailableAt > now
      ? (task.workflowActivePhaseIds || (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : [])) : []),
    workflowPhaseRevisionCounts: task.workflowPhaseRevisionCounts && typeof task.workflowPhaseRevisionCounts === 'object' ? task.workflowPhaseRevisionCounts : {},
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
    JSON.stringify(task.workflowNodeAIAssigneeIds || {}),
    JSON.stringify(task.workflowNodeVoiceOverDeliveryOwnerIds || {}),
    JSON.stringify(task.workContributorIds || []),
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
    report.note, report.autoSendWarningAt || '', JSON.stringify(report.entries),
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
      taskId: entry.taskId, title: entry.title, taskCode: entry.taskCode, source: entry.source, taskStatus: entry.taskStatus, workState: entry.workState, manuallyEdited: entry.manuallyEdited,
      startTime: entry.startTime ?? null,
      endTime: entry.endTime ?? null,
      durationMinutes: typeof entry.durationMinutes === 'number' ? entry.durationMinutes : null,
      note: entry.note,
    })) : [],
    sentAt: report.sentAt ?? null,
    sentBy: report.sentBy ?? null,
    autoSent: Boolean(report.autoSent), autoSendWarningAt: report.autoSendWarningAt ?? null,
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
  updateWorkflowPhaseAssignees: (taskId: string, phaseId: string, assigneeIds: string[]) => void;
  updateTaskReviewMode: (taskId: string, reviewMode: ReviewMode) => void;
  updateTaskActiveWork: (taskId: string, active: boolean, note?: string) => void;
  applyTaskWorkflow: (taskId: string, workflowId: string) => void;
  approveWorkflowPhase: (taskId: string, note?: string, phaseId?: string) => void;
  rejectWorkflowPhase: (taskId: string, note?: string, phaseId?: string) => void;
  skipWorkflowPhase: (taskId: string, phaseId?: string) => WorkflowAssignmentResult;
  setWorkflowPhaseOmitted: (taskId: string, phaseId: string, omitted: boolean) => WorkflowAssignmentResult;
  manuallyApproveTask: (taskId: string, note?: string) => void;
  updateTaskPublishSchedule: (taskId: string, schedule: { scheduledPublishAt: string | null; publishNote: string | null }) => void;
  markCampaignPublished: (taskId: string) => void;
  markPublishReminderSent: (taskId: string) => void;
  markWeekReminderSent: (taskId: string) => void;
  submitScheduledCampaign: (input: { name: string; taskType: 'campaign' | 'media_buying'; scheduledPublishAt: string; publishNote?: string | null; platform?: string | null; budgetAmount?: number | null; budgetCurrency?: string | null }) => void;
  editScheduledCampaign: (taskId: string, input: { name: string; taskType: 'campaign' | 'media_buying'; scheduledPublishAt: string; publishNote?: string | null; platform?: string | null; budgetAmount?: number | null; budgetCurrency?: string | null }) => void;
  createWorkAssignment: (input: WorkAssignmentInput) => WorkflowAssignmentResult;
  updateWorkAssignment: (taskId: string, input: WorkAssignmentInput) => WorkflowAssignmentResult;
  deleteWorkAssignment: (taskId: string) => void;
  updateTaskContentRevisionAssignees: (taskId: string, assigneeIds: string[]) => void;
  submitWorkAssignmentUpload: (taskId: string, payload: WorkAssignmentUploadPayload) => boolean;
  addTaskComment: (taskId: string, comment: Omit<TaskComment, 'id' | 'createdAt'>) => void;
  updateTaskComment: (taskId: string, commentId: string, changes: Pick<TaskComment, 'message' | 'sections'>) => void;
  deleteTaskComment: (taskId: string, commentId: string) => void;
  addTaskVersion: (taskId: string, version: TaskVersion, phaseId?: string) => boolean;
  replaceTaskVersionFiles: (taskId: string, versionId: string, files: UploadedTaskFile[]) => void;
  updateTaskMediaPreviews: (taskId: string, updates: { versions: TaskVersion[]; comments?: TaskComment[]; thumbnailUrl: string; thumbnailStoragePath?: string }) => void;
  addTask: (task: Task) => boolean;
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
  getEffectiveReviewMode: (taskType: string, isContentCreatorTask: boolean, selectedMode: ReviewMode) => ReviewMode;
  updateAppSettings: (updater: AppSettings | ((settings: AppSettings) => AppSettings)) => Promise<void>;
  deleteUserAccount: (userId: string) => Promise<MemberDeletionResult>;
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
  const codexPreviewModeRef = useRef(
    import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('codexPreview') === '1'
  );
  const sharedDataLoadFailedRef = useRef(false);
  const pendingTaskBroadcastIdsRef = useRef<Set<string>>(new Set());
  const pendingDeletedTaskIdsRef = useRef(new Set<string>());
  const neonSaveInFlightRef = useRef(false);
  const workspaceMutationGenerationRef = useRef(0);
  const [neonSaveTick, setNeonSaveTick] = useState(0);
  const pendingNotificationBroadcastIdsRef = useRef<Set<string>>(new Set());
  const pendingSettingsBroadcastRef = useRef(false);
  const pendingDailyReportBroadcastIdsRef = useRef<Set<string>>(new Set());
  const lastNeonUpdatedAtRef = useRef<string | null>(null);
  const nextNeonRetryAtRef = useRef(0);
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
  const appSettingsRef = useRef(appSettings);
  appSettingsRef.current = appSettings;
  const profileUsersRef = useRef(profileUserList);
  profileUsersRef.current = profileUserList;
  const userList = React.useMemo(() => visibleMemberRoster(profileUserList, manualUserList, appSettings.deletedMembers || []), [profileUserList, manualUserList, appSettings.deletedMembers]);
  const usersObj = userList.reduce((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {} as Record<string, User>);

  const [currentUserState, setCurrentUserState] = useState<User>(GUEST_USER);
  const [environment, setEnvironment] = useState<Environment>('production');
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const workflowTasksRef = useRef(tasks);
  workflowTasksRef.current = tasks;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dailyReports, setDailyReports] = useState<DailyReport[]>([]);
  const reportIdentityRef = useRef<string | null>(null);
  const [isPersistedStateReady, setIsPersistedStateReady] = useState(false);
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
  const canMutateTask = (taskId: string) => {
    const task = tasks.find(task => task.id === taskId);
    return Boolean(task && canEditTask(task, currentUser, appSettings, userList));
  };
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
    workspaceMutationGenerationRef.current++;
    pendingTaskBroadcastIdsRef.current.add(taskId);
  };

  const queueNotificationBroadcast = (notificationId: string) => {
    workspaceMutationGenerationRef.current++;
    pendingNotificationBroadcastIdsRef.current.add(notificationId);
  };

  const queueSettingsBroadcast = () => {
    workspaceMutationGenerationRef.current++;
    pendingSettingsBroadcastRef.current = true;
  };

  const queueDailyReportBroadcast = (reportId: string) => {
    workspaceMutationGenerationRef.current++;
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

  const refreshMembershipSettings = async (): Promise<AppSettings> => {
    let settings: AppSettings;
    if (USE_NEON_DATA) {
      const shared = await fetchNeonAppSettings();
      settings = mergeAppSettingsPreservingWorkflowDeletions(shared, appSettingsRef.current);
    } else {
      const local = await loadAppState();
      const { data, error } = await supabase.from('app_settings').select('settings').eq('id', 'current').maybeSingle();
      if (error && !local?.settings) throw new Error(error.message);
      settings = mergeAppSettingsPreservingWorkflowDeletions(local?.settings || data?.settings, appSettingsRef.current);
      if (data?.settings?.deletedMembers) settings = mergeAppSettingsPreservingWorkflowDeletions(settings, mergeAppSettings(data.settings));
    }
    appSettingsRef.current = settings;
    setAppSettings(previous => mergeAppSettingsPreservingWorkflowDeletions(settings, previous));
    return settings;
  };

  const fetchSettings = async () => {
    try { await refreshMembershipSettings(); }
    catch (error) { setAuthError(getErrorMessage(error, 'Could not verify current workspace membership. Please retry.')); }
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
      if (USE_NEON_DATA) setNeonAccessToken(session?.access_token || null);

      if (session?.user) {
        try {
          if (USE_NEON_DATA) {
            const verifiedUser = await fetchNeonSession();
            if (!isMounted) return;
            if (!verifiedUser) throw new Error('This account has no active workspace membership.');
            setCurrentUserState(verifiedUser); setAuthStatus('approved');
            await refreshMembershipSettings();
            return;
          }
          const membership = await refreshMembershipSettings();
          if (!isMounted) return;
          if (isMemberDeleted({ id: session.user.id, email: session.user.email }, membership.deletedMembers)) {
            setCurrentUserState(GUEST_USER); setAuthProfile(null); setAuthStatus('signed_out');
            setAuthError('Your membership in this workspace has been removed.');
            return;
          }
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
            setCurrentUserState(GUEST_USER);
            setAuthProfile(null);
            setAuthStatus('signed_out');
            setAuthError(error?.message || 'This account has no active workspace profile. Ask an admin to restore membership.');
          }
        } catch (err) {
          console.error('Error loading session profile:', err);
          setCurrentUserState(GUEST_USER);
          setAuthProfile(null);
          setAuthError(getErrorMessage(err, 'Could not verify current workspace membership.'));
          setAuthStatus('signed_out');
        }
      } else {
        if (USE_NEON_DATA) {
          try {
            const verifiedUser = await fetchNeonSession();
            if (!isMounted) return;
            if (verifiedUser) { setCurrentUserState(verifiedUser); setAuthStatus('approved'); await refreshMembershipSettings(); return; }
          } catch { /* No valid workspace cookie: show sign-in. */ }
        }
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
    if (reportIdentityRef.current === currentUser.id) return;
    reportIdentityRef.current = currentUser.id;
    workspaceMutationGenerationRef.current++;
    hasLoadedPersistedState.current = false;
    setIsPersistedStateReady(false);
    pendingDailyReportBroadcastIdsRef.current.clear();
    setDailyReports([]);
    setTasks([]);
    setNotifications([]);
    pendingTaskBroadcastIdsRef.current.clear();
    pendingNotificationBroadcastIdsRef.current.clear();
    pendingDeletedTaskIdsRef.current.clear();
    pendingSettingsBroadcastRef.current = false;
  }, [currentUser.id]);

  useEffect(() => {
    if (codexPreviewModeRef.current || currentUser.id === 'guest' || !isMemberDeleted(currentUser, appSettings.deletedMembers)) return;
    setCurrentUserState(GUEST_USER);
    setAuthProfile(null);
    setAuthStatus('signed_out');
    setAuthError('Your membership in this workspace has been removed.');
    void supabase.auth.signOut();
  }, [appSettings.deletedMembers, currentUser.id]);

  useEffect(() => {
    if (USE_NEON_DATA || !isLocalWorkspaceActive) return;
    const sync = () => { void loadAppState().then(state => {
      if (state?.settings) setAppSettings(previous => mergeAppSettingsPreservingWorkflowDeletions(previous, state.settings));
    }).catch(error => setPersistenceError(getErrorMessage(error, 'Could not refresh local membership.'))); };
    const timer = window.setInterval(sync, SHARED_DATA_POLL_INTERVAL_MS);
    window.addEventListener('focus', sync);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', sync); };
  }, [isLocalWorkspaceActive, currentUser.id]);

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
    setIsPersistedStateReady(false);

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
        if (isMounted) {
          hasLoadedPersistedState.current = true;
          setIsPersistedStateReady(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isLocalWorkspaceActive, currentUser.id]);

  useEffect(() => {
    if (authStatus !== 'approved' || !isPersistedStateReady || codexPreviewModeRef.current) return;

    const autoArchiveTasks = tasks.filter(task => shouldAutoArchiveTask(task) && canEditTask(task, currentUser, appSettings, userList));
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
  }, [tasks, authStatus, isPersistedStateReady]);

  useEffect(() => {
    if (authStatus !== 'approved' || !isPersistedStateReady || tasks.length === 0) return;

    const candidates = tasks.filter(task => canEditTask(task, currentUser, appSettings, userList)).flatMap(task => (
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
  }, [tasks, authStatus, isPersistedStateReady]);

  useEffect(() => {
    if (!isNeonWorkspaceActive) return;

    let isMounted = true;
    sharedDataLoadFailedRef.current = false;
    hasLoadedPersistedState.current = false;
    setIsPersistedStateReady(false);

    Promise.all([fetchNeonAppStateResponse(), loadNeonFallbackState()])
      .then(([neonResponse, localState]) => {
        if (!isMounted) return;

        const neonState = neonResponse.state;
        lastNeonUpdatedAtRef.current = neonResponse.updatedAt;
        const sharedTasks = reviveWorkspaceTasks(
          Array.isArray(neonState?.tasks) ? neonState.tasks : [],
          usersObj
        );
        const sharedNotifications = removeGuestSeedNotifications(neonState?.notifications || []);
        const sharedSettings = mergeAppSettingsPreservingWorkflowDeletions(neonState?.settings || localState?.settings, appSettings);
        const localTasks = Array.isArray(localState?.tasks) ? localState.tasks.filter(task => !isGuestSeedTask(task) && !isPlaceholderTask(task)) : [];
        const localNotifications = Array.isArray(localState?.notifications) ? removeGuestSeedNotifications(localState.notifications) : [];
        const sharedReports = Array.isArray(neonState?.dailyReports) ? neonState.dailyReports.map(coerceDailyReport).filter(Boolean) as DailyReport[] : [];
        const combinedReports = sharedReports;

        sharedDataLoadFailedRef.current = false;
        nextNeonRetryAtRef.current = 0;
        setAppSettings(sharedSettings);
        setTasks(sharedTasks);
        setNotifications(sharedNotifications);
        setDailyReports(combinedReports);
        setLocalMigrationState(localTasks.length || localNotifications.length
          ? { tasks: localTasks, notifications: localNotifications }
          : null);
        setPersistenceError(null);
      })
      .catch(async error => {
        console.error('Failed to load Neon app state', error);
        if (!isMounted) return;

        sharedDataLoadFailedRef.current = true;
        nextNeonRetryAtRef.current = Date.now() + 5 * 60 * 1000;
        const localState = await loadNeonFallbackState().catch(localError => {
          console.error('Failed to load local fallback app state after Neon error', localError);
          return null;
        });
        if (!isMounted) return;

        const localTasks: Task[] = [];
        const localNotifications = Array.isArray(localState?.notifications)
          ? removeGuestSeedNotifications(localState.notifications)
          : [];
        const combinedReports: DailyReport[] = [];

        setAppSettings(prev => mergeAppSettingsPreservingWorkflowDeletions(localState?.settings, prev));
        setTasks(reviveWorkspaceTasks(localTasks, usersObj));
        setNotifications(localNotifications);
        setDailyReports(combinedReports);
        setLocalMigrationState(null);
        setPersistenceError(getSharedDataErrorMessage(error, 'Failed to load Neon app state.'));
      })
      .finally(() => {
        if (isMounted) {
          hasLoadedPersistedState.current = true;
          setIsPersistedStateReady(true);
        }
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
      setIsPersistedStateReady(true);
      setTasks(initialTasks);
      setNotifications([]);
      setLocalMigrationState(null);
      setPersistenceError(null);
      return;
    }

    let isMounted = true;
    sharedDataLoadFailedRef.current = false;
    hasLoadedPersistedState.current = false;
    setIsPersistedStateReady(false);

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
        if (isMounted) {
          hasLoadedPersistedState.current = true;
          setIsPersistedStateReady(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isDriveWorkspaceActive, isDriveWorkspaceReady, currentUser.id, driveRootFolder?.id]);

  useEffect(() => {
    if (!isNeonWorkspaceActive || !isPersistedStateReady || sharedDataLoadFailedRef.current) return;
    if (neonSaveInFlightRef.current) return;

    const pendingTaskIds = Array.from<string>(pendingTaskBroadcastIdsRef.current);
    const deletedTaskIds = Array.from<string>(pendingDeletedTaskIdsRef.current);
    const pendingNotificationIds = Array.from(pendingNotificationBroadcastIdsRef.current);
    const pendingDailyReportIds = Array.from(pendingDailyReportBroadcastIdsRef.current);
    const hasPendingSettings = pendingSettingsBroadcastRef.current;
    if (pendingTaskIds.length === 0 && pendingNotificationIds.length === 0 && pendingDailyReportIds.length === 0 && !hasPendingSettings) return;

    pendingTaskBroadcastIdsRef.current.clear();
    pendingDeletedTaskIdsRef.current.clear();
    pendingNotificationBroadcastIdsRef.current.clear();
    pendingDailyReportBroadcastIdsRef.current.clear();
    pendingSettingsBroadcastRef.current = false;

    neonSaveInFlightRef.current = true;
    const savingUserId = currentUser.id;
    saveNeonAppState({ tasks, notifications, settings: appSettings, dailyReports }, { changedTaskIds: pendingTaskIds, deletedTaskIds })
      .then(result => {
        if (reportIdentityRef.current !== savingUserId) return;
        if (result.tasks) setTasks(previous => mergeTasksIntoState(reviveWorkspaceTasks(result.tasks!, usersObj), previous.filter(task => pendingTaskBroadcastIdsRef.current.has(task.id))));
        if (result.notifications) setNotifications(previous => mergeNotificationsIntoState(result.notifications!, previous.filter(notice => pendingNotificationBroadcastIdsRef.current.has(notice.id))));
        if (result.settings) setAppSettings(previous => mergeAppSettingsPreservingWorkflowDeletions(result.settings, previous));
        lastNeonUpdatedAtRef.current = result.updatedAt || lastNeonUpdatedAtRef.current;
        nextNeonRetryAtRef.current = 0;
        setPersistenceError(null);
      })
      .catch(error => {
        if (reportIdentityRef.current !== savingUserId) return;
        console.error('Failed to save Neon app state', error);
        pendingTaskIds.forEach(taskId => pendingTaskBroadcastIdsRef.current.add(taskId));
        deletedTaskIds.forEach(taskId => pendingDeletedTaskIdsRef.current.add(taskId));
        pendingNotificationIds.forEach(notificationId => pendingNotificationBroadcastIdsRef.current.add(notificationId));
        pendingDailyReportIds.forEach(reportId => pendingDailyReportBroadcastIdsRef.current.add(reportId));
        if (hasPendingSettings) pendingSettingsBroadcastRef.current = true;
        sharedDataLoadFailedRef.current = true;
        nextNeonRetryAtRef.current = Date.now() + 5 * 60 * 1000;
        void saveAppState(reportFreeFallback({ tasks, notifications, settings: appSettings, dailyReports }))
          .catch(localError => console.error('Failed to save local fallback app state after Neon error', localError));
        setPersistenceError(getSharedDataErrorMessage(error, 'Failed to save Neon app state.'));
      }).finally(() => { neonSaveInFlightRef.current = false; setNeonSaveTick(value => value + 1); });
  }, [tasks, notifications, appSettings, dailyReports, isNeonWorkspaceActive, isPersistedStateReady, neonSaveTick]);

  useEffect(() => {
    if (!isNeonWorkspaceActive || !isPersistedStateReady || !sharedDataLoadFailedRef.current) return;

    saveAppState(reportFreeFallback({ tasks, notifications, settings: appSettings, dailyReports }))
      .catch(error => {
        console.error('Failed to save local fallback app state while Neon is paused', error);
        setPersistenceError(getErrorMessage(error, 'Failed to save local fallback app state.'));
      });
  }, [tasks, notifications, appSettings, dailyReports, isNeonWorkspaceActive, isPersistedStateReady]);

  useEffect(() => {
    if (!isDriveWorkspaceReady || !isPersistedStateReady || sharedDataLoadFailedRef.current) return;

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
  }, [tasks, notifications, appSettings, isDriveWorkspaceReady, isPersistedStateReady]);

  useEffect(() => {
    if (!isLocalWorkspaceActive || !isPersistedStateReady || !hasLoadedPersistedState.current) return;

    saveAppState({ tasks, notifications, settings: appSettings, dailyReports })
      .then(() => {
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to save local demo workspace', error);
        setPersistenceError(getErrorMessage(error, 'Failed to save local demo workspace.'));
      });
  }, [tasks, notifications, appSettings, dailyReports, isLocalWorkspaceActive, isPersistedStateReady]);

  useEffect(() => {
    if (!isNeonWorkspaceActive) return;

    let isMounted = true;
    let isPolling = false;

    const syncLatestSharedData = async () => {
      if (!hasLoadedPersistedState.current || isPolling || neonSaveInFlightRef.current) return;
      const hasPending = pendingTaskBroadcastIdsRef.current.size || pendingDailyReportBroadcastIdsRef.current.size || pendingNotificationBroadcastIdsRef.current.size || pendingDeletedTaskIdsRef.current.size || pendingSettingsBroadcastRef.current;
      if (hasPending && !sharedDataLoadFailedRef.current) return;
      if (sharedDataLoadFailedRef.current && Date.now() < nextNeonRetryAtRef.current) return;

      isPolling = true;
      const mutationGeneration = workspaceMutationGenerationRef.current;
      try {
        // Available phases can change with time while the database revision is
        // unchanged. Refresh the projection every poll, not just after writes.
        const latestResponse = await fetchNeonAppStateResponse();
        const latestState = latestResponse.state;
        if (!isMounted || !latestState || neonSaveInFlightRef.current || workspaceMutationGenerationRef.current !== mutationGeneration) return;

        lastNeonUpdatedAtRef.current = latestResponse.updatedAt || lastNeonUpdatedAtRef.current;
        sharedDataLoadFailedRef.current = false;
        nextNeonRetryAtRef.current = 0;
        setTasks(previous => mergeTasksIntoState(reviveWorkspaceTasks(latestState.tasks || [], usersObj), previous.filter(task => pendingTaskBroadcastIdsRef.current.has(task.id)))
          .filter(task => !pendingDeletedTaskIdsRef.current.has(task.id)));
        setNotifications(previous => mergeNotificationsIntoState(removeGuestSeedNotifications(latestState.notifications || []), previous.filter(notice => pendingNotificationBroadcastIdsRef.current.has(notice.id))));
        if (Array.isArray(latestState.dailyReports)) {
          setDailyReports(previous => mergeDailyReportsIntoState(latestState.dailyReports!.map(coerceDailyReport).filter(Boolean) as DailyReport[], previous.filter(report => pendingDailyReportBroadcastIdsRef.current.has(report.id))));
        }
        if (latestState.settings && !pendingSettingsBroadcastRef.current) {
          setAppSettings(prev => mergeAppSettingsPreservingWorkflowDeletions(latestState.settings, prev));
        }
        setPersistenceError(null);
      } catch (error) {
        console.error('Failed to sync latest Neon data', error);
        if (isMounted) {
          sharedDataLoadFailedRef.current = true;
          nextNeonRetryAtRef.current = Date.now() + 5 * 60 * 1000;
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
    // Shared workspaces are scheduled on the server, even when all browsers are closed.
    if (USE_NEON_DATA || authStatus !== 'approved' || !isPersistedStateReady) return;
    const tick = () => {
      const plan = planDailyReports(tasks, dailyReports, appSettings, userList, new Date(), [currentUser.id]);
      if (!plan.changedIds.length) return;
      plan.changedIds.forEach(queueDailyReportBroadcast);
      setDailyReports(plan.reports);
      plan.notifications.forEach(notice => queueNotificationBroadcast(notice.id));
      setNotifications(previous => [...previous, ...plan.notifications.filter(notice => !previous.some(old => old.id === notice.id))]);
    };
    tick(); const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [authStatus, isPersistedStateReady, tasks, dailyReports, appSettings, userList, currentUser.id]);


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

  const addNotifications = (userIds: string[], taskId: string, message: string, dailyReportId?: string) => {
    Array.from(new Set(userIds)).forEach(userId => {
      addNotification({ userId, taskId, message, ...(dailyReportId ? { dailyReportId } : {}) });
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
      const [hour, minute] = cairoTime(now.toISOString()).split(':').map(Number);
      endMinutes = hour * 60 + minute;
    }
    const diff = endMinutes - startMinutes;
    return diff > 0 ? diff : 0;
  };

  const upsertDailyReport = (input: { date: string; userId: string; note?: string; entries?: DailyReportEntry[] }) => {
    if (!input.date || !input.userId || !canEditDailyReport(input, currentUser, appSettings)) return null;
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
        autoSendWarningAt: existing?.autoSendWarningAt ?? null,
        editHistory: existing?.editHistory || [],
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      if (existing?.sentAt && (existing.note !== next.note || JSON.stringify(existing.entries) !== JSON.stringify(next.entries))) {
        next.editHistory = [...existing.editHistory, { id: crypto.randomUUID(), editedBy: currentUser.id, editedAt: now,
          previousNote: existing.note, nextNote: next.note,
          changedEntries: next.entries.filter(entry => JSON.stringify(entry) !== JSON.stringify(existing.entries.find(old => old.taskId === entry.taskId))).map(entry => ({ taskId: entry.taskId, field: 'note' as const, oldValue: JSON.stringify(existing.entries.find(old => old.taskId === entry.taskId)) || null, newValue: JSON.stringify(entry) })) }];
        addNotifications(getDailyReportReceiverIds(next, appSettings, userList), 'daily-report', `${currentUser.name} corrected their daily report for ${next.date}.`, next.id);
      }
      result = next;
      const nextReports = mergeDailyReportIntoState(prev, next);
      if (nextReports === prev) return prev;
      queueDailyReportBroadcast(reportId);
      return nextReports;
    });

    return result;
  };

  const upsertDailyReportEntry = (reportId: string, taskId: string, patch: { startTime?: string | null; endTime?: string | null; note?: string }) => {
    if (!reportId || !taskId || !canEditDailyReport({ userId: reportId.split(':').slice(1).join(':') }, currentUser, appSettings)) return;
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
      if (!canEditDailyReport(report, currentUser, appSettings)) return prev;
      const previousEntry = report.entries.find(entry => entry.taskId === taskId) || buildActualWorkEntries(tasks, report.userId, report.date, appSettings, userList).find(entry => entry.taskId === taskId) || null;
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
      const entries = report.entries.some(entry => entry.taskId === taskId)
        ? report.entries.map(entry => entry.taskId === taskId
          ? { ...entry, taskId, startTime: nextStart, endTime: nextEnd, durationMinutes, note: nextNote, manuallyEdited: true }
          : entry)
        : [...report.entries, { ...previousEntry, taskId, startTime: nextStart, endTime: nextEnd, durationMinutes, note: nextNote, manuallyEdited: true }];

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
          `${currentUser.name} updated their daily report for ${report.date}: ${summary}`, report.id
        );
      }

      return nextReports;
    });
  };

  const sendDailyReport = (reportId: string, options?: { auto?: boolean; actorId?: string }) => {
    const now = new Date().toISOString();
    if (options?.actorId && options.actorId !== currentUser.id) return;
    const actorId = currentUser.id;
    setDailyReports(prev => {
      const report = prev.find(item => item.id === reportId);
      if (!report || !canEditDailyReport(report, currentUser, appSettings)) return prev;
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
        `${ownerName}'s daily report for ${report.date} was ${options?.auto ? 'auto-sent' : 'sent'}.`, report.id
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

  const getEffectiveReviewMode = (_taskType: string, _isContentCreatorTask: boolean, selectedMode: ReviewMode): ReviewMode => {
    return normalizeReviewMode(selectedMode);
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
          // Both legacy modes use the same first-review assignment policy.
          if (config.fullReviewerUserIds?.length) return config.fullReviewerUserIds;
          if (config.quickLookUserIds?.length) return config.quickLookUserIds;
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

  const getActiveWorkflowOwnerIds = (task: Task, phase = getWorkflowPhase(task), approvals: string[] = []) => (
    getPhaseAssignableOwnerIds(task, phase, appSettings, userList, approvals)
  );

  const buildTaskWithWorkflowPhase = (task: Task, workflow: WorkflowDefinition, phaseIndex: number, approvals: Record<string, string[]> = {}, history: WorkflowPhaseHistoryEntry[] = [], actorId = currentUser.id, _note?: string): Task => {
    const phase = workflow.phases[phaseIndex];
    return phase ? buildTaskWithWorkflowPhases(task, workflow, [phase.id], approvals, history, actorId) : task;
  };

  // Shared cleanup commits atomically on the server. Local cleanup already ran
  // in the IndexedDB load transaction. Never clear a live feed in a React effect.
  useEffect(() => {
    if (!USE_NEON_DATA || authStatus !== 'approved' || !isPersistedStateReady || codexPreviewModeRef.current) return;
    if (appSettings.notificationResetVersion >= 3) return;
    queueSettingsBroadcast();
    setAppSettings(previous => ({
      ...previous,
      notificationResetVersion: 3,
      updatedAt: new Date().toISOString(),
    }));
  }, [authStatus, appSettings.notificationResetVersion, isPersistedStateReady]);

  // Local-only workspaces use the same planner; Neon is handled by the scheduler
  // even when every browser is closed.
  useEffect(() => {
    if (USE_NEON_DATA || !isLocalWorkspaceActive || authStatus !== 'approved' || !isPersistedStateReady) return;
    const tick = () => {
      const plan = planDeadlineReminders(tasks, appSettings, userList);
      if (!plan.notifications.length) return;
      setTasks(plan.tasks);
      setNotifications(previous => mergeNotificationsIntoState(previous, plan.notifications));
    };
    tick();
    const timer = window.setInterval(tick, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [authStatus, tasks, appSettings, userList, isPersistedStateReady, isLocalWorkspaceActive]);

  const buildTaskWithWorkflowPhases = (
    task: Task,
    workflow: WorkflowDefinition,
    activePhaseIds: string[],
    approvals: Record<string, string[]> = {},
    history: WorkflowPhaseHistoryEntry[] = [],
    actorId = currentUser.id,
  ): Task => {
    const now = new Date().toISOString();
    const activePhases = uniqueIds(activePhaseIds)
      .map(id => workflow.phases.find(phase => phase.id === id))
      .filter((phase): phase is WorkflowDefinition['phases'][number] => Boolean(phase));
    const oldActiveIds = task.workflowActivePhaseIds || [];
    const newlyActiveIds = activePhaseIds.filter(id => !oldActiveIds.includes(id));
    const delay = splitHandoffsByDelay(workflow, newlyActiveIds, appSettings, now);
    const availableAtByPhaseId: Record<string, string> = {};
    activePhases.forEach(phase => {
      const value = task.workflowPhaseAvailableAtByPhaseId?.[phase.id]
        || (oldActiveIds.includes(phase.id) ? task.workflowPhaseAvailableAt : null)
        || delay.availableAtByPhaseId[phase.id];
      if (value) availableAtByPhaseId[phase.id] = value;
    });
    const readyPhases = activePhases.filter(phase => !availableAtByPhaseId[phase.id] || availableAtByPhaseId[phase.id] <= now);
    const primaryPhase = readyPhases[0] || activePhases[0];
    const nextTask: Task = {
      ...task,
      workflowId: workflow.id,
      workflowSnapshot: cloneWorkflow(workflow),
      workflowCurrentPhaseId: primaryPhase?.id || null,
      workflowCurrentPhaseIndex: primaryPhase ? getWorkflowPhaseIndex(workflow, primaryPhase.id) : null,
      workflowActivePhaseIds: activePhases.map(phase => phase.id),
      workflowPhaseApprovals: approvals,
      workflowPhaseHistory: appendStartedEntries(history, activePhases, actorId),
      workflowPhaseAvailableAtByPhaseId: availableAtByPhaseId,
      workflowPhaseAvailableAt: readyPhases.length ? null : Object.values(availableAtByPhaseId).sort()[0] || null,
      workflowPendingHandoffPhaseIds: uniqueIds([
        ...(task.workflowPendingHandoffPhaseIds || []).filter(id => activePhaseIds.includes(id)),
        ...delay.delayedPhaseIds,
      ]),
      reviewMode: primaryPhase ? getReviewModeForWorkflowPhase(primaryPhase) : task.reviewMode,
      status: primaryPhase ? getStatusForWorkflowPhase(primaryPhase) : task.status,
      currentOwnerRole: primaryPhase ? getPhaseOwnerRole(primaryPhase) : null,
      currentOwnerUserId: null,
      currentOwnerUserIds: [],
    };
    const ownerIds = uniqueIds(readyPhases.flatMap(phase => getActiveWorkflowOwnerIds(nextTask, phase, approvals[phase.id] || [])));
    return { ...nextTask, currentOwnerUserId: ownerIds[0] || null, currentOwnerUserIds: ownerIds };
  };

  const initializeTaskWorkflow = (task: Task, workflowId?: string | null, _phaseId?: string | null, actorId = currentUser.id) => {
    const workflow = task.workflowSnapshot || getWorkflowBySelection(task.taskType, workflowId || task.workflowId);
    if (!workflow || workflow.phases.length === 0) return task;
    const initialized = computeWorkflowInitialization(workflow, task, actorId);
    const activeIds = initialized.nextActivePhaseIds;
    return buildTaskWithWorkflowPhases({ ...task, workflowActivePhaseIds: [], workflowPhaseAvailableAt: null, workflowPhaseAvailableAtByPhaseId: {}, workflowPendingHandoffPhaseIds: [] }, workflow, activeIds, task.workflowPhaseApprovals || {}, [...(task.workflowPhaseHistory || []), ...initialized.history], actorId);
  };

  const finishWorkflowTask = (task: Task, approvals: Record<string, string[]>, history: WorkflowPhaseHistoryEntry[]): Task => ({
    ...task,
    status: 'approved_by_art_director',
    workflowPhaseApprovals: approvals,
    workflowPhaseHistory: history,
    workflowActivePhaseIds: [],
    workflowCurrentPhaseId: null,
    workflowCurrentPhaseIndex: null,
    workflowPhaseAvailableAt: null,
    workflowPhaseAvailableAtByPhaseId: {},
    workflowPendingHandoffPhaseIds: [],
    currentOwnerRole: null,
    currentOwnerUserId: null,
    currentOwnerUserIds: [],
    updatedAt: new Date().toISOString(),
  });

  const advanceWorkflowAfterApproval = (task: Task, actorId: string, phaseId?: string): Task => {
    const workflow = task.workflowSnapshot;
    if (!workflow || isTaskArchived(task) || CLOSED_STATUSES.includes(task.status) || task.status === 'on_hold') return task;
    const advanced = computeWorkflowAdvance(workflow, task, actorId, phaseId, appSettings, userList);
    if (!advanced) return task;
    if (advanced.blockedReason) {
      setPersistenceError(advanced.blockedReason);
      return task;
    }
    return advanced.finished
      ? finishWorkflowTask(task, advanced.approvals, advanced.history)
      : { ...buildTaskWithWorkflowPhases(task, workflow, advanced.nextActivePhaseIds, advanced.approvals, advanced.history, actorId), updatedAt: new Date().toISOString() };
  };

  // Keep local actions synchronous so a repeated click cannot approve the same
  // phase twice before React renders the next phase. Preserve ancillary notes
  // already queued by the action form.
  const commitWorkflowTask = (updated: Task) => {
    const prior = workflowTasksRef.current.find(task => task.id === updated.id);
    if (prior) updated = reconcileWorkSessions(prior, updated, appSettings, userList);
    workflowTasksRef.current = workflowTasksRef.current.map(task => task.id === updated.id ? updated : task);
    queueTaskBroadcast(updated.id);
    setTasks(previous => previous.map(task => {
      if (task.id !== updated.id) return task;
      const comments = new Map((task.comments || []).map(comment => [comment.id, comment]));
      (updated.comments || []).forEach(comment => comments.set(comment.id, comment));
      return { ...updated, comments: [...comments.values()] };
    }));
  };

  const notifyWorkflowHandoffs = (before: Task | null, after: Task, requestedPhaseIds?: string[]) => {
    const now = new Date().toISOString();
    const additions = mergeHandoffNotifications([], [
      ...(before ? getReassignmentNotifications(before, after, appSettings, userList) : []),
      ...getHandoffNotifications(after, appSettings, userList, now, requestedPhaseIds),
    ]);
    additions.forEach(notification => queueNotificationBroadcast(notification.id));
    setNotifications(previous => mergeHandoffNotifications(previous, additions));
  };

  useEffect(() => {
    if (USE_NEON_DATA || authStatus !== 'approved' || !isPersistedStateReady) return;
    const repairMissingHandoffs = () => {
      const now = new Date().toISOString();
      const candidates = filterLocallyResetNotifications(workflowTasksRef.current.flatMap(task =>
        getHandoffNotifications(task, appSettings, userList, now)));
      const merged = mergeHandoffNotifications(notifications, candidates);
      const known = new Set(notifications.map(notice => notice.id));
      const additions = merged.filter(notice => !known.has(notice.id));
      if (!additions.length) return;
      additions.forEach(notice => queueNotificationBroadcast(notice.id));
      setNotifications(previous => mergeHandoffNotifications(previous, additions));
    };
    repairMissingHandoffs();
    const timer = window.setInterval(repairMissingHandoffs, 30_000);
    return () => window.clearInterval(timer);
  }, [authStatus, isPersistedStateReady, tasks, notifications, appSettings, userList]);

  useEffect(() => {
    if (authStatus !== 'approved' || !isPersistedStateReady) return;
    const releaseDueHandoffs = () => {
      const now = new Date().toISOString();
      workflowTasksRef.current.forEach(task => {
        if (!task.workflowSnapshot || CLOSED_STATUSES.includes(task.status) || RETURNED_STATUSES.includes(task.status) || task.status === 'on_hold' || isTaskArchived(task)) return;
        const dueIds = (task.workflowPendingHandoffPhaseIds || []).filter(id => (task.workflowActivePhaseIds || []).includes(id) && isPhaseAvailable(task, new Date(now), id));
        if (!dueIds.length) return;
        const next = buildTaskWithWorkflowPhases(task, task.workflowSnapshot, task.workflowActivePhaseIds || [], task.workflowPhaseApprovals || {}, task.workflowPhaseHistory || []);
        next.workflowPendingHandoffPhaseIds = (next.workflowPendingHandoffPhaseIds || []).filter(id => !dueIds.includes(id));
        next.updatedAt = now;
        commitWorkflowTask(next);
        notifyWorkflowHandoffs(task, next, dueIds);
      });
    };
    releaseDueHandoffs();
    const timer = window.setInterval(releaseDueHandoffs, 30_000);
    return () => window.clearInterval(timer);
  }, [authStatus, isPersistedStateReady, tasks, appSettings, userList]);

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

    if (USE_NEON_DATA) {
      try {
        const login = await loginNeonWorkspace(identifier, password);
        if (login.user) {
          setNeonAccessToken(null); setDailyReports([]);
          setCurrentUserState(login.user); setAuthError(null); setAuthStatus('approved');
          await refreshMembershipSettings();
          return { ok: true };
        }
        if (login.code !== 'NOT_MANUAL') return { ok: false, message: login.error || 'Invalid account or password.' };
      } catch (error) { return { ok: false, message: getErrorMessage(error, 'Could not verify workspace login.') }; }
    }
    const normalizedIdentifier = normalizeLoginIdentifier(identifier);
    let membership: AppSettings;
    try { membership = await refreshMembershipSettings(); }
    catch (error) { return { ok: false, message: getErrorMessage(error, 'Could not verify current membership. Please retry.') }; }
    if (isMemberDeleted({ id: '', email: normalizedIdentifier }, membership.deletedMembers)) return { ok: false, message: 'This workspace membership has been removed.' };
    const manualUser = (membership.manualUsers || []).find(user => normalizedIdentifier === normalizeLoginIdentifier(user.email || '')
      || normalizedIdentifier === normalizeLoginIdentifier(user.name));

    if (manualUser && !USE_NEON_DATA) {
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

    if (isMemberDeleted({ id: '', email }, membership.deletedMembers)) return { ok: false, message: 'This workspace membership has been removed.' };

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

    try {
      const membership = await refreshMembershipSettings();
      if (isMemberDeleted({ id: '', email: normalizedEmail }, membership.deletedMembers)) return { ok: false, message: 'This workspace membership has been removed.' };
    } catch (error) { return { ok: false, message: getErrorMessage(error, 'Could not verify workspace membership.') }; }

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
    if (isMemberDeleted({ id: '', email: input.email }, appSettingsRef.current.deletedMembers)) {
      setPersistenceError('This membership was removed. Use a different member identity; removal history cannot be overwritten.');
      return;
    }
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
    queueSettingsBroadcast();
    
    if (!USE_NEON_DATA) await supabase.from('app_settings').upsert({
      id: 'current',
      settings: nextAppSettings,
      updated_at: new Date().toISOString()
    });
  };

  const updateAppSettings = async (updater: AppSettings | ((settings: AppSettings) => AppSettings)) => {
    if (!canManageSettings) return;
    workspaceMutationGenerationRef.current++;
    
    let nextSettings: AppSettings;
    if (typeof updater === 'function') {
      nextSettings = updater(appSettings);
    } else {
      nextSettings = updater;
    }
    
    const merged = mergeAppSettingsPreservingWorkflowDeletions({
      ...nextSettings,
      updatedAt: new Date().toISOString(),
    }, appSettingsRef.current);
    
    setAppSettings(merged);

    const nextState = { tasks, notifications, settings: merged, dailyReports };
    
    try {
      if (isNeonWorkspaceActive && hasLoadedPersistedState.current && !sharedDataLoadFailedRef.current) {
        const result = await saveNeonAppState(nextState, { changedTaskIds: [] });
        if (result.settings) setAppSettings(previous => mergeAppSettingsPreservingWorkflowDeletions(result.settings, previous));
        lastNeonUpdatedAtRef.current = result.updatedAt || lastNeonUpdatedAtRef.current;
        nextNeonRetryAtRef.current = 0;
      } else if (isDriveWorkspaceReady && hasLoadedPersistedState.current && !sharedDataLoadFailedRef.current) {
        await upsertDriveSettings(merged);
      } else if (isNeonWorkspaceActive && hasLoadedPersistedState.current && sharedDataLoadFailedRef.current) {
        await saveAppState(reportFreeFallback(nextState));
      } else if (isLocalWorkspaceActive && hasLoadedPersistedState.current) {
        await saveAppState(nextState);
      }

      if (!USE_NEON_DATA) await supabase.from('app_settings').upsert({
        id: 'current',
        settings: merged,
        updated_at: new Date().toISOString()
      });

      if (isNeonWorkspaceActive && sharedDataLoadFailedRef.current) {
        setPersistenceError(prev => prev || getSharedDataErrorMessage(
          new Error('Shared database transfer limit has been reached.'),
          'Shared database transfer limit has been reached.'
        ));
      } else {
        setPersistenceError(null);
      }
    } catch (error) {
      console.error('Failed to save app settings', error);
      if (isNeonWorkspaceActive) {
        sharedDataLoadFailedRef.current = true;
        nextNeonRetryAtRef.current = Date.now() + 5 * 60 * 1000;
        await saveAppState(reportFreeFallback(nextState)).catch(localError => {
          console.error('Failed to save local fallback settings after Neon error', localError);
        });
      }
      setPersistenceError(getSharedDataErrorMessage(error, 'Failed to save app settings.'));
    }
  };

  const deletingMemberIdsRef = useRef(new Set<string>());
  const deleteUserAccount = async (userId: string): Promise<MemberDeletionResult> => {
    if (!canRemoveMember(currentUser) || isMemberDeleted(currentUser, appSettingsRef.current.deletedMembers)) return { ok: false, message: 'Only an admin or leaderboard member can remove members.' };
    if (userId === currentUser.id) return { ok: false, message: 'You cannot remove your own membership.' };
    if (isDriveWorkspaceActive) return { ok: false, message: 'Member removal is unavailable for Drive-backed workspaces because shared removal cannot yet be saved reliably.' };
    if (!hasLoadedPersistedState.current || !isPersistedStateReady) return { ok: false, message: 'Wait for the workspace to finish loading, then try again.' };
    if (deletingMemberIdsRef.current.has(userId)) return { ok: false, message: 'This member removal is already being saved.' };
    deletingMemberIdsRef.current.add(userId);
    try {
      const shared = isNeonWorkspaceActive ? await fetchNeonAppStateResponse() : null;
      const local = !isNeonWorkspaceActive ? await loadAppState() : null;
      const fresh = shared?.state || local;
      const settings = mergeAppSettingsPreservingWorkflowDeletions(fresh?.settings || appSettingsRef.current, appSettingsRef.current);
      const { data: freshProfiles, error: profileError } = await supabase.from('profiles').select('*');
      if (profileError) throw new Error(`Could not verify member identity aliases: ${profileError.message}`);
      const profiles: User[] = (freshProfiles || []).map(profile => ({ id: profile.id, email: profile.email, name: profile.name, role: profile.role as Role, jobTitle: profile.job_title, isAdmin: profile.is_admin, legacyId: profile.legacy_id }));
      profileUsersRef.current = profiles;
      setProfileUserList(profiles);
      const roster = [...profiles, ...(settings.manualUsers || []), ...manualUserList];
      const target = roster.find(user => user.id === userId);
      if (isMemberDeleted({ id: userId }, settings.deletedMembers)) {
        setAppSettings(previous => mergeAppSettingsPreservingWorkflowDeletions(settings, previous));
        return { ok: true, message: 'This membership has already been removed.' };
      }
      if (!target) return { ok: false, message: 'This member could not be found. Refresh the member list and try again.' };
      const latestTasks = mergeTasksIntoState(fresh?.tasks || [], workflowTasksRef.current);
      const plan = prepareMemberDeletion(currentUser, target, roster, latestTasks, settings);
      if (!plan.ok) return { ...plan, blockingTasks: plan.blockingTasks?.filter(block => {
        const task = latestTasks.find(task => task.id === block.taskId);
        return task && canViewTask(task, currentUser, settings, roster);
      }) };
      const nextSettings = mergeAppSettings(applyMemberDeletions({ ...settings, updatedAt: new Date().toISOString() }, plan.deletedMembers));
      const state = { tasks: latestTasks, notifications: fresh?.notifications || notifications, dailyReports: fresh?.dailyReports || dailyReports, settings: nextSettings };
      if (isNeonWorkspaceActive) {
        const result = await saveNeonAppState(state, { expectedUpdatedAt: shared?.updatedAt || null, changedTaskIds: [] });
        lastNeonUpdatedAtRef.current = result.updatedAt;
        sharedDataLoadFailedRef.current = false;
        nextNeonRetryAtRef.current = 0;
        appSettingsRef.current = mergeAppSettingsPreservingWorkflowDeletions(result.settings || nextSettings, nextSettings);
      } else {
        await saveAppState(state, { expectedState: local });
        appSettingsRef.current = nextSettings;
      }
      setAppSettings(appSettingsRef.current);
      setPersistenceError(null);
      return { ok: true, message: 'App membership removed. Work history has been retained.' };
    } catch (error) {
      const message = getErrorMessage(error, 'Could not save member removal. The member has not been removed.');
      setPersistenceError(message);
      return { ok: false, message, ...(error instanceof NeonAppStateError && error.blockingTasks ? { blockingTasks: error.blockingTasks } : {}) };
    } finally { deletingMemberIdsRef.current.delete(userId); }
  };

  const logout = async () => {
    if (USE_NEON_DATA) await logoutNeonWorkspace();
    setDailyReports([]);
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
    if (!canMutateTask(taskId)) return ;
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(task => task.id === taskId
      ? { ...task, archivedAt: new Date().toISOString(), archivedReason: reason, updatedAt: new Date().toISOString() }
      : task
    ));
  };

  const unarchiveTask = (taskId: string) => {
    if (!canMutateTask(taskId)) return ;
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(task => task.id === taskId
      ? { ...task, archivedAt: null, archivedReason: null, updatedAt: new Date().toISOString() }
      : task
    ));
  };

  const deleteTask = (taskId: string) => {
    const task = tasks.find(task => task.id === taskId);
    if (!task || !canDeleteTask(task, currentUser, appSettings, userList)) return;
    pendingDeletedTaskIdsRef.current.add(taskId);
    queueTaskBroadcast(taskId);
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
      if (isNeonWorkspaceActive) {
        uploadedTasks.forEach(task => queueTaskBroadcast(task.id));
        localMigrationState.notifications.forEach(notification => queueNotificationBroadcast(notification.id));
      }
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
    if (!canMutateTask(taskId)) return ;
    const workflowTask = workflowTasksRef.current.find(item => item.id === taskId);
    if (workflowTask?.workflowSnapshot) {
      if (['approved_by_art_director', 'reviewer_approved', 'sent_to_art_director'].includes(newStatus)) approveWorkflowPhase(taskId);
      else if (RETURNED_STATUSES.includes(newStatus)) rejectWorkflowPhase(taskId);
      return;
    }
    if (newStatus === 'approved_by_art_director' && currentUser.role !== 'art_director') return;
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
        addNotifications(allRecipients, taskId, `Art Director returned "${task.name}" for changes.`);
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
    if (!canMutateTask(taskId)) return ;
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
    if (!canMutateTask(taskId)) return ;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (active ? !canStartTaskWork(task, currentUser.id, appSettings, userList) : !getTaskWorkSessions(task, appSettings, userList).some(session => session.userId === currentUser.id && !session.finishedAt)) return;

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
      return reconcileWorkSessions(t, addAuditComment({
        ...t,
        activeWorkBy: active ? currentUser.id : t.activeWorkBy,
        activeWorkStartedAt: active ? now : t.activeWorkStartedAt,
        activeWorkFinishedAt: active ? null : now,
        activeWorkFinishedById: active ? null : currentUser.id,
        activeWorkNote: note?.trim() || t.activeWorkNote || null,
        updatedAt: now,
      }, currentUser.id, active ? 'active_work_started' : 'active_work_finished', active ? 'Marked as actively working.' : 'Marked active work as finished.', now), appSettings, userList);
    }));
  };

  const setTaskActiveWorkByLeader = (taskId: string, memberId: string | null) => {
    if (!canMutateTask(taskId)) return ;
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
    if (!canMutateTask(taskId)) return ;
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, priority, deadlineText: deadline, updatedAt: new Date().toISOString() };
      }
      return t;
    }));
  };

  const updateTaskAssignment = (taskId: string, handledByIds: string[], currentOwnerUserIds: string[]) => {
    if (!canMutateTask(taskId) || !canReassignWorkflowTask(currentUser)) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const nextHandledBy = sanitizeHandledByWithSettings(appSettings, handledByIds, currentUser.id);
    const nextOwnerIds = task.workflowSnapshot ? getCurrentOwnerUserIds(task) : normalizeOwnerIdsForRole(task.currentOwnerRole, currentOwnerUserIds, currentUser.id);
    const previousAssignees = new Set([...task.handledBy, ...getCurrentOwnerUserIds(task)]);
    const addedAssignees = task.workflowSnapshot ? [] : nextOwnerIds.filter(userId => !previousAssignees.has(userId));
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

  const updateWorkflowPhaseAssignees = (taskId: string, phaseId: string, assigneeIds: string[]) => {
    if (!canMutateTask(taskId)) return ;
    if (!canReassignWorkflowTask(currentUser)) return;
    const task = tasks.find(item => item.id === taskId);
    const workflow = task?.workflowSnapshot;
    const phase = workflow?.phases.find(item => item.id === phaseId);
    if (!task || !workflow || !phase || isMandatoryFinalReview(phase) || CLOSED_STATUSES.includes(task.status)) return;

    const cleanedAssigneeIds = uniqueIds(assigneeIds.filter(userId => Boolean(usersObj[userId])));
    if (cleanedAssigneeIds.length < (phase.requiredApprovals || 1)) { setPersistenceError('Choose enough owners for this step.'); return; }
    const completed = getCompletedPhaseIdsFromHistory(task.workflowPhaseHistory || []);
    if (completed.has(phaseId)) { setPersistenceError('Completed step owners are preserved in history.'); return; }
    const activePhaseIds = task.workflowActivePhaseIds?.length ? task.workflowActivePhaseIds : [task.workflowCurrentPhaseId].filter(Boolean) as string[];
    const isVoice = isVoiceOverPhase(phase) || hasVoiceOverProviderSelection(task, phase);
    if (isVoice && cleanedAssigneeIds.length !== 1) { setPersistenceError('Choose one person to deliver the voice-over audio.'); return; }
    const candidate: Task = isVoice ? { ...task,
      workflowNodeVoiceOverDeliveryOwnerIds: { ...task.workflowNodeVoiceOverDeliveryOwnerIds, [phaseId]: cleanedAssigneeIds[0] },
      workflowNodeAIAssigneeIds: getVoiceOverProvider(task, phase) === 'voice_over_ai' ? { ...task.workflowNodeAIAssigneeIds, [phaseId]: cleanedAssigneeIds[0] } : task.workflowNodeAIAssigneeIds,
    } : { ...task, workflowNodeAssigneeIds: { ...(task.workflowNodeAssigneeIds || {}), [phaseId]: cleanedAssigneeIds } };
    const validation = validateVoiceOverTaskChanges(task, candidate, userList);
    if (!validation.ok) { setPersistenceError(validation.message || 'Invalid voice-over delivery owner.'); return; }
    const updated = buildTaskWithWorkflowPhases(candidate, workflow, activePhaseIds, task.workflowPhaseApprovals || {}, task.workflowPhaseHistory || [], currentUser.id);
    const now = new Date().toISOString();
    const audited = addAuditComment(updated, currentUser.id, 'assignment_change', `Updated ${phase.name} owners: ${cleanedAssigneeIds.map(id => getUserDisplayName(usersObj, id)).join(', ')}.`, now);
    commitWorkflowTask(audited);
    notifyWorkflowHandoffs(task, audited);
  };

  const updateTaskReviewMode = (taskId: string, reviewMode: ReviewMode) => {
    reviewMode = normalizeReviewMode(reviewMode);
    if (!canMutateTask(taskId)) return ;
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.workflowSnapshot || !isLeaderboardUser(currentUser.id)) return;

    const target = getReviewRouteTarget(reviewMode);
    const shouldUpdateStatus = canReviewRouteUpdateStatus(task);
    const nextOwnerRole = shouldUpdateStatus ? target.ownerRole : task.currentOwnerRole;
    const nextOwnerIds = shouldUpdateStatus ? getDefaultOwnerIdsForRole(target.ownerRole, task) : getCurrentOwnerUserIds(task);
    const reviewerLabel = reviewMode === 'content_review'
      ? 'Content Rev.'
      : reviewMode === 'final_review'
        ? 'Final Rev.'
        : 'First Rev.';

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
    if (!canMutateTask(taskId)) return ;
    const task = workflowTasksRef.current.find(item => item.id === taskId);
    if (!task || (task.createdBy !== currentUser.id && !canManageWorkflowBuilder(currentUser, appSettings))) return;
    if (input.assignmentDate && isPastWorkDate(input.assignmentDate)) return;
    const now = new Date().toISOString();
    // A saved workflow is changed only through the explicit workflow control.
    const taskType = task.workflowSnapshot ? task.taskType : input.taskType || task.taskType;
    const updates = { name: input.name.trim() || task.name, description: input.description ?? task.description,
      taskType, priority: input.priority, deadlineAt: input.deadlineAt || null, assignmentDate: input.assignmentDate || task.assignmentDate || null };
    const diffs = buildTaskEditDiff(task, updates);
    let updated: Task = { ...task, ...updates, updatedAt: now };
    let selectedWorkflow = taskType !== task.taskType ? getWorkflowBySelection(taskType) : null;
    if (selectedWorkflow) {
      const selection = resolveWorkflowAssignment(appSettingsRef.current, taskType, selectedWorkflow.id);
      if (!selection.ok) { setPersistenceError(selection.message || 'This workflow cannot be assigned.'); return; }
      selectedWorkflow = selection.workflow!;
      const owners = prepareWorkflowAssignmentOwners(selectedWorkflow, updated, appSettingsRef.current, userList, updated.workContributorIds ?? updated.handledBy, task);
      if (!owners.ok) { setPersistenceError(owners.message || 'Assign the required workflow owners.'); return; }
      updated = initializeTaskWorkflow({ ...updated, workflowNodeAssigneeIds: owners.workflowNodeAssigneeIds, workflowNodeVoiceOverDeliveryOwnerIds: owners.workflowNodeVoiceOverDeliveryOwnerIds, workflowFinalApproverIdsByPhaseId: owners.workflowFinalApproverIdsByPhaseId, workflowId: selectedWorkflow.id, workflowSnapshot: cloneWorkflow(selectedWorkflow),
        workflowActivePhaseIds: [], workflowPhaseApprovals: {}, workflowPhaseHistory: [...(task.workflowPhaseHistory || []),
          ...selectedWorkflow.phases.map(phase => ({ phaseId: phase.id, phaseName: phase.name, action: 'invalidated' as const,
            actorId: currentUser.id, createdAt: now, note: `Workflow changed to ${selectedWorkflow.name}.` }))] }, selectedWorkflow.id);
    }
    const audited = addAuditComment(updated, currentUser.id, 'assignment_change', `Task edited by ${currentUser.name}: ${diffs.join('; ') || 'no changes'}.`, now);
    commitWorkflowTask(audited);
    if (selectedWorkflow) notifyWorkflowHandoffs(null, audited);
    else if (diffs.length) addNotifications(getCurrentOwnerUserIds(audited).filter(id => id !== currentUser.id), task.id, `${currentUser.name} edited "${task.name}": ${diffs.join('; ')}`);
  };

  const applyTaskWorkflow = (taskId: string, workflowId: string) => {
    if (!canMutateTask(taskId)) return ;
    if (!canManageWorkflowBuilder(currentUser, appSettings)) return;
    const task = workflowTasksRef.current.find(item => item.id === taskId);
    const workflow = (appSettingsRef.current.workflows || []).find(item => item.id === workflowId && item.active !== false);
    if (!task || !workflow || CLOSED_STATUSES.includes(task.status) || task.status === 'on_hold' || isTaskArchived(task)) return;
    const nextType = getTaskTypeConfigs(appSettings).find(config => config.workflowId === workflow.id)?.id;
    const selected = resolveWorkflowAssignment(appSettingsRef.current, nextType || '', workflow.id);
    if (!selected.ok) { setPersistenceError(selected.message || 'This workflow cannot be assigned.'); return; }
    const retainedNodeOwners = Object.fromEntries(Object.entries(task.workflowNodeAssigneeIds || {}).filter(([id]) => workflow.phases.some(phase => phase.id === id)));
    const owners = prepareWorkflowAssignmentOwners(workflow, { ...task, workflowNodeAssigneeIds: retainedNodeOwners, workflowSkippedPhaseIds: [] }, appSettingsRef.current, userList, task.workContributorIds ?? task.handledBy, task);
    if (!owners.ok) { setPersistenceError(owners.message || 'Assign the required workflow owners.'); return; }
    const now = new Date().toISOString();
    const invalidations: WorkflowPhaseHistoryEntry[] = workflow.phases.map(phase => ({
      phaseId: phase.id, phaseName: phase.name, action: 'invalidated', actorId: currentUser.id, createdAt: now,
      note: `Workflow changed to ${workflow.name}; begin at the configured first step.`,
    }));
    const updated = initializeTaskWorkflow({ ...task, taskType: nextType!, workflowId, workflowSnapshot: cloneWorkflow(workflow),
      workflowPhaseApprovals: {}, workflowPhaseHistory: [...(task.workflowPhaseHistory || []), ...invalidations],
      workflowNodeAssigneeIds: owners.workflowNodeAssigneeIds,
      workflowNodeVoiceOverDeliveryOwnerIds: owners.workflowNodeVoiceOverDeliveryOwnerIds,
      workflowFinalApproverIdsByPhaseId: owners.workflowFinalApproverIdsByPhaseId,
      workflowSkippedPhaseIds: [], workflowActivePhaseIds: [],
    }, workflowId);
    if (!updated.workflowActivePhaseIds?.length) return;
    const audited = addAuditComment({ ...updated, updatedAt: now }, currentUser.id, 'review_route_change', `Workflow changed to ${workflow.name} and started from its configured first step.`, now);
    commitWorkflowTask(audited);
    notifyWorkflowHandoffs(null, audited);
  };

  const approveWorkflowPhase = (taskId: string, note?: string, phaseId?: string) => {
    if (!canMutateTask(taskId)) return ;
    const task = workflowTasksRef.current.find(item => item.id === taskId);
    if (!task || isTaskArchived(task) || CLOSED_STATUSES.includes(task.status) || task.status === 'on_hold') return;
    const taskWithWorkflow = task.workflowSnapshot ? task : initializeTaskWorkflow(task, task.workflowId);
    const workflow = taskWithWorkflow.workflowSnapshot;
    if (!workflow) return;
    const beforePhase = workflow.phases.find(phase => (
      (!phaseId || phase.id === phaseId)
      && (taskWithWorkflow.workflowActivePhaseIds || []).includes(phase.id)
      && getActiveWorkflowOwnerIds(taskWithWorkflow, phase, taskWithWorkflow.workflowPhaseApprovals?.[phase.id] || []).includes(currentUser.id)
    ));
    if (!beforePhase) return;
    const updated = advanceWorkflowAfterApproval(taskWithWorkflow, currentUser.id, beforePhase.id);
    if (updated === taskWithWorkflow) return;
    const audited = addAuditComment(updated, currentUser.id, 'review_note', note || `${beforePhase.name} completed.`);
    commitWorkflowTask(audited);
    notifyWorkflowHandoffs(taskWithWorkflow, audited);
  };

  const rejectWorkflowPhase = (taskId: string, noteText?: string, phaseId?: string) => {
    if (!canMutateTask(taskId)) return ;
    const task = workflowTasksRef.current.find(item => item.id === taskId);
    if (!task?.workflowSnapshot || isTaskArchived(task) || CLOSED_STATUSES.includes(task.status) || task.status === 'on_hold') return;
    const workflow = task.workflowSnapshot;
    const source = workflow.phases.find(phase => (
      (!phaseId || phase.id === phaseId)
      && (task.workflowActivePhaseIds || []).includes(phase.id)
      && getActiveWorkflowOwnerIds(task, phase, task.workflowPhaseApprovals?.[phase.id] || []).includes(currentUser.id)
    ));
    if (!source) return;
    const returned = computeWorkflowReturn(workflow, task, currentUser.id, source.id, undefined, appSettings, userList);
    if (!returned) return;
    const revisionCount = (task.workflowPhaseRevisionCounts?.[returned.targetPhaseId] || 0) + 1;
    const cleanTask: Task = {
      ...task,
      workflowActivePhaseIds: (task.workflowActivePhaseIds || []).filter(id => !returned.invalidatedIds.includes(id)),
      workflowPhaseAvailableAt: null,
      workflowPhaseAvailableAtByPhaseId: { ...Object.fromEntries(Object.entries(task.workflowPhaseAvailableAtByPhaseId || {}).filter(([id]) => !returned.invalidatedIds.includes(id))), ...returned.availableAtByPhaseId },
      workflowPendingHandoffPhaseIds: (task.workflowPendingHandoffPhaseIds || []).filter(id => !returned.invalidatedIds.includes(id)),
      workflowPhaseRevisionCounts: { ...task.workflowPhaseRevisionCounts, [returned.targetPhaseId]: revisionCount },
    };
    const updated = buildTaskWithWorkflowPhases(cleanTask, workflow, returned.nextActivePhaseIds, returned.approvals, returned.history, currentUser.id);
    const awaitingRevisionUpload = returned.targetPhaseId === source.id;
    if (awaitingRevisionUpload) {
      const uploaderId = task.versions[0]?.submittedBy || task.createdBy;
      if (!userList.some(user => user.id === uploaderId)) return;
      updated.status = getPhaseOwnerRole(source) === 'art_director' ? 'changes_requested_by_art_director' : 'changes_requested_by_reviewer';
      updated.currentOwnerRole = 'team_member';
      updated.currentOwnerUserIds = [uploaderId];
      updated.currentOwnerUserId = uploaderId;
      updated.workflowCurrentPhaseId = source.id;
      updated.workflowCurrentPhaseIndex = getWorkflowPhaseIndex(workflow, source.id);
      updated.workflowPhaseAvailableAt = null;
      updated.workflowPhaseAvailableAtByPhaseId = { ...updated.workflowPhaseAvailableAtByPhaseId, [source.id]: new Date().toISOString() };
      updated.workflowPendingHandoffPhaseIds = (updated.workflowPendingHandoffPhaseIds || []).filter(id => id !== source.id);
    }
    const audited = addAuditComment({ ...updated, updatedAt: new Date().toISOString() }, currentUser.id, 'request_edits', noteText || `Returned to ${workflow.phases.find(phase => phase.id === returned.targetPhaseId)?.name || 'the previous step'} for changes.`);
    commitWorkflowTask(audited);
    notifyWorkflowHandoffs(task, audited, [returned.targetPhaseId]);
  };

  const setWorkflowPhaseOmitted = (taskId: string, phaseId: string, omitted: boolean): WorkflowAssignmentResult => {
    const task = workflowTasksRef.current.find(item => item.id === taskId);
    if (!task || !canManageWorkflowOmissions(currentUser, appSettings, task, userList)) return { ok: false, message: 'Only workflow managers can change this task’s steps.' };
    const ids = omitted ? uniqueIds([...(task.workflowSkippedPhaseIds || []), phaseId]) : (task.workflowSkippedPhaseIds || []).filter(id => id !== phaseId);
    const result = reconcileWorkflowOmissions(task, { ...task, workflowSkippedPhaseIds: ids }, currentUser, appSettings, userList);
    if (!result.ok || !result.task) {
      setPersistenceError(result.message || 'This step cannot be changed.');
      return result;
    }
    const phase = task.workflowSnapshot?.phases.find(phase => phase.id === phaseId);
    const updated = addAuditComment(result.task, currentUser.id, 'review_note', `${phase?.name || 'Workflow step'} ${omitted ? 'removed from' : 'restored to'} this task.`);
    commitWorkflowTask(updated);
    notifyWorkflowHandoffs(task, updated);
    return { ok: true };
  };

  const skipWorkflowPhase = (taskId: string, phaseId?: string): WorkflowAssignmentResult => {
    const task = workflowTasksRef.current.find(item => item.id === taskId);
    const id = phaseId || task?.workflowCurrentPhaseId;
    return id ? setWorkflowPhaseOmitted(taskId, id, true) : { ok: false, message: 'Select a workflow step.' };
  };

  const manuallyApproveTask = (taskId: string, note?: string) => {
    if (!canMutateTask(taskId)) return ;
    const task = workflowTasksRef.current.find(item => item.id === taskId);
    // Saved workflows can only finish through their configured active phases.
    if (!task || task.workflowSnapshot || task.workflowId || currentUser.role !== 'art_director'
      || CLOSED_STATUSES.includes(task.status) || isTaskArchived(task)) return;
    const updated = addAuditComment(finishWorkflowTask(task, {}, task.workflowPhaseHistory || []), currentUser.id, 'manual_approval', note?.trim() || 'Approved by the Art Director outside the tool.');
    commitWorkflowTask(updated);
  };

  const updateTaskPublishSchedule = (taskId: string, schedule: { scheduledPublishAt: string | null; publishNote: string | null }) => {
    if (!canMutateTask(taskId)) return ;
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
    if (!canMutateTask(taskId)) return ;
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
    if (!canMutateTask(taskId)) return ;
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
    if (!canMutateTask(taskId)) return ;
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
      reviewMode: 'first_review',
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
    if (!canMutateTask(taskId)) return ;
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

  const createWorkAssignment = (input: WorkAssignmentInput): WorkflowAssignmentResult => {
    if (!canCreateWorkAssignment(currentUser, appSettings)) return { ok: false, message: 'You cannot create work assignments.' };
    const selection = resolveWorkflowAssignment(appSettingsRef.current, input.taskType || '');
    if (!selection.ok || !selection.workflow) return { ok: false, message: selection.message };

    const handledBy = input.isTemporarySelfTask
      ? uniqueIds(input.handledByIds.filter(Boolean))
      : sanitizeHandledByWithSettings(appSettings, input.handledByIds, currentUser.id);
    if (!input.name.trim() || handledBy.length === 0) return { ok: false, message: 'Enter a task name and select an assignee.' };

    const now = new Date().toISOString();
    const taskId = Math.random().toString(36).substring(7);
    const normalizedLinks = input.assignmentLinks.map(link => link.trim()).filter(Boolean);
    const deadlineText = formatDeadlineText(input.deadlineAt);
    const assignmentPeriod = getAssignmentPeriodFromDeadline(input.deadlineAt);
    const workflow = selection.workflow;
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
      taskType: selection.taskType!,
      reviewMode: getEffectiveReviewMode(input.taskType || 'campaign', isContentCreatorTask, 'first_review'),
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
      workflowNodeAIAssigneeIds: input.workflowNodeAIAssigneeIds || {},
      workflowNodeVoiceOverDeliveryOwnerIds: input.workflowNodeVoiceOverDeliveryOwnerIds || {},
      workContributorIds: input.workContributorIds ?? handledBy,
      workflowSkippedPhaseIds: applyContentReviewChoice(workflow, input.workflowSkippedPhaseIds, input.needsContentRevision),
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
      workflowSnapshot: cloneWorkflow(workflow),
      workflowCurrentPhaseId: null,
      workflowCurrentPhaseIndex: null,
      workflowPhaseApprovals: {},
      workflowPhaseHistory: [],
      workflowActivePhaseIds: [],
    };

    const omissions = validateWorkflowOmissionSelection(task, task.workflowSkippedPhaseIds || [], currentUser, appSettings, userList);
    if (!omissions.ok) return omissions;
    const owners = prepareWorkflowAssignmentOwners(workflow, task, appSettingsRef.current, userList, input.workContributorIds ?? handledBy);
    if (!owners.ok) return { ok: false, message: owners.message };
    const taskWithWorkflow = initializeTaskWorkflow({ ...task, workflowNodeAssigneeIds: owners.workflowNodeAssigneeIds, workflowNodeVoiceOverDeliveryOwnerIds: owners.workflowNodeVoiceOverDeliveryOwnerIds, workflowFinalApproverIdsByPhaseId: owners.workflowFinalApproverIdsByPhaseId }, workflow.id, undefined, currentUser.id);
    if (taskWithWorkflow.workflowSnapshot) notifyWorkflowHandoffs(null, taskWithWorkflow);
    else addNotifications(getCurrentOwnerUserIds(taskWithWorkflow), taskId, `You are now responsible for "${taskWithWorkflow.name}".`);
    queueTaskBroadcast(taskId);
    setTasks(prev => [
      addAuditComment(taskWithWorkflow, currentUser.id, 'work_assignment_created', `Assigned work created for ${handledBy.map(userId => getUserDisplayName(usersObj, userId)).join(', ')}.`, now),
      ...prev,
    ]);
    return { ok: true };
  };

  const updateWorkAssignment = (taskId: string, input: WorkAssignmentInput): WorkflowAssignmentResult => {
    if (!canMutateTask(taskId)) return { ok: false, message: 'You cannot edit this task.' };
    const task = workflowTasksRef.current.find(t => t.id === taskId);
    if (!task || (!canManageWorkAssignment(task, currentUser, appSettings) && !canManageWorkflowOmissions(currentUser, appSettings, task, userList))) return { ok: false, message: 'You cannot edit this assignment.' };

    const today = new Date();
    const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (input.assignmentDate && input.assignmentDate < todayValue) {
      console.warn('Assignment date cannot be in the past.');
      return { ok: false, message: 'Assignment date cannot be in the past.' };
    }

    const handledBy = input.isTemporarySelfTask
      ? uniqueIds(input.handledByIds.filter(Boolean))
      : sanitizeHandledByWithSettings(appSettings, input.handledByIds, currentUser.id);
    if (!input.name.trim() || handledBy.length === 0) return { ok: false, message: 'Enter a task name and select an assignee.' };
    const changesWorkflow = Boolean(input.taskType && cleanTaskTypeKey(input.taskType) !== cleanTaskTypeKey(task.taskType)) || !task.workflowSnapshot;
    const selection = changesWorkflow ? resolveWorkflowAssignment(appSettingsRef.current, input.taskType || task.taskType) : null;
    if (selection && (!selection.ok || !selection.workflow)) return { ok: false, message: selection.message };
    let nodeOwners = input.workflowNodeAssigneeIds;
    let deliveryOwners = input.workflowNodeVoiceOverDeliveryOwnerIds ?? task.workflowNodeVoiceOverDeliveryOwnerIds;
    let frozenFinalApproverIdsByPhaseId = changesWorkflow ? {} : { ...task.workflowFinalApproverIdsByPhaseId };
    for (const phase of (changesWorkflow ? selection!.workflow : task.workflowSnapshot)?.phases || []) {
      if (!isMandatoryFinalReview(phase)) continue;
      const fixed = changesWorkflow ? resolveFixedArtDirector(phase, appSettings, userList) : resolveTaskFinalArtDirector(phase, task, appSettings, userList);
      if (!fixed.ok) return fixed;
      nodeOwners = { ...nodeOwners, [phase.id]: [fixed.ownerId!] };
      frozenFinalApproverIdsByPhaseId = { ...frozenFinalApproverIdsByPhaseId, [phase.id]: fixed.ownerId! };
    }
    if (!changesWorkflow) {
      const voiceOverCandidate = { ...task, workflowNodeAssigneeIds: nodeOwners,
        workflowNodeAIAssigneeIds: input.workflowNodeAIAssigneeIds ?? task.workflowNodeAIAssigneeIds,
        workflowNodeVoiceOverDeliveryOwnerIds: deliveryOwners,
        workflowSkippedPhaseIds: applyContentReviewChoice(task.workflowSnapshot, input.workflowSkippedPhaseIds ?? task.workflowSkippedPhaseIds, input.needsContentRevision) };
      for (const phase of task.workflowSnapshot?.phases || []) {
        const beforeOwners = resolveWorkflowPhaseOwnerIds(phase, task, appSettings, userList);
        const afterOwners = resolveWorkflowPhaseOwnerIds(phase, voiceOverCandidate, appSettings, userList);
        if (JSON.stringify(beforeOwners) === JSON.stringify(afterOwners)) continue;
        if (!canReassignWorkflowTask(currentUser)) return { ok: false, message: 'Only leadership can reassign workflow owners.' };
        if (getCompletedPhaseIdsFromHistory(task.workflowPhaseHistory || []).has(phase.id)) return { ok: false, message: 'Completed step owners are preserved in history.' };
        if (afterOwners.length < (phase.requiredApprovals || 1)) return { ok: false, message: `Choose enough eligible owners for ${phase.name}.` };
      }
      const voiceOverValidation = validateVoiceOverTaskChanges(task, voiceOverCandidate, userList);
      if (!voiceOverValidation.ok) return voiceOverValidation;
      for (const phase of task.workflowSnapshot?.phases || []) {
        if (hasVoiceOverProviderSelection(voiceOverCandidate, phase)) {
          const owner = getVoiceOverDeliveryOwnerId(voiceOverCandidate, phase, userList);
          if (owner) deliveryOwners = { ...deliveryOwners, [phase.id]: owner };
        }
      }
    }
    if (changesWorkflow) {
      const prepared = { ...task, handledBy, workflowNodeAssigneeIds: input.workflowNodeAssigneeIds,
        workflowNodeAIAssigneeIds: input.workflowNodeAIAssigneeIds,
        workflowNodeVoiceOverDeliveryOwnerIds: deliveryOwners,
        workflowSkippedPhaseIds: applyContentReviewChoice(selection!.workflow, input.workflowSkippedPhaseIds, input.needsContentRevision) };
      const owners = prepareWorkflowAssignmentOwners(selection!.workflow!, prepared, appSettingsRef.current, userList, input.workContributorIds ?? task.workContributorIds ?? handledBy, task);
      if (!owners.ok) return { ok: false, message: owners.message };
      nodeOwners = owners.workflowNodeAssigneeIds;
      deliveryOwners = owners.workflowNodeVoiceOverDeliveryOwnerIds;
      frozenFinalApproverIdsByPhaseId = owners.workflowFinalApproverIdsByPhaseId || frozenFinalApproverIdsByPhaseId;
    }

    const omissionWorkflow = changesWorkflow ? selection!.workflow! : task.workflowSnapshot!;
    const requestedSkippedIds = applyContentReviewChoice(omissionWorkflow, input.workflowSkippedPhaseIds ?? (changesWorkflow ? [] : task.workflowSkippedPhaseIds), input.needsContentRevision);
    const omissionCandidate = { ...task, workflowSnapshot: omissionWorkflow, workflowSkippedPhaseIds: requestedSkippedIds,
      workflowNodeAssigneeIds: nodeOwners, workflowNodeAIAssigneeIds: input.workflowNodeAIAssigneeIds ?? task.workflowNodeAIAssigneeIds,
      workflowNodeVoiceOverDeliveryOwnerIds: deliveryOwners, contentRevisionAssigneeIds: input.contentRevisionAssigneeIds ?? task.contentRevisionAssigneeIds };
    const omissionCheck = changesWorkflow
      ? validateWorkflowOmissionSelection(omissionCandidate, requestedSkippedIds, currentUser, appSettings, userList)
      : reconcileWorkflowOmissions(task, omissionCandidate, currentUser, appSettings, userList);
    if (!omissionCheck.ok) return { ok: false, message: omissionCheck.message };

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
    const workflow = changesWorkflow ? selection!.workflow! : task.workflowSnapshot!;

    const updatedTask = (() => {
      const t = task;
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
      const baseTask: Task = {
        ...t,
        name: input.name.trim(),
        description: input.description.trim() || null,
        taskType: selection?.taskType || t.taskType,
        workflowId: workflow?.id || null,
        workflowSnapshot: t.workflowSnapshot && workflow?.id === t.workflowSnapshot.id ? t.workflowSnapshot : (typeChanged && workflow ? cloneWorkflow(workflow) : t.workflowSnapshot),
        workflowCurrentPhaseId: typeChanged ? null : (t.workflowSnapshot && workflow?.id === t.workflowSnapshot.id ? t.workflowCurrentPhaseId : null),
        workflowCurrentPhaseIndex: typeChanged ? null : (t.workflowSnapshot && workflow?.id === t.workflowSnapshot.id ? t.workflowCurrentPhaseIndex : null),
        workflowPhaseApprovals: typeChanged ? {} : (t.workflowSnapshot && workflow?.id === t.workflowSnapshot.id ? t.workflowPhaseApprovals : {}),
        reviewMode: getEffectiveReviewMode((input.taskType as TaskType) || t.taskType, isContentCreatorTask, t.reviewMode),
        handledBy,
        currentOwnerRole: isAlreadyUploaded ? t.currentOwnerRole : 'team_member',
        currentOwnerUserId: isAlreadyUploaded ? t.currentOwnerUserId : (handledBy[0] || null),
        currentOwnerUserIds: isAlreadyUploaded ? t.currentOwnerUserIds : handledBy,
        priority: input.priority,
        deadlineText: formatDeadlineText(input.deadlineAt),
        assignmentPeriod,
        assignmentLinks: normalizedLinks,
        assignmentDate: input.assignmentDate || null,
        workflowNodeAssigneeIds: nodeOwners || {},
        workflowNodeAIAssigneeIds: input.workflowNodeAIAssigneeIds || {},
        workflowNodeVoiceOverDeliveryOwnerIds: deliveryOwners || {},
        workflowFinalApproverIdsByPhaseId: frozenFinalApproverIdsByPhaseId,
        workContributorIds: input.workContributorIds ?? t.workContributorIds,
        workflowSkippedPhaseIds: requestedSkippedIds,
        deadlineAt: input.deadlineAt || null,
        isOvertime: input.isOvertime || false,
        needsContentRevision: input.needsContentRevision ?? t.needsContentRevision,
        contentRevisionAssigneeIds: input.needsContentRevision === false ? [] : (input.contentRevisionAssigneeIds ?? t.contentRevisionAssigneeIds ?? []),
        isTemporarySelfTask: input.isTemporarySelfTask || false,
        selfAssignedBy: t.selfAssignedBy || (t.createdBy === currentUser.id ? currentUser.id : null),
        submittedOnBehalfOfIds: input.submittedOnBehalfOfIds || t.submittedOnBehalfOfIds || [],
        updatedAt: now,
      };
      const shouldRestartWorkflow = Boolean(workflow && (typeChanged || !t.workflowSnapshot));
      let routedTask = shouldRestartWorkflow && workflow
        ? initializeTaskWorkflow({
            ...baseTask,
            workflowId: workflow.id,
            workflowSnapshot: null,
            workflowCurrentPhaseId: null,
            workflowCurrentPhaseIndex: null,
            workflowActivePhaseIds: [],
            workflowPhaseApprovals: {},
            workflowPhaseHistory: [...(t.workflowPhaseHistory || []), ...workflow.phases.map(phase => ({
              phaseId: phase.id, phaseName: phase.name, action: 'invalidated' as const, actorId: currentUser.id, createdAt: now,
              note: `Workflow changed to ${workflow.name}.`,
            }))],
          }, workflow.id, undefined, currentUser.id)
        : baseTask;
      if (!shouldRestartWorkflow) {
        const omission = reconcileWorkflowOmissions(t, routedTask, currentUser, appSettings, userList);
        routedTask = omission.task || routedTask;
      }
      const routedPhase = getWorkflowPhase(routedTask);
      const suspended = routedTask.status === 'on_hold' || RETURNED_STATUSES.includes(routedTask.status);
      const routedOwners = routedPhase && !suspended
        ? uniqueIds((routedTask.workflowActivePhaseIds || [routedPhase.id]).flatMap(id => {
            const phase = routedTask.workflowSnapshot?.phases.find(phase => phase.id === id);
            return phase ? getActiveWorkflowOwnerIds(routedTask, phase, routedTask.workflowPhaseApprovals?.[id] || []) : [];
          }))
        : routedTask.currentOwnerUserIds;
      return addAuditComment({
        ...routedTask,
        currentOwnerRole: routedPhase && !suspended ? getPhaseOwnerRole(routedPhase) : routedTask.currentOwnerRole,
        currentOwnerUserId: routedOwners[0] || null,
        currentOwnerUserIds: routedOwners,
      }, currentUser.id, 'work_assignment_updated', message, now);
    })();
    commitWorkflowTask(updatedTask);
    notifyWorkflowHandoffs(task, updatedTask);
    return { ok: true };
  };

  const deleteWorkAssignment = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !canDeleteWorkAssignment(task, currentUser) || !canDeleteTask(task, currentUser, appSettings, userList)) return;
    pendingDeletedTaskIdsRef.current.add(taskId);
    queueTaskBroadcast(taskId);

    setTasks(prev => prev.filter(t => t.id !== taskId));
    setNotifications(prev => prev.filter(notification => notification.taskId !== taskId));
    if (isDriveWorkspaceReady) {
      deleteDriveTask(taskId).catch(error => console.error('Failed to delete assigned task from Drive', error));
    }
  };

  const updateTaskContentRevisionAssignees = (taskId: string, assigneeIds: string[]) => {
    if (!canMutateTask(taskId)) return ;
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

  const submitWorkAssignmentUpload = (taskId: string, payload: WorkAssignmentUploadPayload): boolean => {
    if (!canMutateTask(taskId)) return false;
    const task = workflowTasksRef.current.find(item => item.id === taskId);
    if (!task || payload.version.submittedBy !== currentUser.id || task.versions.some(version => version.id === payload.version.id)
      || CLOSED_STATUSES.includes(task.status) || task.status === 'on_hold' || isTaskArchived(task)) return false;
    const workflow = task.workflowSnapshot;
    const ownedWorkPhase = workflow?.phases.find(phase => (
      (!payload.phaseId || phase.id === payload.phaseId)
      && (task.workflowActivePhaseIds || []).includes(phase.id)
      && (phase.phaseKind === 'work' || getStatusForWorkflowPhase(phase) === 'assigned_work')
      && getActiveWorkflowOwnerIds(task, phase, task.workflowPhaseApprovals?.[phase.id] || []).includes(currentUser.id)
    ));
    if (workflow ? !ownedWorkPhase : task.status !== 'assigned_work' || !task.handledBy.includes(currentUser.id)) return false;
    const now = new Date().toISOString();
    const uploaded: Task = {
      ...task,
      versions: [payload.version, ...task.versions],
      thumbnailUrl: payload.thumbnailUrl || task.thumbnailUrl,
      thumbnailStoragePath: payload.thumbnailStoragePath || task.thumbnailStoragePath,
      driveFolderId: payload.driveFolderId || task.driveFolderId,
      assignmentUploadedAt: now,
      updatedAt: now,
    };
    let updated: Task;
    if (workflow && ownedWorkPhase) {
      updated = advanceWorkflowAfterApproval(uploaded, currentUser.id, ownedWorkPhase.id);
      if (updated === uploaded) return false;
    } else {
      const target = getReviewRouteTarget(payload.reviewMode || task.reviewMode);
      const nextOwners = getDefaultOwnerIdsForRole(target.ownerRole, task);
      updated = initializeTaskWorkflow({ ...uploaded, status: target.status, currentOwnerRole: target.ownerRole, currentOwnerUserId: nextOwners[0] || null, currentOwnerUserIds: nextOwners }, payload.workflowId || task.workflowId);
    }
    const audited = addAuditComment(updated, currentUser.id, 'work_assignment_uploaded', `${ownedWorkPhase?.name || 'Assigned work'} delivered and routed to the next configured step.`, now);
    commitWorkflowTask(audited);
    if (audited.workflowSnapshot) notifyWorkflowHandoffs(task, audited);
    else addNotifications(getCurrentOwnerUserIds(audited), task.id, `You are now responsible for "${task.name}".`);
    return true;
  };

  const addTask = (task: Task): boolean => {
    if (workflowTasksRef.current.some(item => item.id === task.id)) return false;
    const selection = resolveWorkflowAssignment(appSettingsRef.current, task.taskType, task.workflowId);
    if (!selection.ok || !selection.workflow) { setPersistenceError(selection.message || 'This workflow cannot be assigned.'); return false; }
    const workflow = selection.workflow;
    const taskForCreation: Task = {
      ...task,
      taskType: selection.taskType!,
      workflowId: workflow.id,
      workflowSnapshot: cloneWorkflow(workflow),
      workflowSkippedPhaseIds: applyContentReviewChoice(workflow, task.workflowSkippedPhaseIds, task.needsContentRevision),
    };
    const omissions = validateWorkflowOmissionSelection(taskForCreation, taskForCreation.workflowSkippedPhaseIds || [], currentUser, appSettings, userList);
    if (!omissions.ok) { setPersistenceError(omissions.message || 'Only workflow managers can remove steps.'); return false; }
    const owners = prepareWorkflowAssignmentOwners(workflow, taskForCreation, appSettingsRef.current, userList,
      task.workContributorIds ?? (task.handledBy.length ? task.handledBy : [task.createdBy]));
    if (!owners.ok) { setPersistenceError(owners.message || 'Assign every required workflow step before creating the task.'); return false; }
    taskForCreation.workflowNodeAssigneeIds = owners.workflowNodeAssigneeIds;
    taskForCreation.workflowNodeVoiceOverDeliveryOwnerIds = owners.workflowNodeVoiceOverDeliveryOwnerIds;
    taskForCreation.workflowFinalApproverIdsByPhaseId = owners.workflowFinalApproverIdsByPhaseId;
    taskForCreation.workContributorIds = task.workContributorIds ?? (task.handledBy.length ? task.handledBy : [task.createdBy]);
    const initialized = initializeTaskWorkflow(taskForCreation, workflow.id, undefined, task.createdBy);
    const normalized = normalizeReviewerCreatedTask(initialized, usersObj);
    const ownerIds = normalized.workflowSnapshot ? getCurrentOwnerUserIds(normalized)
      : uniqueIds([...getCurrentOwnerUserIds(normalized), ...getDefaultOwnerIdsForRole(normalized.currentOwnerRole, normalized)]);
    const updated = { ...normalized, currentOwnerUserId: ownerIds[0] || null, currentOwnerUserIds: ownerIds };
    workflowTasksRef.current = [updated, ...workflowTasksRef.current];
    queueTaskBroadcast(updated.id);
    setTasks(previous => previous.some(item => item.id === updated.id) ? previous : [updated, ...previous]);
    if (updated.workflowSnapshot) notifyWorkflowHandoffs(null, updated);
    else addNotifications(ownerIds, updated.id, `You are now responsible for "${updated.name}".`);
    return true;
  };

  const addTaskVersion = (taskId: string, version: TaskVersion, phaseId?: string): boolean => {
    if (!canMutateTask(taskId)) return false;
    const task = workflowTasksRef.current.find(item => item.id === taskId);
    if (!task || version.submittedBy !== currentUser.id || task.versions.some(item => item.id === version.id)
      || CLOSED_STATUSES.includes(task.status) || task.status === 'on_hold' || isTaskArchived(task)) return false;
    const thumbnailFile = version.files?.find(file => file.previewUrl || file.type.startsWith('image/'));
    const uploaded = { ...task, versions: [version, ...task.versions], thumbnailUrl: thumbnailFile?.previewUrl || task.thumbnailUrl,
      thumbnailStoragePath: thumbnailFile?.previewStoragePath || task.thumbnailStoragePath, updatedAt: new Date().toISOString() };
    let updated: Task;
    let reopenedPhaseIds: string[] | undefined;
    if (task.workflowSnapshot) {
      const workflow = task.workflowSnapshot;
      if (RETURNED_STATUSES.includes(task.status) && getCurrentOwnerUserIds(task).includes(currentUser.id)) {
        const reviewPhase = workflow.phases.find(phase => phase.id === task.workflowCurrentPhaseId);
        if (!reviewPhase) return false;
        reopenedPhaseIds = [reviewPhase.id];
        updated = buildTaskWithWorkflowPhases({ ...uploaded, status: getStatusForWorkflowPhase(reviewPhase) }, workflow, task.workflowActivePhaseIds || reopenedPhaseIds, task.workflowPhaseApprovals || {}, task.workflowPhaseHistory || [], currentUser.id);
      } else {
        const workPhase = workflow.phases.find(phase => (
          (!phaseId || phase.id === phaseId)
          && (task.workflowActivePhaseIds || []).includes(phase.id)
          && (phase.phaseKind === 'work' || phase.phaseKind === 'content_review' || getStatusForWorkflowPhase(phase) === 'assigned_work')
          && getActiveWorkflowOwnerIds(task, phase, task.workflowPhaseApprovals?.[phase.id] || []).includes(currentUser.id)
        ));
        if (!workPhase) return false;
        updated = advanceWorkflowAfterApproval(uploaded, currentUser.id, workPhase.id);
        if (updated === uploaded) return false;
      }
    } else {
      if (!task.handledBy.includes(currentUser.id) && task.createdBy !== currentUser.id) return false;
      const target = getReviewRouteTarget(task.status === 'changes_requested_by_art_director' ? 'final_review' : task.reviewMode);
      const owners = getDefaultOwnerIdsForRole(target.ownerRole, task);
      updated = { ...uploaded, status: target.status, currentOwnerRole: target.ownerRole, currentOwnerUserId: owners[0] || null, currentOwnerUserIds: owners };
    }
    const audited = addAuditComment(updated, currentUser.id, 'version_added', `Version ${version.versionNumber} submitted for the configured workflow.`);
    commitWorkflowTask(audited);
    if (audited.workflowSnapshot) notifyWorkflowHandoffs(task, audited, reopenedPhaseIds);
    else addNotifications(getCurrentOwnerUserIds(audited), taskId, `You are now responsible for "${task.name}".`);
    return true;
  };

  const replaceTaskVersionFiles = (taskId: string, versionId: string, files: UploadedTaskFile[]) => {
    if (!canMutateTask(taskId)) return ;
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
    if (!canMutateTask(taskId)) return ;
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
    if (!canMutateTask(taskId)) return ;
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
        const isWorkflowTransitionComment = ['request_edits', 'marwa_rejection', 'sent_to_marwa', 'content_approved', 'content_rejected'].includes(comment.action || '');
        const recipients = uniqueIds(task.workflowSnapshot
          ? (isWorkflowTransitionComment ? [] : getCurrentOwnerUserIds(task))
          : [
          task.createdBy,
          ...task.handledBy,
          ...(task.contentRevisionAssigneeIds || []),
          ...seniorIds,
          ...teamLeaderIds,
          ...reviewerIds,
          ...artDirectorIds,
        ]).filter(userId => userId && userId !== currentUser.id);
        const dedupedRecipients = recipients.filter(userId => !(options?.skipNotificationUserIds || []).includes(userId)
          && userList.some(user => user.id === userId && canViewTask(task, user, appSettings, userList)));
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
    if (!canMutateTask(taskId)) return ;
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
    if (!canMutateTask(taskId)) return ;
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
      accountProfiles: accountProfiles.filter(profile => !isMemberDeleted(profile, appSettings.deletedMembers)),
      customResponsibilities,
      appSettings: resolveAppSettingsWithRealIds(appSettings, userList),
      canManageSettings,
      environment,
      tasks: tasks.filter(task => canViewTask(task, currentUser, appSettings, userList)),
      users: { ...Object.fromEntries((appSettings.deletedMembers || []).map(record => [record.id, { id: record.id, name: record.name, role: record.role || 'team_member', jobTitle: record.jobTitle }])), ...usersObj },
      userList,
      notifications: projectDeadlineNotifications(projectReportNotifications(projectTaskNotifications(USE_NEON_DATA ? notifications : filterLocallyResetNotifications(notifications), tasks, currentUser, appSettings, userList), dailyReports, currentUser, appSettings, userList), tasks, currentUser, appSettings, userList),
      persistenceMode: isNeonWorkspaceActive ? 'neon' : isDriveWorkspaceActive ? 'drive' : 'local',
      persistenceError,
      localMigrationCount: (localMigrationState?.tasks.length || 0) + (localMigrationState?.notifications.length || 0),
      isMigratingLocalData,
      dailyReports: dailyReports.filter(report => canViewDailyReport(report, currentUser, appSettings, userList)),
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
      updateWorkflowPhaseAssignees,
      updateTaskReviewMode,
      updateTaskActiveWork,
      applyTaskWorkflow,
      approveWorkflowPhase,
      rejectWorkflowPhase,
      skipWorkflowPhase,
      setWorkflowPhaseOmitted,
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
