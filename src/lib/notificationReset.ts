import type { AppSettings, Notification } from './types';

export interface NotificationResetRecord {
  version: 3;
  completedAt: string;
  clearedIds: string[];
}

export function filterResetNotifications(notifications: Notification[], reset?: NotificationResetRecord): Notification[] {
  if (!reset?.clearedIds.length) return notifications;
  const cleared = new Set(reset.clearedIds);
  return notifications.filter(notice => !cleared.has(notice.id));
}

/** A v2 marker has already promised to retain newer activity: never clear it again. */
export function planNotificationReset(notifications: Notification[], settings: Pick<AppSettings, 'notificationResetVersion'>, prior?: NotificationResetRecord, now = new Date().toISOString()) {
  const reset: NotificationResetRecord = prior?.version === 3 && Array.isArray(prior.clearedIds) ? prior : {
    version: 3, completedAt: now,
    clearedIds: (settings.notificationResetVersion || 0) >= 2 ? [] : [...new Set(notifications.map(notice => notice.id))],
  };
  return { reset, notifications: filterResetNotifications(notifications, reset), notificationResetVersion: 3 };
}
