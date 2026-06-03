import { UploadedTaskFile } from './types';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v']);

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
      return `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/preview`;
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
    return driveFileId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w1000` : null;
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

export function isLinkedTaskFile(file?: Pick<UploadedTaskFile, 'storageProvider'>) {
  return file?.storageProvider === 'link';
}

export function getLinkHostLabel(rawUrl?: string) {
  if (!rawUrl) return 'Linked file';

  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'Linked file';
  }
}
