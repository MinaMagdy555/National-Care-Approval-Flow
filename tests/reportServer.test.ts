import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceAuth, withoutPrivateSettings } from '../server/workspaceAuth';
import { createAppStateHandler } from '../api/app-state';
import { mergeAppSettings } from '../src/lib/appSettings';
import { mergeMemberDeletions } from '../src/lib/memberIdentity';
import type { AppSettings, DailyReport, DeletedMember, Notification, User } from '../src/lib/types';
import { normalizeDailyReport } from '../server/reportAccess';

// Independently computed fixture for the existing persisted password format.
const PASSWORD_HASH = '54dc5ea37dba777773abb68176c2eb2472856d5f480f71fdc76259b1d397a061';
const member = { id: 'member', name: 'Writer', email: 'writer@example.test', role: 'team_member', jobTitle: 'Content Creator' } as User;
const peer = { ...member, id: 'peer', name: 'Peer', email: 'peer@example.test' };
const senior = { id: 'senior', name: 'Senior Writer', email: 'senior@example.test', role: 'team_member', jobTitle: 'Senior Content Creator' } as User;
const otherSenior = { id: 'design-senior', name: 'Mina fixture', email: 'mina@example.test', role: 'reviewer', jobTitle: 'Senior Brand Designer', isAdmin: true } as User;
const leader = { id: 'leader', name: 'Team Leader', email: 'leader@example.test', role: 'team_leader', jobTitle: 'Team Leader' } as User;
const ad = { id: 'ad', name: 'Art Director', email: 'ad@example.test', role: 'art_director' } as User;
const users = [member, peer, senior, otherSenior, leader, ad].map(user => ({ ...user, passwordHash: PASSWORD_HASH, passwordUpdatedAt: '2026-09-14T00:00:00Z' }));
const settings = mergeAppSettings({ manualUsers: users, workflows: [], reportingSeniorByUserId: { member: senior.id, peer: senior.id }, dailyReportReceiverUserIds: [peer.id, otherSenior.id] });
const report = (user: User, sent = true, date = '2026-09-14'): DailyReport => ({ id: `${date}:${user.id}`, date, userId: user.id,
  note: `private note ${user.id}`, entries: [], sentAt: sent ? `${date}T17:30:00.000Z` : null, sentBy: sent ? user.id : null,
  editHistory: [], createdAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T17:30:00.000Z` });

function fixture() {
  const db = { state: { settings: structuredClone(settings), tasks: [], notifications: [] as Notification[],
    dailyReports: [report(member), report(peer), report(senior), report(otherSenior), report(leader), report(peer, false, '2026-09-13')] },
    deleted: [] as DeletedMember[], revision: '2026-09-14T00:00:00.000Z', now: Date.parse('2026-09-14T18:00:00.000Z') };
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    if (query.startsWith('CREATE TABLE')) return [];
    if (query.startsWith('SELECT record')) return db.deleted.map(record => ({ record }));
    if (query.startsWith('SELECT workflow_id')) return [];
    if (query.startsWith('SELECT state, updated_at')) return [{ state: structuredClone(db.state), updated_at: db.revision }];
    if (query.startsWith('WITH written AS')) {
      if (values[3] !== db.revision) return [];
      db.state = JSON.parse(values[1] as string);
      db.deleted = mergeMemberDeletions(db.deleted, JSON.parse(values[4] as string));
      db.revision = new Date(Date.parse(db.revision) + 1).toISOString();
      return [{ updated_at: db.revision }];
    }
    throw new Error(`Unexpected test query: ${query}`);
  };
  const auth = createWorkspaceAuth({ env: { WORKSPACE_SESSION_SECRET: 'isolated-test-secret-with-enough-randomness', NODE_ENV: 'test' }, now: () => db.now });
  const handler = createAppStateHandler(() => sql as never, auth);
  async function request(method: string, url = '/api/app-state', body?: unknown, headers: Record<string, string> = {}) {
    let status = 0;
    let data: any;
    const resultHeaders: Record<string, string> = {};
    await handler({ method, url, body, headers: { host: 'workspace.test', ...headers } }, { setHeader: (key, value) => { resultHeaders[key] = value; },
      status: code => { status = code; return { json: value => { data = value; }, end: () => {} }; } });
    return { status, data, headers: resultHeaders };
  }
  async function login(user: User) {
    const result = await request('POST', '/api/app-state?auth=login', { identifier: user.email, password: 'qa-password' });
    assert.equal(result.status, 200);
    assert.equal(result.data.user.passwordHash, undefined);
    assert.match(result.headers['Set-Cookie'], /HttpOnly; SameSite=Lax/);
    return { cookie: result.headers['Set-Cookie'].split(';')[0] };
  }
  return { db, auth, request, login };
}

test('anonymous and forged identities cannot retrieve reports or write state; prelogin settings contain no hashes', async () => {
  const { request } = fixture();
  const session = await request('GET', '/api/app-state?auth=session');
  assert.equal(session.status, 200);
  assert.deepEqual(session.data, { user: null });
  assert.match(session.headers['Set-Cookie'], /Max-Age=0/);
  assert.equal((await request('GET')).status, 401);
  assert.equal((await request('GET', '/api/app-state', undefined, { 'x-user-id': leader.id, authorization: 'Bearer forged-admin' })).status, 401);
  assert.equal((await request('PUT', '/api/app-state', { state: { dailyReports: [] }, userId: leader.id, role: 'admin' })).status, 401);
  const publicSettings = await request('GET', '/api/app-state?settings=1');
  assert.equal(publicSettings.status, 200);
  assert.equal(JSON.stringify(publicSettings.data).includes(PASSWORD_HASH), false);
  assert.equal(JSON.stringify(publicSettings.data).includes('private note'), false);
  assert.equal(JSON.stringify(withoutPrivateSettings({ ...settings, nested: { dailyReports: [{ note: 'nested private note' }], passwordHash: 'nested hash' } } as AppSettings)).includes('nested private note'), false);
});

test('server manual authentication uses existing hash prefix, validates expiry and rejects cookie forgery', async () => {
  const { db, request, login } = fixture();
  const credentials = await login(member);
  assert.equal((await request('GET', '/api/app-state?auth=session', undefined, credentials)).data.user.id, member.id);
  assert.equal((await request('GET', '/api/app-state', undefined, { cookie: credentials.cookie + 'tampered' })).status, 401);
  assert.equal((await request('POST', '/api/app-state?auth=login', { identifier: member.email, password: 'wrong-password' })).status, 401);
  db.now += 8 * 60 * 60 * 1000 + 1;
  assert.equal((await request('GET', '/api/app-state', undefined, credentials)).status, 401);
});

test('deleted membership and password changes revoke previously valid manual sessions', async () => {
  const { db, request, login } = fixture();
  const credentials = await login(member);
  db.state.settings.manualUsers![0].passwordHash = 'changed-password-hash';
  assert.equal((await request('GET', '/api/app-state', undefined, credentials)).status, 401);
  db.state.settings.manualUsers![0].passwordHash = PASSWORD_HASH;
  db.deleted = [{ ...member, deletedAt: '2026-09-14T19:00:00Z', deletedBy: leader.id }];
  assert.equal((await request('GET', '/api/app-state', undefined, credentials)).status, 401);
  assert.equal((await request('POST', '/api/app-state?auth=login', { identifier: member.email, password: 'qa-password' })).status, 401);
});

test('authenticated report projection enforces personal, senior and upward leader audiences; drafts stay private', async () => {
  const { request, login } = fixture();
  const readIds = async (viewer: User) => {
    const result = await request('GET', '/api/app-state', undefined, await login(viewer));
    assert.equal(result.status, 200);
    return result.data.state.dailyReports.map((item: DailyReport) => item.id).sort();
  };
  assert.deepEqual(await readIds(member), [report(member).id]);
  assert.deepEqual(await readIds(senior), [report(member).id, report(peer).id, report(senior).id].sort());
  assert.deepEqual(await readIds(otherSenior), [report(otherSenior).id], 'senior admin does not gain peer or downward-independent access');
  assert.deepEqual(await readIds(leader), [member, peer, senior, otherSenior, leader].map(user => report(user).id).sort());
  assert.deepEqual(await readIds(ad), [member, peer, senior, otherSenior, leader].map(user => report(user).id).sort());
});

test('filtered whole-state saves preserve hidden reports and credentials while accepting harmless foreign echoes', async () => {
  const { db, request, login } = fixture();
  const credentials = await login(senior);
  const read = await request('GET', '/api/app-state', undefined, credentials);
  const incoming = read.data.state;
  // Different property order and absent optional fields represent the same visible foreign report.
  incoming.dailyReports = incoming.dailyReports.map((item: DailyReport) => ({ userId: item.userId, ...normalizeDailyReport(item) }));
  const hidden = structuredClone(db.state.dailyReports.filter(item => !incoming.dailyReports.some((visible: DailyReport) => visible.id === item.id)));
  assert.equal((await request('PUT', '/api/app-state', { state: incoming }, credentials)).status, 200);
  for (const report of hidden) assert.deepEqual(db.state.dailyReports.find(item => item.id === report.id), report);
  assert.equal(db.state.settings.manualUsers!.find(user => user.id === member.id)?.passwordHash, PASSWORD_HASH);
});

test('report owner may submit and append a second edit; leadership cannot edit, impersonate or send subordinate reports', async () => {
  const { request, login } = fixture();
  const ownCredentials = await login(member);
  const ownState = (await request('GET', '/api/app-state', undefined, ownCredentials)).data.state;
  const own = ownState.dailyReports[0] as DailyReport;
  own.note = 'first edit'; own.updatedAt = '2026-09-14T18:01:00Z';
  own.editHistory.push({ id: 'edit-1', editedBy: member.id, editedAt: own.updatedAt, previousNote: '', nextNote: own.note, changedEntries: [] });
  assert.equal((await request('PUT', '/api/app-state', { state: ownState }, ownCredentials)).status, 200);
  const secondState = (await request('GET', '/api/app-state', undefined, ownCredentials)).data.state;
  secondState.dailyReports[0].note = 'second edit';
  secondState.dailyReports[0].editHistory.push({ id: 'edit-2', editedBy: member.id, editedAt: '2026-09-14T18:02:00Z', changedEntries: [] });
  assert.equal((await request('PUT', '/api/app-state', { state: secondState }, ownCredentials)).status, 200);
  const leaderCredentials = await login(leader);
  const leaderState = (await request('GET', '/api/app-state', undefined, leaderCredentials)).data.state;
  leaderState.dailyReports.find((item: DailyReport) => item.userId === member.id).note = 'unauthorized supervisor edit';
  assert.equal((await request('PUT', '/api/app-state', { state: leaderState }, leaderCredentials)).status, 403);
  secondState.dailyReports[0].sentBy = leader.id;
  assert.equal((await request('PUT', '/api/app-state', { state: secondState }, ownCredentials)).status, 403);
});

test('ordinary users cannot grant report access by modifying roster roles, supervisor assignments or claimed viewer', async () => {
  const { request, login } = fixture();
  const credentials = await login(member);
  const state = (await request('GET', '/api/app-state', undefined, credentials)).data.state;
  state.settings.reportingSeniorByUserId.peer = member.id;
  assert.equal((await request('PUT', '/api/app-state', { state, actor: { ...member, role: 'admin' } }, credentials)).status, 403);
  state.settings.reportingSeniorByUserId.peer = senior.id;
  state.settings.manualUsers.find((user: User) => user.id === member.id).role = 'admin';
  assert.equal((await request('PUT', '/api/app-state', { state }, credentials)).status, 403);
});

test('workflow managers keep settings access without gaining member identity or reporting relationship access', async () => {
  const { db, request, login } = fixture();
  const credentials = await login(ad);
  const state = (await request('GET', '/api/app-state', undefined, credentials)).data.state;
  state.settings.dailyReportAutoSendTime = '17:15';
  state.settings.manualUsers.find((user: User) => user.id === member.id).passwordHash = 'attempted-credential-replacement';
  assert.equal((await request('PUT', '/api/app-state', { state }, credentials)).status, 200);
  assert.equal(db.state.settings.dailyReportAutoSendTime, '17:15');
  assert.equal(db.state.settings.manualUsers!.find(user => user.id === member.id)?.passwordHash, PASSWORD_HASH);
  state.settings.reportingSeniorByUserId.peer = ad.id;
  assert.equal((await request('PUT', '/api/app-state', { state }, credentials)).status, 403);
  const fresh = (await request('GET', '/api/app-state', undefined, credentials)).data.state;
  fresh.dailyReports.push(report(ad));
  assert.equal((await request('PUT', '/api/app-state', { state: fresh }, credentials)).status, 403, 'exempt AD cannot submit a report');
});

test('report notifications are generated for policy recipients; client/global overrides cannot notify a peer', async () => {
  const { db, request, login } = fixture();
  const credentials = await login(member);
  const state = (await request('GET', '/api/app-state', undefined, credentials)).data.state;
  state.dailyReports[0].note = 'updated own report';
  state.dailyReports[0].updatedAt = '2026-09-14T19:00:00Z';
  state.notifications.push({ id: 'forged', dailyReportId: report(member).id, userId: peer.id, taskId: 'daily-report', message: 'daily report private details', read: false, createdAt: '2026-09-14T19:00:00Z' });
  assert.equal((await request('PUT', '/api/app-state', { state }, credentials)).status, 200);
  assert.equal(db.state.notifications.some(item => item.userId === peer.id), false);
  assert.deepEqual(new Set(db.state.notifications.map(item => item.userId)), new Set([senior.id, leader.id, ad.id]));
  const peerRead = await request('GET', '/api/app-state', undefined, await login(peer));
  assert.equal(peerRead.data.state.notifications.length, 0);
});

test('cookie-authenticated cross-origin writes are rejected', async () => {
  const { request, login } = fixture();
  const credentials = await login(member);
  assert.equal((await request('PUT', '/api/app-state', { state: {} }, { ...credentials, origin: 'https://attacker.test' })).status, 403);
});

test('Supabase bearer identity comes from verified auth and profile responses, not request claims', async () => {
  const profile = { id: 'registered', email: 'registered@example.test', name: 'Registered', role: 'team_member', is_admin: false, job_title: 'Writer' };
  const auth = createWorkspaceAuth({ env: { VITE_SUPABASE_URL: 'https://supabase.example.test', VITE_SUPABASE_ANON_KEY: 'public-test-key' },
    fetch: async (url, init) => {
      const authorization = (init?.headers as Record<string, string>).Authorization;
      if (String(url).includes('/auth/v1/user')) return new Response(JSON.stringify({ id: profile.id }), { status: authorization === 'Bearer valid-token' ? 200 : 401 });
      return new Response(JSON.stringify([profile]), { status: 200 });
    } });
  const req = { headers: { authorization: 'Bearer valid-token', 'x-user-id': leader.id, 'x-role': 'admin' } };
  const profiles = await auth.loadProfiles(req);
  assert.equal((await auth.authenticate(req, mergeAppSettings({ workflows: [], manualUsers: [] }), profiles))?.id, profile.id);
  assert.equal((await auth.authenticate({ headers: { authorization: 'Bearer forged-token' } }, settings, profiles)), null);
  assert.equal((await auth.authenticate(req, settings, [])), null, 'profile-less verified sessions cannot become members');
});
