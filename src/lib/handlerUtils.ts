export const MINA_ID = 'user_1';
export const MARWA_ID = 'user_2';
export const DINA_ID = 'user_3';

const NON_HANDLER_IDS = new Set([MARWA_ID, DINA_ID]);

export function sanitizeHandledBy(ids: string[] = []) {
  return Array.from(new Set(ids.filter(id => id && !NON_HANDLER_IDS.has(id))));
}

export function isAssignableHandler(id: string) {
  return Boolean(id) && !NON_HANDLER_IDS.has(id);
}
