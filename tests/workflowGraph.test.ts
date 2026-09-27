import test from 'node:test';
import assert from 'node:assert/strict';
import type { Task, User, WorkflowDefinition, WorkflowPhaseDefinition } from '../src/lib/types';
import { defaultWorkflows, findWorkflowTaskTypeCollisions, getTaskTypeConfigs, makeTaskTypeIdForWorkflowName, mergeAppSettings, normalizeWorkflowTaskTypeId } from '../src/lib/appSettings';
import { getWorkflowEntryPhases, getWorkflowSuccessors, validateWorkflowGraph } from '../src/lib/workflowGraph';
import { prepareWorkflowAssignmentOwners, resolveWorkflowAssignment } from '../src/lib/workflowAssignment';
import { computeWorkflowAdvance, computeWorkflowInitialization, computeWorkflowReturn } from '../src/lib/workflowRuntime';
import { cloneWorkflow, isMandatoryFinalReview } from '../src/lib/workflowUtils';
import { validateTaskWorkflowAssignment } from '../server/workflowAssignment';

const member: User = { id: 'member', name: 'Member', role: 'team_member' };
const ad: User = { id: 'ad', name: 'Art Director', role: 'art_director' };
const step = (id: string, extra: Partial<WorkflowPhaseDefinition> = {}): WorkflowPhaseDefinition => ({ id, name: id, phaseKind: 'work', reviewStyle: 'first_review', mode: 'sequential', userIds: [member.id], roleIds: [], responsibilityIds: [], ...extra });
const final = (extra: Partial<WorkflowPhaseDefinition> = {}) => step('AD', { phaseKind: 'final_review', reviewStyle: 'final_review', userIds: [ad.id], roleIds: ['art_director'], ...extra });
const flow = (phases: WorkflowPhaseDefinition[], name = 'Custom'): WorkflowDefinition => ({ id: 'flow', name, active: true, taskTypeIds: [name], phases });
const task = (workflow: WorkflowDefinition): Task => ({ id: 'task', name: 'Task', taskType: normalizeWorkflowTaskTypeId(workflow.name), workflowId: workflow.id, workflowSnapshot: cloneWorkflow(workflow),
  createdBy: member.id, status: 'assigned_work', versions: [], assignmentLinks: [], handledBy: [member.id], workflowActivePhaseIds: computeWorkflowInitialization(workflow, { versions: [], assignmentLinks: [] }).nextActivePhaseIds } as Task);

test('seeded campaign has one final gate, all retained steps run, and revision returns remain executable', () => {
  const workflow = defaultWorkflows[0];
  assert.equal(validateWorkflowGraph(workflow).valid, true);
  const runnable = workflow.phases.filter(phase => (phase.nodeType || 'step') === 'step');
  assert.deepEqual(runnable.filter(isMandatoryFinalReview).map(phase => phase.id), ['art_director_review']);
  const settings = mergeAppSettings({ workflows: [workflow] });
  let current = task(workflow);
  current.workflowNodeAssigneeIds = Object.fromEntries(runnable.map(phase => [phase.id, [isMandatoryFinalReview(phase) ? ad.id : member.id]]));
  for (let count = 0; current.workflowActivePhaseIds?.length && count < runnable.length + 5; count++) {
    const phaseId = current.workflowActivePhaseIds[0];
    if (phaseId === 'art_director_review') {
      assert.equal(computeWorkflowReturn(workflow, current, ad.id, phaseId, undefined, settings, [member, ad])?.targetPhaseId, 'final_creative');
    }
    const result = computeWorkflowAdvance(workflow, current, phaseId === 'art_director_review' ? ad.id : member.id, phaseId, settings, [member, ad])!;
    assert.ok(result);
    assert.equal(result.blockedReason, undefined);
    current = { ...current, workflowActivePhaseIds: result.nextActivePhaseIds, workflowPhaseHistory: result.history, workflowPhaseApprovals: result.approvals };
  }
  assert.deepEqual(new Set(current.workflowPhaseHistory?.filter(entry => entry.action === 'completed').map(entry => entry.phaseId)), new Set(runnable.map(phase => phase.id)));
});

test('explicit multi-root joins and root-plus-parent prerequisites use the same runtime graph', () => {
  const workflow = flow([step('A', { parentPhaseIds: ['workflow-root'] }), step('B', { parentPhaseIds: ['workflow-root'] }), final({ parentPhaseIds: ['A', 'B'] })]);
  assert.equal(validateWorkflowGraph(workflow).valid, true);
  assert.deepEqual(getWorkflowEntryPhases(workflow).map(phase => phase.id), ['A', 'B']);
  assert.deepEqual(computeWorkflowInitialization(workflow, task(workflow)).nextActivePhaseIds, ['A', 'B']);
  const dependent = flow([step('A', { parentPhaseIds: ['workflow-root'] }), final({ parentPhaseIds: ['workflow-root', 'A'] })]);
  assert.equal(validateWorkflowGraph(dependent).valid, true);
  assert.deepEqual(computeWorkflowInitialization(dependent, task(dependent)).nextActivePhaseIds, ['A']);
});

test('legacy array fallback is preserved while pass edges override ordinary children and blocked joins are diagnosed', () => {
  assert.equal(validateWorkflowGraph(flow([step('A'), final()])).valid, true);
  const workflow = flow([step('A', { parentPhaseIds: ['workflow-root'], passToPhaseId: 'AD' }), step('B', { parentPhaseIds: ['A'] }), final({ parentPhaseIds: ['A', 'B'] })]);
  assert.deepEqual(getWorkflowSuccessors(workflow, 'A').map(phase => phase.id), ['AD']);
  assert.ok(validateWorkflowGraph(workflow).issues.some(issue => issue.code === 'unreachable_final'));
  assert.ok(validateWorkflowGraph(workflow).issues.some(issue => issue.phaseId === 'B'));
});

test('invalid drafts save intact but cannot be assigned: cycles, unlinked, non-step and missing targets, missing AD', () => {
  for (const [workflow, code] of [
    [flow([step('A', { parentPhaseIds: ['AD'] }), final({ parentPhaseIds: ['A'] })]), 'forward_cycle'],
    [flow([step('A', { parentPhaseId: '__unlinked__' }), final({ parentPhaseIds: ['A'] })]), 'unlinked_step'],
    [flow([step('A', { passToPhaseId: 'note' }), step('note', { nodeType: 'note' }), final()]), 'invalid_target'],
    [flow([step('A'), final({ failToPhaseId: 'missing' })]), 'invalid_target'],
    [flow([step('A')]), 'missing_final'],
  ] as const) {
    const before = structuredClone(workflow);
    const settings = mergeAppSettings({ workflows: [workflow] });
    assert.equal(settings.workflows?.[0].id, workflow.id, 'draft persistence retains invalid workflows');
    assert.ok(validateWorkflowGraph(workflow).issues.some(issue => issue.code === code));
    assert.equal(resolveWorkflowAssignment(settings, workflow.name).ok, false);
    assert.deepEqual(workflow, before);
  }
});

test('fail/return links allow self and ancestors, never forward or unrelated return targets', () => {
  const valid = flow([step('A'), final({ failToPhaseId: 'A', returnToPhaseId: 'AD' })]);
  assert.equal(validateWorkflowGraph(valid).valid, true);
  const forward = flow([step('A', { returnToPhaseId: 'AD' }), final()]);
  assert.ok(validateWorkflowGraph(forward).issues.some(issue => issue.code === 'invalid_return'));
});

test('canonical Unicode task types preserve Arabic and diagnose punctuation aliases with consistent ownership', () => {
  assert.equal(makeTaskTypeIdForWorkflowName('حملة رمضان'), 'حملة رمضان');
  assert.notEqual(makeTaskTypeIdForWorkflowName('حملة رمضان'), makeTaskTypeIdForWorkflowName('مراجعة محتوى'));
  assert.equal(normalizeWorkflowTaskTypeId('  AI__Packet -- QA '), 'ai packet qa');
  const first = flow([step('A'), final()], 'حملة-رمضان');
  const second = { ...first, id: 'second', taskTypeIds: ['حملة   رمضان'] };
  const settings = mergeAppSettings({ workflows: [first, second] });
  assert.deepEqual(findWorkflowTaskTypeCollisions(settings.workflows!), [{ taskTypeId: 'حملة رمضان', workflowIds: ['flow', 'second'] }]);
  assert.equal(getTaskTypeConfigs(settings)[0].workflowId, settings.taskTypeWorkflowIds?.['حملة رمضان']);
  assert.equal(resolveWorkflowAssignment(settings, 'حملة رمضان').ok, false);
  assert.equal(resolveWorkflowAssignment(mergeAppSettings({ workflows: [first] }), 'حملة رمضان').ok, true);
});

test('new assignments reject stale/forged templates and entry phases while existing snapshots survive template edits/deletion', () => {
  const workflow = flow([step('A'), final()]);
  const original = task(workflow);
  const settings = mergeAppSettings({ workflows: [workflow] });
  assert.doesNotThrow(() => validateTaskWorkflowAssignment(original, undefined, settings));
  assert.throws(() => validateTaskWorkflowAssignment({ ...original, workflowActivePhaseIds: ['AD'] }, undefined, settings), /initial/);
  const changed = { ...workflow, phases: [step('A', { delayDays: 2 }), final()] };
  const next = mergeAppSettings({ workflows: [changed] });
  assert.throws(() => validateTaskWorkflowAssignment(original, undefined, next), /changed/);
  const ordinaryEdit = { ...original, name: 'Edited title' };
  assert.doesNotThrow(() => validateTaskWorkflowAssignment(ordinaryEdit, original, next));
  assert.doesNotThrow(() => validateTaskWorkflowAssignment(ordinaryEdit, original, mergeAppSettings({ workflows: [] })));
  assert.deepEqual(ordinaryEdit.workflowSnapshot, original.workflowSnapshot);
  assert.throws(() => validateTaskWorkflowAssignment({ ...original, workflowSnapshot: { ...workflow, phases: [final()] } }, original, settings), /changed/);
  assert.throws(() => validateTaskWorkflowAssignment({ ...original, workflowSnapshot: cloneWorkflow(changed) }, original, next, member), /workflow manager/);
  assert.doesNotThrow(() => validateTaskWorkflowAssignment({ ...original, workflowSnapshot: cloneWorkflow(changed) }, original, next, { ...member, role: 'team_leader' }));
});

test('creation materializes only truly unconfigured work from explicit contributors and never overrides empty choices', () => {
  const workflow = flow([step('Work', { userIds: [] }), final()]);
  const original = task(workflow);
  const settings = mergeAppSettings({ workflows: [workflow] });
  const prepared = prepareWorkflowAssignmentOwners(workflow, original, settings, [member, ad], [member.id]);
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.workflowNodeAssigneeIds, { Work: [member.id], AD: [ad.id] });
  assert.equal(original.workflowNodeAssigneeIds, undefined);
  assert.equal(prepareWorkflowAssignmentOwners(workflow, { ...original, workflowNodeAssigneeIds: { Work: [] } }, settings, [member, ad], [member.id]).ok, false);
  assert.equal(prepareWorkflowAssignmentOwners(workflow, original, settings, [member, ad]).ok, false, 'server validation never invents owner overrides');
  assert.doesNotThrow(() => validateTaskWorkflowAssignment({ ...original, workflowNodeAssigneeIds: prepared.workflowNodeAssigneeIds }, undefined, settings, member, [member, ad]));
  assert.throws(() => validateTaskWorkflowAssignment(original, undefined, settings, member, [member, ad]), /accountable member/);
});

test('future conditional, delayed and AI work require real owners and achievable finite approval counts', () => {
  const future = step('Future', { userIds: [], responsibilityIds: ['unknown-provider'], delayDays: 5, skipRule: 'if_no_files_in_previous_version' });
  const workflow = flow([step('A'), future, final()]);
  const settings = mergeAppSettings({ workflows: [workflow] });
  const initial = task(workflow);
  assert.match(prepareWorkflowAssignmentOwners(workflow, initial, settings, [member, ad], [member.id]).message || '', /Future/);
  assert.equal(prepareWorkflowAssignmentOwners(workflow, { ...initial, workflowSkippedPhaseIds: ['Future'] }, settings, [member, ad]).ok, true);
  assert.equal(prepareWorkflowAssignmentOwners(workflow, { ...initial, workflowNodeAssigneeIds: { Future: ['voice_over_ai'] } }, settings, [member, ad]).ok, false);
  assert.equal(prepareWorkflowAssignmentOwners(workflow, { ...initial, workflowNodeAssigneeIds: { Future: ['voice_over_ai'] }, workflowNodeAIAssigneeIds: { Future: member.id } }, settings, [member, ad]).ok, true);
  for (const requiredApprovals of [0, -1, 1.5, Infinity, NaN, 2]) {
    const invalid = flow([step('A', { requiredApprovals, userIds: [member.id, member.id] }), final()]);
    assert.match(prepareWorkflowAssignmentOwners(invalid, task(invalid), settings, [member, ad]).message || '', /approval count/);
  }
  const wrongFinal = flow([step('A'), final({ userIds: [member.id], roleIds: [] })]);
  assert.deepEqual(prepareWorkflowAssignmentOwners(wrongFinal, task(wrongFinal), settings, [member, ad]).workflowNodeAssigneeIds?.AD, [ad.id], 'final assignment automatically selects the actual AD rather than an ordinary member');
});
