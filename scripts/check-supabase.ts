import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });
config();

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, '');
}

const supabaseUrl = cleanEnvValue(process.env.VITE_SUPABASE_URL);
const supabaseAnonKey = cleanEnvValue(process.env.VITE_SUPABASE_ANON_KEY);
const testEmail = cleanEnvValue(process.env.SUPABASE_TEST_EMAIL);
const testPassword = cleanEnvValue(process.env.SUPABASE_TEST_PASSWORD);

function fail(message: string, error?: unknown): never {
  console.error(`FAIL ${message}`);
  if (error) console.error(error);
  process.exit(1);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

function skip(message: string) {
  console.log(`SKIP ${message}`);
}

if (!supabaseUrl) fail('Missing VITE_SUPABASE_URL in .env.local');
if (!supabaseAnonKey) fail('Missing VITE_SUPABASE_ANON_KEY in .env.local');

let parsedUrl: URL;
try {
  parsedUrl = new URL(supabaseUrl);
} catch {
  fail('VITE_SUPABASE_URL is not a valid URL');
}

if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
  fail('VITE_SUPABASE_URL must start with https:// or http://');
}

const anonymousClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

async function expectAnonymousDenied(table: 'approval_tasks' | 'approval_notifications') {
  const { error } = await anonymousClient
    .from(table)
    .select('id', { count: 'exact', head: true });

  if (!error) {
    fail(`${table} is still readable anonymously. Re-run supabase.sql so only approved authenticated users can access app data.`);
  }

  pass(`${table} blocks anonymous access`);
}

async function main() {
  pass(`Supabase URL configured for ${parsedUrl.host}`);

  await expectAnonymousDenied('approval_tasks');
  await expectAnonymousDenied('approval_notifications');

  const { error: publicStorageReadError } = await anonymousClient.storage.from('task-files').list('', { limit: 1 });
  if (publicStorageReadError) fail('Cannot read public task-files bucket.', publicStorageReadError);
  pass('task-files bucket remains publicly readable');

  if (!testEmail || !testPassword) {
    skip('Set SUPABASE_TEST_EMAIL and SUPABASE_TEST_PASSWORD for an approved user to test authenticated reads/writes/uploads.');
    return;
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });
  const { error: signInError } = await authClient.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (signInError) fail('Cannot sign in with SUPABASE_TEST_EMAIL/SUPABASE_TEST_PASSWORD.', signInError);
  pass('approved test user sign-in works');

  const { data: profile, error: profileError } = await authClient
    .from('user_profiles')
    .select('id,email,approval_status,is_admin,role')
    .eq('email', testEmail.toLowerCase())
    .maybeSingle();
  if (profileError) fail('Cannot read signed-in user profile.', profileError);
  if (!profile || profile.approval_status !== 'approved') {
    fail('SUPABASE_TEST_EMAIL must belong to an approved account profile.', profile);
  }
  pass(`approved profile read works (${profile.role})`);

  const smokeId = `smoke_${Date.now()}`;
  const now = new Date().toISOString();
  const smokeTask = {
    id: smokeId,
    payload: {
      id: smokeId,
      code: 'SMOKE-TEST',
      name: 'Supabase auth smoke test',
      taskType: 'others',
      reviewMode: 'full_review',
      environment: 'production',
      createdBy: profile.id,
      handledBy: [profile.id],
      status: 'submitted',
      currentOwnerRole: 'reviewer',
      currentOwnerUserId: null,
      priority: 'not_set',
      deadlineText: null,
      versions: [],
      thumbnailUrl: '',
      createdAt: now,
      updatedAt: now,
    },
    environment: 'production',
    created_by: profile.id,
    status: 'submitted',
    updated_at: now,
  };

  const smokeNotification = {
    id: smokeId,
    user_id: profile.id,
    task_id: smokeId,
    read: false,
    payload: {
      id: smokeId,
      userId: profile.id,
      taskId: smokeId,
      message: 'Supabase auth smoke test',
      read: false,
      createdAt: now,
    },
    created_at: now,
  };

  const { error: taskWriteError } = await authClient.from('approval_tasks').upsert(smokeTask);
  if (taskWriteError) fail('Cannot write approval_tasks as an approved user.', taskWriteError);
  pass('approval_tasks approved write works');

  const { error: notificationWriteError } = await authClient.from('approval_notifications').upsert(smokeNotification);
  if (notificationWriteError) fail('Cannot write approval_notifications as an approved user.', notificationWriteError);
  pass('approval_notifications approved write works');

  const storagePath = `smoke-tests/${smokeId}.png`;
  const pngBlob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
  const { error: uploadError } = await authClient.storage
    .from('task-files')
    .upload(storagePath, pngBlob, { contentType: 'image/png', upsert: true });
  if (uploadError) fail('Cannot upload to task-files as an approved user.', uploadError);
  pass('task-files approved upload works');

  const { error: storageCleanupError } = await authClient.storage.from('task-files').remove([storagePath]);
  if (storageCleanupError) fail('Cannot clean up smoke upload.', storageCleanupError);

  const { error: notificationDeleteError, count: deletedNotifications } = await authClient
    .from('approval_notifications')
    .delete({ count: 'exact' })
    .eq('id', smokeId);
  if (notificationDeleteError) fail('Cannot clean up smoke notification.', notificationDeleteError);
  if (deletedNotifications !== 1) fail(`Smoke notification cleanup deleted ${deletedNotifications ?? 0} rows instead of 1.`);

  const { error: taskDeleteError, count: deletedTasks } = await authClient
    .from('approval_tasks')
    .delete({ count: 'exact' })
    .eq('id', smokeId);
  if (taskDeleteError) fail('Cannot clean up smoke task.', taskDeleteError);
  if (deletedTasks !== 1) fail(`Smoke task cleanup deleted ${deletedTasks ?? 0} rows instead of 1.`);

  pass('authenticated smoke test cleanup completed');
}

main().catch(error => fail('Unexpected Supabase smoke test error', error));
