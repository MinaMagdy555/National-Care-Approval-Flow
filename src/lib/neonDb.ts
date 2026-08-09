import { AppSettings, DailyReport, Notification, Task } from './types';

const NEON_FLAG = String(import.meta.env.VITE_USE_NEON_DATA ?? '').trim().toLowerCase();

export const USE_NEON_DATA = ['1', 'true', 'yes', 'on'].includes(NEON_FLAG);

export interface NeonAppState {
  tasks: Task[];
  notifications: Notification[];
  settings?: AppSettings;
  dailyReports?: DailyReport[];
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
    try {
      const body = await response.json() as { error?: string };
      message = body.error || message;
    } catch {
      // Keep status text.
    }
    throw new Error(message);
  }

  return response;
}

export async function fetchNeonAppState(): Promise<NeonAppState | null> {
  if (!USE_NEON_DATA) return null;
  const response = await appStateFetch('/api/app-state');
  const responseText = await response.text();
  let data: { state?: NeonAppState | null };
  try {
    data = JSON.parse(responseText) as { state?: NeonAppState | null };
  } catch {
    if (import.meta.env.DEV) {
      console.warn('Neon app-state endpoint did not return JSON. Falling back to local app state.');
      return null;
    }
    throw new Error('Neon app-state endpoint did not return JSON.');
  }
  return data.state || null;
}

export async function saveNeonAppState(state: NeonAppState): Promise<void> {
  if (!USE_NEON_DATA) return;
  await appStateFetch('/api/app-state', {
    method: 'PUT',
    body: JSON.stringify({ state }),
  });
}
