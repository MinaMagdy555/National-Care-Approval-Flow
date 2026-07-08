const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const GOOGLE_API_SCRIPT = 'https://apis.google.com/js/api.js';
const DRIVE_ROOT_STORAGE_KEY = 'national-care-drive-root-folder';
const DRIVE_TOKEN_STORAGE_KEY = 'national-care-drive-token';
const DRIVE_USER_STORAGE_KEY = 'national-care-drive-user';
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000;

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export type DriveAuthStatus = 'disabled' | 'needs_config' | 'needs_auth' | 'needs_root' | 'ready';

export type DriveRootFolder = {
  id: string;
  name: string;
};

export type DrivePickerMode = 'root' | 'import';

export type DrivePickerDocument = GooglePickerDocument;

type StoredToken = {
  accessToken: string;
  expiresAt: number;
};

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, '');
}

export const googleClientId = cleanEnvValue(import.meta.env.VITE_GOOGLE_CLIENT_ID);
export const googleApiKey = cleanEnvValue(import.meta.env.VITE_GOOGLE_API_KEY);
export const googleAppId = cleanEnvValue(import.meta.env.VITE_GOOGLE_APP_ID);

export const isGoogleDriveConfigured = Boolean(googleClientId && googleApiKey && googleAppId);

let tokenClient: ReturnType<NonNullable<NonNullable<Window['google']>['accounts']>['oauth2']['initTokenClient']> | null = null;
let activeTokenRequest: Promise<string> | null = null;

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T | null) {
  if (typeof window === 'undefined') return;
  if (value === null) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }

    const script = existing || document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Could not load ${src}`));

    if (!existing) {
      document.head.appendChild(script);
    }
  });
}

async function loadIdentityClient() {
  if (!isGoogleDriveConfigured || !googleClientId) {
    throw new Error('Google Drive is not configured. Add VITE_GOOGLE_CLIENT_ID, VITE_GOOGLE_API_KEY, and VITE_GOOGLE_APP_ID.');
  }

  await loadScript(GOOGLE_IDENTITY_SCRIPT);
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('Google Identity Services did not load.');

  if (!tokenClient) {
    tokenClient = oauth2.initTokenClient({
      client_id: googleClientId,
      scope: DRIVE_SCOPES,
      callback: () => undefined,
    });
  }

  return tokenClient;
}

export function getStoredDriveRoot(): DriveRootFolder | null {
  return readJson<DriveRootFolder>(DRIVE_ROOT_STORAGE_KEY);
}

export function setStoredDriveRoot(root: DriveRootFolder | null) {
  writeJson(DRIVE_ROOT_STORAGE_KEY, root);
}

export function getStoredDriveUserEmail() {
  return window.localStorage.getItem(DRIVE_USER_STORAGE_KEY);
}

function setStoredDriveUserEmail(email: string | null) {
  if (email) {
    window.localStorage.setItem(DRIVE_USER_STORAGE_KEY, email);
  } else {
    window.localStorage.removeItem(DRIVE_USER_STORAGE_KEY);
  }
}

function getStoredToken() {
  const token = readJson<StoredToken>(DRIVE_TOKEN_STORAGE_KEY);
  if (!token?.accessToken || token.expiresAt - TOKEN_EXPIRY_SKEW_MS <= Date.now()) return null;
  return token;
}

function setStoredToken(accessToken: string, expiresInSeconds = 3600) {
  writeJson<StoredToken>(DRIVE_TOKEN_STORAGE_KEY, {
    accessToken,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  });
}

export function hasUsableDriveToken() {
  return Boolean(getStoredToken());
}

export function clearDriveSession() {
  writeJson(DRIVE_TOKEN_STORAGE_KEY, null);
  setStoredDriveUserEmail(null);
}

async function fetchDriveUserEmail(accessToken: string) {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) return null;
    const data = await response.json() as { email?: string };
    return data.email || null;
  } catch {
    return null;
  }
}

export async function requestDriveAccessToken(prompt: '' | 'consent' = ''): Promise<string> {
  const cachedToken = getStoredToken();
  if (cachedToken && prompt === '') return cachedToken.accessToken;

  if (activeTokenRequest) return activeTokenRequest;

  activeTokenRequest = (async () => {
    const client = await loadIdentityClient();
    const token = await new Promise<string>((resolve, reject) => {
      client.callback = response => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        if (!response.access_token) {
          reject(new Error('Google did not return an access token.'));
          return;
        }
        setStoredToken(response.access_token, response.expires_in);
        resolve(response.access_token);
      };

      client.requestAccessToken({ prompt });
    });

    const email = await fetchDriveUserEmail(token);
    setStoredDriveUserEmail(email);
    return token;
  })().finally(() => {
    activeTokenRequest = null;
  });

  return activeTokenRequest;
}

export async function ensureDriveAccessToken() {
  return requestDriveAccessToken('');
}

export async function loadGooglePicker() {
  if (!isGoogleDriveConfigured) {
    throw new Error('Google Drive Picker is not configured.');
  }

  await loadScript(GOOGLE_API_SCRIPT);
  await new Promise<void>((resolve, reject) => {
    if (!window.gapi) {
      reject(new Error('Google API loader did not load.'));
      return;
    }

    window.gapi.load('picker', resolve);
  });

  if (!window.google?.picker) {
    throw new Error('Google Picker did not load.');
  }

  return window.google.picker;
}

export async function pickDriveDocuments(mode: DrivePickerMode): Promise<DrivePickerDocument[]> {
  const [accessToken, picker] = await Promise.all([
    requestDriveAccessToken(''),
    loadGooglePicker(),
  ]);

  return new Promise(resolve => {
    const builder = new (picker.PickerBuilder as new () => any)()
      .setAppId(googleAppId!)
      .setDeveloperKey(googleApiKey!)
      .setOAuthToken(accessToken)
      .setTitle(mode === 'root' ? 'Select the shared task root folder' : 'Select Drive tasks to import')
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setCallback(data => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.PICKED) {
          resolve((data[picker.Response.DOCUMENTS] as DrivePickerDocument[] | undefined) || []);
        } else if (action === picker.Action.CANCEL) {
          resolve([]);
        }
      });

    if (mode === 'root') {
      const folderView = new (picker.DocsView as new (viewId?: string) => any)(picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes('application/vnd.google-apps.folder');
      builder.addView(folderView);
    } else {
      const docsView = new (picker.DocsView as new (viewId?: string) => any)(picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true);
      builder
        .addView(docsView)
        .enableFeature(picker.Feature.MULTISELECT_ENABLED);
    }

    builder.build().setVisible(true);
  });
}
