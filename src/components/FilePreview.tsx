import React from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
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

export function TaskThumbnail({ task }: { task: Task }) {
  const file = getTaskFiles(task.versions[0])[0];
  const kind = getFileKind(file);

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

  const Icon = kind === 'pdf' ? FileText : ImageIcon;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-slate-100 text-slate-400">
      <Icon className="h-5 w-5" />
      <span className="max-w-[80px] truncate text-[10px] font-black uppercase">{kind === 'pdf' ? 'PDF' : 'FILE'}</span>
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

  if (kind === 'image') {
    return (
      <button type="button" onClick={() => onImageClick?.(file.url)} className="flex h-full w-full items-center justify-center">
        <img src={file.url} alt={file.name} className="max-h-full max-w-full object-contain" />
      </button>
    );
  }

  if (kind === 'video') {
    return <video src={file.url} controls className="max-h-full max-w-full rounded-lg bg-black" />;
  }

  if (kind === 'pdf') {
    return <iframe src={file.url} title={file.name} className="h-full min-h-[70vh] w-full rounded-lg bg-white" />;
  }

  return (
    <a href={file.url} target="_blank" rel="noreferrer" className="rounded-xl bg-white px-5 py-3 text-sm font-black text-indigo-600 shadow-sm">
      Open {file.name}
    </a>
  );
}
