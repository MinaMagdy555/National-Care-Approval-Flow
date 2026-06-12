import { defaultAppSettings, getPriorityWeightFromSettings, isAssignableHandlerWithSettings } from './appSettings';
import { AppSettings, AssignmentPeriod, Priority, Task, User } from './types';

export function canCreateWorkAssignment(user: Pick<User, 'id' | 'role' | 'name' | 'isAdmin'>, settings: AppSettings = defaultAppSettings) {
  return settings.workAssignmentCreatorIds.includes(user.id);
}

export function canManageWorkAssignment(task: Task, user: Pick<User, 'id' | 'role' | 'name' | 'isAdmin'>, settings: AppSettings = defaultAppSettings) {
  const isFinished = ['approved_by_art_director', 'completed', 'archived'].includes(task.status);
  return !isFinished && canCreateWorkAssignment(user, settings);
}

export function canUploadWorkAssignment(task: Task, user: Pick<User, 'id' | 'isAdmin'>) {
  if (task.status !== 'assigned_work') return false;
  return task.handledBy.includes(user.id);
}

export function isWorkAssignmentTask(task: Pick<Task, 'assignmentPeriod' | 'deadlineAt'>) {
  return Boolean(task.assignmentPeriod || task.deadlineAt);
}

export function isWorkAssignmentAssignee(user: Pick<User, 'id'>, assignerId?: string, settings: AppSettings = defaultAppSettings) {
  return isAssignableHandlerWithSettings(settings, user.id, assignerId);
}

export function getAssignmentPeriodLabel(period?: AssignmentPeriod | null) {
  if (period === 'day') return 'Day';
  if (period === 'week') return 'Week';
  if (period === 'month') return 'Month';
  return 'Assigned Work';
}

export function getPriorityWeight(priority: Priority, settings: AppSettings = defaultAppSettings) {
  return getPriorityWeightFromSettings(settings, priority);
}

export function getDeadlineTime(value?: string | null) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function startOfDay(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function endOfWeek(date: Date) {
  const normalized = startOfDay(date);
  normalized.setDate(normalized.getDate() + (6 - normalized.getDay()));
  normalized.setHours(23, 59, 59, 999);
  return normalized;
}

export function getAssignmentPeriodFromDeadline(value: string, todayValue = new Date()): AssignmentPeriod {
  const deadline = new Date(value);
  const today = startOfDay(todayValue);
  if (Number.isNaN(deadline.getTime())) return 'month';

  if (deadline >= today && deadline < new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)) {
    return 'day';
  }

  if (deadline >= today && deadline <= endOfWeek(today)) {
    return 'week';
  }

  return 'month';
}

export function sortWorkAssignments(tasks: Task[], settings: AppSettings = defaultAppSettings) {
  return [...tasks].sort((a, b) => {
    const aUploaded = Boolean(a.assignmentUploadedAt || a.status !== 'assigned_work');
    const bUploaded = Boolean(b.assignmentUploadedAt || b.status !== 'assigned_work');
    if (aUploaded !== bUploaded) return aUploaded ? 1 : -1;

    const deadlineDiff = getDeadlineTime(a.deadlineAt) - getDeadlineTime(b.deadlineAt);
    if (deadlineDiff !== 0) return deadlineDiff;

    const priorityDiff = getPriorityWeight(a.priority, settings) - getPriorityWeight(b.priority, settings);
    if (priorityDiff !== 0) return priorityDiff;

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}
