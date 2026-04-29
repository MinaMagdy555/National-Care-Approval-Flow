import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, FileWarning, Film, Image as ImageIcon } from 'lucide-react';
import { Task, UploadedTaskFile } from '../lib/types';
import {
  getExpectedFilePreview,
  getTaskFiles,
  isStoredPreviewUrl,
  isStoredTaskThumbnail,
  optimizeTaskThumbnailForPreview,
  taskNeedsThumbnailPreview,
} from '../lib/previewUtils';
import { useAppStore } from '../lib/store';

const thumbnailPreviewBackfillAttempts = new Set<string>();
const thumbnailPreviewBackfillQueue: Array<() => Promise<void>> = [];
const MAX_THUMBNAIL_BACKFILLS = 2;
let activeThumbnailBackfills = 0;

function runNextThumbnailBackfill() {
  if (activeThumbnailBackfills >= MAX_THUMBNAIL_BACKFILLS) return;

  const job = thumbnailPreviewBackfillQueue.shift();
  if (!job) return;

  activeThumbnailBackfills += 1;
  void job().finally(() => {
    activeThumbnailBackfills -= 1;
    runNextThumbnailBackfill();
  });
}

function enqueueThumbnailBackfill(job: () => Promise<void>) {
  thumbnailPreviewBackfillQueue.push(job);
  runNextThumbnailBackfill();
}

export function getFileKind(file?: Pick<UploadedTaskFile, 'type' | 'name' | 'url'>): 'image' | 'video' | 'pdf' | 'file' {
  if (!file) return 'file';
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  const urlPath = file.url.split('?')[0].toLowerCase();
  const source = `${name} ${urlPath}`;

  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(source) || file.url.includes('images.unsplash.com')) return 'image';
  if (type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(source)) return 'video';
  if (type === 'application/pdf' || source.includes('.pdf')) return 'pdf';
  return 'file';
}

export function getPdfPreviewUrl(url: string) {
  return `${url}#toolbar=0&navpanes=0&scrollbar=0&page=1&view=FitH`;
}

export function isLocalOnlyFileUrl(url?: string) {
  return Boolean(url?.startsWith('blob:'));
}

function MissingSharedFile({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-100 p-3 text-center text-slate-500">
      <FileWarning className={compact ? 'h-5 w-5' : 'h-8 w-8'} />
      <span className={`${compact ? 'text-[10px]' : 'text-sm'} font-black uppercase tracking-wide`}>
        File needs re-upload
      </span>
      {!compact && (
        <p className="max-w-sm text-xs font-semibold text-slate-400">
          This task was migrated before its file was uploaded to shared storage.
        </p>
      )}
    </div>
  );
}

function LightweightFilePlaceholder({
  file,
  compact = false,
}: {
  file?: Pick<UploadedTaskFile, 'name' | 'type' | 'url'>;
  compact?: boolean;
}) {
  const kind = getFileKind(file);
  const Icon = kind === 'video' ? Film : kind === 'pdf' ? FileText : kind === 'image' ? ImageIcon : FileWarning;
  const label = kind === 'file' ? 'File' : kind.toUpperCase();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-slate-50 to-slate-200 p-2 text-center text-slate-500">
      <div className={compact ? 'rounded-md bg-white/80 p-1.5 shadow-sm' : 'rounded-lg bg-white/80 p-2 shadow-sm'}>
        <Icon className={compact ? 'h-4 w-4' : 'h-6 w-6'} />
      </div>
      <span className={compact ? 'text-[9px] font-black uppercase tracking-wide' : 'text-[10px] font-black uppercase tracking-wide'}>
        {label} Preview
      </span>
      {file?.name && !compact && (
        <span className="max-w-[90%] truncate text-[10px] font-bold text-slate-400">{file.name}</span>
      )}
    </div>
  );
}

function PdfCanvasPreview({
  file,
  compact = false,
}: {
  file: UploadedTaskFile;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    async function renderPdfPage() {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

        const loadingTask = pdfjs.getDocument({
          url: file.url,
          withCredentials: false,
        });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: compact ? 0.28 : 0.5 });
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context || cancelled) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
      } catch (error) {
        console.error('Failed to render PDF preview', error);
        if (!cancelled) setFailed(true);
      }
    }

    renderPdfPage();

    return () => {
      cancelled = true;
    };
  }, [compact, file.url]);

  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-100 p-2 text-center text-slate-500">
        <FileWarning className="h-5 w-5" />
        <span className="text-[10px] font-black uppercase tracking-wide">PDF preview unavailable</span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-slate-200">
      <canvas ref={canvasRef} className="h-full w-full object-cover" aria-label={`${file.name} preview`} />
    </div>
  );
}

export function FileContentThumbnail({
  file,
  alt,
  className = '',
}: {
  file?: UploadedTaskFile;
  alt: string;
  className?: string;
}) {
  const previewUrl = file?.previewUrl || '';
  const [previewLoadFailed, setPreviewLoadFailed] = useState(false);

  useEffect(() => {
    setPreviewLoadFailed(false);
  }, [previewUrl]);

  if (!file) {
    return <MissingSharedFile compact />;
  }

  if (isStoredPreviewUrl(file) && !previewLoadFailed) {
    return (
      <img
        src={file.previewUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        onError={() => setPreviewLoadFailed(true)}
        className={className || 'h-full w-full object-cover'}
      />
    );
  }

  if (isLocalOnlyFileUrl(file.url)) {
    return <MissingSharedFile compact />;
  }

  return <LightweightFilePlaceholder file={file} compact />;
}

export function TaskThumbnail({ task }: { task: Task }) {
  const { updateTaskMediaPreviews } = useAppStore();
  const thumbnailRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const updateTaskMediaPreviewsRef = useRef(updateTaskMediaPreviews);
  const [isVisible, setIsVisible] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const file = getTaskFiles(task.versions[0])[0];
  const hasLocalOnlyFile = isLocalOnlyFileUrl(task.thumbnailUrl) || isLocalOnlyFileUrl(file?.url);
  const expectedPreview = !hasLocalOnlyFile ? getExpectedFilePreview(task.id, file) : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    updateTaskMediaPreviewsRef.current = updateTaskMediaPreviews;
  }, [updateTaskMediaPreviews]);

  useEffect(() => {
    const element = thumbnailRef.current;
    if (!element) return;

    if (!('IntersectionObserver' in window)) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '240px' });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isVisible || hasLocalOnlyFile || !taskNeedsThumbnailPreview(task) || thumbnailPreviewBackfillAttempts.has(task.id)) return;

    thumbnailPreviewBackfillAttempts.add(task.id);
    const taskSnapshot = task;

    enqueueThumbnailBackfill(async () => {
      if (mountedRef.current) setIsGeneratingPreview(true);

      try {
        const updates = await optimizeTaskThumbnailForPreview(taskSnapshot);
        if (updates.changed) {
          updateTaskMediaPreviewsRef.current(taskSnapshot.id, updates);
        }
      } catch (error) {
        console.warn('Could not create task thumbnail preview', error);
        thumbnailPreviewBackfillAttempts.delete(taskSnapshot.id);
      } finally {
        if (mountedRef.current) setIsGeneratingPreview(false);
      }
    });
  }, [hasLocalOnlyFile, isVisible, task]);

  let content: React.ReactNode;

  if (hasLocalOnlyFile) {
    content = <MissingSharedFile compact />;
  } else if (isStoredTaskThumbnail(task)) {
    const previewFile = file || { id: task.id, name: task.name, type: 'image/jpeg', size: 0, url: task.thumbnailUrl };
    content = (
      <FileContentThumbnail
        file={{
          ...previewFile,
          previewUrl: task.thumbnailUrl,
          previewStoragePath: task.thumbnailStoragePath,
        }}
        alt={task.name}
      />
    );
  } else if (file && expectedPreview) {
    content = (
      <FileContentThumbnail
        file={{
          ...file,
          ...expectedPreview,
        }}
        alt={task.name}
      />
    );
  } else {
    content = <FileContentThumbnail file={file} alt={task.name} />;
  }

  return (
    <div ref={thumbnailRef} className="relative h-full w-full">
      {content}
      {isGeneratingPreview && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-white/80 to-transparent py-1">
          <span className="h-1 w-10 animate-pulse rounded-full bg-indigo-500/70" />
        </div>
      )}
    </div>
  );
}

export function FilePreview({
  file,
  onImageClick,
}: {
  file?: UploadedTaskFile;
  onImageClick?: (url: string) => void;
}) {
  const kind = getFileKind(file);

  if (!file) {
    return <div className="flex h-full w-full items-center justify-center text-sm font-bold text-slate-400">No file uploaded</div>;
  }

  if (isLocalOnlyFileUrl(file.url)) {
    return <MissingSharedFile />;
  }

  if (kind === 'image') {
    return (
      <button type="button" onClick={() => onImageClick?.(file.url)} className="flex h-full w-full items-center justify-center bg-slate-100">
        <img src={file.url} alt={file.name} className="block max-h-full max-w-full object-contain" />
      </button>
    );
  }

  if (kind === 'video') {
    return <video src={file.url} controls className="block max-h-full max-w-full rounded-lg bg-black object-contain" />;
  }

  if (kind === 'pdf') {
    return (
      <div className="relative h-full w-full">
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900/90 text-white shadow-sm transition-colors hover:bg-slate-950"
          aria-label="Open PDF in new tab"
          title="Open PDF in new tab"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <PdfCanvasPreview file={file} />
      </div>
    );
  }

  return (
    <a href={file.url} target="_blank" rel="noreferrer" className="rounded-xl bg-white px-5 py-3 text-sm font-black text-indigo-600 shadow-sm">
      Open {file.name}
    </a>
  );
}
