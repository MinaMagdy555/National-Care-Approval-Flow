import { Notification, Task, UploadedTaskFile } from './types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { uploadLimitHelpText } from './uploadLimits';

const TASK_FILES_BUCKET = 'task-files';

type TaskRow = {
  id: string;
  payload: Task;
};

type NotificationRow = {
  id: string;
  payload: Notification;
};

function ensureSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }
  return supabase;
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

function safeFileName(name: string) {
  return name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'upload';
}

export async function uploadTaskFiles(taskId: string, files: UploadedTaskFile[]): Promise<UploadedTaskFile[]> {
  if (!isSupabaseConfigured || !supabase) return files;

  const uploadedFiles: UploadedTaskFile[] = [];

  for (const file of files) {
    if (!file.blob) {
      uploadedFiles.push(file);
      continue;
    }

    const storagePath = `${taskId}/${file.id}-${safeFileName(file.name)}`;
    const { error } = await supabase.storage
      .from(TASK_FILES_BUCKET)
      .upload(storagePath, file.blob, {
        contentType: file.type || 'application/octet-stream',
        upsert: true,
      });

    if (error) {
      const message = 'message' in error ? error.message : 'Upload failed.';
      const help = message.toLowerCase().includes('maximum allowed size')
        ? ` ${uploadLimitHelpText()}`
        : '';
      throw new Error(`${file.name}: ${message}${help}`);
    }

    const { data } = supabase.storage.from(TASK_FILES_BUCKET).getPublicUrl(storagePath);

    uploadedFiles.push({
      ...file,
      storagePath,
      url: data.publicUrl,
      blob: undefined,
    });
  }

  return uploadedFiles;
}

export async function uploadTaskPreviewImage(storagePath: string, previewBlob: Blob): Promise<{ url: string; storagePath: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      storagePath,
      url: URL.createObjectURL(previewBlob),
    };
  }

  const { error } = await supabase.storage
    .from(TASK_FILES_BUCKET)
    .upload(storagePath, previewBlob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) {
    const message = 'message' in error ? error.message : 'Preview upload failed.';
    throw new Error(`${storagePath}: ${message}`);
  }

  const { data } = supabase.storage.from(TASK_FILES_BUCKET).getPublicUrl(storagePath);

  return {
    storagePath,
    url: data.publicUrl,
  };
}

export function getTaskFilePublicUrl(storagePath: string) {
  if (!isSupabaseConfigured || !supabase) return '';

  const { data } = supabase.storage.from(TASK_FILES_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function fetchSupabaseTasks(): Promise<Task[]> {
  const client = ensureSupabase();
  const { data, error } = await client
    .from('approval_tasks')
    .select('id,payload')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return ((data || []) as TaskRow[]).map(row => row.payload);
}

export async function upsertSupabaseTask(task: Task): Promise<void> {
  const client = ensureSupabase();
  const sanitizedTask = stripFileBlobs(task);
  const { error } = await client
    .from('approval_tasks')
    .upsert({
      id: sanitizedTask.id,
      payload: sanitizedTask,
      environment: sanitizedTask.environment,
      created_by: sanitizedTask.createdBy,
      status: sanitizedTask.status,
      updated_at: sanitizedTask.updatedAt,
    });

  if (error) throw error;
}

export async function fetchSupabaseNotifications(): Promise<Notification[]> {
  const client = ensureSupabase();
  const { data, error } = await client
    .from('approval_notifications')
    .select('id,payload')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return ((data || []) as NotificationRow[]).map(row => row.payload);
}

export async function upsertSupabaseNotification(notification: Notification): Promise<void> {
  const client = ensureSupabase();
  const { error } = await client
    .from('approval_notifications')
    .upsert({
      id: notification.id,
      user_id: notification.userId,
      task_id: notification.taskId,
      read: notification.read,
      payload: notification,
      created_at: notification.createdAt,
    });

  if (error) throw error;
}

export async function upsertSupabaseNotifications(notifications: Notification[]): Promise<void> {
  if (notifications.length === 0) return;
  const client = ensureSupabase();
  const { error } = await client
    .from('approval_notifications')
    .upsert(notifications.map(notification => ({
      id: notification.id,
      user_id: notification.userId,
      task_id: notification.taskId,
      read: notification.read,
      payload: notification,
      created_at: notification.createdAt,
    })));

  if (error) throw error;
}
