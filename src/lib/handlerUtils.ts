export const MINA_ID = 'user_1';
export const MARWA_ID = 'user_2';
export const DINA_ID = 'user_3';
export const FAWZY_ID = 'user_7';
export const OMAR_ID = 'user_8';
export const AHMED_SOBEEH_ID = 'user_9';

const NEVER_HANDLER_IDS = new Set([OMAR_ID]);
const SELF_ASSIGNMENT_BLOCKED_IDS = new Set([MINA_ID, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID]);

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
