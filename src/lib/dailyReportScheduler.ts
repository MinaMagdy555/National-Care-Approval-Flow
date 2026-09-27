import type { AppSettings, DailyReport, Notification, Task, User } from './types.js';
import { buildActualWorkEntries, cairoDate, cairoTime, mergeWorkReportEntries } from './dailyReportWork.js';
import { getDailyReportReceiverIds, isReportExempt } from './reportPolicy.js';
import { isMemberDeleted } from './memberIdentity.js';

export function planDailyReports(tasks: Task[], reports: DailyReport[], settings: AppSettings, users: User[], now = new Date(), ownerIds?: string[]) {
  const next = new Map(reports.map(report => [report.id, report]));
  const notifications: Notification[] = [];
  const changedIds: string[] = [];
  const date = cairoDate(now), time = cairoTime(now.toISOString());
  const workday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (settings.dailyReportAutoSendEnabled === false || !settings.businessCalendar.workdays.includes(workday) || time < '17:15') return { reports, notifications, changedIds };
  for (const user of users) {
    if (user.id === 'guest' || isMemberDeleted(user, settings.deletedMembers) || isReportExempt(user) || (ownerIds && !ownerIds.includes(user.id))) continue;
    const id = `${date}:${user.id}`;
    const existing = next.get(id);
    if (existing?.sentAt) continue;
    const entries = mergeWorkReportEntries(buildActualWorkEntries(tasks, user.id, date, settings, users, now), existing?.entries);
    const report: DailyReport = { id, date, userId: user.id, note: '', entries, editHistory: [], createdAt: now.toISOString(), updatedAt: now.toISOString(), ...existing };
    report.entries = entries;
    let changed = false;
    if (time < '17:29' && !report.autoSendWarningAt) {
      report.autoSendWarningAt = now.toISOString(); changed = true;
      notifications.push({ id: `report-warning:${id}`, userId: user.id, taskId: 'daily-report', dailyReportId: id, read: false, createdAt: now.toISOString(), message: `Your daily report for ${date} will auto-send at 17:29 Africa/Cairo. Review your work and add any side work before then.` });
    }
    if (time >= '17:29' && (entries.length > 0 || report.note.trim())) {
      report.sentAt = now.toISOString(); report.sentBy = user.id; report.autoSent = true; changed = true;
      for (const receiver of getDailyReportReceiverIds(report, settings, users)) notifications.push({ id: `report-auto:${id}:${receiver}`, userId: receiver, taskId: 'daily-report', dailyReportId: id, read: false, createdAt: now.toISOString(), message: `${user.name}'s daily report for ${date} was auto-sent.` });
    }
    if (changed) { report.updatedAt = now.toISOString(); next.set(id, report); changedIds.push(id); }
  }
  return { reports: [...next.values()], notifications, changedIds };
}
