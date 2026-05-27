import { Environment, Notification, Task, UploadedTaskFile, User } from './types';
import {
  DrivePickerDocument,
  ensureDriveAccessToken,
  getStoredDriveRoot,
  isGoogleDriveConfigured,
} from './driveAuth';
import { uploadLimitHelpText } from './uploadLimits';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const TASK_METADATA_NAME = '.approval-flow-task.json';
const SYSTEM_FOLDER_NAME = '_approval-flow';
const NOTIFICATIONS_FOLDER_NAME = 'notifications';
const APP_PROPERTY_KEY = 'approvalFlow';
const ROOT_PROPERTY_KEY = 'approvalFlowRootId';
const TASK_ID_PROPERTY_KEY = 'approvalFlowTaskId';
const NOTIFICATION_ID_PROPERTY_KEY = 'approvalFlowNotificationId';
const FOLDER_ROLE_PROPERTY_KEY = 'approvalFlowFolderRole';
const DRIVE_FILE_FIELDS = 'id,name,mimeType,size,parents,webViewLink,webContentLink,thumbnailLink,appProperties,createdTime,modifiedTime';
const SHARED_DRIVE_FLAG = String(import.meta.env.VITE_USE_SHARED_DRIVE_DATA ?? '').trim().toLowerCase();

export const USE_SHARED_DRIVE_DATA = ['1', 'true', 'yes', 'on'].includes(SHARED_DRIVE_FLAG);

type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  parents?: string[];
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
  appProperties?: Record<string, string>;
  createdTime?: string;
  modifiedTime?: string;
};

type TaskFolderSet = {
  taskFolderId: string;
  originalsFolderId: string;
  previewsFolderId: string;
  commentsFolderId: string;
};

export type DriveUploadContext = {
  taskCode?: string;
  taskName?: string;
  taskFolderId?: string;
};

function isDriveSharedStorageReady() {
  return USE_SHARED_DRIVE_DATA && isGoogleDriveConfigured && Boolean(getStoredDriveRoot());
}

function ensureRootFolderId() {
  const root = getStoredDriveRoot();
  if (!root?.id) {
    throw new Error('Choose the company shared Drive folder before using shared task storage.');
  }
  return root.id;
}

function getFriendlyDriveError(error: unknown, fallback: string) {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

async function getDriveErrorMessage(response: Response) {
  try {
    const data = await response.json() as { error?: { message?: string } };
    return data.error?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

function driveUrl(path: string, params: Record<string, string | number | boolean | undefined> = {}) {
  const url = new URL(path.startsWith('http') ? path : `${DRIVE_API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function driveFetch(path: string, init: RequestInit = {}, params?: Record<string, string | number | boolean | undefined>) {
  const accessToken = await ensureDriveAccessToken();
  const response = await fetch(driveUrl(path, params), {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(await getDriveErrorMessage(response));
  }

  return response;
}

async function driveJson<T>(path: string, init: RequestInit = {}, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const response = await driveFetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  }, params);

  return response.json() as Promise<T>;
}

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listDriveFiles(q: string, fields = DRIVE_FILE_FIELDS) {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const data = await driveJson<{ files?: DriveFile[]; nextPageToken?: string }>('/files', {}, {
      q,
      fields: `nextPageToken,files(${fields})`,
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives',
      pageToken,
    });
    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

async function createDriveFolder(name: string, parentId: string, appProperties: Record<string, string>) {
  return driveJson<DriveFile>('/files', {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parents: [parentId],
      appProperties,
    }),
  }, {
    fields: DRIVE_FILE_FIELDS,
    supportsAllDrives: true,
  });
}

async function findChildFolder(parentId: string, name: string, role?: string) {
  const clauses = [
    `mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`,
    `name = '${escapeDriveQuery(name)}'`,
    `'${escapeDriveQuery(parentId)}' in parents`,
    'trashed = false',
  ];

  if (role) {
    clauses.push(`appProperties has { key='${FOLDER_ROLE_PROPERTY_KEY}' and value='${escapeDriveQuery(role)}' }`);
  }

  const matches = await listDriveFiles(clauses.join(' and '));
  return matches[0] || null;
}

async function ensureChildFolder(parentId: string, name: string, appProperties: Record<string, string>, role?: string) {
  const existing = await findChildFolder(parentId, name, role);
  if (existing?.id) return existing.id;
  const folder = await createDriveFolder(name, parentId, appProperties);
  return folder.id;
}

function safeNamePart(value: string) {
  return value.replace(/[\\/:*?"<>|#{}%~&]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Task';
}

function taskFolderName(taskId: string, taskCode?: string, taskName?: string) {
  return safeNamePart(`${taskCode || taskId} - ${taskName || 'Task'}`);
}

async function findTaskFolder(rootFolderId: string, taskId: string) {
  const matches = await listDriveFiles([
    `mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`,
    'trashed = false',
    `appProperties has { key='${TASK_ID_PROPERTY_KEY}' and value='${escapeDriveQuery(taskId)}' }`,
    `appProperties has { key='${ROOT_PROPERTY_KEY}' and value='${escapeDriveQuery(rootFolderId)}' }`,
  ].join(' and '));

  return matches[0] || null;
}

async function ensureTaskFolders(taskId: string, context: DriveUploadContext = {}): Promise<TaskFolderSet> {
  const rootFolderId = ensureRootFolderId();
  const taskFolder = context.taskFolderId
    ? { id: context.taskFolderId }
    : await findTaskFolder(rootFolderId, taskId);
  const taskFolderId = taskFolder?.id || await createDriveFolder(taskFolderName(taskId, context.taskCode, context.taskName), rootFolderId, {
    [APP_PROPERTY_KEY]: 'task-folder',
    [ROOT_PROPERTY_KEY]: rootFolderId,
    [TASK_ID_PROPERTY_KEY]: taskId,
  }).then(folder => folder.id);

  const commonProperties = {
    [ROOT_PROPERTY_KEY]: rootFolderId,
    [TASK_ID_PROPERTY_KEY]: taskId,
  };

  const originalsFolderId = await ensureChildFolder(taskFolderId, 'originals', {
    ...commonProperties,
    [APP_PROPERTY_KEY]: 'task-assets',
    [FOLDER_ROLE_PROPERTY_KEY]: 'originals',
  }, 'originals');
  const previewsFolderId = await ensureChildFolder(taskFolderId, 'previews', {
    ...commonProperties,
    [APP_PROPERTY_KEY]: 'task-assets',
    [FOLDER_ROLE_PROPERTY_KEY]: 'previews',
  }, 'previews');
  const commentsFolderId = await ensureChildFolder(taskFolderId, 'comments', {
    ...commonProperties,
    [APP_PROPERTY_KEY]: 'task-assets',
    [FOLDER_ROLE_PROPERTY_KEY]: 'comments',
  }, 'comments');

  return {
    taskFolderId,
    originalsFolderId,
    previewsFolderId,
    commentsFolderId,
  };
}

async function ensureSystemFolders() {
  const rootFolderId = ensureRootFolderId();
  const systemFolderId = await ensureChildFolder(rootFolderId, SYSTEM_FOLDER_NAME, {
    [APP_PROPERTY_KEY]: 'system',
    [ROOT_PROPERTY_KEY]: rootFolderId,
  });
  const notificationsFolderId = await ensureChildFolder(systemFolderId, NOTIFICATIONS_FOLDER_NAME, {
    [APP_PROPERTY_KEY]: 'notifications-folder',
    [ROOT_PROPERTY_KEY]: rootFolderId,
  });

  return { systemFolderId, notificationsFolderId };
}

function createMultipartBody(metadata: Record<string, unknown>, blob: Blob, mimeType: string) {
  const boundary = `approval_flow_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const body = new Blob([
    delimiter,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    delimiter,
    `Content-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`,
    blob,
    closeDelimiter,
  ], {
    type: `multipart/related; boundary=${boundary}`,
  });

  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

async function startResumableUpload(metadata: Record<string, unknown>, contentType: string) {
  try {
    const accessToken = await ensureDriveAccessToken();
    const response = await fetch('/api/drive/resumable-upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ metadata, contentType }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { uploadUrl?: string };
    return data.uploadUrl || null;
  } catch {
    return null;
  }
}

async function uploadNewDriveFile(metadata: Record<string, unknown>, blob: Blob, mimeType: string) {
  const uploadUrl = await startResumableUpload(metadata, mimeType);
  if (uploadUrl) {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType || 'application/octet-stream',
      },
      body: blob,
    });
    if (!response.ok) {
      throw new Error(await getDriveErrorMessage(response));
    }
    return response.json() as Promise<DriveFile>;
  }

  const { body, contentType } = createMultipartBody(metadata, blob, mimeType);
  const response = await driveFetch(`${DRIVE_UPLOAD_BASE}/files`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
    },
    body,
  }, {
    uploadType: 'multipart',
    supportsAllDrives: true,
    fields: DRIVE_FILE_FIELDS,
  });

  return response.json() as Promise<DriveFile>;
}

async function updateDriveFile(fileId: string, metadata: Record<string, unknown>, blob: Blob, mimeType: string) {
  const { body, contentType } = createMultipartBody(metadata, blob, mimeType);
  const response = await driveFetch(`${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': contentType,
    },
    body,
  }, {
    uploadType: 'multipart',
    supportsAllDrives: true,
    fields: DRIVE_FILE_FIELDS,
  });

  return response.json() as Promise<DriveFile>;
}

async function uploadDriveFile(name: string, parentId: string, blob: Blob, mimeType: string, appProperties: Record<string, string>, existingFileId?: string) {
  const metadata = {
    name,
    parents: existingFileId ? undefined : [parentId],
    mimeType: mimeType || 'application/octet-stream',
    appProperties,
  };

  return existingFileId
    ? updateDriveFile(existingFileId, metadata, blob, mimeType)
    : uploadNewDriveFile(metadata, blob, mimeType);
}

function stripFileBlobs(task: Task): Task {
  return {
    ...task,
    versions: task.versions.map(version => ({
      ...version,
      files: version.files?.map(({ blob, ...file }) => file),
    })),
  };
}

function driveFileToUploadedTaskFile(file: DriveFile, driveFolderId?: string): UploadedTaskFile {
  const previewUrl = file.thumbnailLink || `https://drive.google.com/thumbnail?id=${encodeURIComponent(file.id)}&sz=w1000`;
  return {
    id: file.id,
    name: file.name || 'Drive file',
    type: file.mimeType || '',
    size: Number(file.size || 0),
    url: file.webViewLink || file.webContentLink || `https://drive.google.com/file/d/${file.id}/view`,
    storageProvider: 'drive',
    storagePath: file.id,
    previewUrl,
    previewStoragePath: `drive-thumbnail:${file.id}`,
    driveFileId: file.id,
    driveFolderId,
    webViewLink: file.webViewLink,
    downloadUrl: file.webContentLink,
  };
}

function driveFileFromPickerDocument(doc: DrivePickerDocument, driveFolderId?: string): UploadedTaskFile {
  const previewUrl = `https://drive.google.com/thumbnail?id=${encodeURIComponent(doc.id)}&sz=w1000`;
  return {
    id: doc.id,
    name: doc.name || 'Drive file',
    type: doc.mimeType || '',
    size: 0,
    url: doc.url || `https://drive.google.com/file/d/${doc.id}/view`,
    storageProvider: 'drive',
    storagePath: doc.id,
    previewUrl,
    previewStoragePath: `drive-thumbnail:${doc.id}`,
    driveFileId: doc.id,
    driveFolderId,
    webViewLink: doc.url,
  };
}

async function downloadJsonFile<T>(fileId: string): Promise<T> {
  const response = await driveFetch(`/files/${encodeURIComponent(fileId)}`, {}, {
    alt: 'media',
    supportsAllDrives: true,
  });
  return response.json() as Promise<T>;
}

async function findTaskMetadataFile(taskId: string) {
  const rootFolderId = ensureRootFolderId();
  const matches = await listDriveFiles([
    `name = '${TASK_METADATA_NAME}'`,
    'trashed = false',
    `appProperties has { key='${APP_PROPERTY_KEY}' and value='task' }`,
    `appProperties has { key='${TASK_ID_PROPERTY_KEY}' and value='${escapeDriveQuery(taskId)}' }`,
    `appProperties has { key='${ROOT_PROPERTY_KEY}' and value='${escapeDriveQuery(rootFolderId)}' }`,
  ].join(' and '));

  return matches[0] || null;
}

async function findNotificationMetadataFile(notificationId: string) {
  const rootFolderId = ensureRootFolderId();
  const matches = await listDriveFiles([
    'trashed = false',
    `appProperties has { key='${APP_PROPERTY_KEY}' and value='notification' }`,
    `appProperties has { key='${NOTIFICATION_ID_PROPERTY_KEY}' and value='${escapeDriveQuery(notificationId)}' }`,
    `appProperties has { key='${ROOT_PROPERTY_KEY}' and value='${escapeDriveQuery(rootFolderId)}' }`,
  ].join(' and '));

  return matches[0] || null;
}

export async function uploadDriveTaskFiles(taskId: string, files: UploadedTaskFile[], context: DriveUploadContext = {}): Promise<UploadedTaskFile[]> {
  if (!USE_SHARED_DRIVE_DATA) {
    return files.map(file => ({ ...file, storageProvider: file.storageProvider || 'local' }));
  }

  if (!isGoogleDriveConfigured) {
    throw new Error('Google Drive is not configured. Add the Google client ID, API key, and app ID.');
  }

  if (!isDriveSharedStorageReady()) {
    throw new Error('Connect Google Drive and choose the shared task root before uploading files.');
  }

  const folders = await ensureTaskFolders(taskId, context);
  const rootFolderId = ensureRootFolderId();
  const uploadedFiles: UploadedTaskFile[] = [];

  for (const file of files) {
    if (!file.blob) {
      uploadedFiles.push({
        ...file,
        storageProvider: file.storageProvider || 'drive',
        driveFolderId: file.driveFolderId || folders.taskFolderId,
      });
      continue;
    }

    try {
      const uploadedFile = await uploadDriveFile(file.name, folders.originalsFolderId, file.blob, file.type || 'application/octet-stream', {
        [APP_PROPERTY_KEY]: 'task-file',
        [ROOT_PROPERTY_KEY]: rootFolderId,
        [TASK_ID_PROPERTY_KEY]: taskId,
      });

      uploadedFiles.push({
        ...file,
        storageProvider: 'drive',
        storagePath: uploadedFile.id,
        url: uploadedFile.webViewLink || uploadedFile.webContentLink || file.url,
        previewUrl: uploadedFile.thumbnailLink || `https://drive.google.com/thumbnail?id=${encodeURIComponent(uploadedFile.id)}&sz=w1000`,
        previewStoragePath: `drive-thumbnail:${uploadedFile.id}`,
        driveFileId: uploadedFile.id,
        driveFolderId: folders.taskFolderId,
        webViewLink: uploadedFile.webViewLink,
        downloadUrl: uploadedFile.webContentLink,
        blob: undefined,
      });
    } catch (error) {
      const message = getFriendlyDriveError(error, 'Upload failed.');
      const help = message.toLowerCase().includes('storage quota') || message.toLowerCase().includes('size')
        ? ` ${uploadLimitHelpText()}`
        : '';
      throw new Error(`${file.name}: ${message}${help}`);
    }
  }

  return uploadedFiles;
}

export async function uploadDrivePreviewImage(storagePath: string, previewBlob: Blob, taskFolderId?: string): Promise<{ url: string; storagePath: string }> {
  if (!USE_SHARED_DRIVE_DATA || !isGoogleDriveConfigured) {
    return {
      storagePath,
      url: URL.createObjectURL(previewBlob),
    };
  }

  if (!isDriveSharedStorageReady()) {
    return {
      storagePath,
      url: URL.createObjectURL(previewBlob),
    };
  }

  const taskId = storagePath.split('/')[0] || 'task';
  const folders = await ensureTaskFolders(taskId, { taskFolderId });
  const rootFolderId = ensureRootFolderId();
  const uploadedFile = await uploadDriveFile(safeNamePart(storagePath.split('/').pop() || 'preview.jpg'), folders.previewsFolderId, previewBlob, 'image/jpeg', {
    [APP_PROPERTY_KEY]: 'task-preview',
    [ROOT_PROPERTY_KEY]: rootFolderId,
    [TASK_ID_PROPERTY_KEY]: taskId,
  });

  return {
    storagePath: uploadedFile.id,
    url: uploadedFile.thumbnailLink || `https://drive.google.com/thumbnail?id=${encodeURIComponent(uploadedFile.id)}&sz=w1000`,
  };
}

export function getDriveFilePublicUrl(_storagePath?: string) {
  return '';
}

export async function fetchDriveTasks(): Promise<Task[]> {
  if (!isDriveSharedStorageReady()) return [];

  const rootFolderId = ensureRootFolderId();
  const metadataFiles = await listDriveFiles([
    `name = '${TASK_METADATA_NAME}'`,
    'trashed = false',
    `appProperties has { key='${APP_PROPERTY_KEY}' and value='task' }`,
    `appProperties has { key='${ROOT_PROPERTY_KEY}' and value='${escapeDriveQuery(rootFolderId)}' }`,
  ].join(' and '));

  const tasks = await Promise.all(metadataFiles.map(async file => {
    const task = await downloadJsonFile<Task>(file.id);
    return {
      ...task,
      driveMetadataFileId: file.id,
    };
  }));

  return tasks;
}

export async function upsertDriveTask(task: Task): Promise<void> {
  if (!isDriveSharedStorageReady()) return;

  const folders = await ensureTaskFolders(task.id, {
    taskCode: task.code,
    taskName: task.name,
    taskFolderId: task.driveFolderId,
  });
  const rootFolderId = ensureRootFolderId();
  const existingMetadataFile = task.driveMetadataFileId ? { id: task.driveMetadataFileId } : await findTaskMetadataFile(task.id);
  const taskPayload = stripFileBlobs({
    ...task,
    driveFolderId: folders.taskFolderId,
    driveMetadataFileId: existingMetadataFile?.id || task.driveMetadataFileId,
  });
  const metadataBlob = new Blob([JSON.stringify(taskPayload, null, 2)], { type: 'application/json' });
  await uploadDriveFile(TASK_METADATA_NAME, folders.taskFolderId, metadataBlob, 'application/json', {
    [APP_PROPERTY_KEY]: 'task',
    [ROOT_PROPERTY_KEY]: rootFolderId,
    [TASK_ID_PROPERTY_KEY]: task.id,
  }, existingMetadataFile?.id);
}

export async function fetchDriveNotifications(): Promise<Notification[]> {
  if (!isDriveSharedStorageReady()) return [];

  const rootFolderId = ensureRootFolderId();
  const notificationFiles = await listDriveFiles([
    'trashed = false',
    `appProperties has { key='${APP_PROPERTY_KEY}' and value='notification' }`,
    `appProperties has { key='${ROOT_PROPERTY_KEY}' and value='${escapeDriveQuery(rootFolderId)}' }`,
  ].join(' and '));

  return Promise.all(notificationFiles.map(file => downloadJsonFile<Notification>(file.id)));
}

export async function upsertDriveNotifications(notifications: Notification[]): Promise<void> {
  if (!isDriveSharedStorageReady() || notifications.length === 0) return;

  const rootFolderId = ensureRootFolderId();
  const { notificationsFolderId } = await ensureSystemFolders();

  for (const notification of notifications) {
    const existingFile = await findNotificationMetadataFile(notification.id);
    const blob = new Blob([JSON.stringify(notification, null, 2)], { type: 'application/json' });
    await uploadDriveFile(`${safeNamePart(notification.id)}.json`, notificationsFolderId, blob, 'application/json', {
      [APP_PROPERTY_KEY]: 'notification',
      [ROOT_PROPERTY_KEY]: rootFolderId,
      [NOTIFICATION_ID_PROPERTY_KEY]: notification.id,
    }, existingFile?.id);
  }
}

async function importDriveFolder(folder: DrivePickerDocument, currentUser: User, environment: Environment): Promise<Task | null> {
  const folderId = folder.id;
  const metadataMatches = await listDriveFiles([
    `name = '${TASK_METADATA_NAME}'`,
    `'${escapeDriveQuery(folderId)}' in parents`,
    'trashed = false',
  ].join(' and '));

  if (metadataMatches[0]?.id) {
    return downloadJsonFile<Task>(metadataMatches[0].id);
  }

  const childFiles = await listDriveFiles([
    `'${escapeDriveQuery(folderId)}' in parents`,
    'trashed = false',
    `mimeType != '${DRIVE_FOLDER_MIME_TYPE}'`,
    `name != '${TASK_METADATA_NAME}'`,
  ].join(' and '));
  const files = childFiles.map(file => driveFileToUploadedTaskFile(file, folderId));
  if (files.length === 0) return null;

  const now = new Date().toISOString();
  const taskId = `drv_${folderId}`;
  const task: Task = {
    id: taskId,
    code: `DRV-${folderId.slice(-6).toUpperCase()}`,
    name: folder.name || 'Imported Drive task',
    taskType: 'others',
    reviewMode: 'full_review',
    environment,
    createdBy: currentUser.id,
    handledBy: [currentUser.id],
    status: 'waiting_reviewer_full_review',
    currentOwnerRole: 'reviewer',
    currentOwnerUserId: null,
    currentOwnerUserIds: [],
    priority: 'not_set',
    deadlineText: null,
    scheduledPublishAt: null,
    publishNote: null,
    publishedAt: null,
    publishReminderSentAt: null,
    versions: [{
      id: `${taskId}_v1`,
      versionNumber: 1,
      submittedBy: currentUser.id,
      submissionNote: 'Imported from Google Drive',
      fileUrl: files[0]?.url || '',
      files,
      createdAt: now,
    }],
    comments: [],
    thumbnailUrl: files.find(file => file.previewUrl)?.previewUrl || '',
    thumbnailStoragePath: files.find(file => file.previewUrl)?.previewStoragePath,
    driveFolderId: folderId,
    createdAt: now,
    updatedAt: now,
  };

  await upsertDriveTask(task);
  return task;
}

async function importDriveFile(fileDoc: DrivePickerDocument, currentUser: User, environment: Environment): Promise<Task | null> {
  const now = new Date().toISOString();
  const taskId = `drv_${fileDoc.id}`;
  const folders = await ensureTaskFolders(taskId, {
    taskCode: `DRV-${fileDoc.id.slice(-6).toUpperCase()}`,
    taskName: fileDoc.name || 'Imported file',
  });
  const file = driveFileFromPickerDocument(fileDoc, folders.taskFolderId);
  const task: Task = {
    id: taskId,
    code: `DRV-${fileDoc.id.slice(-6).toUpperCase()}`,
    name: fileDoc.name || 'Imported Drive file',
    taskType: 'others',
    reviewMode: 'full_review',
    environment,
    createdBy: currentUser.id,
    handledBy: [currentUser.id],
    status: 'waiting_reviewer_full_review',
    currentOwnerRole: 'reviewer',
    currentOwnerUserId: null,
    currentOwnerUserIds: [],
    priority: 'not_set',
    deadlineText: null,
    scheduledPublishAt: null,
    publishNote: null,
    publishedAt: null,
    publishReminderSentAt: null,
    versions: [{
      id: `${taskId}_v1`,
      versionNumber: 1,
      submittedBy: currentUser.id,
      submissionNote: 'Imported from Google Drive',
      fileUrl: file.url,
      files: [file],
      createdAt: now,
    }],
    comments: [],
    thumbnailUrl: file.previewUrl || '',
    thumbnailStoragePath: file.previewStoragePath,
    driveFolderId: folders.taskFolderId,
    createdAt: now,
    updatedAt: now,
  };

  await upsertDriveTask(task);
  return task;
}

export async function importDriveSelectionToTasks(documents: DrivePickerDocument[], currentUser: User, environment: Environment): Promise<Task[]> {
  if (!isDriveSharedStorageReady() || documents.length === 0) return [];

  const tasks: Task[] = [];
  for (const document of documents) {
    const isFolder = document.mimeType === DRIVE_FOLDER_MIME_TYPE || document.type === 'folder';
    const task = isFolder
      ? await importDriveFolder(document, currentUser, environment)
      : await importDriveFile(document, currentUser, environment);

    if (task) tasks.push(task);
  }

  return tasks;
}

export const uploadTaskFiles = uploadDriveTaskFiles;
export const uploadTaskPreviewImage = uploadDrivePreviewImage;
export const getTaskFilePublicUrl = getDriveFilePublicUrl;
