import type { AppSettings, DailyReportEntry, Task, User } from './types.js';
import { formatDeadlineInput, parseDeadlineInput } from './deadlinePolicy.js';
import { getTaskWorkSessions } from './workSessions.js';

export const cairoDate = (now = new Date()) => formatDeadlineInput(now).slice(0, 10);
export const cairoTime = (iso?: string | null) => iso && Number.isFinite(Date.parse(iso)) ? formatDeadlineInput(new Date(iso)).slice(11, 16) : '';

function dayStart(date: string) {
  // Cairo's spring change can skip midnight. Use the first real local minute.
  for (let hour = 0; hour < 4; hour++) {
    const parsed = parseDeadlineInput(`${date}T${String(hour).padStart(2, '0')}:00`);
    if (parsed) return parsed.getTime();
  }
  return NaN;
}

export function buildActualWorkEntries(tasks: Task[], userId: string, date: string, settings: AppSettings, users: User[], now = new Date()): DailyReportEntry[] {
  const following = new Date(`${date}T12:00:00Z`); following.setUTCDate(following.getUTCDate() + 1);
  if (!Number.isFinite(following.getTime())) return [];
  const from = dayStart(date), until = dayStart(following.toISOString().slice(0, 10));
  return tasks.filter(task => task.environment !== 'demo').flatMap(task => {
    const sessions = getTaskWorkSessions(task, settings, users).filter(s => s.userId === userId);
    const intervals = sessions.map(s => [Math.max(from, Date.parse(s.startedAt)), Math.min(until, now.getTime(), s.finishedAt ? Date.parse(s.finishedAt) : now.getTime())])
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start && start >= from && start < until).sort(([a], [b]) => a - b);
    const happenedToday = (iso: string) => Number.isFinite(Date.parse(iso)) && Date.parse(iso) <= now.getTime() && cairoDate(new Date(iso)) === date;
    const didAct = task.workflowPhaseHistory?.some(entry => entry.actorId === userId && ['approved', 'completed', 'changes_requested'].includes(entry.action) && happenedToday(entry.createdAt))
      || task.versions?.some(version => version.submittedBy === userId && (version.fileUrl || version.files?.some(file => file.url || file.driveFileId || file.blob)) && happenedToday(version.createdAt));
    if (!intervals.length && !didAct) return [];
    const merged: number[][] = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]); else merged.push([...interval]);
    }
    const active = sessions.some(s => !s.finishedAt && Date.parse(s.startedAt) < until && now.getTime() >= from && now.getTime() < until);
    const start = merged[0]?.[0], end = merged.at(-1)?.[1];
    return [{ taskId: task.id, title: task.name, taskCode: task.code, source: 'work' as const, taskStatus: task.status, workState: active ? 'active' as const : 'finished' as const,
      startTime: start !== undefined ? cairoTime(new Date(start).toISOString()) : null,
      endTime: !active && end !== undefined ? (end === until ? '24:00' : cairoTime(new Date(end).toISOString())) : null,
      durationMinutes: merged.length ? Math.round(merged.reduce((sum, [start, end]) => sum + end - start, 0) / 60000) : null }];
  });
}

export function mergeWorkReportEntries(actual: DailyReportEntry[], saved: DailyReportEntry[] = []): DailyReportEntry[] {
  const entries = new Map(actual.map(entry => [entry.taskId, entry]));
  for (const entry of saved) {
    const current = entries.get(entry.taskId);
    const merged = current && entry.source === 'work' && !entry.manuallyEdited ? { ...entry, ...current, note: entry.note } : { ...current, ...entry };
    entries.set(entry.taskId, current && entry.source === 'work' ? { ...merged, workState: current.workState, taskStatus: current.taskStatus } : merged);
  }
  return [...entries.values()];
}
