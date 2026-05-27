export const MINA_ID = 'user_1';
export const MARWA_ID = 'user_2';
export const DINA_ID = 'user_3';
export const FAWZY_ID = 'user_7';
export const OMAR_ID = 'user_8';
export const AHMED_SOBEEH_ID = 'user_9';

const NON_HANDLER_IDS = new Set([MARWA_ID, DINA_ID, FAWZY_ID, OMAR_ID, AHMED_SOBEEH_ID]);

export function sanitizeHandledBy(ids: string[] = []) {
  return Array.from(new Set(ids.filter(id => id && !NON_HANDLER_IDS.has(id))));
}

export function isAssignableHandler(id: string) {
  return Boolean(id) && !NON_HANDLER_IDS.has(id);
}
