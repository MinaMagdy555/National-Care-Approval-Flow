import { Task } from './types';
import { isTaskArchived } from './archiveUtils';

const CLOSED_STATUSES = new Set(['approved_by_art_director', 'completed', 'archived']);
const WEEKDAY_INDEXES: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function startOfDay(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function endOfDay(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(23, 59, 59, 999);
  return normalized;
}

function addDays(date: Date, days: number) {
  const normalized = new Date(date);
  normalized.setDate(normalized.getDate() + days);
  return normalized;
}

function endOfWeek(date: Date) {
  const normalized = endOfDay(date);
  normalized.setDate(normalized.getDate() + (6 - normalized.getDay()));
  return normalized;
}

function parseDeadlineDate(deadlineText: string | null, today = new Date()): Date | null {
  const text = deadlineText?.trim();
  if (!text) return null;

  const lowerText = text.toLowerCase();
  if (/\btoday\b/.test(lowerText)) return today;
  if (/\btomorrow\b/.test(lowerText)) return addDays(today, 1);

  const weekday = Object.keys(WEEKDAY_INDEXES).find(day => new RegExp(`\\b${day}\\b`).test(lowerText));
  if (weekday) {
    const daysUntilWeekday = (WEEKDAY_INDEXES[weekday] - today.getDay() + 7) % 7;
    return addDays(today, daysUntilWeekday);
  }

  const isoDateMatch = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoDateMatch) {
    const parsed = new Date(`${isoDateMatch[0]}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isOpenTask(task: Task) {
  return !CLOSED_STATUSES.has(task.status) && !isTaskArchived(task);
}

export function isDueToday(task: Task, today = new Date()) {
  const deadline = parseDeadlineDate(task.deadlineText, today);
  if (!deadline || !isOpenTask(task)) return false;
  return deadline >= startOfDay(today) && deadline <= endOfDay(today);
}

export function isDueThisWeek(task: Task, today = new Date()) {
  const deadline = parseDeadlineDate(task.deadlineText, today);
  if (!deadline || !isOpenTask(task)) return false;
  return deadline >= startOfDay(today) && deadline <= endOfWeek(today);
}
