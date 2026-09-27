import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppStateHandler } from '../api/app-state';
import { createMetadataHandler } from '../api/metadata';
import { createTaskMetadataAuthorizer } from '../server/taskMetadata';
import { createWorkspaceAuth } from '../server/workspaceAuth';
import { mergeAuthorizedTasks } from '../server/taskAccess';
import { canViewTask, canEditTask, hasTaskWorkHistory } from '../src/lib/taskPolicy';
import { computeWorkflowAdvance, computeWorkflowReturn, computeWorkflowInitialization } from '../src/lib/workflowRuntime';
import { mergeAppSettings } from '../src/lib/appSettings';
import type { Task, User, WorkflowPhaseDefinition } from '../src/lib/types';
import type { PersistedAppState } from '../src/lib/localDb';

const hash = '54dc5ea37dba777773abb68176c2eb2472856d5f480f71c2eb2472856d5f480f71';
const member = { id: 'member', name: 'Member', email: 'member@example.test', role: 'team_member', jobTitle: 'Content Creator', passwordHash: hash } as User;
const future = { ...member, id: 'future', email: 'future@example.test' };
const senior = { id: 'senior', name: 'Senior', role: 'reviewer', jobTitle: 'Senior Content Creator' } as User;
const leader = { id: 'leader', name: 'Leader', role: 'team_leader' } as User;
const users = [member, future, senior, leader, { id: 'ad', name: 'Art Director', role: 'art_director' as const }];
const settings = mergeAppSettings({ notificationResetVersion: 2, workflows: [], manualUsers: users, viewAllWorkloadUserIds: [member.id], reportingSeniorByUserId: { member: senior.id, future: senior.id } });
const phase = (id: string): WorkflowPhaseDefinition => ({ id, name: id, phaseKind: 'work', mode: 'sequential', reviewStyle: 'quick_look', userIds: [], roleIds: [], responsibilityIds: [], skipRule: 'none' });
const task = (overrides: Partial<Task> = {}): Task => ({ id: 'own', code: 'TSK-1', name: 'Own task', createdBy: leader.id, handledBy: [member.id, future.id], status: 'assigned_work',
  currentOwnerUserId: member.id, currentOwnerUserIds: [member.id], workflowCurrentPhaseId: 'A', workflowActivePhaseIds: ['A'], workflowSnapshot: { id: 'flow', name: 'Flow', phases: [phase('A'), phase('B')] },
  workflowNodeAssigneeIds: { A: [member.id], B: [future.id] }, workflowPhaseHistory: [], workflowPhaseApprovals: {}, versions: [], ...overrides } as Task);

function fixture() {
  const db = { now: new Date('2026-09-14T08:00:00Z'), revision: '2026-09-14T00:00:00.000Z', state: { settings, tasks: [task(),
    task({ id: 'hidden', name: 'SECRET future work', createdBy: member.id, workflowNodeAssigneeIds: { A: [future.id], B: [member.id] }, assignmentLinks: ['https://drive.google.com/file/d/secret-file/view'] }),
    task({ id: 'past', name: 'Past upload', workflowNodeAssigneeIds: { A: [future.id] }, versions: [{ id: 'upload', submittedBy: member.id, fileUrl: 'https://drive.google.com/file/d/old-file/view' } as never] })],
    notifications: [{ id: 'hidden-notice', userId: member.id, taskId: 'hidden', message: 'SECRET notice', read: false, createdAt: '2026-09-14T08:00:00Z' }], dailyReports: [] } as PersistedAppState };
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    if (query.startsWith('CREATE TABLE') || query.startsWith('SELECT record') || query.startsWith('SELECT workflow_id')) return [];
    if (query.startsWith('SELECT state, updated_at')) return [{ state: structuredClone(db.state), updated_at: db.revision }];
    if (query.startsWith('WITH written AS')) {
      if (values[3] !== db.revision) return [];
      db.state = JSON.parse(values[1] as string);
      db.revision = new Date(Date.parse(db.revision) + 1).toISOString();
      return [{ updated_at: db.revision }];
    }
    throw new Error(`Unexpected test SQL: ${query}`);
  };
  const auth = createWorkspaceAuth({ env: { WORKSPACE_SESSION_SECRET: 'test-cookie-secret', SUPABASE_URL: 'https://supabase.example.test', SUPABASE_ANON_KEY: 'test-key' },
    fetch: async (url, init) => {
      const token = (init?.headers as Record<string, string>)?.Authorization?.replace('Bearer ', '');
      if (String(url).includes('/auth/v1/user')) return new Response(JSON.stringify({ id: token }), { status: users.some(user => user.id === token) ? 200 : 401 });
      return new Response(JSON.stringify((db.state.settings?.manualUsers || users).map(user => ({ ...user, job_title: user.jobTitle, is_admin: user.isAdmin }))));
    } });
  const handler = createAppStateHandler(() => sql as never, auth, () => db.now);
  const metadata = createMetadataHandler({ authorize: createTaskMetadataAuthorizer(() => sql as never, auth), fetchTitle: async () => 'Verified title' });
  async function request(method: string, body?: unknown, user = member.id, url = '/api/app-state', target: any = handler) {
    let status = 0; let data: any;
    await target({ method, url, body, headers: { host: 'workspace.test', authorization: `Bearer ${user}` } }, {
      setHeader: () => {}, status: (code: number) => { status = code; return { json: (value: unknown) => { data = value; } }; },
    });
    return { status, data };
  }
  return { db, request, metadata };
}

test('task visibility requires a real available turn; creator, broad lists and future assignments do not grant it', () => {
  const own = task();
  assert.equal(canViewTask(own, member, settings, users), true);
  assert.equal(canViewTask(own, future, settings, users), false);
  assert.equal(canViewTask(task({ createdBy: future.id }), future, settings, users), false);
  assert.equal(canViewTask(own, senior, settings, users), true);
  assert.equal(canEditTask(own, senior, settings, users), false);
  assert.equal(canViewTask(task({ workflowNodeAssigneeIds: { A: [] } }), member, settings, users), false);
  assert.equal(hasTaskWorkHistory(task({ workflowPhaseHistory: [{ phaseId: 'A', phaseName: 'A', action: 'started', actorId: future.id, createdAt: 'now' }] }), future.id), false);
});

test('API projection removes hidden tasks/notices and preserves omitted canonical tasks on ordinary/report/settings saves', async () => {
  const { db, request } = fixture();
  const read = await request('GET');
  assert.deepEqual(read.data.state.tasks.map((task: Task) => task.id), ['own', 'past']);
  assert.equal(JSON.stringify(read.data).includes('SECRET'), false);
  const next = read.data.state; next.tasks = [];
  assert.equal((await request('PUT', { state: next, changedTaskIds: [] })).status, 200);
  assert.equal(db.state.tasks.length, 3);
  assert.ok(db.state.notifications.some(notice => notice.id === 'hidden-notice'));
  assert.ok(db.state.notifications.every(notice => notice.id === 'hidden-notice' || notice.id.startsWith('workflow:')));
});

test('hidden history forgery, hidden deletion and read-only historical edits are rejected against prestate', async () => {
  const { db, request } = fixture();
  const hidden = structuredClone(db.state.tasks[1]);
  hidden.workflowPhaseApprovals = { A: [member.id] };
  assert.equal((await request('PUT', { state: { tasks: [hidden] }, changedTaskIds: ['hidden'], role: 'admin' })).status, 403);
  assert.equal((await request('PUT', { state: { tasks: [] }, deletedTaskIds: ['hidden'] })).status, 403);
  const past = { ...db.state.tasks[2], name: 'Unauthorized past edit' };
  assert.equal((await request('PUT', { state: { tasks: [past] } })).status, 403);
  assert.equal(db.state.tasks[1].workflowPhaseApprovals?.A, undefined);
});

test('active owner cannot fabricate another member’s historical approval, upload or work session', () => {
  const own = task();
  const cases: Partial<Task>[] = [
    { workflowPhaseApprovals: { A: [future.id] } },
    { workflowPhaseHistory: [{ phaseId: 'A', phaseName: 'A', action: 'completed', actorId: future.id, createdAt: 'now' }] },
    { versions: [{ id: 'forged', submittedBy: future.id, fileUrl: 'https://drive.google.com/file/d/forged/view' } as never] },
    { activeWorkBy: future.id, activeWorkStartedAt: new Date().toISOString() },
  ];
  for (const forged of cases) assert.throws(() => mergeAuthorizedTasks([own], [{ ...own, ...forged }], member, settings, users), /fabricated|impersonated|attribution/i);
  const placeholder: Task = { ...own, versions: [{ id: 'empty', submittedBy: future.id, fileUrl: '' } as never] };
  assert.throws(() => mergeAuthorizedTasks([placeholder], [{ ...placeholder, versions: [{ ...placeholder.versions[0], fileUrl: 'https://drive.google.com/file/d/forged/view' }] }], member, settings, users), /fabricated/i);
});

test('valid uploaded handoff retains read-only work history; authorized deletion and on-behalf creation still work', async () => {
  const { db, request } = fixture();
  const prior = db.state.tasks[0];
  const versions = [{ id: 'real-upload', submittedBy: member.id, fileUrl: 'https://drive.google.com/file/d/real-upload/view' } as never];
  const advance = computeWorkflowAdvance(prior.workflowSnapshot!, { ...prior, versions }, member.id, 'A', settings, users)!;
  const handoff = { ...prior, versions, workflowPhaseHistory: advance.history, workflowPhaseApprovals: advance.approvals, workflowActivePhaseIds: advance.nextActivePhaseIds, workflowCurrentPhaseId: 'B', currentOwnerUserId: future.id, currentOwnerUserIds: [future.id] };
  const result = await request('PUT', { state: { tasks: [handoff] }, changedTaskIds: ['own'] });
  assert.equal(result.status, 200);
  assert.equal(result.data.tasks.some((task: Task) => task.id === 'own'), true);
  assert.equal(canEditTask(handoff, member, settings, users), false);
  assert.equal(db.state.tasks.some(task => task.id === 'own'), true);
  const workflow = { id: 'new-flow', name: 'New Flow', active: true, taskTypeIds: ['new flow'], phases: [phase('A'), { ...phase('AD'), phaseKind: 'final_review' as const, roleIds: ['art_director' as const] }] };
  db.state.settings = mergeAppSettings({ ...db.state.settings, workflows: [workflow] });
  const created = task({ id: 'new', taskType: 'new flow', workflowId: workflow.id, workflowSnapshot: workflow, createdBy: future.id });
  assert.equal((await request('PUT', { state: { tasks: [created] }, changedTaskIds: ['new'] }, senior.id)).status, 200);
  assert.equal((await request('PUT', { state: { tasks: [] }, deletedTaskIds: ['new'] }, leader.id)).status, 200);
  assert.equal(db.state.tasks.some(task => task.id === 'new'), false);
});

test('time alone can make a delayed phase visible with an unchanged database revision', async () => {
  const { db, request } = fixture();
  db.state.tasks[0].workflowPhaseAvailableAtByPhaseId = { A: '2026-09-14T09:00:00Z' };
  const before = await request('GET');
  assert.equal(before.data.state.tasks.some((task: Task) => task.id === 'own'), false);
  db.now = new Date('2026-09-14T09:00:00Z');
  const after = await request('GET');
  assert.equal(after.data.updatedAt, before.data.updatedAt);
  assert.equal(after.data.state.tasks.some((task: Task) => task.id === 'own'), true);
});

test('metadata uses verified bearer identity and prevents URL and task-ID bypasses for hidden attachments', async () => {
  const { request, metadata } = fixture();
  const url = '/api/metadata?url=' + encodeURIComponent('https://drive.google.com/open?id=secret-file');
  assert.equal((await request('GET', undefined, member.id, url, metadata)).status, 403);
  assert.equal((await request('GET', undefined, leader.id, url, metadata)).status, 200);
  assert.equal((await request('GET', undefined, 'forged', url, metadata)).status, 401);
  assert.equal((await request('GET', undefined, member.id, '/api/metadata?taskId=hidden&url=' + encodeURIComponent('https://docs.google.com/document/d/public-new/edit'), metadata)).status, 403);
  assert.equal((await request('GET', undefined, member.id, '/api/metadata?url=' + encodeURIComponent('https://docs.google.com/document/d/public-new/edit'), metadata)).status, 200);
});

test('member-removal failures keep hidden task identity private while retaining the actual blocker', async () => {
  const { db, request } = fixture();
  db.state.settings = structuredClone(settings);
  db.state.settings.manualUsers!.find(user => user.id === senior.id)!.isAdmin = true;
  db.state.settings.manualUsers!.push({ id: 'designer', name: 'Designer', role: 'team_member', jobTitle: 'Brand Designer' });
  db.state.tasks[1].workflowNodeAssigneeIds = { A: ['designer'], B: [future.id] };
  const nextSettings = { ...db.state.settings, deletedMembers: [{ ...future, deletedAt: '2026-09-14T09:00:00Z', deletedBy: senior.id }] };
  const result = await request('PUT', { state: { settings: nextSettings, tasks: [] }, changedTaskIds: [] }, senior.id);
  assert.equal(result.status, 409);
  assert.equal(JSON.stringify(result.data).includes('hidden'), false);
  assert.equal(JSON.stringify(result.data).includes('SECRET'), false);
  assert.ok(result.data.blockedTaskCount > result.data.blockingTasks.length);
  assert.equal(db.state.settings.deletedMembers?.length || 0, 0);
});

test('runtime advance, return, upload revision and workflow reset preserve valid attribution', () => {
  const own = task(); const workflow = own.workflowSnapshot!;
  const advance = computeWorkflowAdvance(workflow, own, member.id, 'A', settings, users);
  assert.ok(advance);
  const review = { ...own, versions: [{ id: 'initial-delivery', submittedBy: member.id, fileUrl: 'https://drive.google.com/file/d/initial/view' } as never], workflowActivePhaseIds: advance.nextActivePhaseIds, workflowCurrentPhaseId: 'B', workflowPhaseHistory: advance.history, workflowPhaseApprovals: advance.approvals };
  assert.doesNotThrow(() => mergeAuthorizedTasks([own], [review], member, settings, users));
  const returned = computeWorkflowReturn(workflow, review, future.id, 'B', 'A', settings, users);
  assert.ok(returned);
  const revision = { ...review, workflowActivePhaseIds: returned.nextActivePhaseIds, workflowCurrentPhaseId: 'A', workflowPhaseHistory: returned.history, workflowPhaseApprovals: returned.approvals };
  assert.doesNotThrow(() => mergeAuthorizedTasks([review], [revision], future, settings, users));
  const uploaded = { ...revision, versions: [{ id: 'revised', submittedBy: member.id, fileUrl: 'https://drive.google.com/file/d/revised/view' } as never] };
  assert.doesNotThrow(() => mergeAuthorizedTasks([revision], [uploaded], member, settings, users));
  const resetBase = { ...uploaded, workflowPhaseApprovals: {}, workflowPhaseHistory: [...uploaded.workflowPhaseHistory, ...workflow.phases.map(phase => ({ phaseId: phase.id, phaseName: phase.name, action: 'invalidated' as const, actorId: leader.id, createdAt: new Date().toISOString() }))] };
  const initialized = computeWorkflowInitialization(workflow, resetBase, leader.id);
  const reset = { ...resetBase, workflowPhaseHistory: [...resetBase.workflowPhaseHistory, ...initialized.history], workflowActivePhaseIds: initialized.nextActivePhaseIds };
  assert.doesNotThrow(() => mergeAuthorizedTasks([uploaded], [reset], leader, settings, users));
});
