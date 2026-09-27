import { AppSettings, DailyReport, Notification, Task, MemberDeletionResult, User } from './types';

const NEON_FLAG = String(import.meta.env.VITE_USE_NEON_DATA ?? '').trim().toLowerCase();

export const USE_NEON_DATA = ['1', 'true', 'yes', 'on'].includes(NEON_FLAG);

let verifiedSessionAccessToken: string | null = null;
export function setNeonAccessToken(token: string | null) { verifiedSessionAccessToken = token; }
export function getNeonAuthHeaders(): Record<string, string> {
  return verifiedSessionAccessToken ? { Authorization: `Bearer ${verifiedSessionAccessToken}` } : {};
}

export async function loginNeonWorkspace(identifier: string, password: string): Promise<{ user?: User; error?: string; code?: string }> {
  const response = await fetch('/api/app-state?auth=login', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  return parseAppStateResponse(response, { error: 'Workspace login was not confirmed.' });
}

export async function fetchNeonSession(): Promise<User | null> {
  const response = await appStateFetch('/api/app-state?auth=session');
  const data = await parseAppStateResponse<{ user?: User }>(response, {});
  return data.user || null;
}

export async function logoutNeonWorkspace(): Promise<void> {
  await appStateFetch('/api/app-state?auth=logout', { method: 'POST', body: '{}' });
  verifiedSessionAccessToken = null;
}

export interface NeonAppState {
  tasks: Task[];
  notifications: Notification[];
  settings?: AppSettings;
  dailyReports?: DailyReport[];
}

export interface NeonAppStateResponse {
  state: NeonAppState | null;
  updatedAt: string | null;
}

export const NEON_TRANSFER_QUOTA_ERROR_MESSAGE =
  'Shared database transfer limit has been reached. Shared data is paused until the Neon quota is restored.';

function getNormalizedNeonErrorMessage(message: string, status?: number, code?: string) {
  const normalized = `${message} ${code || ''}`.toLowerCase();
  if (
    status === 402 ||
    normalized.includes('data transfer quota') ||
    normalized.includes('transfer quota') ||
    normalized.includes('quota exceeded') ||
    normalized.includes('exceeded the data transfer')
  ) {
    return NEON_TRANSFER_QUOTA_ERROR_MESSAGE;
  }

  return message;
}

async function parseAppStateResponse<T>(response: Response, fallback: T): Promise<T> {
  const responseText = await response.text();
  if (!responseText.trim()) return fallback;

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error('Neon app-state endpoint did not return JSON.');
  }
}

export class NeonAppStateError extends Error {
  constructor(message: string, public blockingTasks?: MemberDeletionResult['blockingTasks']) { super(message); }
}

async function appStateFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(verifiedSessionAccessToken ? { Authorization: `Bearer ${verifiedSessionAccessToken}` } : {}),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    let message = response.statusText;
    let code: string | undefined;
    let blockingTasks: MemberDeletionResult['blockingTasks'];
    try {
      const body = await response.json() as { error?: string; message?: string; code?: string; blockingTasks?: MemberDeletionResult['blockingTasks'] };
      message = body.error || body.message || message;
      code = body.code;
      blockingTasks = body.blockingTasks;
    } catch {
      // Keep status text.
    }
    throw new NeonAppStateError(getNormalizedNeonErrorMessage(message, response.status, code), blockingTasks);
  }

  return response;
}

export async function fetchNeonAppStateResponse(): Promise<NeonAppStateResponse> {
  if (!USE_NEON_DATA) return { state: null, updatedAt: null };
  const response = await appStateFetch('/api/app-state');
  const data = await parseAppStateResponse<{ state?: NeonAppState | null; updatedAt?: string | null }>(
    response,
    { state: null, updatedAt: null },
  );
  return {
    state: data.state || null,
    updatedAt: data.updatedAt || null,
  };
}

export async function fetchNeonAppState(): Promise<NeonAppState | null> {
  if (!USE_NEON_DATA) return null;
  return (await fetchNeonAppStateResponse()).state;
}

export async function fetchNeonAppStateMeta(): Promise<{ updatedAt: string | null }> {
  if (!USE_NEON_DATA) return { updatedAt: null };
  const response = await appStateFetch('/api/app-state?meta=1');
  const data = await parseAppStateResponse<{ updatedAt?: string | null }>(
    response,
    { updatedAt: null },
  );
  return { updatedAt: data.updatedAt || null };
}

export async function fetchNeonAppSettings(): Promise<AppSettings | null> {
  if (!USE_NEON_DATA) return null;
  const response = await appStateFetch('/api/app-state?settings=1');
  const data = await parseAppStateResponse<{ settings?: AppSettings | null }>(
    response,
    { settings: null },
  );
  return data.settings || null;
}

export async function saveNeonAppState(state: NeonAppState, options?: { expectedUpdatedAt?: string | null; changedTaskIds?: string[]; deletedTaskIds?: string[] }): Promise<{ updatedAt: string | null; settings?: AppSettings; tasks?: Task[]; notifications?: Notification[] }> {
  if (!USE_NEON_DATA) return { updatedAt: null };
  const response = await appStateFetch('/api/app-state', {
    method: 'PUT',
    body: JSON.stringify({ state, ...(options || {}) }),
  });
  const data = await parseAppStateResponse<{ ok?: boolean; updatedAt?: string | null; settings?: AppSettings; tasks?: Task[]; notifications?: Notification[] }>(
    response,
    { updatedAt: null },
  );
  if (data.ok !== true || !data.updatedAt) throw new Error('Shared storage did not confirm the save. Refresh before trying again.');
  return { updatedAt: data.updatedAt, settings: data.settings, tasks: data.tasks, notifications: data.notifications };
}
