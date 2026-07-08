import { UploadedTaskFile } from './types';
import { ensureDriveAccessToken, googleApiKey, hasUsableDriveToken } from './driveAuth';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v']);
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

type DriveLinkMetadata = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
};

function getUrlExtension(url: URL) {
  const cleanPath = url.pathname.split('/').pop() || '';
  const extension = cleanPath.split('.').pop()?.toLowerCase() || '';
  return extension === cleanPath.toLowerCase() ? '' : extension;
}

function normalizeLinkedUrl(rawUrl: string) {
  const value = rawUrl.trim();
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Enter a valid http or https link.');
  }
  return url;
}

function isGoogleDriveHost(url: URL) {
  const host = url.hostname.toLowerCase();
  return host === 'drive.google.com' || host.endsWith('.drive.google.com') || host === 'docs.google.com' || host.endsWith('.docs.google.com');
}

function getGoogleDriveFileId(url: URL) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (host === 'drive.google.com' || host.endsWith('.drive.google.com')) {
    const fileMatch = path.match(/\/file\/d\/([^/]+)/);
    if (fileMatch?.[1]) return fileMatch[1];

    const folderMatch = path.match(/\/folders\/([^/]+)/);
    if (folderMatch?.[1]) return folderMatch[1];

    const queryId = url.searchParams.get('id');
    if (queryId) return queryId;
  }

  if (host === 'docs.google.com' || host.endsWith('.docs.google.com')) {
    const docsMatch = path.match(/\/(?:document|presentation|spreadsheets|forms|drawings)\/d\/([^/]+)/);
    if (docsMatch?.[1]) return docsMatch[1];
  }

  return null;
}

async function fetchDriveLinkMetadata(fileId: string): Promise<DriveLinkMetadata | null> {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink',
    supportsAllDrives: 'true',
  });

  const headers: HeadersInit = {};
  if (hasUsableDriveToken()) {
    try {
      const accessToken = await ensureDriveAccessToken();
      headers.Authorization = `Bearer ${accessToken}`;
    } catch {
      // Public Drive links may still resolve with the API key fallback.
      if (googleApiKey) params.set('key', googleApiKey);
    }
  } else if (googleApiKey) {
    params.set('key', googleApiKey);
  }

  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${params.toString()}`, { headers });
  if (!response.ok) return null;
  return response.json() as Promise<DriveLinkMetadata>;
}

function getGoogleDocsPreviewUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  if (host !== 'docs.google.com' && !host.endsWith('.docs.google.com')) return null;

  const match = url.pathname.match(/\/(document|presentation|spreadsheets|forms|drawings)\/d\/([^/]+)/);
  if (!match?.[1] || !match[2]) return null;

  return `https://docs.google.com/${match[1]}/d/${encodeURIComponent(match[2])}/preview`;
}

export function getLinkedFileEmbedUrl(rawUrl?: string) {
  if (!rawUrl) return null;

  try {
    const url = normalizeLinkedUrl(rawUrl);
    const docsPreviewUrl = getGoogleDocsPreviewUrl(url);
    if (docsPreviewUrl) return docsPreviewUrl;

    const driveFileId = getGoogleDriveFileId(url);
    if (driveFileId && url.hostname.toLowerCase().includes('drive.google.com')) {
      const previewUrl = new URL(`https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`);
      const resourceKey = url.searchParams.get('resourcekey');
      if (resourceKey) previewUrl.searchParams.set('resourcekey', resourceKey);
      return previewUrl.toString();
    }
  } catch {
    return null;
  }

  return null;
}

export function getLinkedFileThumbnailUrl(rawUrl?: string) {
  if (!rawUrl) return null;

  try {
    const url = normalizeLinkedUrl(rawUrl);
    const driveFileId = getGoogleDriveFileId(url);
    if (!driveFileId) return null;
    const thumbnailUrl = new URL('https://drive.google.com/thumbnail');
    thumbnailUrl.searchParams.set('id', driveFileId);
    thumbnailUrl.searchParams.set('sz', 'w1000');
    const resourceKey = url.searchParams.get('resourcekey');
    if (resourceKey) thumbnailUrl.searchParams.set('resourcekey', resourceKey);
    return thumbnailUrl.toString();
  } catch {
    return null;
  }
}

export function inferLinkedFileType(rawUrl: string) {
  const url = normalizeLinkedUrl(rawUrl);
  const extension = getUrlExtension(url);

  if (IMAGE_EXTENSIONS.has(extension)) return `image/${extension === 'jpg' ? 'jpeg' : extension}`;
  if (VIDEO_EXTENSIONS.has(extension)) return `video/${extension === 'mov' || extension === 'm4v' ? 'mp4' : extension}`;
  if (extension === 'pdf') return 'application/pdf';
  return 'text/uri-list';
}

function getTypeFromMetadata(metadata: DriveLinkMetadata | null, fallbackUrl: string) {
  return metadata?.mimeType || inferLinkedFileType(fallbackUrl);
}

export function getLinkedFileName(rawUrl: string) {
  const url = normalizeLinkedUrl(rawUrl);
  const driveFileId = getGoogleDriveFileId(url);
  if (driveFileId && isGoogleDriveHost(url)) {
    if (url.hostname.toLowerCase().includes('docs.google.com')) return 'Google Docs file';
    if (url.pathname.includes('/folders/')) return 'Google Drive folder';
    return 'Google Drive file';
  }

  const lastPathPart = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
  return lastPathPart || url.hostname.replace(/^www\./, '');
}

export function createLinkedTaskFile(rawUrl: string): UploadedTaskFile {
  const parsedUrl = normalizeLinkedUrl(rawUrl);
  if (!isGoogleDriveHost(parsedUrl) || !getGoogleDriveFileId(parsedUrl)) {
    throw new Error('Paste a shared Google Drive or Google Docs link.');
  }

  const url = parsedUrl.toString();
  const type = inferLinkedFileType(url);
  const thumbnailUrl = getLinkedFileThumbnailUrl(url) || (type.startsWith('image/') ? url : undefined);
  const id = Math.random().toString(36).substring(7);

  return {
    id,
    name: getLinkedFileName(url),
    type,
    size: 0,
    url,
    storageProvider: 'link',
    webViewLink: url,
    previewUrl: thumbnailUrl,
    previewStoragePath: thumbnailUrl ? `linked-preview:${id}` : undefined,
  };
}

export async function fetchLinkTitleScraped(url: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/metadata?url=${encodeURIComponent(url)}`);
    if (!response.ok) return null;
    const data = await response.json() as { title?: string };
    return data.title || null;
  } catch {
    return null;
  }
}

export async function createLinkedTaskFileWithMetadata(rawUrl: string): Promise<UploadedTaskFile> {
  const parsedUrl = normalizeLinkedUrl(rawUrl);
  if (!isGoogleDriveHost(parsedUrl)) {
    throw new Error('Paste a shared Google Drive or Google Docs link.');
  }

  const driveFileId = getGoogleDriveFileId(parsedUrl);
  if (!driveFileId) {
    throw new Error('Paste a shared Google Drive or Google Docs link.');
  }

  const fallbackFile = createLinkedTaskFile(rawUrl);
  const metadata = await fetchDriveLinkMetadata(driveFileId).catch(() => null);

  let name = fallbackFile.name;
  if (metadata?.name) {
    name = metadata.name;
  } else {
    const scrapedName = await fetchLinkTitleScraped(rawUrl);
    if (scrapedName) {
      name = scrapedName;
    }
  }

  const previewUrl = metadata?.thumbnailLink || fallbackFile.previewUrl;
  const url = metadata?.webViewLink || fallbackFile.url;

  return {
    ...fallbackFile,
    id: driveFileId,
    name,
    type: getTypeFromMetadata(metadata, url),
    size: Number(metadata?.size || fallbackFile.size || 0),
    url,
    storagePath: driveFileId,
    previewUrl,
    previewStoragePath: previewUrl ? `drive-thumbnail:${driveFileId}` : fallbackFile.previewStoragePath,
    driveFileId,
    webViewLink: metadata?.webViewLink || fallbackFile.webViewLink,
    downloadUrl: metadata?.webContentLink,
  };
}

export function isLinkedTaskFile(file?: Pick<UploadedTaskFile, 'storageProvider'>) {
  return file?.storageProvider === 'link';
}

export function needsLinkedTaskFileMetadata(file: UploadedTaskFile) {
  return isLinkedTaskFile(file) && (
    !file.driveFileId ||
    !file.previewUrl ||
    file.name === 'Google Drive file' ||
    file.name === 'Google Docs file' ||
    file.name === 'Google Drive folder'
  );
}

export async function enrichLinkedTaskFileMetadata(file: UploadedTaskFile): Promise<UploadedTaskFile> {
  if (!needsLinkedTaskFileMetadata(file)) return file;

  const parsedUrl = normalizeLinkedUrl(file.webViewLink || file.url);
  const driveFileId = getGoogleDriveFileId(parsedUrl);
  if (!driveFileId) return file;

  const metadata = await fetchDriveLinkMetadata(driveFileId).catch(() => null);

  let name = file.name;
  if (metadata?.name) {
    name = metadata.name;
  } else if (file.name === 'Google Drive file' || file.name === 'Google Docs file' || file.name === 'Google Drive folder') {
    const scrapedName = await fetchLinkTitleScraped(file.webViewLink || file.url);
    if (scrapedName) {
      name = scrapedName;
    }
  }

  if (!metadata) return {
    ...file,
    name,
    driveFileId,
    storagePath: file.storagePath || driveFileId,
  };

  const previewUrl = metadata.thumbnailLink || file.previewUrl || getLinkedFileThumbnailUrl(file.webViewLink || file.url) || undefined;
  const url = metadata.webViewLink || file.webViewLink || file.url;

  return {
    ...file,
    name,
    type: getTypeFromMetadata(metadata, url),
    size: Number(metadata.size || file.size || 0),
    url,
    storagePath: file.storagePath || driveFileId,
    previewUrl,
    previewStoragePath: previewUrl ? `drive-thumbnail:${driveFileId}` : file.previewStoragePath,
    driveFileId,
    webViewLink: metadata.webViewLink || file.webViewLink,
    downloadUrl: metadata.webContentLink || file.downloadUrl,
  };
}

export function getLinkHostLabel(rawUrl?: string) {
  if (!rawUrl) return 'Linked file';

  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'Linked file';
  }
}

export async function fetchFreshDriveThumbnail(fileId: string): Promise<string | null> {
  const metadata = await fetchDriveLinkMetadata(fileId).catch(() => null);
  return metadata?.thumbnailLink || null;
}

export function parseAssignmentLink(linkStr: string): { url: string; name: string } {
  if (!linkStr) return { url: '', name: '' };
  const delimiterIndex = linkStr.indexOf('|');
  if (delimiterIndex === -1) {
    return { url: linkStr, name: linkStr };
  }
  const url = linkStr.substring(0, delimiterIndex);
  const name = linkStr.substring(delimiterIndex + 1);
  return { url, name: name || url };
}

