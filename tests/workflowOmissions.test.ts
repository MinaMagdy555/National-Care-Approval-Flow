import test from 'node:test';
import assert from 'node:assert/strict';
import type { Task, User, WorkflowDefinition, WorkflowPhaseDefinition } from '../src/lib/types';
import { mergeAppSettings } from '../src/lib/appSettings';
import { canManageWorkflowOmissions, reconcileWorkflowOmissions, validateWorkflowOmissionSelection } from '../src/lib/workflowOmissions';
import { computeWorkflowAdvance, computeWorkflowInitialization, computeWorkflowReturn } from '../src/lib/workflowRuntime';
import { validateTaskWorkflowOmissions } from '../server/workflowOmissions';
import { mergeAuthorizedTasks } from '../server/taskAccess';

const member: User = { id: 'member', name: 'Member', role: 'team_member', jobTitle: 'Graphic Designer' };
const other: User = { ...member, id: 'other', name: 'Other' };
const leader: User = { id: 'leader', name: 'Leader', role: 'team_leader' };
const ad: User = { id: 'ad', name: 'AD', role: 'art_director' };
const senior: User = { id: 'senior', name: 'Senior', role: 'reviewer', jobTitle: 'Senior Graphic Designer' };
const users = [member, other, leader, ad, senior];
const settings = mergeAppSettings({ workflows: [], reportingSeniorByUserId: { member: senior.id } });
const now = new Date('2026-09-14T08:00:00.000Z');
const phase = (id: string, parent: string[], owner = member.id, extra: Partial<WorkflowPhaseDefinition> = {}): WorkflowPhaseDefinition => ({ id, name: id, phaseKind: 'work', mode: 'sequential', reviewStyle: 'first_review', userIds: [owner], roleIds: [], responsibilityIds: [], skipRule: 'none', parentPhaseIds: parent, ...extra });
const workflow = (phases = [phase('A', ['workflow-root']), phase('B', ['A'], other.id), phase('AD', ['B'], ad.id, { phaseKind: 'final_review', roleIds: ['art_director'] })]): WorkflowDefinition => ({ id: 'flow', name: 'Flow', active: true, phases });
const task = (flow = workflow(), extra: Partial<Task> = {}): Task => ({ id: 'task', code: 'TSK-14', name: 'Omission task', taskType: 'design', createdBy: leader.id, handledBy: [member.id, other.id], reviewMode: 'first_review', environment: 'production', status: 'assigned_work', currentOwnerRole: 'team_member', currentOwnerUserId: member.id, currentOwnerUserIds: [member.id], priority: 'normal', deadlineText: null, versions: [], comments: [], thumbnailUrl: '', workflowId: flow.id, workflowSnapshot: flow, workflowActivePhaseIds: ['A'], workflowCurrentPhaseId: 'A', workflowPhaseApprovals: {}, workflowPhaseHistory: [{ phaseId: 'A', phaseName: 'A', actorId: leader.id, action: 'started', createdAt: now.toISOString() }], createdAt: now.toISOString(), updatedAt: now.toISOString(), ...extra });
const omit = (before: Task, ids: string[], actor = leader) => reconcileWorkflowOmissions(before, { ...before, workflowSkippedPhaseIds: ids }, actor, settings, users, now);

test('active removal preserves snapshot/history, moves owner and stops same-person prior work session', () => {
  const flow = workflow([phase('A', ['workflow-root']), phase('B', ['A']), phase('AD', ['B'], ad.id, { phaseKind: 'final_review' })]);
  const before = task(flow, { activeWorkBy: member.id, activeWorkStartedAt: '2026-09-14T07:00:00Z' });
  const result = omit(before, ['A']);
  assert.equal(result.ok, true);
  const after = result.task!;
  assert.deepEqual(after.workflowActivePhaseIds, ['B']);
  assert.deepEqual(after.currentOwnerUserIds, [member.id]);
  assert.equal(after.activeWorkFinishedAt, now.toISOString());
  assert.equal(after.activeWorkStartedAt, before.activeWorkStartedAt);
  assert.deepEqual(after.workflowSnapshot, before.workflowSnapshot);
  assert.deepEqual(after.workflowPhaseHistory?.slice(0, 1), before.workflowPhaseHistory);
  assert.doesNotThrow(() => validateTaskWorkflowOmissions(before, after, leader, settings, users, now));
});

test('future removal and restoration preserve active progress; restoration after routing is refused', () => {
  const before = task();
  const future = omit(before, ['B']).task!;
  assert.deepEqual(future.workflowActivePhaseIds, ['A']);
  assert.deepEqual(future.workflowPhaseHistory, before.workflowPhaseHistory);
  assert.equal(omit(future, []).ok, true);
  const advanced = computeWorkflowAdvance(future.workflowSnapshot!, future, member.id, 'A', settings, users)!;
  assert.deepEqual(advanced.nextActivePhaseIds, ['AD']);
  const passed = { ...future, workflowActivePhaseIds: advanced.nextActivePhaseIds, workflowPhaseHistory: advanced.history };
  assert.equal(omit(passed, []).ok, false);
  assert.doesNotThrow(() => validateTaskWorkflowOmissions(future, passed, member, settings, users));
});

test('parallel removals satisfy a join once, preserve unaffected delayed branch and session', () => {
  const flow = workflow([phase('A', ['workflow-root']), phase('B', ['workflow-root']), phase('C', ['A', 'B'], other.id, { disabled: true }), phase('AD', ['C'], ad.id, { phaseKind: 'final_review' })]);
  const before = task(flow, { workflowActivePhaseIds: ['A', 'B'], activeWorkBy: member.id, activeWorkStartedAt: now.toISOString(), workflowPhaseAvailableAtByPhaseId: { B: '2026-09-15T08:00:00Z' } });
  const one = omit(before, ['A']).task!;
  assert.deepEqual(one.workflowActivePhaseIds, ['B']);
  assert.equal(one.activeWorkFinishedAt, undefined);
  assert.equal(one.workflowPhaseAvailableAtByPhaseId?.B, '2026-09-15T08:00:00Z');
  const all = omit(before, ['A', 'B']).task!;
  assert.deepEqual(all.workflowActivePhaseIds, ['AD']);
  assert.deepEqual(all.workflowPhaseHistory?.filter(entry => entry.action === 'skipped').map(entry => entry.phaseId), ['A', 'B', 'C']);
  assert.equal(all.workflowPhaseHistory?.filter(entry => entry.phaseId === 'AD' && entry.action === 'started').length, 1);
});

test('new successor delay starts at omission time; held and returned tasks keep their suspension and uploader', () => {
  const flow = workflow([phase('A', ['workflow-root']), phase('B', ['A'], other.id, { delayDays: 1 }), phase('AD', ['B'], ad.id, { phaseKind: 'final_review' })]);
  const delayed = omit(task(flow), ['A']).task!;
  assert.ok(new Date(delayed.workflowPhaseAvailableAtByPhaseId!.B) > now);
  assert.deepEqual(delayed.currentOwnerUserIds, []);
  for (const status of ['on_hold', 'changes_requested_by_reviewer'] as const) {
    const before = task(flow, { status, previousStatusBeforeHold: 'assigned_work' });
    const after = omit(before, ['A']).task!;
    assert.equal(after.status, status);
    assert.deepEqual(after.workflowActivePhaseIds, ['B']);
    assert.deepEqual(after.workflowPendingHandoffPhaseIds, ['B']);
    if (status.startsWith('changes')) assert.deepEqual(after.currentOwnerUserIds, [member.id]);
    assert.doesNotThrow(() => validateTaskWorkflowOmissions(before, after, leader, settings, users, now));
  }
});

test('suspended immediate handoffs stay queued; newly reached legacy steps require real owners', () => {
  for (const status of ['on_hold', 'changes_requested_by_reviewer'] as const) {
    const after = omit(task(workflow(), { status, previousStatusBeforeHold: 'assigned_work' }), ['A']).task!;
    assert.deepEqual(after.workflowPendingHandoffPhaseIds, ['B']);
    assert.deepEqual(after.workflowPhaseAvailableAtByPhaseId, {});
  }
  const before = task(workflow(), { workflowNodeAssigneeIds: { B: [] } });
  assert.match(omit(before, ['A']).message!, /accountable member.*B/);
  assert.equal(omit(before, ['B']).ok, true, 'future omission does not validate an unrelated legacy owner');
});

test('creation can omit all nonfinal steps but AD remains required and ordinary users only choose Content Rev', () => {
  const before = task();
  assert.equal(validateWorkflowOmissionSelection(before, ['A', 'B'], leader, settings, users).ok, true);
  assert.deepEqual(computeWorkflowInitialization(before.workflowSnapshot!, { ...before, workflowSkippedPhaseIds: ['A', 'B'] }).nextActivePhaseIds, ['AD']);
  assert.equal(validateWorkflowOmissionSelection(before, ['AD'], leader, settings, users).ok, false);
  assert.equal(validateWorkflowOmissionSelection(before, ['A'], member, settings, users).ok, false);
  const content = task(workflow([phase('A', ['workflow-root'], member.id, { phaseKind: 'content_review' }), phase('AD', ['A'], ad.id, { phaseKind: 'final_review' })]));
  assert.equal(validateWorkflowOmissionSelection(content, ['A'], member, settings, users).ok, true);
  assert.equal(omit(content, ['A'], member).ok, false);
});

test('server rejects ordinary-owner skip IDs and fabricated skip history, managers require reconciled routing', () => {
  const before = task();
  assert.equal(canManageWorkflowOmissions(member, settings, before, users), false);
  assert.equal(canManageWorkflowOmissions(senior, settings, before, users), false);
  assert.throws(() => mergeAuthorizedTasks([before], [{ ...before, workflowSkippedPhaseIds: ['A'] }], member, settings, users), /workflow managers/);
  const forged = { ...before, workflowPhaseHistory: [...before.workflowPhaseHistory!, { phaseId: 'B', phaseName: 'B', action: 'skipped' as const, actorId: member.id, createdAt: now.toISOString() }] };
  assert.throws(() => mergeAuthorizedTasks([before], [forged], member, settings, users), /manually skipped/);
  assert.throws(() => validateTaskWorkflowOmissions(before, { ...before, workflowSkippedPhaseIds: ['A'] }, leader, settings, users), /routing action/);
  assert.throws(() => validateTaskWorkflowOmissions(before, { ...before, workflowSkippedPhaseIds: ['AD'] }, leader, settings, users), /Art Director/);
  assert.throws(() => validateTaskWorkflowOmissions(before, { ...before, workflowSkippedPhaseIds: ['B'], workflowActivePhaseIds: ['AD'] }, leader, settings, users), /routing action/);
});

test('restoring future step validates live owner and approval count without revalidating unrelated legacy nodes', () => {
  const before = task(workflow(), { workflowSkippedPhaseIds: ['B'], workflowNodeAssigneeIds: { B: [] } });
  assert.match(omit(before, []).message!, /accountable member/);
  const assigned = { ...before, workflowNodeAssigneeIds: { B: [other.id] } };
  assert.equal(omit(assigned, []).ok, true);
  assigned.workflowSnapshot = { ...assigned.workflowSnapshot!, phases: assigned.workflowSnapshot!.phases.map(phase => phase.id === 'B' ? { ...phase, requiredApprovals: 2 } : phase) };
  assert.match(omit(assigned, []).message!, /approval count/);
});

test('AD return traverses consecutive removed destinations to earlier retained work; no predecessor uses revision upload', () => {
  const flow = workflow([phase('A', ['workflow-root']), phase('B', ['A']), phase('C', ['B']), phase('AD', ['C'], ad.id, { phaseKind: 'final_review', returnToPhaseId: 'C' })]);
  const before = task(flow, { workflowSkippedPhaseIds: ['B', 'C'], workflowActivePhaseIds: ['AD'], workflowCurrentPhaseId: 'AD', workflowPhaseHistory: [
    { phaseId: 'A', phaseName: 'A', action: 'completed', actorId: member.id, createdAt: now.toISOString() },
    ...['B', 'C'].map(id => ({ phaseId: id, phaseName: id, action: 'skipped' as const, actorId: leader.id, createdAt: now.toISOString() })),
  ] });
  assert.equal(computeWorkflowReturn(flow, before, ad.id, 'AD', undefined, settings, users)?.targetPhaseId, 'A');
  assert.equal(computeWorkflowReturn(flow, { ...before, workflowSkippedPhaseIds: ['A', 'B', 'C'] }, ad.id, 'AD', undefined, settings, users)?.targetPhaseId, 'AD');
});
