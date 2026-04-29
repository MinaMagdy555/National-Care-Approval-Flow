import { Task, TaskComment, TaskCommentSection, TaskVersion, UploadedTaskFile } from './types';
import { uploadTaskPreviewImage } from './supabaseDb';

const PREVIEW_MAX_EDGE = 420;
const PREVIEW_JPEG_QUALITY = 0.45;
const VIDEO_PREVIEW_TIME_SECONDS = 0.1;

type PreviewSource = UploadedTaskFile & { blob?: Blob };

type PreviewUpload = {
  previewUrl: string;
  previewStoragePath: string;
};

function safePathPart(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'preview';
}

function getPreviewSize(width: number, height: number) {
  if (width <= 0 || height <= 0) return { width: PREVIEW_MAX_EDGE, height: PREVIEW_MAX_EDGE };

  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('Could not create preview image.'));
    }, 'image/jpeg', PREVIEW_JPEG_QUALITY);
  });
}

async function createImagePreviewBlob(source: Blob | string): Promise<Blob> {
  const image = new Image();
  const objectUrl = typeof source === 'string' ? source : URL.createObjectURL(source);

  image.crossOrigin = 'anonymous';

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not load image preview source.'));
      image.src = objectUrl;
    });

    const size = getPreviewSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available.');

    canvas.width = size.width;
    canvas.height = size.height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    return canvasToJpegBlob(canvas);
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(objectUrl);
  }
}

async function createPdfPreviewBlob(file: PreviewSource): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

  const loadingTask = file.blob
    ? pdfjs.getDocument({ data: await file.blob.arrayBuffer() })
    : pdfjs.getDocument({ url: file.url, withCredentials: false });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const size = getPreviewSize(viewport.width, viewport.height);
  const scaledViewport = page.getViewport({ scale: Math.min(size.width / viewport.width, size.height / viewport.height) });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');

  canvas.width = Math.max(1, Math.floor(scaledViewport.width));
  canvas.height = Math.max(1, Math.floor(scaledViewport.height));
  await page.render({ canvas, canvasContext: context, viewport: scaledViewport }).promise;
  return canvasToJpegBlob(canvas);
}

async function createVideoPreviewBlob(file: PreviewSource): Promise<Blob> {
  const video = document.createElement('video');
  const objectUrl = file.blob ? URL.createObjectURL(file.blob) : file.url;

  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';

  try {
    await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => reject(new Error('Video preview timed out.')), 10000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timeoutId);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeoutId);
        reject(new Error('Could not load video preview source.'));
      };
      video.src = objectUrl;
      video.load();
    });

    const duration = Number.isFinite(video.duration) ? video.duration : VIDEO_PREVIEW_TIME_SECONDS;
    const previewTime = Math.min(VIDEO_PREVIEW_TIME_SECONDS, Math.max(0, duration - 0.01));

    if (previewTime <= 0.01) {
      await new Promise<void>((resolve, reject) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        const timeoutId = window.setTimeout(() => reject(new Error('Video frame load timed out.')), 10000);
        video.onloadeddata = () => {
          window.clearTimeout(timeoutId);
          resolve();
        };
        video.onerror = () => {
          window.clearTimeout(timeoutId);
          reject(new Error('Could not load video preview frame.'));
        };
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => reject(new Error('Video frame seek timed out.')), 10000);
        video.onseeked = () => {
          window.clearTimeout(timeoutId);
          resolve();
        };
        video.onerror = () => {
          window.clearTimeout(timeoutId);
          reject(new Error('Could not seek video preview frame.'));
        };
        video.currentTime = previewTime;
      });
    }

    const size = getPreviewSize(video.videoWidth, video.videoHeight);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available.');

    canvas.width = size.width;
    canvas.height = size.height;
    context.drawImage(video, 0, 0, size.width, size.height);
    return canvasToJpegBlob(canvas);
  } finally {
    if (file.blob) URL.revokeObjectURL(objectUrl);
  }
}

function getFileKind(file: Pick<UploadedTaskFile, 'type' | 'name' | 'url'>): 'image' | 'video' | 'pdf' | 'file' {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name) || file.url.includes('images.unsplash.com')) return 'image';
  if (type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(name)) return 'video';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  return 'file';
}

export function isStoredPreviewUrl(file?: Pick<UploadedTaskFile, 'previewUrl' | 'previewStoragePath'>) {
  return Boolean(file?.previewUrl && file.previewStoragePath);
}

export function isStoredTaskThumbnail(task: Pick<Task, 'thumbnailUrl' | 'thumbnailStoragePath'>) {
  return Boolean(task.thumbnailUrl && task.thumbnailStoragePath);
}

export function isDataImageUrl(url?: string) {
  return Boolean(url?.startsWith('data:image/'));
}

export async function createLowResPreviewBlob(file: PreviewSource): Promise<Blob | null> {
  const kind = getFileKind(file);

  try {
    if (kind === 'image') {
      return createImagePreviewBlob(file.blob || file.url);
    }
    if (kind === 'pdf') {
      return createPdfPreviewBlob(file);
    }
    if (kind === 'video') {
      return createVideoPreviewBlob(file);
    }
  } catch (error) {
    console.warn(`Could not create low-resolution preview for ${file.name}`, error);
  }

  return null;
}

export async function createLowResCommentImageBlob(source: Blob | string): Promise<Blob | null> {
  try {
    return createImagePreviewBlob(source);
  } catch (error) {
    console.warn('Could not create low-resolution comment preview', error);
    return null;
  }
}

export async function uploadFilePreview(taskId: string, file: PreviewSource): Promise<PreviewUpload | null> {
  const blob = await createLowResPreviewBlob(file);
  if (!blob) return null;

  const previewStoragePath = `${safePathPart(taskId)}/previews/${safePathPart(file.id)}.jpg`;
  const uploadedPreview = await uploadTaskPreviewImage(previewStoragePath, blob);

  return {
    previewUrl: uploadedPreview.url,
    previewStoragePath: uploadedPreview.storagePath,
  };
}

export async function uploadCommentImagePreview(taskId: string, sectionId: string, source: Blob | string): Promise<{ imageUrl: string; imageStoragePath: string } | null> {
  const blob = await createLowResCommentImageBlob(source);
  if (!blob) return null;

  const imageStoragePath = `${safePathPart(taskId)}/comment-previews/${safePathPart(sectionId)}.jpg`;
  const uploadedPreview = await uploadTaskPreviewImage(imageStoragePath, blob);

  return {
    imageUrl: uploadedPreview.url,
    imageStoragePath: uploadedPreview.storagePath,
  };
}

export async function addLowResPreviewsToFiles(taskId: string, files: UploadedTaskFile[], sourceFiles: UploadedTaskFile[] = files): Promise<UploadedTaskFile[]> {
  const sourcesById = new Map(sourceFiles.map(file => [file.id, file]));

  return Promise.all(files.map(async file => {
    if (isStoredPreviewUrl(file)) return file;

    const sourceFile = sourcesById.get(file.id) || file;
    const preview = await uploadFilePreview(taskId, { ...file, blob: sourceFile.blob });
    return preview ? { ...file, ...preview } : file;
  }));
}

export function getTaskFiles(version?: TaskVersion): UploadedTaskFile[] {
  if (!version) return [];
  if (version.files && version.files.length > 0) return version.files;

  return [{
    id: version.id,
    name: 'Uploaded file',
    type: version.fileUrl.includes('images.unsplash.com') ? 'image/jpeg' : '',
    size: 0,
    url: version.fileUrl,
  }];
}

export function taskNeedsPreviewOptimization(task: Task) {
  const hasMissingFilePreview = task.versions.some(version => getTaskFiles(version).some(file => !isStoredPreviewUrl(file)));
  const hasBase64CommentImage = (task.comments || []).some(comment => comment.sections.some(section => isDataImageUrl(section.imageUrl)));
  return hasMissingFilePreview || hasBase64CommentImage;
}

export async function optimizeTaskMediaForPreview(task: Task): Promise<{
  versions: TaskVersion[];
  comments?: TaskComment[];
  thumbnailUrl: string;
  thumbnailStoragePath?: string;
  changed: boolean;
}> {
  let changed = false;

  const versions = await Promise.all(task.versions.map(async version => {
    const files = getTaskFiles(version);
    if (files.length === 0 || files.every(isStoredPreviewUrl)) return version;

    const previewedFiles = await addLowResPreviewsToFiles(task.id, files);
    if (previewedFiles.some((file, index) => file.previewStoragePath !== files[index]?.previewStoragePath)) {
      changed = true;
    }

    return {
      ...version,
      files: previewedFiles,
      fileUrl: previewedFiles[0]?.url || version.fileUrl,
    };
  }));

  const comments = await Promise.all((task.comments || []).map(async comment => {
    const sections = await Promise.all(comment.sections.map(async section => {
      if (!isDataImageUrl(section.imageUrl) || section.imageStoragePath) return section;

      const uploadedImage = await uploadCommentImagePreview(task.id, section.id, section.imageUrl || '');
      if (!uploadedImage) return section;
      changed = true;
      return {
        ...section,
        ...uploadedImage,
      };
    }));

    return {
      ...comment,
      sections,
    };
  }));

  const firstPreviewFile = getTaskFiles(versions[0]).find(isStoredPreviewUrl);
  const thumbnailUrl = firstPreviewFile?.previewUrl || task.thumbnailUrl;
  const thumbnailStoragePath = firstPreviewFile?.previewStoragePath || task.thumbnailStoragePath;
  if (thumbnailUrl !== task.thumbnailUrl || thumbnailStoragePath !== task.thumbnailStoragePath) {
    changed = true;
  }

  return {
    versions,
    comments,
    thumbnailUrl,
    thumbnailStoragePath,
    changed,
  };
}
