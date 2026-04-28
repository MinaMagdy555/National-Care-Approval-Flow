import React from 'react';
import { ExternalLink, FileWarning, Image as ImageIcon } from 'lucide-react';
import { Task, TaskVersion, UploadedTaskFile } from '../lib/types';

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

export function getFileKind(file?: Pick<UploadedTaskFile, 'type' | 'name' | 'url'>): 'image' | 'video' | 'pdf' | 'file' {
  if (!file) return 'file';
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name) || file.url.includes('images.unsplash.com')) return 'image';
  if (type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(name)) return 'video';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
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

export function TaskThumbnail({ task }: { task: Task }) {
  const file = getTaskFiles(task.versions[0])[0];
  const kind = getFileKind(file);

  if (isLocalOnlyFileUrl(task.thumbnailUrl || file?.url)) {
    return <MissingSharedFile compact />;
  }

  if (task.thumbnailUrl || kind === 'image') {
    return (
      <img
        src={task.thumbnailUrl || file?.url}
        alt={task.name}
        className="h-full w-full object-cover"
      />
    );
  }

  if (kind === 'video') {
    return (
      <video
        src={file.url}
        className="h-full w-full object-cover"
        muted
        playsInline
        preload="metadata"
      />
    );
  }

  if (kind === 'pdf') {
    return (
      <div className="relative h-full w-full overflow-hidden bg-white">
        <iframe
          src={getPdfPreviewUrl(file.url)}
          title={`${file.name} preview`}
          className="pointer-events-none h-[240%] w-[240%] origin-top-left scale-[0.42] border-0 bg-white"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-slate-100 text-slate-400">
      <ImageIcon className="h-5 w-5" />
      <span className="max-w-[80px] truncate text-[10px] font-black uppercase">FILE</span>
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
        <iframe src={file.url} title={file.name} className="h-full w-full rounded-lg bg-white" />
      </div>
    );
  }

  return (
    <a href={file.url} target="_blank" rel="noreferrer" className="rounded-xl bg-white px-5 py-3 text-sm font-black text-indigo-600 shadow-sm">
      Open {file.name}
    </a>
  );
}
