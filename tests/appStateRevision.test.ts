import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppStateHandler } from '../api/app-state.js';
import { mergeAppSettings } from '../src/lib/appSettings.js';

test('app-state keeps microsecond revision tokens through reads and writes and rejects stale writes', async () => {
  const revision = '2026-09-29 14:29:22.421207+00';
  const nextRevision = '2026-09-29 14:30:00.123456+00';
  let writes = 0;
  let conflict = false;
  const actor = { id: 'admin', name: 'Admin', role: 'admin' as const };
  const settings = mergeAppSettings({ workflows: [], manualUsers: [actor], notificationResetVersion: 3 });
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    if (query.startsWith('CREATE TABLE') || query.startsWith('SELECT record') || query.startsWith('SELECT workflow_id')) return [];
    // Simulate Neon's parser: timestamps become millisecond Dates; text stays exact.
    if (query.startsWith('SELECT state,')) return [{ state: { tasks: [], settings, notifications: [], dailyReports: [] },
      updated_at: query.includes('updated_at::text AS updated_at') ? revision : new Date(revision) }];
    if (query.startsWith('WITH written AS')) {
      writes++;
      assert.equal(values[3], revision, 'CAS must use the exact database timestamp');
      if (conflict) return [];
      return [{ updated_at: query.includes('RETURNING updated_at::text AS updated_at') ? nextRevision : new Date(nextRevision) }];
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  const handler = createAppStateHandler(() => sql as never, { authenticate: async () => actor, loadProfiles: async () => [actor] } as never);
  const request = async (method: string, body?: unknown) => {
    let status = 0; let data: any;
    await handler({ method, url: '/api/app-state', headers: { host: 'workspace.test' }, body }, {
      setHeader() {}, status(code) { status = code; return { json(value) { data = value; }, end() {} }; },
    });
    return { status, data };
  };
  const read = await request('GET');
  assert.equal(read.status, 200);
  assert.equal(read.data.updatedAt, revision);
  for (const expectedUpdatedAt of ['2026-09-29T14:29:22.421Z', '2026-09-29 14:29:22.421208+00', null]) {
    assert.equal((await request('PUT', { state: {}, expectedUpdatedAt })).status, 409);
  }
  assert.equal(writes, 0);
  for (const body of [{ state: {} }, { state: {}, expectedUpdatedAt: revision }]) {
    const saved = await request('PUT', body);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.updatedAt, nextRevision);
  }
  conflict = true;
  const stale = await request('PUT', { state: {}, expectedUpdatedAt: revision });
  assert.equal(stale.status, 409);
  assert.match(stale.data.error, /concurrent/i);
  assert.doesNotMatch(stale.data.error, /removing this member/i);
});
