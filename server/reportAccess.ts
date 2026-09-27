import type { AppSettings, DailyReport, Notification, User } from '../src/lib/types.js';
import { canEditDailyReport, canViewDailyReport, getDailyReportReceiverIds } from '../src/lib/reportPolicy.js';

export class ReportAccessError extends Error { status = 403; }

export function normalizeDailyReport(report: DailyReport): DailyReport {
  return { id: report.id, date: report.date, userId: report.userId, note: report.note || '',
    entries: (report.entries || []).map(entry => ({ taskId: entry.taskId, title: entry.title, taskCode: entry.taskCode, source: entry.source, taskStatus: entry.taskStatus, workState: entry.workState, manuallyEdited: entry.manuallyEdited, startTime: entry.startTime ?? null,
      endTime: entry.endTime ?? null, durationMinutes: typeof entry.durationMinutes === 'number' ? entry.durationMinutes : null, note: entry.note })),
    sentAt: report.sentAt ?? null, sentBy: report.sentBy ?? null, autoSent: Boolean(report.autoSent), autoSendWarningAt: report.autoSendWarningAt ?? null,
    editHistory: (report.editHistory || []).map(entry => ({ id: entry.id, editedBy: entry.editedBy, editedAt: entry.editedAt,
      previousNote: entry.previousNote ?? null, nextNote: entry.nextNote ?? null, changedEntries: entry.changedEntries || [], autoSent: Boolean(entry.autoSent) })),
    createdAt: report.createdAt || '', updatedAt: report.updatedAt || '' };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function isReportNotification(notification: Partial<Notification>): boolean {
  return Boolean(notification.dailyReportId || notification.taskId === 'daily-report' || /daily report/i.test(notification.message || ''));
}

export function projectReports(reports: DailyReport[], viewer: User, settings: AppSettings, users: User[]): DailyReport[] {
  return reports.filter(report => canViewDailyReport(report, viewer, settings, users)).map(normalizeDailyReport);
}

export function projectReportNotifications(notifications: Notification[], reports: DailyReport[], viewer: User, settings: AppSettings, users: User[]): Notification[] {
  return notifications.filter(notification => {
    if (!isReportNotification(notification)) return true;
    const report = reports.find(report => report.id === notification.dailyReportId);
    // Untagged legacy messages cannot prove their audience and are not exposed.
    return Boolean(report && notification.userId === viewer.id && canViewDailyReport(report, viewer, settings, users));
  });
}

/** Whole-state clients submit only visible reports; hidden records are never deleted. */
export function mergeAuthorizedReports(existing: DailyReport[], incoming: DailyReport[] | undefined, actor: User, settings: AppSettings): { reports: DailyReport[]; changed: DailyReport[] } {
  const reports = new Map(existing.map(report => [report.id, report]));
  const changed: DailyReport[] = [];
  for (const report of incoming || []) {
    if (!report || typeof report.id !== 'string' || typeof report.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(report.date)
      || report.id !== `${report.date}:${report.userId}` || !Array.isArray(report.entries)) throw new ReportAccessError('Invalid daily report identity.');
    const prior = reports.get(report.id);
    if (prior && stable(normalizeDailyReport(prior)) === stable(normalizeDailyReport(report))) continue;
    if (!canEditDailyReport(report, actor, settings) || (prior && prior.userId !== actor.id)) throw new ReportAccessError('You can change only your own daily report.');
    if (report.sentBy && report.sentBy !== actor.id) throw new ReportAccessError('A report sender cannot be impersonated.');
    if (prior?.sentAt && (!report.sentAt || report.sentAt !== prior.sentAt)) throw new ReportAccessError('A submitted report cannot be made private again.');
    const priorHistory = prior ? normalizeDailyReport(prior).editHistory : [];
    const history = normalizeDailyReport(report).editHistory;
    if (stable(history.slice(0, priorHistory.length)) !== stable(priorHistory)
      || history.slice(priorHistory.length).some(entry => entry.editedBy !== actor.id)) throw new ReportAccessError('Report edit attribution cannot be changed.');
    const next: DailyReport = { id: report.id, userId: actor.id, date: report.date, note: report.note || '', entries: report.entries,
      sentAt: prior?.sentAt || report.sentAt || null, sentBy: report.sentAt ? actor.id : null, autoSent: Boolean(prior?.autoSent || report.autoSent), autoSendWarningAt: prior?.autoSendWarningAt ?? null,
      editHistory: history, createdAt: prior?.createdAt || report.createdAt || new Date().toISOString(), updatedAt: report.updatedAt || new Date().toISOString() };
    reports.set(next.id, next);
    changed.push(next);
  }
  return { reports: [...reports.values()], changed };
}

export function mergeReportNotifications(existing: Notification[], incoming: Notification[], changedReports: DailyReport[], actor: User, settings: AppSettings, users: User[]): Notification[] {
  const priorReportNotices = existing.filter(isReportNotification).map(notification => {
    const incomingNotice = incoming.find(item => item.id === notification.id);
    return incomingNotice && notification.userId === actor.id ? { ...notification, read: Boolean(incomingNotice.read) } : notification;
  });
  const notices = new Map([...incoming.filter(notification => !isReportNotification(notification)), ...priorReportNotices].map(notification => [notification.id, notification]));
  for (const report of changedReports.filter(report => report.sentAt)) {
    const ownerName = users.find(user => user.id === report.userId)?.name || 'Member';
    for (const userId of getDailyReportReceiverIds(report, settings, users)) {
      const id = `report:${report.id}:${report.updatedAt}:${userId}`;
      notices.set(id, { id, userId, taskId: 'daily-report', dailyReportId: report.id, read: false, createdAt: report.updatedAt,
        message: `${ownerName}'s daily report for ${report.date} was submitted or updated.` });
    }
  }
  return [...notices.values()];
}
