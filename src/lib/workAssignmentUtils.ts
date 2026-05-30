import { AHMED_SOBEEH_ID, DINA_ID, FAWZY_ID, MARWA_ID, isAssignableHandler } from './handlerUtils';
import { AssignmentPeriod, Priority, Task, User } from './types';

export const WORK_ASSIGNMENT_CREATOR_IDS = [DINA_ID, MARWA_ID, AHMED_SOBEEH_ID, FAWZY_ID];
export function canCreateWorkAssignment(user: Pick<User, 'id' | 'isAdmin'>) {
  return WORK_ASSIGNMENT_CREATOR_IDS.includes(user.id);
}

export function canManageWorkAssignment(task: Task, user: Pick<User, 'id' | 'isAdmin'>) {
  return task.status === 'assigned_work' && canCreateWorkAssignment(user);
}

export function canUploadWorkAssignment(task: Task, user: Pick<User, 'id' | 'isAdmin'>) {
  if (task.status !== 'assigned_work') return false;
  return Boolean(user.isAdmin) || task.createdBy === user.id || task.handledBy.includes(user.id);
}

export function isWorkAssignmentTask(task: Pick<Task, 'assignmentPeriod' | 'deadlineAt'>) {
  return Boolean(task.assignmentPeriod || task.deadlineAt);
}

export function isWorkAssignmentAssignee(user: Pick<User, 'id'>, assignerId?: string) {
  return isAssignableHandler(user.id, assignerId);
}

export function getAssignmentPeriodLabel(period?: AssignmentPeriod | null) {
  if (period === 'day') return 'Day';
  if (period === 'week') return 'Week';
  if (period === 'month') return 'Month';
  return 'Assigned Work';
}

export function getPriorityWeight(priority: Priority) {
  switch (priority) {
    case 'urgent': return 0;
    case 'high': return 1;
    case 'normal': return 2;
    case 'low': return 3;
    default: return 4;
  }
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

export function sortWorkAssignments(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    const aUploaded = Boolean(a.assignmentUploadedAt || a.status !== 'assigned_work');
    const bUploaded = Boolean(b.assignmentUploadedAt || b.status !== 'assigned_work');
    if (aUploaded !== bUploaded) return aUploaded ? 1 : -1;

    const deadlineDiff = getDeadlineTime(a.deadlineAt) - getDeadlineTime(b.deadlineAt);
    if (deadlineDiff !== 0) return deadlineDiff;

    const priorityDiff = getPriorityWeight(a.priority) - getPriorityWeight(b.priority);
    if (priorityDiff !== 0) return priorityDiff;

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}
