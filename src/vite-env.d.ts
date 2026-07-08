/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_NEON_DATA?: string;
  readonly VITE_USE_SHARED_DRIVE_DATA?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_GOOGLE_API_KEY?: string;
  readonly VITE_GOOGLE_APP_ID?: string;
  readonly VITE_MAX_UPLOAD_MB?: string;
}

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GooglePickerDocument = {
  id: string;
  name?: string;
  mimeType?: string;
  url?: string;
  type?: string;
};

interface Window {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          callback: (response: GoogleTokenResponse) => void;
        }) => {
          callback: (response: GoogleTokenResponse) => void;
          requestAccessToken: (options?: { prompt?: string }) => void;
        };
      };
    };
    picker?: {
      Action: { PICKED: string; CANCEL: string };
      Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string };
      Response: { ACTION: string; DOCUMENTS: string };
      ViewId: { DOCS: string; FOLDERS: string };
      DocsView: new (viewId?: string) => {
        setIncludeFolders: (value: boolean) => Window['google']['picker']['DocsView'];
        setSelectFolderEnabled: (value: boolean) => Window['google']['picker']['DocsView'];
        setMimeTypes: (value: string) => Window['google']['picker']['DocsView'];
      };
      PickerBuilder: new () => {
        addView: (view: unknown) => Window['google']['picker']['PickerBuilder'];
        enableFeature: (feature: string) => Window['google']['picker']['PickerBuilder'];
        setAppId: (appId: string) => Window['google']['picker']['PickerBuilder'];
        setDeveloperKey: (key: string) => Window['google']['picker']['PickerBuilder'];
        setOAuthToken: (token: string) => Window['google']['picker']['PickerBuilder'];
        setTitle: (title: string) => Window['google']['picker']['PickerBuilder'];
        setCallback: (callback: (data: Record<string, unknown>) => void) => Window['google']['picker']['PickerBuilder'];
        build: () => { setVisible: (visible: boolean) => void };
      };
    };
  };
  gapi?: {
    load: (api: string, callback: () => void) => void;
  };
}
