import type { AppSettings, Notification, Task, User } from './types';
import { getDeadlineOwnerIds } from './deadlinePolicy';
import { isMemberDeleted } from './memberIdentity';
import { getReportSeniorId, isReportLeader } from './reportPolicy';
import { canManageWorkflowBuilder, CLOSED_STATUSES } from './workflowUtils';
import { canManageWorkAssignment } from './workAssignmentUtils';

export function hasTaskWorkHistory(task: Task, userId: string): boolean {
  if (!userId || userId === 'guest') return false;
  return Boolean(task.workSessions?.some(session => session.userId === userId && session.startedAt)
    || task.workflowPhaseHistory?.some(entry => entry.actorId === userId && ['approved', 'completed', 'changes_requested'].includes(entry.action))
    || Object.values(task.workflowPhaseApprovals || {}).some(ids => ids.includes(userId))
    || task.versions?.some(version => version.submittedBy === userId && (version.fileUrl || version.files?.some(file => file.url || file.driveFileId || file.blob)))
    || (task.activeWorkBy === userId && task.activeWorkStartedAt));
}

export function canViewTask(task: Task, user: User, settings: AppSettings, users: User[], now = new Date()): boolean {
  if (!user?.id || user.id === 'guest' || isMemberDeleted(user, settings.deletedMembers)) return false;
  if (isReportLeader(user) || hasTaskWorkHistory(task, user.id)) return true;
  const owners = getDeadlineOwnerIds(task, settings, users, now);
  if (owners.includes(user.id)) return true;
  return owners.some(id => {
    const owner = users.find(candidate => candidate.id === id);
    return Boolean(owner && getReportSeniorId(owner, settings, users) === user.id);
  });
}

/** Viewing past work or supervising a member does not itself authorize mutations. */
export function canEditTask(task: Task, user: User, settings: AppSettings, users: User[], now = new Date()): boolean {
  if (!canViewTask(task, user, settings, users, now)) return false;
  return isReportLeader(user) || getDeadlineOwnerIds(task, settings, users, now).includes(user.id)
    || canManageWorkflowBuilder(user, settings) || canManageWorkAssignment(task, user, settings);
}

export function canDeleteTask(task: Task, user: User, settings: AppSettings, users: User[], now = new Date()): boolean {
  return canViewTask(task, user, settings, users, now) && (isReportLeader(user)
    || (task.createdBy === user.id && !CLOSED_STATUSES.includes(task.status)));
}

export function projectTaskNotifications(notifications: Notification[], tasks: Task[], user: User, settings: AppSettings, users: User[], now = new Date()): Notification[] {
  return notifications.filter(notification => {
    if (notification.dailyReportId || notification.taskId === 'daily-report') return true; // Separate report policy follows.
    const task = tasks.find(task => task.id === notification.taskId);
    if (!task) return !notification.taskId && notification.userId === user.id;
    return notification.userId === user.id && canViewTask(task, user, settings, users, now);
  });
}
