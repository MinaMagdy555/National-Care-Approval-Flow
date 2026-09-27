import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppSettings, Task, User, WorkflowDefinition, WorkflowPhaseDefinition } from '../src/lib/types';
import { prepareWorkflowAssignmentOwners } from '../src/lib/workflowAssignment';
import { resolveWorkflowPhaseOwnerIds } from '../src/lib/workflowUtils';
import { resolveFixedArtDirector, resolveFrozenFinalApproverId } from '../src/lib/finalApprovalPolicy';
import { mergeAuthorizedTasks } from '../server/taskAccess';
import { validateTaskWorkflowAssignment } from '../server/workflowAssignment';
import { validateWorkflowTransition } from '../server/workflowTransitions';

const carol: User = { id: 'u_carol', name: 'Carol', role: 'art_director', jobTitle: 'Art Director' };
const dave: User = { id: 'u_dave', name: 'Dave', role: 'art_director', jobTitle: 'Art Director' };
const alice: User = { id: 'u_alice', name: 'Alice', role: 'team_member', jobTitle: 'Graphic Designer' };
const leader: User = { id: 'u_leader', name: 'Leader', role: 'team_leader' };
const users = [alice, carol, dave, leader];

const baseSettings: AppSettings = {
  responsibilities: [],
  priorities: [],
  businessCalendar: { timezone: 'Africa/Cairo', workdays: [], startTime: '09:00', endTime: '17:00' },
  settingsManagerUserIds: [],
  settingsManagerResponsibilityIds: [],
  workAssignmentCreatorIds: [],
  contributorAssignerIds: [],
  neverHandlerIds: [],
  selfAssignmentBlockedIds: [],
  videoOnlyHandlerIds: [],
  alwaysAssignableHandlerIds: [],
  flowLabels: {},
  finalReviewerUserIds: [carol.id],
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const finalPhase = (id = 'final', roleIds: WorkflowPhaseDefinition['roleIds'] = ['art_director']): WorkflowPhaseDefinition => ({
  id,
  name: 'Final Rev.',
  phaseKind: 'final_review',
  reviewStyle: 'final_review',
  mode: 'sequential',
  userIds: [],
  roleIds,
  responsibilityIds: [],
  skipRule: 'none',
  parentPhaseId: null,
  parentPhaseIds: ['work'],
});

const workPhase: WorkflowPhaseDefinition = {
  id: 'work',
  name: 'Work',
  phaseKind: 'work',
  reviewStyle: 'first_review',
  mode: 'sequential',
  userIds: [alice.id],
  roleIds: [],
  responsibilityIds: [],
  skipRule: 'none',
  parentPhaseId: null,
  parentPhaseIds: ['workflow-root'],
};

const workflow = (id = 'flow', final = finalPhase()): WorkflowDefinition => ({
  id,
  name: id,
  active: true,
  phases: [workPhase, final],
});

const taskBase = (flow: WorkflowDefinition, extra: Partial<Task> = {}): Task => ({
  id: 'task-1',
  code: 'TSK-15',
  name: 'Frozen final approver',
  taskType: 'design',
  reviewMode: 'final_review',
  environment: 'production',
  createdBy: leader.id,
  handledBy: [alice.id],
  status: 'waiting_art_director_approval',
  currentOwnerRole: 'art_director',
  currentOwnerUserId: carol.id,
  currentOwnerUserIds: [carol.id],
  priority: 'normal',
  deadlineText: null,
  versions: [],
  comments: [],
  thumbnailUrl: '',
  workflowId: flow.id,
  workflowSnapshot: flow,
  workflowActivePhaseIds: ['final'],
  workflowCurrentPhaseId: 'final',
  workflowPhaseApprovals: {},
  workflowPhaseHistory: [{ phaseId: 'final', phaseName: 'Final Rev.', action: 'started', actorId: alice.id, createdAt: '2026-01-01T00:00:00.000Z' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

test('a task frozen at creation keeps its original Art Director even after global settings add a new default AD', () => {
  const flow = workflow();
  const prepared = prepareWorkflowAssignmentOwners(flow, taskBase(flow), baseSettings, users, [alice.id]);
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.workflowNodeAssigneeIds?.['final'], [carol.id]);
  assert.equal(prepared.workflowFinalApproverIdsByPhaseId?.['final'], carol.id, 'creation must freeze the actual AD');

  const taskWithFrozen: Task = taskBase(flow, {
    workflowNodeAssigneeIds: prepared.workflowNodeAssigneeIds,
    workflowFinalApproverIdsByPhaseId: prepared.workflowFinalApproverIdsByPhaseId,
  });
  const expandedSettings: AppSettings = { ...baseSettings, finalReviewerUserIds: [dave.id] };
  const owners = resolveWorkflowPhaseOwnerIds(flow.phases[1], taskWithFrozen, expandedSettings, users);
  assert.deepEqual(owners, [carol.id], 'runtime must honor the frozen task owner, never the new global default');
});

test('a brand-new assignment uses the current default actual Art Director', () => {
  const expandedSettings: AppSettings = { ...baseSettings, finalReviewerUserIds: [dave.id] };
  const prepared = prepareWorkflowAssignmentOwners(workflow(), taskBase(workflow()), expandedSettings, users, [alice.id]);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.workflowFinalApproverIdsByPhaseId?.['final'], dave.id, 'a new task freezes whoever the current global default resolves to');
  assert.deepEqual(prepared.workflowNodeAssigneeIds?.['final'], [dave.id]);
});

test('an ordinary edit preserves the frozen final approver and never rebinds it from global settings', () => {
  const flow = workflow();
  const prepared = prepareWorkflowAssignmentOwners(flow, taskBase(flow), baseSettings, users, [alice.id]);
  const before: Task = taskBase(flow, {
    workflowNodeAssigneeIds: prepared.workflowNodeAssigneeIds,
    workflowFinalApproverIdsByPhaseId: prepared.workflowFinalApproverIdsByPhaseId,
  });
  const flipped: AppSettings = { ...baseSettings, finalReviewerUserIds: [dave.id] };
  // Simulate an ordinary edit by storing again through the same workflow; owner stays bound to carol.
  const rePrepared = prepareWorkflowAssignmentOwners(flow, before, flipped, users, [alice.id], before);
  assert.equal(rePrepared.workflowFinalApproverIdsByPhaseId?.['final'], carol.id, 're-preparing with changed settings must not rebind the frozen owner');
});

test('legacy migration reads a previously valid Art Director from workflowNodeAssigneeIds when no frozen map exists', () => {
  const flow = workflow();
  const legacy: Task = taskBase(flow, {
    workflowNodeAssigneeIds: { final: [carol.id] },
    workflowFinalApproverIdsByPhaseId: undefined,
  });
  assert.equal(resolveFrozenFinalApproverId(flow.phases[1], legacy, baseSettings, users), carol.id);
  const owners = resolveWorkflowPhaseOwnerIds(flow.phases[1], legacy, baseSettings, users);
  assert.deepEqual(owners, [carol.id]);
});

test('incoming arbitrary overrides cannot claim authority over the frozen task owner', () => {
  const flow = workflow();
  const prepared = prepareWorkflowAssignmentOwners(flow, taskBase(flow), baseSettings, users, [alice.id]);
  const prior: Task = taskBase(flow, {
    workflowNodeAssigneeIds: prepared.workflowNodeAssigneeIds,
    workflowFinalApproverIdsByPhaseId: prepared.workflowFinalApproverIdsByPhaseId,
  });
  const incoming: Task = {
    ...prior,
    workflowFinalApproverIdsByPhaseId: { ...prior.workflowFinalApproverIdsByPhaseId, final: dave.id },
    workflowNodeAssigneeIds: { ...prior.workflowNodeAssigneeIds, final: [dave.id] },
  };
  assert.throws(
    () => mergeAuthorizedTasks([prior], [incoming], leader, baseSettings, users),
    /Final Rev\.|frozen|Art Director/i,
    'arbitrary incoming rebinding of the frozen final approver must be rejected by the server',
  );
});

test('a genuine workflow replacement regenerates the frozen final approver from the current default', () => {
  const original = workflow('flow', finalPhase('final', ['art_director']));
  const prepared = prepareWorkflowAssignmentOwners(original, taskBase(original), baseSettings, users, [alice.id]);
  const prior: Task = taskBase(original, {
    workflowNodeAssigneeIds: prepared.workflowNodeAssigneeIds,
    workflowFinalApproverIdsByPhaseId: prepared.workflowFinalApproverIdsByPhaseId,
  });
  const replacement = workflow('flow-2', finalPhase('final', ['art_director']));
  const flipped: AppSettings = { ...baseSettings, finalReviewerUserIds: [dave.id] };
  const rePrepared = prepareWorkflowAssignmentOwners(replacement, prior, flipped, users, [alice.id]);
  assert.equal(rePrepared.workflowFinalApproverIdsByPhaseId?.['final'], dave.id, 'replacement with new settings freezes whoever the current default is');
});

test('server validation rejects an ordinary edit that flips the frozen final approver even when the workflow graph is unchanged', () => {
  const flow = workflow();
  const prepared = prepareWorkflowAssignmentOwners(flow, taskBase(flow), baseSettings, users, [alice.id]);
  const prior: Task = taskBase(flow, {
    workflowNodeAssigneeIds: prepared.workflowNodeAssigneeIds,
    workflowFinalApproverIdsByPhaseId: prepared.workflowFinalApproverIdsByPhaseId,
  });
  const tampered: Task = {
    ...prior,
    workflowFinalApproverIdsByPhaseId: { ...prior.workflowFinalApproverIdsByPhaseId, final: dave.id },
    workflowNodeAssigneeIds: { ...prior.workflowNodeAssigneeIds, final: [dave.id] },
  };
  assert.throws(
    () => validateWorkflowTransition(prior, tampered, leader, baseSettings, users),
    /Final Rev\.|frozen|Art Director/i,
    'reassigning the frozen final approver during an ordinary edit must fail transition validation',
  );
  assert.throws(
    () => validateTaskWorkflowAssignment(tampered, prior, baseSettings, leader, users),
    /Final Rev\.|frozen|Art Director/i,
    'reassigning the frozen final approver must fail even when the workflow graph is unchanged',
  );
});

test('legacy migration only accepts a single actual Art Director, never an arbitrary override', () => {
  const flow = workflow();
  const arbitrary: Task = taskBase(flow, {
    workflowNodeAssigneeIds: { final: [alice.id, dave.id] },
    workflowFinalApproverIdsByPhaseId: undefined,
  });
  assert.equal(resolveFrozenFinalApproverId(flow.phases[1], arbitrary, baseSettings, users), null);
  const empty: Task = taskBase(flow, {
    workflowNodeAssigneeIds: { final: [] },
    workflowFinalApproverIdsByPhaseId: undefined,
  });
  assert.equal(resolveFrozenFinalApproverId(flow.phases[1], empty, baseSettings, users), null);
});

test('resolveFixedArtDirector remains authoritative for templates that have not yet been frozen onto a task', () => {
  const fixed = resolveFixedArtDirector(workflow().phases[1], baseSettings, users);
  assert.equal(fixed.ownerId, carol.id);
  const shifted: AppSettings = { ...baseSettings, finalReviewerUserIds: [dave.id] };
  assert.equal(resolveFixedArtDirector(workflow().phases[1], shifted, users).ownerId, dave.id);
});
