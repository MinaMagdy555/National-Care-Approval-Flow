import { TaskType, User } from './types';

export const MINA_ID = 'user_1';
export const MARWA_ID = 'user_2';
export const DINA_ID = 'user_3';
export const FAWZY_ID = 'user_7';
export const OMAR_ID = 'user_8';
export const AHMED_SOBEEH_ID = 'user_9';
export const YOMNA_ID = 'user_6';

const NEVER_HANDLER_IDS = new Set([OMAR_ID]);
const SELF_ASSIGNMENT_BLOCKED_IDS = new Set([MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID]);
const CONTRIBUTOR_ASSIGNER_IDS = new Set([MINA_ID, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID]);

export function sanitizeHandledBy(ids: string[] = [], assignerId?: string) {
  return Array.from(new Set(ids.filter(id => (
    id &&
    !NEVER_HANDLER_IDS.has(id) &&
    !(assignerId && SELF_ASSIGNMENT_BLOCKED_IDS.has(assignerId) && id === assignerId)
  ))));
}

export function isAssignableHandler(id: string, assignerId?: string) {
  return Boolean(id) && sanitizeHandledBy([id], assignerId).length > 0;
}

export function canAssignContributors(userId: string) {
  return CONTRIBUTOR_ASSIGNER_IDS.has(userId);
}

export function isAssignableContributorForTask(user: User, taskType: TaskType, creatorId?: string) {
  if (!isAssignableHandler(user.id)) return false;
  if (user.id !== MINA_ID && user.id === creatorId) return false;
  if (user.id === MINA_ID) return true;
  if (user.role !== 'team_member') return false;
  return taskType === 'video' ? user.id === YOMNA_ID : user.id !== YOMNA_ID;
}

export function getAssignableContributorsForTask(users: User[], taskType: TaskType, creatorId?: string) {
  return users.filter(user => isAssignableContributorForTask(user, taskType, creatorId));
}
