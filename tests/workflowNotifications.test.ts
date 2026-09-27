import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppStateHandler } from '../api/app-state';
import { mergeAppSettings } from '../src/lib/appSettings';
import { appendStartedEntries, computeWorkflowAdvance } from '../src/lib/workflowRuntime';
import { getHandoffNotifications, getReassignmentNotifications, mergeHandoffNotifications } from '../src/lib/reassignmentNotifications';
import { canEditTask, canViewTask } from '../src/lib/taskPolicy';
import type { Notification, Task, User, WorkflowDefinition } from '../src/lib/types';
import type { PersistedAppState } from '../src/lib/localDb';

const employees: User[] = ['one', 'two', 'three'].map((id, index) => ({ id, name: id, role: 'team_member', jobTitle: ['Content Creator', 'Senior Brand Designer', 'Graphic Designer'][index] }));
const leader: User = { id: 'leader', name: 'Leader', role: 'admin' };
const director: User = { id: 'ad', name: 'Director', role: 'art_director' };
const users = [...employees, leader, director];
const workflow: WorkflowDefinition = { id: 'handoff', name: 'Handoff', active: true, taskTypeIds: ['handoff'], phases: [
  ...employees.map((user, index) => ({ id: user.id, name: `Work ${index + 1}`, phaseKind: 'work' as const, reviewStyle: 'first_review' as const,
    mode: 'sequential' as const, userIds: [user.id], roleIds: [], responsibilityIds: [], parentPhaseIds: [index ? employees[index - 1].id : 'workflow-root'] })),
  { id: 'final', name: 'Final Rev.', phaseKind: 'final_review', reviewStyle: 'final_review', mode: 'sequential', userIds: ['ad'], roleIds: ['art_director'], responsibilityIds: [], parentPhaseIds: ['three'] },
] };
const settings = mergeAppSettings({ workflows: [workflow], manualUsers: users, finalReviewerUserIds: ['ad'], notificationResetVersion: 3 });
const now = () => new Date().toISOString();
function makeTask(): Task {
  const time = now();
  return { id: 'A', code: 'TASK-A', name: 'Task A', taskType: 'handoff', reviewMode: 'first_review', environment: 'production', createdBy: leader.id,
    handledBy: employees.map(user => user.id), workContributorIds: employees.map(user => user.id), status: 'assigned_work', currentOwnerRole: 'team_member',
    currentOwnerUserId: 'one', currentOwnerUserIds: ['one'], priority: 'normal', deadlineText: null, versions: [], comments: [], thumbnailUrl: '', createdAt: time, updatedAt: time,
    workflowId: workflow.id, workflowSnapshot: structuredClone(workflow), workflowCurrentPhaseId: 'one', workflowActivePhaseIds: ['one'], workflowPhaseApprovals: {},
    workflowNodeAssigneeIds: { one: ['one'], two: ['two'], three: ['three'] }, workflowFinalApproverIdsByPhaseId: { final: 'ad' },
    workflowPhaseHistory: [{ phaseId: 'one', phaseName: 'Work 1', action: 'started', actorId: leader.id, createdAt: time }] };
}
function deliver(task: Task, actor: User): Task {
  const phaseId = task.workflowActivePhaseIds![0];
  const version = { id: `upload-${actor.id}`, versionNumber: task.versions.length + 1, submittedBy: actor.id, fileUrl: `https://example.test/${actor.id}.pdf` } as Task['versions'][number];
  const next = { ...task, versions: [version, ...task.versions] };
  const result = computeWorkflowAdvance(task.workflowSnapshot!, next, actor.id, phaseId, settings, users)!;
  assert.ok(result);
  assert.equal(result.blockedReason, undefined);
  const active = task.workflowSnapshot!.phases.filter(phase => result.nextActivePhaseIds.includes(phase.id));
  const ownerIds = active.flatMap(phase => phase.userIds.filter(id => !result.approvals[phase.id]?.includes(id))).slice(0, 1);
  return { ...next, workflowPhaseApprovals: result.approvals, workflowPhaseHistory: appendStartedEntries(result.history, active, actor.id),
    workflowActivePhaseIds: result.nextActivePhaseIds, workflowCurrentPhaseId: result.nextActivePhaseIds[0], currentOwnerUserId: ownerIds[0], currentOwnerUserIds: ownerIds,
    currentOwnerRole: active[0]?.phaseKind === 'final_review' ? 'art_director' : 'team_member',
    status: active[0]?.phaseKind === 'final_review' ? 'sent_to_art_director' : 'assigned_work', updatedAt: now() };
}
function fixture(tasks: Task[] = []) {
  const db = { state: { tasks, settings, notifications: [], dailyReports: [] } as PersistedAppState, revision: now(), now: new Date() };
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    if (query.startsWith('CREATE TABLE') || query.startsWith('SELECT record') || query.startsWith('SELECT workflow_id')) return [];
    if (query.startsWith('SELECT state, updated_at')) return [{ state: structuredClone(db.state), updated_at: db.revision }];
    if (query.startsWith('WITH written AS')) {
      if (values[3] !== db.revision) return [];
      db.state = JSON.parse(values[1] as string); db.revision = new Date(Date.parse(db.revision) + 1).toISOString();
      return [{ updated_at: db.revision }];
    }
    throw new Error(`Unexpected SQL: ${query}`);
  };
  const auth = { loadProfiles: async () => users, authenticate: async (req: any) => users.find(user => user.id === req.headers.authorization) };
  const handler = createAppStateHandler(() => sql as never, auth as never, () => db.now);
  async function request(user: User, method = 'GET', body?: unknown) {
    let status = 0; let data: any;
    await handler({ method, url: '/api/app-state', headers: { host: 'workspace.test', authorization: user.id }, body }, {
      setHeader() {}, status(code: number) { status = code; return { json(value: unknown) { data = value; }, end() {} }; },
    });
    assert.equal(status, 200, JSON.stringify(data));
    return data;
  }
  return { db, request };
}

test('server creates and advances notices without client notices; access accumulates for employees 1, 2, 3', async () => {
  const { db, request } = fixture();
  let task = makeTask();
  await request(leader, 'PUT', { state: { tasks: [task] }, changedTaskIds: ['A'] });
  for (let turn = 0; turn < employees.length; turn++) {
    for (let index = 0; index < employees.length; index++) {
      const state = (await request(employees[index])).state;
      assert.equal(state.tasks.some((item: Task) => item.id === 'A'), index <= turn);
      assert.equal(state.notifications.filter((notice: Notification) => notice.taskId === 'A').length, index <= turn ? 1 : 0);
      assert.equal(canEditTask(task, employees[index], settings, users), index === turn);
    }
    assert.deepEqual(db.state.notifications.filter(notice => notice.taskId === 'A').map(notice => notice.userId).sort(), employees.slice(0, turn + 1).map(user => user.id).sort());
    if (turn < employees.length - 1) {
      task = deliver(task, employees[turn]);
      await request(employees[turn], 'PUT', { state: { tasks: [task], notifications: [] }, changedTaskIds: ['A'] });
    }
  }
});

test('missing notices recover on GET, persist read acknowledgements without task edits, and never duplicate', async () => {
  const { db, request } = fixture([makeTask()]);
  const first = (await request(employees[0])).state;
  const notice = first.notifications[0]; assert.ok(notice);
  assert.equal((await request(employees[1])).state.notifications.length, 0);
  db.now = new Date(db.now.getTime() + 30_000);
  assert.deepEqual((await request(employees[0])).state.notifications, first.notifications);
  await request(employees[0], 'PUT', { state: { notifications: [{ ...notice, read: true }] }, changedTaskIds: [] });
  assert.equal(db.state.notifications.length, 1);
  assert.equal(db.state.notifications[0].read, true);
  assert.equal((await request(employees[0])).state.notifications[0].read, true);
  await request(employees[0], 'PUT', { state: { tasks: db.state.tasks }, changedTaskIds: [] });
  assert.equal(db.state.notifications.length, 1);
  assert.equal(db.state.notifications[0].read, true);
});

test('same-step sequential employees are notified only when each approval advances the turn', () => {
  let task = makeTask();
  task.workflowSnapshot!.phases = [{ ...task.workflowSnapshot!.phases[0], userIds: employees.map(user => user.id) }, { ...task.workflowSnapshot!.phases[3], parentPhaseIds: ['one'] }];
  task.workflowNodeAssigneeIds = { one: employees.map(user => user.id) };
  let notices: Notification[] = [];
  for (let turn = 0; turn < employees.length; turn++) {
    const generated = getHandoffNotifications(task, settings, users, now());
    assert.deepEqual(generated.map(notice => notice.userId), [employees[turn].id]);
    notices = mergeHandoffNotifications(notices, generated);
    assert.equal(notices.length, turn + 1);
    for (let index = 0; index < employees.length; index++) assert.equal(canViewTask(task, employees[index], settings, users), index <= turn);
    if (turn < employees.length - 1) task = deliver(task, employees[turn]);
  }
});

test('delays use the supplied clock, including legacy scalar delays, and closed/held work stays quiet', async () => {
  const task = makeTask(); const release = new Date(Date.now() + 60_000).toISOString();
  task.workflowPhaseAvailableAt = release;
  task.workflowPhaseAvailableAtByPhaseId = {};
  assert.equal(getHandoffNotifications(task, settings, users, now()).length, 0);
  assert.deepEqual(getHandoffNotifications(task, settings, users, release).map(notice => notice.userId), ['one']);
  const { db, request } = fixture([task]);
  assert.equal((await request(employees[0])).state.notifications.length, 0);
  db.now = new Date(release);
  assert.equal((await request(employees[0])).state.notifications.length, 1);
  for (const status of ['on_hold', 'completed', 'archived'] as const) assert.equal(getHandoffNotifications({ ...task, status }, settings, users, release).length, 0);
  assert.equal(getHandoffNotifications({ ...task, archivedAt: now() }, settings, users, release).length, 0);
});

test('reassignment and current-turn recovery produce one notice, preserving reads and reset tombstones', () => {
  const before = makeTask();
  const after = { ...before, workflowNodeAssigneeIds: { ...before.workflowNodeAssigneeIds, one: ['two'] }, updatedAt: now() };
  const assigned = getReassignmentNotifications(before, after, settings, users);
  const handoff = getHandoffNotifications(after, settings, users, now());
  const combined = mergeHandoffNotifications([], [...assigned, ...handoff]);
  assert.deepEqual(combined.map(notice => notice.userId), ['two']);
  assert.equal(mergeHandoffNotifications(combined.map(notice => ({ ...notice, read: true })), handoff)[0].read, true);
  const normal = getHandoffNotifications(before, settings, users, now());
  assert.equal(mergeHandoffNotifications([], normal, normal.map(notice => notice.id)).length, 0);
});
