import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAppStateHandler } from '../api/app-state.js';
import { createWorkspaceAuth } from '../server/workspaceAuth.js';
import { mergeAppSettings } from '../src/lib/appSettings.js';
import { visibleMemberRoster } from '../src/lib/memberIdentity.js';
import type { User } from '../src/lib/types.js';

const registered: User = { id: 'registered', email: 'owner@example.test', name: 'Original Owner', role: 'reviewer', isAdmin: true };
const duplicate: User = { id: 'manual-duplicate', email: 'OWNER@example.test', name: 'Manual Duplicate', role: 'team_member', isAdmin: false,
  passwordHash: createHash('sha256').update('national-care-tool-login:manual-password').digest('hex') };

function fixture(profile = registered, manual = duplicate) {
  const settings = mergeAppSettings({ workflows: [], manualUsers: [manual] });
  const auth = createWorkspaceAuth({ env: { WORKSPACE_SESSION_SECRET: 'collision-test-only', VITE_SUPABASE_URL: 'https://identity.example.test', VITE_SUPABASE_ANON_KEY: 'test-public-key' },
    fetch: async (url, init) => {
      if (String(url).endsWith('/auth/v1/user')) {
        const valid = (init?.headers as Record<string, string>).Authorization === 'Bearer verified-provider-token';
        return new Response(JSON.stringify(valid ? { id: profile.id } : {}), { status: valid ? 200 : 401 });
      }
      return new Response(JSON.stringify([{ id: profile.id, name: profile.name, email: profile.email, role: profile.role, is_admin: profile.isAdmin }]), { status: 200 });
    } });
  const sql = async (parts: TemplateStringsArray) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    if (query.startsWith('CREATE TABLE') || query.startsWith('SELECT record') || query.startsWith('SELECT workflow_id')) return [];
    if (query.startsWith('SELECT state, updated_at')) return [{ state: { settings, tasks: [], notifications: [] }, updated_at: '2026-09-29T00:00:00Z' }];
    throw new Error(`Unexpected query: ${query}`);
  };
  const handler = createAppStateHandler(() => sql as never, auth);
  async function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const result = { status: 0, data: null as any, headers: {} as Record<string, string> };
    await handler({ method, url, body, headers: { host: 'workspace.test', ...headers } }, {
      setHeader: (key, value) => { result.headers[key] = value; },
      status: code => { result.status = code; return { json: data => { result.data = data; }, end() {} }; },
    });
    return result;
  }
  return { settings, auth, request };
}

test('a duplicate manual account cannot block registered email or full-name login routing', async () => {
  const { request } = fixture();
  for (const identifier of [' OWNER@example.test ', registered.name]) {
    const result = await request('POST', '/api/app-state?auth=login', { identifier, password: 'provider-password' });
    assert.equal(result.status, 401);
    assert.equal(result.data.code, 'NOT_MANUAL', 'the client must continue with provider verification');
    assert.equal(result.headers['Set-Cookie'], undefined, 'routing never authenticates a password itself');
  }
});

test('verified registered sessions preserve their original identity and permissions in both collision directions', async () => {
  for (const [profile, manual] of [[registered, duplicate], [{ ...registered, role: 'team_member', isAdmin: false }, { ...duplicate, role: 'admin', isAdmin: true }]] as [User, User][]) {
    const { request } = fixture(profile, manual);
    const result = await request('GET', '/api/app-state?auth=session', undefined, { authorization: 'Bearer verified-provider-token' });
    assert.equal(result.status, 200);
    assert.equal(result.data.user.id, profile.id);
    assert.equal(result.data.user.role, profile.role);
    assert.equal(result.data.user.isAdmin, profile.isAdmin);
    assert.equal(result.data.user.name, profile.name);
    const forged = await request('GET', '/api/app-state', undefined, { authorization: 'Bearer forged-token' });
    assert.equal(forged.status, 401);
  }
});

test('the separately named manual account still needs its own password and retains its own identity', async () => {
  const { request } = fixture();
  const rejected = await request('POST', '/api/app-state?auth=login', { identifier: duplicate.name, password: 'provider-password' });
  assert.equal(rejected.status, 401);
  const login = await request('POST', '/api/app-state?auth=login', { identifier: duplicate.name, password: 'manual-password' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.id, duplicate.id);
  const restored = await request('GET', '/api/app-state?auth=session', undefined, { cookie: login.headers['Set-Cookie'].split(';')[0] });
  assert.equal(restored.data.user.id, duplicate.id);
  assert.equal(restored.data.user.isAdmin, false);
});

test('deleted registered accounts remain blocked by ID and by email when duplicates exist', async () => {
  const { auth, settings } = fixture();
  for (const record of [{ id: registered.id }, { id: 'removed-alias', email: registered.email }]) {
    const removedSettings = { ...settings, deletedMembers: [{ ...record, name: 'Removed', deletedAt: '2026-09-29T00:00:00Z', deletedBy: 'admin' }] };
    assert.equal(auth.login({}, removedSettings, registered.name, 'any-password', [registered]).code, 'INVALID_CREDENTIALS');
    assert.equal(await auth.authenticate({ headers: { authorization: 'Bearer verified-provider-token' } }, removedSettings, [registered]), null);
  }
});

test('roster keeps distinct account IDs sharing an email without duplicating an exact registered ID', () => {
  const roster = visibleMemberRoster([registered], [duplicate, { ...registered, name: 'Stale override', isAdmin: false }], []);
  assert.deepEqual(roster.map(user => user.id), [registered.id, duplicate.id]);
  assert.equal(roster[0].name, registered.name);
  assert.equal(roster[0].isAdmin, true);
});
