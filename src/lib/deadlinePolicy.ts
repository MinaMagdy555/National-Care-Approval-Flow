import type { AppSettings, Notification, Task, User } from './types.js';
import { isMemberDeleted } from './memberIdentity.js';
import { getReportSeniorId, isReportLeader } from './reportPolicy.js';
import { CLOSED_STATUSES, RETURNED_STATUSES, getCurrentOwnerUserIds, getPhaseAssignableOwnerIds, isPhaseAvailable, uniqueIds } from './workflowUtils.js';

const HOUR = 60 * 60 * 1000;
const cairo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function formatDeadlineInput(value: Date): string {
  if (!Number.isFinite(value.getTime())) return '';
  const parts = Object.fromEntries(cairo.formatToParts(value).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Datetime-local inputs have an explicit workspace timezone, independent of server/browser TZ. */
export function parseDeadlineInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value) return null;
  let instant = wall;
  for (let attempt = 0; attempt < 4; attempt++) {
    const shown = Date.parse(`${formatDeadlineInput(new Date(instant))}:00Z`);
    instant += wall - shown;
  }
  const result = new Date(instant);
  // Reject nonexistent wall times at the daylight-saving transition.
  return formatDeadlineInput(result) === value ? result : null;
}

export function getTaskDeadlineAt(task: Pick<Task, 'deadlineAt' | 'deadlineText'>): Date | null {
  const value = (task.deadlineAt || task.deadlineText || '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    const fields = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/i)!;
    const datePart = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(datePart.getTime()) || datePart.toISOString().slice(0, 10) !== value.slice(0, 10)
      || Number(fields[4]) > 23 || Number(fields[5]) > 59 || Number(fields[6] || 0) > 59) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseDeadlineInput(`${value}T23:59`);
  return parseDeadlineInput(value);
}

export function isTaskDeadlineOpen(task: Task): boolean {
  return !task.archivedAt && !CLOSED_STATUSES.includes(task.status);
}

export function getDeadlineOwnerIds(task: Task, settings: AppSettings, users: User[], now = new Date()): string[] {
  if (!isTaskDeadlineOpen(task)) return [];
  let ids: string[];
  if (RETURNED_STATUSES.includes(task.status) || !task.workflowSnapshot) {
    ids = isPhaseAvailable(task, now) ? getCurrentOwnerUserIds(task) : [];
  } else {
    const active = task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
    ids = task.workflowSnapshot.phases.filter(phase => active.includes(phase.id)).flatMap(phase =>
      getPhaseAssignableOwnerIds(task, phase, settings, users, task.workflowPhaseApprovals?.[phase.id] || [], now));
  }
  return uniqueIds(ids).filter(id => users.some(user => user.id === id && id !== 'guest' && !isMemberDeleted(user, settings.deletedMembers)));
}

export function canViewTaskDeadline(task: Task, user: User, settings: AppSettings, users: User[], now = new Date()): boolean {
  if (!isTaskDeadlineOpen(task) || !user?.id || user.id === 'guest' || isMemberDeleted(user, settings.deletedMembers)) return false;
  if (isReportLeader(user)) return true;
  const owners = getDeadlineOwnerIds(task, settings, users, now);
  if (owners.includes(user.id)) return true;
  return owners.some(id => {
    const owner = users.find(user => user.id === id);
    return Boolean(owner && getReportSeniorId(owner, settings, users) === user.id);
  });
}

export function isDeadlineNotification(notification: Partial<Notification>): boolean {
  return Boolean(notification.deadlineReminder || notification.id?.startsWith('deadline:') || /^Deadline reminder:/i.test(notification.message || ''));
}

export function projectDeadlineNotifications(notifications: Notification[], tasks: Task[], viewer: User, settings: AppSettings, users: User[], now = new Date()): Notification[] {
  return notifications.filter(notification => {
    if (!isDeadlineNotification(notification)) return true;
    const task = tasks.find(task => task.id === notification.taskId);
    return Boolean(notification.deadlineReminder && notification.userId === viewer.id && task
      && getTaskDeadlineAt(task)?.toISOString() === notification.deadlineReminder.deadlineAt
      && canViewTaskDeadline(task, viewer, settings, users, now));
  });
}

export function planDeadlineReminders(tasks: Task[], settings: AppSettings, users: User[], now = new Date()): { tasks: Task[]; notifications: Notification[] } {
  const notifications: Notification[] = [];
  const nextTasks = tasks.map(task => {
    const deadline = getTaskDeadlineAt(task);
    if (!isTaskDeadlineOpen(task) || !deadline) return task;
    const remaining = deadline.getTime() - now.getTime();
    if (remaining <= 0 || remaining > 24 * HOUR) return task;
    const hours = remaining <= HOUR ? 1 : 24;
    const deadlineAt = deadline.toISOString();
    const sentAt = now.toISOString();
    const receipts = { ...(task.deadlineReminderReceipts || {}) };
    let changed = false;
    for (const user of users) {
      if (!canViewTaskDeadline(task, user, settings, users, now)) continue;
      const id = `deadline:${encodeURIComponent(task.id)}:${deadlineAt}:${hours}:${encodeURIComponent(user.id)}`;
      if (receipts[id]) continue;
      receipts[id] = sentAt;
      changed = true;
      notifications.push({ id, taskId: task.id, userId: user.id, read: false, createdAt: sentAt,
        deadlineReminder: { deadlineAt, hours }, message: `Deadline reminder: "${task.name}" is due within ${hours === 1 ? '1 hour' : '24 hours'} (${formatDeadlineInput(deadline).replace('T', ' ')} Cairo time).` });
    }
    return changed ? { ...task, deadlineReminderReceipts: receipts } : task;
  });
  return { tasks: nextTasks, notifications };
}

/** Client echoes cannot erase server receipts or overwrite/forge scheduler notices. */
export function preserveDeadlineState(existingTasks: Task[], incomingTasks: Task[], existingNotifications: Notification[], incomingNotifications: Notification[], actor: User) {
  const tasks = incomingTasks.map(task => {
    const prior = existingTasks.find(item => item.id === task.id);
    return { ...task, deadlineReminderReceipts: prior?.deadlineReminderReceipts || {} };
  });
  const notifications = [...incomingNotifications.filter(item => !isDeadlineNotification(item)), ...existingNotifications.filter(isDeadlineNotification).map(item => {
    const incoming = incomingNotifications.find(candidate => candidate.id === item.id);
    return incoming && item.userId === actor.id ? { ...item, read: Boolean(incoming.read) } : item;
  })];
  return { tasks, notifications };
}
