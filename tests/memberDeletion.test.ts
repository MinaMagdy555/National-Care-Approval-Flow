import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeletedMember, Task, User, WorkflowPhaseDefinition } from '../src/lib/types';
import { mergeAppSettings } from '../src/lib/appSettings';
import { applyMemberDeletions, isMemberDeleted, memberDeletionIdentities, mergeMemberDeletions, visibleMemberRoster } from '../src/lib/memberIdentity';
import { findMemberDeletionBlockers, prepareMemberDeletion } from '../src/lib/memberDeletion';
import { createAppStateHandler } from '../api/app-state';

const admin: User = { id: 'admin', name: 'Admin', role: 'admin' };
const member: User = { id: 'manual-member', email: 'Member@example.test', name: 'Member', role: 'team_member', jobTitle: 'Writer' };
const alias: User = { ...member, id: 'profile-member', email: 'member@EXAMPLE.test', legacyId: 'legacy-member' };
const other: User = { id: 'other', name: 'Reviewer', role: 'reviewer' };
const finalReviewer: User = { id: 'final-reviewer', name: 'Art Director', role: 'art_director' };
const roster = [admin, member, alias, other, finalReviewer];
const settings = mergeAppSettings({ workflows: [], manualUsers: [member, other] });
const removed = memberDeletionIdentities(member, roster, admin.id, '2026-09-14T00:00:00.000Z');
const phase = (id: string, extra: Partial<WorkflowPhaseDefinition> = {}): WorkflowPhaseDefinition => ({
  id, name: id, userIds: [other.id], roleIds: [], responsibilityIds: [], mode: 'sequential', reviewStyle: 'first_review', phaseKind: 'work', ...extra,
});
function task(phases: WorkflowPhaseDefinition[], extra: Partial<Task> = {}): Task {
  return { id: 'task', code: 'QA-1', name: 'Assignment', taskType: 'qa', reviewMode: 'first_review', environment: 'demo', createdBy: admin.id,
    handledBy: [], status: 'assigned_work', currentOwnerRole: null, currentOwnerUserId: null, currentOwnerUserIds: [], priority: 'normal', deadlineText: null,
    versions: [], thumbnailUrl: '', createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z',
    workflowSnapshot: { id: 'wf', name: 'Workflow', active: true, phases }, workflowActivePhaseIds: phases.slice(0, 1).map(item => item.id), ...extra };
}

test('removal retains nonsecret attribution and covers manual/profile/email/legacy aliases', () => {
  const records = mergeMemberDeletions([...removed, { ...removed[0], passwordHash: 'must-not-be-retained', password: 'secret' }]);
  assert.equal(JSON.stringify(records).includes('password'), false);
  assert.deepEqual(new Set(records.map(record => record.id)), new Set([member.id, alias.id, alias.legacyId]));
  for (const user of [member, alias, { ...member, id: 'new-id', email: ' MEMBER@example.test ' }]) assert.equal(isMemberDeleted(user, records), true);
  assert.equal(isMemberDeleted(other, records), false);
  assert.deepEqual(visibleMemberRoster([alias], [member, other], records).map(user => user.id), [other.id]);
});

test('fresh normalization and a stale settings save cannot restore removed member credentials or permissions', () => {
  const stale = { ...settings, manualUsers: [{ ...member, passwordHash: 'old-login' }, other], firstReviewerUserIds: [member.id, other.id] };
  const once = mergeAppSettings(applyMemberDeletions(stale, removed));
  const reloaded = mergeAppSettings(applyMemberDeletions(stale, once.deletedMembers));
  assert.deepEqual(reloaded.manualUsers?.map(user => user.id), [other.id]);
  assert.deepEqual(reloaded.firstReviewerUserIds, [other.id]);
  assert.equal(JSON.stringify(reloaded).includes('old-login'), false);
  assert.equal(reloaded.deletedMembers?.[0].name, member.name);
});

test('deletion permission and self-alias checks cannot be bypassed by UI calls', () => {
  assert.equal(prepareMemberDeletion(other, member, roster, [], settings).ok, false);
  assert.equal(prepareMemberDeletion(admin, admin, roster, [], settings).ok, false);
  assert.equal(prepareMemberDeletion({ ...admin, email: member.email }, member, roster, [], settings).ok, false);
  const first = prepareMemberDeletion(admin, member, roster, [], settings);
  assert.equal(first.ok, true);
  assert.equal(prepareMemberDeletion(admin, member, roster, [], { ...settings, deletedMembers: first.deletedMembers }).ok, true);
});

test('delayed current, future, AI-human and returned-upload assignments block removal with exact phase labels', () => {
  const active = task([phase('Delayed work', { userIds: [member.id], delayDays: 10 })], { workflowPhaseAvailableAtByPhaseId: { 'Delayed work': '2099-01-01T00:00:00Z' } });
  const future = task([phase('current', { parentPhaseIds: ['workflow-root'] }), phase('Future work', { parentPhaseIds: ['current'], userIds: [member.id] })]);
  const ai = task([phase('Voice over')], { workflowNodeAssigneeIds: { 'Voice over': ['voice_over_ai'] }, workflowNodeAIAssigneeIds: { 'Voice over': member.id } });
  const returned = task([phase('review')], { status: 'changes_requested_by_reviewer', currentOwnerUserIds: [member.id] });
  assert.deepEqual(findMemberDeletionBlockers([active], removed, settings, roster), [{ taskId: 'task', taskCode: 'QA-1', phaseName: 'Delayed work' }]);
  assert.equal(findMemberDeletionBlockers([future], removed, settings, roster)[0].phaseName, 'Future work');
  assert.equal(findMemberDeletionBlockers([ai], removed, settings, roster)[0].phaseName, 'Voice over');
  assert.equal(findMemberDeletionBlockers([returned], removed, settings, roster)[0].phaseName, 'Revised upload');
});

test('finished work and completed-phase historical owners remain removable without changing audit', () => {
  const history = [{ phaseId: 'old', phaseName: 'Old work', action: 'completed' as const, actorId: member.id, createdAt: '2026-09-13T00:00:00Z' }];
  const historical = task([phase('old', { userIds: [member.id] }), phase('next', { parentPhaseIds: ['old'] })], {
    workflowActivePhaseIds: ['next'], workflowPhaseHistory: history, workflowPhaseApprovals: { old: [member.id] },
    createdBy: member.id, handledBy: [member.id], activeWorkBy: member.id, activeWorkFinishedAt: '2026-09-13T00:00:00Z',
  });
  const before = structuredClone(historical);
  assert.deepEqual(findMemberDeletionBlockers([historical], removed, settings, roster), []);
  assert.equal(prepareMemberDeletion(admin, member, roster, [historical], settings).ok, true);
  assert.deepEqual(historical, before);
  assert.deepEqual(findMemberDeletionBlockers([task([phase('closed', { userIds: [member.id] })], { status: 'completed' })], removed, settings, roster), []);
});

test('removal cannot reduce a pending phase below required approvals or bypass mandatory final AD', () => {
  const gate = task([phase('Two approvals', { userIds: [member.id, other.id], requiredApprovals: 2 })], { workflowPhaseApprovals: { 'Two approvals': [member.id] } });
  assert.equal(findMemberDeletionBlockers([gate], removed, settings, roster).length, 1);
  const enough = task([phase('One approval', { userIds: [member.id, other.id], requiredApprovals: 1 })], { workflowPhaseApprovals: { 'One approval': [member.id] } });
  assert.equal(findMemberDeletionBlockers([enough], removed, settings, roster).length, 0);
  const final = task([phase('Final AD', { phaseKind: 'final_review', userIds: [member.id], disabled: true, skipRule: 'manual' })], { workflowSkippedPhaseIds: ['Final AD'] });
  assert.equal(findMemberDeletionBlockers([final], removed, settings, roster)[0].phaseName, 'Final AD');
});

test('content omission uses saved skip IDs for deletion blockers, never an old content preference boolean', () => {
  const assigned = task([phase('current'), phase('Content Rev.', { phaseKind: 'content_review', userIds: [member.id] })], { needsContentRevision: false });
  assert.equal(findMemberDeletionBlockers([assigned], removed, settings, roster)[0].phaseName, 'Content Rev.');
  assert.deepEqual(findMemberDeletionBlockers([{ ...assigned, workflowSkippedPhaseIds: ['Content Rev.'] }], removed, settings, roster), []);
  const disabled = { ...assigned, needsContentRevision: true, workflowSnapshot: { ...assigned.workflowSnapshot!, phases: assigned.workflowSnapshot!.phases.map(item => item.id === 'Content Rev.' ? { ...item, disabled: true } : item) } };
  assert.deepEqual(findMemberDeletionBlockers([disabled], removed, settings, roster), []);
});

type State = { tasks: Task[]; notifications: unknown[]; settings: typeof settings };
function fakeDatabase(initial: State) {
  const db = { state: structuredClone(initial), revision: '2026-09-14T00:00:00.000Z', deleted: [] as DeletedMember[], beforeWrite: undefined as (() => Promise<void> | void) | undefined, failWrite: false };
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim();
    if (query.startsWith('CREATE TABLE')) return [];
    if (query.startsWith('SELECT record FROM deleted_member')) return db.deleted.map(record => ({ record: structuredClone(record) }));
    if (query.startsWith('SELECT workflow_id')) return [];
    if (query.startsWith("SELECT state->'settings'")) return [{ settings: structuredClone(db.state.settings), updated_at: db.revision }];
    if (query.startsWith('SELECT state, updated_at')) return [{ state: structuredClone(db.state), updated_at: db.revision }];
    if (query.startsWith('SELECT updated_at')) return [{ updated_at: db.revision }];
    if (query.startsWith('WITH written AS')) {
      if (db.beforeWrite) { const callback = db.beforeWrite; db.beforeWrite = undefined; await callback(); }
      if (db.failWrite) throw new Error('Simulated durable storage failure');
      const [, stateJson, , expected, recordsJson] = values;
      if (expected !== db.revision) return [];
      db.state = JSON.parse(stateJson as string);
      db.deleted = mergeMemberDeletions(db.deleted, JSON.parse(recordsJson as string));
      db.revision = new Date(new Date(db.revision).getTime() + 1).toISOString();
      return [{ updated_at: db.revision }];
    }
    throw new Error(`Unexpected SQL in handler test: ${query}`);
  };
  const handler = createAppStateHandler(() => sql as never, { authenticate: async () => admin, loadProfiles: async () => roster, login: () => ({ user: null, cookie: null, code: 'INVALID_CREDENTIALS' }), clearCookie: () => '' });
  const request = async (method: string, body?: unknown, url?: string) => {
    let status = 0;
    let data: any;
    await handler({ method, body, url }, { setHeader: () => {}, status: code => { status = code; return { json: value => { data = value; }, end: () => {} }; } });
    return { status, data };
  };
  return { db, request };
}

test('production API deletion survives an older second-client roster save and both GET projections', async () => {
  const stale = { tasks: [], notifications: [], settings };
  const { db, request } = fakeDatabase(stale);
  const deletion = { ...stale, settings: applyMemberDeletions(settings, removed) };
  assert.equal((await request('PUT', { state: deletion, expectedUpdatedAt: db.revision })).status, 200);
  assert.equal((await request('PUT', { state: stale })).status, 200);
  const full = await request('GET');
  const onlySettings = await request('GET', undefined, '/api/app-state?settings=1');
  for (const result of [full.data.state.settings, onlySettings.data.settings]) {
    assert.equal(result.manualUsers.some((user: User) => user.id === member.id), false);
    assert.equal(isMemberDeleted(alias, result.deletedMembers), true);
  }
});

test('ordinary concurrent PUT cannot apply validation performed before a member was removed', async () => {
  const assigned = task([phase('New assignment'), phase('Final Rev.', { phaseKind: 'final_review', roleIds: ['art_director'], userIds: [finalReviewer.id] })], { workflowNodeAssigneeIds: { 'New assignment': [member.id] } });
  const canonical = { ...settings, workflows: [{ ...assigned.workflowSnapshot!, taskTypeIds: ['qa'] }] };
  const initial = { tasks: [], notifications: [], settings: canonical };
  const { db, request } = fakeDatabase(initial);
  db.beforeWrite = async () => {
    assert.equal((await request('PUT', { state: { ...initial, settings: applyMemberDeletions(canonical, removed) }, expectedUpdatedAt: db.revision })).status, 200);
  };
  const incoming = { ...initial, tasks: [assigned] };
  assert.equal((await request('PUT', { state: incoming })).status, 409);
  assert.equal(db.state.tasks.length, 0);
  const retry = await request('PUT', { state: incoming });
  assert.equal(retry.status, 403, 'retry must revalidate owners against durable removal records');
  assert.match(retry.data.error, /accountable member/);
  assert.equal(db.state.tasks.length, 0);
});

test('deletion loses a CAS race to new assignment without creating tombstones or removing member', async () => {
  const assigned = task([phase('New work'), phase('Final Rev.', { phaseKind: 'final_review', roleIds: ['art_director'], userIds: [finalReviewer.id] })], { workflowNodeAssigneeIds: { 'New work': [member.id] } });
  const canonical = { ...settings, workflows: [{ ...assigned.workflowSnapshot!, taskTypeIds: ['qa'] }] };
  const initial = { tasks: [], notifications: [], settings: canonical };
  const { db, request } = fakeDatabase(initial);
  db.beforeWrite = async () => {
    assert.equal((await request('PUT', { state: { ...initial, tasks: [assigned] } })).status, 200);
  };
  const response = await request('PUT', { state: { ...initial, settings: applyMemberDeletions(canonical, removed) }, expectedUpdatedAt: db.revision });
  assert.equal(response.status, 409);
  assert.equal(db.deleted.length, 0);
  assert.equal(db.state.settings.manualUsers?.some(user => user.id === member.id), true);
});

test('durable write failures do not report successful removal or retain partial tombstones', async () => {
  const initial = { tasks: [], notifications: [], settings };
  const { db, request } = fakeDatabase(initial);
  db.failWrite = true;
  const response = await request('PUT', { state: { ...initial, settings: applyMemberDeletions(settings, removed) }, expectedUpdatedAt: db.revision });
  assert.equal(response.status, 500);
  assert.equal(db.deleted.length, 0);
  assert.deepEqual(db.state, initial);
});
