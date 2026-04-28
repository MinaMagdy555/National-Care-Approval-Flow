import { Task } from './types';

const ARCHIVE_AFTER_DAYS = 90;

export function isTaskArchived(task: Task) {
  return Boolean(task.archivedAt || task.status === 'archived');
}

export function shouldAutoArchiveTask(task: Task, today = new Date()) {
  if (isTaskArchived(task)) return false;

  const updatedAt = new Date(task.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) return false;

  const ageMs = today.getTime() - updatedAt.getTime();
  return ageMs >= ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
