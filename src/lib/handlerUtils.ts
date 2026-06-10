import {
  AHMED_SOBEEH_ID,
  DINA_ID,
  FAWZY_ID,
  MARWA_ID,
  MINA_ID,
  OMAR_ID,
  YOMNA_ID,
  canAssignContributorsWithSettings,
  defaultAppSettings,
  getAssignableContributorsForTaskWithSettings,
  isAssignableContributorForTaskWithSettings,
  isAssignableHandlerWithSettings,
  sanitizeHandledByWithSettings,
} from './appSettings';
import { AppSettings, TaskType, User } from './types';

export { AHMED_SOBEEH_ID, DINA_ID, FAWZY_ID, MARWA_ID, MINA_ID, OMAR_ID, YOMNA_ID };

export function sanitizeHandledBy(ids: string[] = [], assignerId?: string, settings: AppSettings = defaultAppSettings) {
  return sanitizeHandledByWithSettings(settings, ids, assignerId);
}

export function isAssignableHandler(id: string, assignerId?: string, settings: AppSettings = defaultAppSettings) {
  return isAssignableHandlerWithSettings(settings, id, assignerId);
}

export function canAssignContributors(userId: string, settings: AppSettings = defaultAppSettings) {
  return canAssignContributorsWithSettings(settings, userId);
}

export function isAssignableContributorForTask(user: User, taskType: TaskType, creatorId?: string, settings: AppSettings = defaultAppSettings) {
  return isAssignableContributorForTaskWithSettings(settings, user, taskType, creatorId);
}

export function getAssignableContributorsForTask(users: User[], taskType: TaskType, creatorId?: string, settings: AppSettings = defaultAppSettings) {
  return getAssignableContributorsForTaskWithSettings(settings, users, taskType, creatorId);
}
