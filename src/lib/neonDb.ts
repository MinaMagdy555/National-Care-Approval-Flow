import { AppSettings, DailyReport, Notification, Task } from './types';

const NEON_FLAG = String(import.meta.env.VITE_USE_NEON_DATA ?? '').trim().toLowerCase();

export const USE_NEON_DATA = ['1', 'true', 'yes', 'on'].includes(NEON_FLAG);

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
    if (import.meta.env.DEV) {
      console.warn('Neon app-state endpoint did not return JSON. Falling back to local app state.');
      return fallback;
    }
    throw new Error('Neon app-state endpoint did not return JSON.');
  }
}

async function appStateFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    let message = response.statusText;
    let code: string | undefined;
    try {
      const body = await response.json() as { error?: string; message?: string; code?: string };
      message = body.error || body.message || message;
      code = body.code;
    } catch {
      // Keep status text.
    }
    throw new Error(getNormalizedNeonErrorMessage(message, response.status, code));
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

export async function saveNeonAppState(state: NeonAppState): Promise<{ updatedAt: string | null }> {
  if (!USE_NEON_DATA) return { updatedAt: null };
  const response = await appStateFetch('/api/app-state', {
    method: 'PUT',
    body: JSON.stringify({ state }),
  });
  const data = await parseAppStateResponse<{ updatedAt?: string | null }>(
    response,
    { updatedAt: null },
  );
  return { updatedAt: data.updatedAt || null };
}
