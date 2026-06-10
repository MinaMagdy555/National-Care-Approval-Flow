import { AppSettings, ReviewMode, Role, Task, TaskStatus, User } from './types';
import { isTaskArchived } from './archiveUtils';

export const REVIEWER_WAITING_STATUSES: TaskStatus[] = ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'];
export const ART_DIRECTOR_WAITING_STATUSES: TaskStatus[] = ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'];
export const RETURNED_STATUSES: TaskStatus[] = ['changes_requested_by_reviewer', 'changes_requested_by_art_director', 'changes_requested_by_content'];
export const CLOSED_STATUSES: TaskStatus[] = ['approved_by_art_director', 'completed', 'archived'];

export function uniqueIds(ids: Array<string | null | undefined>) {
  return Array.from(new Set(ids.filter(Boolean) as string[]));
}

export function getCurrentOwnerUserIds(task: Pick<Task, 'currentOwnerUserIds' | 'currentOwnerUserId'>) {
  return uniqueIds([
    ...(Array.isArray(task.currentOwnerUserIds) ? task.currentOwnerUserIds : []),
    task.currentOwnerUserId,
  ]);
}

export function userCanViewFullWorkspace(user: Pick<User, 'id' | 'role' | 'isAdmin'>, settings?: AppSettings) {
  if (user.isAdmin || user.role === 'admin') return true;
  if (settings && settings.viewAllWorkloadUserIds?.includes(user.id)) return true;
  if (!settings || !settings.viewAllWorkloadUserIds) {
    return ['reviewer', 'art_director', 'team_leader', 'manager', 'developer', 'marketing_manager'].includes(user.role);
  }
  return false;
}

export function canUserAccessTask(task: Task, user: Pick<User, 'id' | 'role' | 'isAdmin'>, settings?: AppSettings) {
  if (userCanViewFullWorkspace(user, settings)) return true;
  return task.createdBy === user.id || task.handledBy.includes(user.id) || getCurrentOwnerUserIds(task).includes(user.id);
}

export function canManageWorkflow(user: Pick<User, 'id' | 'role' | 'isAdmin'>, settings?: AppSettings) {
  if (user.isAdmin || user.role === 'admin') return true;
  if (settings && (settings.firstReviewerUserIds?.includes(user.id) || settings.finalReviewerUserIds?.includes(user.id))) return true;
  if (!settings) {
    return ['reviewer', 'art_director', 'team_leader'].includes(user.role);
  }
  return false;
}

export function canUserActAsCurrentOwner(task: Task, user: Pick<User, 'id'>) {
  const ownerIds = getCurrentOwnerUserIds(task);
  return ownerIds.length === 0 || ownerIds.includes(user.id);
}

export function getReviewRouteTarget(mode: ReviewMode): { status: TaskStatus; ownerRole: Role } {
  if (mode === 'quick_look') {
    return { status: 'waiting_reviewer_quick_look', ownerRole: 'reviewer' };
  }

  if (mode === 'direct_to_ad') {
    return { status: 'sent_to_art_director', ownerRole: 'art_director' };
  }

  return { status: 'waiting_reviewer_full_review', ownerRole: 'reviewer' };
}

export function canReviewRouteUpdateStatus(task: Task) {
  return !isTaskArchived(task) && !CLOSED_STATUSES.includes(task.status) && !RETURNED_STATUSES.includes(task.status);
}

export function getTaskParticipantIds(task: Task, teamLeaderIds: string[] = []) {
  return uniqueIds([
    task.createdBy,
    ...task.handledBy,
    ...getCurrentOwnerUserIds(task),
    ...teamLeaderIds,
  ]);
}

export function parsePublishDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isScheduledCampaign(task: Task) {
  return task.taskType === 'campaign' && Boolean(task.scheduledPublishAt);
}
