import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });
config();

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, '');
}

const supabaseUrl = cleanEnvValue(process.env.VITE_SUPABASE_URL);
const supabaseAnonKey = cleanEnvValue(process.env.VITE_SUPABASE_ANON_KEY);

function fail(message: string, error?: unknown): never {
  console.error(`FAIL ${message}`);
  if (error) console.error(error);
  process.exit(1);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
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

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

const smokeId = `smoke_${Date.now()}`;
const smokeTask = {
  id: smokeId,
  payload: {
    id: smokeId,
    code: 'SMOKE-TEST',
    name: 'Supabase smoke test',
    taskType: 'others',
    reviewMode: 'full_review',
    environment: 'production',
    createdBy: 'smoke_test',
    handledBy: ['smoke_test'],
    status: 'submitted',
    currentOwnerRole: 'reviewer',
    currentOwnerUserId: null,
    priority: 'not_set',
    deadlineText: null,
    versions: [],
    thumbnailUrl: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  environment: 'production',
  created_by: 'smoke_test',
  status: 'submitted',
  updated_at: new Date().toISOString(),
};

const smokeNotification = {
  id: smokeId,
  user_id: 'smoke_test',
  task_id: smokeId,
  read: false,
  payload: {
    id: smokeId,
    userId: 'smoke_test',
    taskId: smokeId,
    message: 'Supabase smoke test',
    read: false,
    createdAt: new Date().toISOString(),
  },
  created_at: new Date().toISOString(),
};

async function main() {
  pass(`Supabase URL configured for ${parsedUrl.host}`);

  const restHealth = await fetch(`${supabaseUrl}/rest/v1/approval_tasks?select=id&limit=1`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
  });

  if (restHealth.status === 401) {
    const body = await restHealth.text();
    fail('Supabase rejected VITE_SUPABASE_ANON_KEY. Copy the anon/public API key from this same Supabase project.', body);
  }

  const { error: taskReadError } = await supabase
    .from('approval_tasks')
    .select('id', { count: 'exact', head: true });
  if (taskReadError) fail('Cannot read approval_tasks. Run supabase.sql and check RLS policies.', taskReadError);
  pass('approval_tasks read works');

  const { error: notificationReadError } = await supabase
    .from('approval_notifications')
    .select('id', { count: 'exact', head: true });
  if (notificationReadError) fail('Cannot read approval_notifications. Run supabase.sql and check RLS policies.', notificationReadError);
  pass('approval_notifications read works');

  const { error: taskWriteError } = await supabase.from('approval_tasks').upsert(smokeTask);
  if (taskWriteError) fail('Cannot write approval_tasks. Check anon write policy.', taskWriteError);
  pass('approval_tasks write works');

  const { error: notificationWriteError } = await supabase.from('approval_notifications').upsert(smokeNotification);
  if (notificationWriteError) fail('Cannot write approval_notifications. Check anon write policy.', notificationWriteError);
  pass('approval_notifications write works');

  const { error: storageError } = await supabase.storage.from('task-files').list('', { limit: 1 });
  if (storageError) fail('Cannot access task-files storage bucket. Check bucket and storage policies.', storageError);
  pass('task-files storage bucket is accessible');

  const { error: notificationDeleteError, count: deletedNotifications } = await supabase
    .from('approval_notifications')
    .delete({ count: 'exact' })
    .eq('id', smokeId);
  if (notificationDeleteError) fail('Cannot clean up smoke notification.', notificationDeleteError);
  if (deletedNotifications !== 1) fail(`Smoke notification cleanup deleted ${deletedNotifications ?? 0} rows instead of 1.`);

  const { error: taskDeleteError, count: deletedTasks } = await supabase
    .from('approval_tasks')
    .delete({ count: 'exact' })
    .eq('id', smokeId);
  if (taskDeleteError) fail('Cannot clean up smoke task.', taskDeleteError);
  if (deletedTasks !== 1) fail(`Smoke task cleanup deleted ${deletedTasks ?? 0} rows instead of 1.`);
  pass('smoke test cleanup completed');
}

main().catch(error => fail('Unexpected Supabase smoke test error', error));
