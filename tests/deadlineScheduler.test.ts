import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeadlineReminderHandler } from '../api/cron/deadline-reminders';
import { createAppStateHandler } from '../api/app-state';
import { createWorkspaceAuth } from '../server/workspaceAuth';
import { mergeAppSettings } from '../src/lib/appSettings';
import type { PersistedAppState } from '../src/lib/localDb';
import type { Task, User } from '../src/lib/types';

const member: User = { id: 'member', name: 'Member', email: 'member@example.test', role: 'team_member', jobTitle: 'Content Creator', passwordHash: '54dc5ea37dba777773abb68176c2eb2472856d5f480f71fdc76259b1d397a061' };
const senior: User = { id: 'senior', name: 'Senior', role: 'reviewer', jobTitle: 'Senior Content Creator' };
const leader: User = { id: 'leader', name: 'Leader', role: 'team_leader' };
const now = new Date('2026-09-14T08:00:00Z');

function fixture() {
  const db = { state: { settings: mergeAppSettings({ notificationResetVersion: 2, workflows: [], manualUsers: [member, senior, leader] }), tasks: [{ id: 'task', code: 'TSK-1', name: 'Before race',
    status: 'assigned_work', currentOwnerUserIds: [member.id], currentOwnerUserId: member.id, deadlineAt: '2026-09-14T08:45:00Z' } as Task], notifications: [], dailyReports: [] } as PersistedAppState,
    revision: '2026-09-14T00:00:00.000Z', beforeWrite: null as null | (() => void), fail: false, writes: 0 };
  const advance = () => { db.revision = new Date(Date.parse(db.revision) + 1).toISOString(); };
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    if (query.startsWith('CREATE TABLE') || query.startsWith('SELECT record') || query.startsWith('SELECT workflow_id')) return [];
    if (query.startsWith('SELECT state, updated_at')) return [{ state: structuredClone(db.state), updated_at: db.revision }];
    if (query.startsWith('UPDATE app_state') || query.startsWith('WITH written AS')) {
      if (db.beforeWrite) { const action = db.beforeWrite; db.beforeWrite = null; action(); advance(); }
      if (db.fail) throw new Error('Injected durable failure');
      const scheduler = query.startsWith('UPDATE app_state');
      if (values[scheduler ? 2 : 3] !== db.revision) return [];
      db.state = JSON.parse(values[scheduler ? 0 : 1] as string);
      advance(); db.writes++;
      return [{ updated_at: db.revision }];
    }
    throw new Error(`Unexpected test SQL: ${query}`);
  };
  const env = { CRON_SECRET: 'isolated-cron-secret', WORKSPACE_SESSION_SECRET: 'isolated-cookie-secret' };
  const cron = createDeadlineReminderHandler({ sqlFactory: () => sql as never, env, loadProfiles: async () => [], now: () => now });
  const app = createAppStateHandler(() => sql as never, createWorkspaceAuth({ env, now: () => now.getTime() }));
  async function request(handler: any, method = 'GET', headers: Record<string, string> = {}, url = '/api/cron/deadline-reminders', body?: unknown) {
    let status: number; let data: any; const responseHeaders: Record<string, string> = {};
    await handler({ method, headers: { host: 'workspace.test', ...headers }, url, body }, { setHeader: (key: string, value: string) => { responseHeaders[key] = value; },
      status: (value: number) => { status = value; return { json: (value: unknown) => { data = value; } }; } });
    return { status: status!, data, headers: responseHeaders };
  }
  const run = () => request(cron, 'GET', { authorization: `Bearer ${env.CRON_SECRET}` });
  async function login() {
    const result = await request(app, 'POST', {}, '/api/app-state?auth=login', { identifier: member.email, password: 'qa-password' });
    assert.equal(result.status, 200);
    return { cookie: result.headers['Set-Cookie'].split(';')[0] };
  }
  return { db, request, cron, app, run, login };
}

test('scheduler requires configured secret and rejects forged/browser identity before any data access', async () => {
  let touched = false;
  const handler = createDeadlineReminderHandler({ env: { CRON_SECRET: 'secret' }, sqlFactory: () => { touched = true; throw new Error('Must not access DB'); } });
  const { request } = fixture();
  assert.equal((await request(handler)).status, 401);
  assert.equal((await request(handler, 'GET', { authorization: 'Bearer forged', 'x-role': 'admin' })).status, 401);
  assert.equal((await request(createDeadlineReminderHandler({ env: {} }))).status, 503);
  assert.equal(touched, false);
});

test('server-only execution delivers once with atomic receipts even across concurrent cron runs and removed notifications', async () => {
  const { db, run } = fixture();
  const results = await Promise.all([run(), run()]);
  assert.ok(results.every(result => result.status === 200));
  assert.equal(db.state.notifications.length, 3);
  assert.equal(Object.keys(db.state.tasks[0].deadlineReminderReceipts!).length, 3);
  assert.equal(db.writes, 1);
  db.state.notifications = [];
  assert.equal((await run()).data.generated, 0);
  assert.equal(db.state.notifications.length, 0);
});

test('scheduler retries fresh state after concurrent edits and preserves unrelated notifications/reports', async () => {
  const { db, run } = fixture();
  db.beforeWrite = () => {
    db.state.tasks[0].name = 'Concurrent user edit';
    db.state.notifications.push({ id: 'human', taskId: 'task', userId: member.id, message: 'Keep this message', read: false, createdAt: now.toISOString() });
    db.state.dailyReports = [{ id: 'hidden', note: 'Keep this report' } as never];
  };
  const result = await run();
  assert.equal(result.status, 200); assert.equal(result.data.attempts, 2);
  assert.equal(db.state.tasks[0].name, 'Concurrent user edit');
  assert.equal(db.state.notifications.length, 4);
  assert.ok(db.state.notifications.filter(item => item.deadlineReminder).every(item => item.message.includes('Concurrent user edit')));
  assert.equal(db.state.dailyReports![0].note, 'Keep this report');
});

test('a task completed or moved outside the window during a race receives no obsolete reminder', async () => {
  for (const change of [(task: Task) => { task.status = 'completed'; }, (task: Task) => { task.deadlineAt = '2026-10-01T08:00:00Z'; }]) {
    const { db, run } = fixture(); db.beforeWrite = () => change(db.state.tasks[0]);
    assert.equal((await run()).data.generated, 0);
    assert.equal(db.state.notifications.length, 0);
    assert.equal(db.state.tasks[0].deadlineReminderReceipts, undefined);
  }
});

test('failed scheduler persistence leaves no delivery receipt and a later run can deliver', async () => {
  const { db, run } = fixture(); db.fail = true;
  assert.equal((await run()).status, 503);
  assert.equal(db.state.notifications.length, 0);
  assert.equal(db.state.tasks[0].deadlineReminderReceipts, undefined);
  db.fail = false;
  assert.equal((await run()).data.generated, 3);
});

test('authenticated stale whole-state save preserves scheduler receipts and notices; GET exposes only own allowed reminder', async () => {
  const { db, run, request, app, login } = fixture();
  const credentials = await login();
  const old = (await request(app, 'GET', credentials, '/api/app-state')).data.state;
  await run();
  old.tasks[0].name = 'Stale browser edit';
  assert.equal((await request(app, 'PUT', credentials, '/api/app-state', { state: old })).status, 200);
  assert.equal(db.state.tasks[0].name, 'Stale browser edit');
  assert.equal(db.state.notifications.length, 3);
  assert.equal(Object.keys(db.state.tasks[0].deadlineReminderReceipts!).length, 3);
  assert.equal((await run()).data.generated, 0);
  const read = await request(app, 'GET', credentials, '/api/app-state');
  assert.equal(read.data.state.notifications.length, 1);
  assert.equal(read.data.state.notifications[0].userId, member.id);
});
