import { AccountApprovalStatus, AccountProfile, Notification, Role, Task, UploadedTaskFile } from './types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { uploadLimitHelpText } from './uploadLimits';

const TASK_FILES_BUCKET = 'task-files';
const ROLE_VALUES: Role[] = ['team_member', 'reviewer', 'art_director', 'team_leader', 'admin'];
const APPROVAL_STATUS_VALUES: AccountApprovalStatus[] = ['pending', 'approved', 'rejected'];

type TaskRow = {
  id: string;
  payload: Task;
};

type NotificationRow = {
  id: string;
  payload: Notification;
};

type UserProfileRow = {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  requested_role: string | null;
  approval_status: string | null;
  is_admin: boolean | null;
  legacy_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

function ensureSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }
  return supabase;
}

async function hasWritableSupabaseClient() {
  return Boolean(isSupabaseConfigured && supabase);
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

function normalizeRole(value: string | null | undefined, fallback: Role = 'team_member'): Role {
  return ROLE_VALUES.includes(value as Role) ? value as Role : fallback;
}

function normalizeApprovalStatus(value: string | null | undefined): AccountApprovalStatus {
  return APPROVAL_STATUS_VALUES.includes(value as AccountApprovalStatus) ? value as AccountApprovalStatus : 'pending';
}

function profileRowToProfile(row: UserProfileRow): AccountProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name?.trim() || row.email.split('@')[0] || 'New user',
    role: normalizeRole(row.role),
    requestedRole: normalizeRole(row.requested_role),
    approvalStatus: normalizeApprovalStatus(row.approval_status),
    isAdmin: Boolean(row.is_admin),
    legacyId: row.legacy_id,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function throwFriendlyProfileError(error: unknown): never {
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '';
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : '';

  if (
    code === 'PGRST205' ||
    message.includes('schema cache') ||
    message.includes('user_profiles') ||
    message.includes('relation "public.user_profiles" does not exist')
  ) {
    throw new Error('Supabase setup is incomplete: public.user_profiles is missing from the API schema. Run the updated supabase.sql in the same Supabase project as .env.local, then wait a few seconds and refresh.');
  }

  throw error;
}

const USER_PROFILE_COLUMNS = [
  'id',
  'email',
  'name',
  'role',
  'requested_role',
  'approval_status',
  'is_admin',
  'legacy_id',
  'approved_by',
  'approved_at',
  'created_at',
  'updated_at',
].join(',');

export function profileToUser(profile: AccountProfile) {
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    requestedRole: profile.requestedRole,
    approvalStatus: profile.approvalStatus,
    isAdmin: profile.isAdmin,
    legacyId: profile.legacyId,
    jobTitle: profile.role === 'admin' ? 'Admin' : profile.role.replaceAll('_', ' '),
  };
}

export async function ensureCurrentUserProfile(): Promise<void> {
  const client = ensureSupabase();
  const { error } = await client.rpc('ensure_current_user_profile');

  if (error) throwFriendlyProfileError(error);
}

export async function fetchCurrentUserProfile(userId: string): Promise<AccountProfile | null> {
  const client = ensureSupabase();
  const { data, error } = await client
    .from('user_profiles')
    .select(USER_PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) throwFriendlyProfileError(error);
  return data ? profileRowToProfile(data as unknown as UserProfileRow) : null;
}

export async function fetchUserProfiles(): Promise<AccountProfile[]> {
  const client = ensureSupabase();
  const { data, error } = await client
    .from('user_profiles')
    .select(USER_PROFILE_COLUMNS)
    .order('name', { ascending: true });

  if (error) throwFriendlyProfileError(error);
  return ((data || []) as unknown as UserProfileRow[]).map(profileRowToProfile);
}

export async function updatePendingProfileRequest(userId: string, name: string, requestedRole: Role): Promise<AccountProfile> {
  const client = ensureSupabase();
  const { data, error } = await client
    .from('user_profiles')
    .update({
      name: name.trim(),
      requested_role: requestedRole,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select(USER_PROFILE_COLUMNS)
    .single();

  if (error) throwFriendlyProfileError(error);
  return profileRowToProfile(data as unknown as UserProfileRow);
}

export async function approveUserProfile(profileId: string, role: Role, legacyId: string | null, adminId: string): Promise<AccountProfile> {
  const client = ensureSupabase();
  const approvedAt = new Date().toISOString();
  const { data, error } = await client
    .from('user_profiles')
    .update({
      role,
      requested_role: role,
      approval_status: 'approved',
      is_admin: role === 'admin',
      legacy_id: legacyId || null,
      approved_by: adminId,
      approved_at: approvedAt,
      updated_at: approvedAt,
    })
    .eq('id', profileId)
    .select(USER_PROFILE_COLUMNS)
    .single();

  if (error) throwFriendlyProfileError(error);
  return profileRowToProfile(data as unknown as UserProfileRow);
}

export async function rejectUserProfile(profileId: string, adminId: string): Promise<AccountProfile> {
  const client = ensureSupabase();
  const rejectedAt = new Date().toISOString();
  const { data, error } = await client
    .from('user_profiles')
    .update({
      approval_status: 'rejected',
      approved_by: adminId,
      approved_at: rejectedAt,
      updated_at: rejectedAt,
    })
    .eq('id', profileId)
    .select(USER_PROFILE_COLUMNS)
    .single();

  if (error) throw error;
  return profileRowToProfile(data as unknown as UserProfileRow);
}

function replaceUserId(value: string | null | undefined, legacyId: string, targetUserId: string) {
  return value === legacyId ? targetUserId : value ?? null;
}

function replaceUserIdList(values: string[] | undefined, legacyId: string, targetUserId: string) {
  return Array.from(new Set((values || []).map(value => value === legacyId ? targetUserId : value).filter(Boolean)));
}

function migrateTaskUserIds(task: Task, legacyId: string, targetUserId: string): { task: Task; changed: boolean } {
  let changed = false;
  const mark = (next: string | null | undefined, previous: string | null | undefined) => {
    if (next !== (previous ?? null)) changed = true;
    return next;
  };

  const versions = task.versions.map(version => {
    const submittedBy = replaceUserId(version.submittedBy, legacyId, targetUserId) || version.submittedBy;
    if (submittedBy !== version.submittedBy) changed = true;
    return { ...version, submittedBy };
  });

  const comments = task.comments?.map(comment => {
    const authorId = replaceUserId(comment.authorId, legacyId, targetUserId) || comment.authorId;
    if (authorId !== comment.authorId) changed = true;
    return { ...comment, authorId };
  });

  const createdBy = mark(replaceUserId(task.createdBy, legacyId, targetUserId) || task.createdBy, task.createdBy) || task.createdBy;
  const currentOwnerUserId = mark(replaceUserId(task.currentOwnerUserId, legacyId, targetUserId), task.currentOwnerUserId);
  const handledBy = replaceUserIdList(task.handledBy, legacyId, targetUserId);
  if (handledBy.join('|') !== task.handledBy.join('|')) changed = true;

  return {
    changed,
    task: {
      ...task,
      createdBy,
      handledBy,
      currentOwnerUserId,
      versions,
      comments,
    },
  };
}

function migrateNotificationUserIds(notification: Notification, legacyId: string, targetUserId: string): { notification: Notification; changed: boolean } {
  if (notification.userId !== legacyId) {
    return { notification, changed: false };
  }

  return {
    changed: true,
    notification: {
      ...notification,
      userId: targetUserId,
    },
  };
}

export async function migrateLegacyUserData(legacyId: string, targetUserId: string): Promise<{ tasksUpdated: number; notificationsUpdated: number }> {
  if (!legacyId || legacyId === targetUserId) {
    return { tasksUpdated: 0, notificationsUpdated: 0 };
  }

  const client = ensureSupabase();
  const { data: taskRows, error: taskReadError } = await client
    .from('approval_tasks')
    .select('id,payload');

  if (taskReadError) throw taskReadError;

  let tasksUpdated = 0;
  for (const row of (taskRows || []) as TaskRow[]) {
    const { task, changed } = migrateTaskUserIds(row.payload, legacyId, targetUserId);
    if (!changed) continue;

    const { error } = await client
      .from('approval_tasks')
      .update({
        payload: task,
        created_by: task.createdBy,
        updated_at: task.updatedAt,
      })
      .eq('id', row.id);

    if (error) throw error;
    tasksUpdated += 1;
  }

  const { data: notificationRows, error: notificationReadError } = await client
    .from('approval_notifications')
    .select('id,payload');

  if (notificationReadError) throw notificationReadError;

  let notificationsUpdated = 0;
  for (const row of (notificationRows || []) as NotificationRow[]) {
    const { notification, changed } = migrateNotificationUserIds(row.payload, legacyId, targetUserId);
    if (!changed) continue;

    const { error } = await client
      .from('approval_notifications')
      .update({
        payload: notification,
        user_id: notification.userId,
      })
      .eq('id', row.id);

    if (error) throw error;
    notificationsUpdated += 1;
  }

  return { tasksUpdated, notificationsUpdated };
}

export async function uploadTaskFiles(taskId: string, files: UploadedTaskFile[]): Promise<UploadedTaskFile[]> {
  if (!(await hasWritableSupabaseClient())) return files;

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
  if (!(await hasWritableSupabaseClient())) {
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

export async function deleteSupabaseGuestSeedData(): Promise<void> {
  const client = ensureSupabase();
  const { error: notificationTaskError } = await client
    .from('approval_notifications')
    .delete()
    .like('task_id', 'guest_seed_%');

  if (notificationTaskError) throw notificationTaskError;

  const { error: notificationIdError } = await client
    .from('approval_notifications')
    .delete()
    .like('id', 'guest_seed_%');

  if (notificationIdError) throw notificationIdError;

  const { error: taskError } = await client
    .from('approval_tasks')
    .delete()
    .like('id', 'guest_seed_%');

  if (taskError) throw taskError;
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
