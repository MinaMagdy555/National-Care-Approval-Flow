import { AHMED_SOBEEH_ID, DINA_ID, FAWZY_ID, MARWA_ID, MINA_ID, defaultAppSettings, getPriorityWeightFromSettings, isAssignableHandlerWithSettings } from './appSettings';
import { AppSettings, AssignmentPeriod, Priority, Task, User } from './types';

export const LEADERBOARD_USER_IDS: readonly string[] = [MINA_ID, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID];

export function isLeaderboardUser(userId: string) {
  return LEADERBOARD_USER_IDS.includes(userId);
}

export function canSetActiveWorkForMember(actor: Pick<User, 'id' | 'role' | 'isAdmin'>) {
  if (actor.isAdmin || actor.role === 'admin') return true;
  if (isLeaderboardUser(actor.id)) return true;
  if (actor.role === 'team_leader') return true;
  return false;
}

export function canCreateWorkAssignment(user: Pick<User, 'id' | 'role' | 'name' | 'isAdmin'>, _settings?: AppSettings) {
  return user.id !== 'guest';
}

export function canManageWorkAssignment(task: Task, user: Pick<User, 'id' | 'role' | 'name' | 'isAdmin'>, settings: AppSettings = defaultAppSettings) {
  const isFinished = ['approved_by_art_director', 'completed', 'archived'].includes(task.status);
  return !isFinished && (isLeaderboardUser(user.id) || task.createdBy === user.id);
}

export function canDeleteWorkAssignment(task: Task, user: Pick<User, 'id'>) {
  const isFinished = ['approved_by_art_director', 'completed', 'archived'].includes(task.status);
  return !isFinished && task.createdBy === user.id;
}

export function canUploadWorkAssignment(task: Task, user: Pick<User, 'id' | 'isAdmin'>) {
  if (task.status !== 'assigned_work') return false;
  return task.handledBy.includes(user.id);
}

export function isWorkAssignmentTask(task: Pick<Task, 'assignmentPeriod' | 'assignmentDate' | 'deadlineAt'>) {
  return Boolean(task.assignmentPeriod || task.assignmentDate || task.deadlineAt);
}

export function isPastWorkDate(dateValue?: string | null, nowValue = new Date()) {
  if (!dateValue) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return false;
  const today = `${nowValue.getFullYear()}-${String(nowValue.getMonth() + 1).padStart(2, '0')}-${String(nowValue.getDate()).padStart(2, '0')}`;
  return dateValue < today;
}

const TASK_EDIT_DIFF_FIELDS: Array<{ key: keyof Task; label: string; workflowAffecting?: boolean }> = [
  { key: 'name', label: 'name' },
  { key: 'description', label: 'description' },
  { key: 'taskType', label: 'task type', workflowAffecting: true },
  { key: 'priority', label: 'priority' },
  { key: 'assignmentDate', label: 'work date' },
  { key: 'deadlineAt', label: 'deadline' },
  { key: 'handledBy', label: 'assignees' },
  { key: 'reviewMode', label: 'review mode', workflowAffecting: true },
];

export function buildTaskEditDiff(
  oldTask: Pick<Task, 'name' | 'description' | 'taskType' | 'priority' | 'assignmentDate' | 'deadlineAt' | 'handledBy' | 'reviewMode'>,
  updates: Partial<Pick<Task, 'name' | 'description' | 'taskType' | 'priority' | 'assignmentDate' | 'deadlineAt' | 'handledBy' | 'reviewMode'>>
): string[] {
  const diffs: string[] = [];
  TASK_EDIT_DIFF_FIELDS.forEach(field => {
    if (!(field.key in updates)) return;
    const oldValue = oldTask[field.key];
    const newValue = updates[field.key];
    const oldString = Array.isArray(oldValue) ? (oldValue as string[]).join(', ') : (oldValue ?? '');
    const newString = Array.isArray(newValue) ? (newValue as string[]).join(', ') : (newValue ?? '');
    if (oldString === newString) return;
    diffs.push(`${field.label}: ${oldString || 'unset'} -> ${newString || 'unset'}`);
  });
  return diffs;
}

export function isWorkAssignmentAssignee(user: Pick<User, 'id'>, assignerId?: string, settings: AppSettings = defaultAppSettings) {
  return isAssignableHandlerWithSettings(settings, user.id, assignerId);
}

export function getAssignmentPeriodLabel(period?: AssignmentPeriod | null) {
  if (period === 'day') return 'Day';
  if (period === 'week') return 'Week';
  if (period === 'month') return 'Month';
  return 'Assign a Task';
}

export function getPriorityWeight(priority: Priority, settings: AppSettings = defaultAppSettings) {
  return getPriorityWeightFromSettings(settings, priority);
}

export function getDeadlineTime(value?: string | null) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function getDateKey(value?: string | null) {
  if (!value) return '9999-12-31';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '9999-12-31';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

export function isDeadlineNear(task: Pick<Task, 'deadlineAt' | 'status'>, nowValue = new Date()) {
  if (!task.deadlineAt) return false;
  if (['approved_by_art_director', 'completed', 'archived'].includes(task.status)) return false;
  const deadline = new Date(task.deadlineAt);
  if (Number.isNaN(deadline.getTime())) return false;
  const now = nowValue.getTime();
  const diff = deadline.getTime() - now;
  return diff >= 0 && diff <= 2 * 24 * 60 * 60 * 1000;
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

    const todayKey = getDateKey(new Date().toISOString());
    const aWorkDate = getDateKey(a.assignmentDate || a.createdAt);
    const bWorkDate = getDateKey(b.assignmentDate || b.createdAt);
    const aOverdue = !aUploaded && aWorkDate < todayKey;
    const bOverdue = !bUploaded && bWorkDate < todayKey;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

    const assignmentDateDiff = aWorkDate.localeCompare(bWorkDate);
    if (assignmentDateDiff !== 0) return assignmentDateDiff;

    const priorityDiff = getPriorityWeight(a.priority, settings) - getPriorityWeight(b.priority, settings);
    if (priorityDiff !== 0) return priorityDiff;

    const deadlineDiff = getDeadlineTime(a.deadlineAt) - getDeadlineTime(b.deadlineAt);
    if (deadlineDiff !== 0) return deadlineDiff;

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}
