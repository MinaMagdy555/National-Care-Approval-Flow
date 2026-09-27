import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AppSettings,
  Task,
  User,
  WorkflowDefinition,
  WorkflowPhaseDefinition,
  WorkflowPhaseHistoryEntry,
} from '../src/lib/types';
import {
  appendStartedEntries,
  computePhaseHandoffs,
  computeWorkflowAdvance,
  computeWorkflowInitialization,
  computeWorkflowReturn,
  computeWorkflowSkip,
  getCompletedPhaseIdsFromHistory,
  splitHandoffsByDelay,
  getInitialActivePhaseIds,
  getPhaseAssignableOwnerIds,
  resolveWorkflowPhaseOwnerIds,
  workflowHasExplicitEdges,
} from '../src/lib/workflowRuntime';

import { canSkipWorkflowPhase, canUserActAsCurrentOwner, cloneWorkflow, getActiveWorkflowPhaseForUser, getNextPhaseIndex, getStatusForWorkflowPhase, isPhaseAvailable } from '../src/lib/workflowUtils';
import { applyContentReviewChoice, isContentReviewPhase, normalizeReviewMode, normalizeReviewPhase } from '../src/lib/reviewPolicy';
import { defaultAppSettings, mergeAppSettings } from '../src/lib/appSettings';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const alice: User = { id: 'u_alice', name: 'Alice', role: 'team_member', jobTitle: 'Graphic Designer' };
const bob: User = { id: 'u_bob', name: 'Bob', role: 'reviewer', jobTitle: 'Senior Reviewer' };
const carol: User = { id: 'u_carol', name: 'Carol', role: 'art_director', jobTitle: 'Art Director' };
const dave: User = { id: 'u_dave', name: 'Dave', role: 'team_leader', jobTitle: 'Team Leader' };
const users = [alice, bob, carol, dave];

test('legacy quick/full routes converge and canonical abbreviated stage names migrate without changing custom work', () => {
  assert.equal(normalizeReviewMode('quick_look'), 'first_review');
  assert.equal(normalizeReviewMode('full_review'), 'first_review');
  assert.equal(normalizeReviewMode('direct_to_ad'), 'final_review');
  for (const [name, kind, status] of [
    ['Content Rev.', 'content_review', 'waiting_content_revision'],
    ['First Rev.', 'first_review', 'waiting_reviewer_full_review'],
    ['Final Rev.', 'final_review', 'sent_to_art_director'],
  ] as const) {
    const legacy = mkPhase(`custom-${kind}`, { name, userIds: [bob.id] });
    assert.equal(normalizeReviewPhase(legacy).phaseKind, kind);
    assert.equal(getStatusForWorkflowPhase(legacy), status);
    assert.equal(normalizeReviewPhase({ ...legacy, phaseKind: 'work' }).phaseKind, 'work');
    assert.equal(getStatusForWorkflowPhase({ ...legacy, phaseKind: 'work' }), 'assigned_work');
  }
  assert.equal(getStatusForWorkflowPhase(null), 'assigned_work', 'a missing phase is never AD approval');
});

test('settings normalization is stable and campaign-specific IDs never overwrite custom work or its graph', () => {
  const phase = mkPhase('content_team_review', { name: 'Prepare assets', phaseKind: 'work', roleIds: ['reviewer'], parentPhaseIds: ['custom-root'] });
  const workflow = mkWorkflow('custom-workflow', [phase]);
  const original = structuredClone(workflow);
  const merged = mergeAppSettings({ ...defaultAppSettings, workflows: [workflow] });
  const normalized = merged.workflows!.find(item => item.id === workflow.id)!;
  assert.equal(normalized.phases[0].phaseKind, 'work');
  assert.equal(isContentReviewPhase(normalized.phases[0]), false);
  assert.deepEqual(normalized.phases[0].parentPhaseIds, ['custom-root']);
  assert.deepEqual(workflow, original, 'normalization must not mutate a saved snapshot object');
  assert.deepEqual(mergeAppSettings(merged).workflows, merged.workflows, 'reload normalization is idempotent');
});

test('per-task Content Rev choice traverses graph joins and can never omit Final Rev', () => {
  const content = mkPhase('optional-content', { phaseKind: 'content_review', parentPhaseIds: ['workflow-root'], userIds: [alice.id] });
  const first = mkPhase('first', { phaseKind: 'first_review', parentPhaseIds: ['optional-content'], userIds: [bob.id] });
  const final = mkPhase('final', { phaseKind: 'final_review', roleIds: ['art_director'], userIds: [carol.id], parentPhaseIds: ['first'], skipRule: 'manual', disabled: true });
  const workflow = mkWorkflow('content-choice', [content, first, final]);
  const original = structuredClone(workflow);
  assert.equal(canSkipWorkflowPhase(content), true);
  assert.equal(canSkipWorkflowPhase(final), false);
  const omitted = mkTask(workflow, [], { needsContentRevision: false, workflowSkippedPhaseIds: applyContentReviewChoice(workflow, ['final'], false) });
  const initialized = computeWorkflowInitialization(workflow, omitted, alice.id);
  assert.deepEqual(initialized.nextActivePhaseIds, ['first']);
  assert.deepEqual(initialized.history.map(entry => [entry.phaseId, entry.action]), [['optional-content', 'skipped']]);
  const advance = computeWorkflowAdvance(workflow, { ...omitted, workflowActivePhaseIds: ['first'], workflowPhaseHistory: initialized.history }, bob.id, 'first', settings, users)!;
  assert.deepEqual(advance.nextActivePhaseIds, ['final']);
  assert.equal(advance.finished, false);
  const approved = computeWorkflowAdvance(workflow, { ...omitted, workflowActivePhaseIds: ['final'], workflowPhaseHistory: advance.history }, carol.id, 'final', settings, users)!;
  assert.equal(approved.finished, true);
  assert.deepEqual(workflow, original);
  assert.equal(getNextPhaseIndex(workflow, -1, omitted), 1, 'legacy sequential helper shares the same choice');
});

test('legacy content booleans never change saved routes; only explicit form choices reconcile skip IDs', () => {
  const content = mkPhase('content', { phaseKind: 'content_review', userIds: [alice.id] });
  const final = mkPhase('final', { phaseKind: 'final_review', roleIds: ['art_director'], userIds: [carol.id] });
  const workflow = mkWorkflow('legacy-choice', [content, final]);
  const legacy = mkTask(workflow, []);
  assert.deepEqual(computeWorkflowInitialization(workflow, legacy).nextActivePhaseIds, ['content']);
  assert.deepEqual(computeWorkflowInitialization(workflow, { ...legacy, workflowSkippedPhaseIds: ['content'] }).nextActivePhaseIds, ['final']);
  assert.deepEqual(computeWorkflowInitialization(workflow, { ...legacy, needsContentRevision: true, workflowSkippedPhaseIds: ['content'] }).nextActivePhaseIds, ['final']);
  assert.deepEqual(computeWorkflowInitialization(workflow, { ...legacy, needsContentRevision: false }).nextActivePhaseIds, ['content']);
  assert.deepEqual(computeWorkflowInitialization(workflow, { ...legacy, workflowSkippedPhaseIds: applyContentReviewChoice(workflow, ['content'], true) }).nextActivePhaseIds, ['content']);
  assert.deepEqual(computeWorkflowInitialization(workflow, { ...legacy, workflowSkippedPhaseIds: applyContentReviewChoice(workflow, [], false) }).nextActivePhaseIds, ['final']);
  const disabled = { ...workflow, phases: [{ ...content, disabled: true }, final] };
  assert.deepEqual(computeWorkflowInitialization(disabled, { ...legacy, needsContentRevision: true }).nextActivePhaseIds, ['final']);
});

test('a removed final approval cannot turn the last work upload or manual omission into final approval', () => {
  const work = mkPhase('work', { phaseKind: 'work', userIds: [alice.id], skipRule: 'manual' });
  const workflow = mkWorkflow('missing-final', [work]);
  const task = mkTask(workflow, ['work'], { status: 'assigned_work' });
  const advance = computeWorkflowAdvance(workflow, task, alice.id, 'work', settings, users)!;
  assert.equal(advance.finished, false);
  assert.match(advance.blockedReason || '', /Art Director/);
  const skipped = computeWorkflowSkip(workflow, task, dave.id, 'work')!;
  assert.equal(skipped.finished, false);
  assert.match(skipped.blockedReason || '', /Final Rev/);
});

const settings: AppSettings = {
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
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function mkPhase(id: string, overrides: Partial<WorkflowPhaseDefinition> = {}): WorkflowPhaseDefinition {
  return {
    id,
    name: overrides.name || id,
    reviewStyle: 'quick_look',
    mode: 'sequential',
    userIds: [],
    roleIds: [],
    responsibilityIds: [],
    skipRule: 'none',
    parentPhaseId: null,
    parentPhaseIds: [],
    ...overrides,
  };
}

function mkWorkflow(id: string, phases: WorkflowPhaseDefinition[]): WorkflowDefinition {
  return { id, name: id, active: true, phases };
}

let historySequence = 0;
function historyEntry(phaseId: string, action: WorkflowPhaseHistoryEntry['action'], actorId = 'u_setup'): WorkflowPhaseHistoryEntry {
  historySequence += 1;
  return {
    phaseId,
    phaseName: phaseId,
    action,
    actorId,
    createdAt: new Date(Date.UTC(2026, 1, 1, 0, 0, historySequence)).toISOString(),
  };
}

function mkTask(workflow: WorkflowDefinition, activeIds: string[], overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    code: 'TSK-2026-0001',
    name: 'Demo Task',
    taskType: 'campaign',
    reviewMode: 'first_review',
    environment: 'production',
    createdBy: 'u_alice',
    handledBy: ['u_alice'],
    status: 'waiting_reviewer_full_review',
    currentOwnerRole: null,
    currentOwnerUserId: null,
    currentOwnerUserIds: [],
    priority: 'normal',
    deadlineText: null,
    versions: [],
    comments: [],
    thumbnailUrl: '',
    workflowId: workflow.id,
    workflowSnapshot: workflow,
    workflowActivePhaseIds: activeIds,
    workflowCurrentPhaseId: activeIds[0] || null,
    workflowCurrentPhaseIndex: 0,
    workflowPhaseApprovals: {},
    workflowPhaseHistory: activeIds.map(id => historyEntry(id, 'started')),
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Linear A -> B: only the new step owner receives the handoff
// ---------------------------------------------------------------------------

test('linear A->B: completes step, activates next step, handoff only to the new owner with that phase name', () => {
  const design = mkPhase('design', { name: 'Design Work', userIds: [bob.id] });
  const review = mkPhase('review', { name: 'Senior Review', userIds: [carol.id], parentPhaseId: 'design', parentPhaseIds: ['design'] });
  const workflow = mkWorkflow('wf_linear', [design, review]);
  const task = mkTask(workflow, ['design']);

  const advance = computeWorkflowAdvance(workflow, task, bob.id, 'design', settings, users);
  assert.ok(advance, 'advance should be allowed for the active step owner');
  assert.equal(advance.finished, false);
  assert.deepEqual(advance.nextActivePhaseIds, ['review']);
  assert.deepEqual(advance.approvals.design, [bob.id]);

  const progressedTask: Task = {
    ...task,
    workflowActivePhaseIds: advance.nextActivePhaseIds,
    workflowPhaseApprovals: advance.approvals,
    workflowPhaseHistory: advance.history,
  };
  const handoffs = computePhaseHandoffs(workflow, progressedTask, advance.nextActivePhaseIds, settings, users);
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].phaseName, 'Senior Review');
  assert.deepEqual(handoffs[0].ownerIds, [carol.id]);
  assert.ok(!handoffs[0].ownerIds.includes(bob.id), 'previous owner must not receive the new step handoff');
  assert.ok(!handoffs[0].ownerIds.includes(alice.id), 'future contributor must not be notified early');
});

// ---------------------------------------------------------------------------
// 2. A -> A: same owner of consecutive steps still receives the new handoff
// ---------------------------------------------------------------------------

test('A->A: the same person owning consecutive steps still gets a new handoff notification for the new step', () => {
  const first = mkPhase('shoot', { name: 'Shooting', userIds: [alice.id] });
  const second = mkPhase('edit', { name: 'Editing', userIds: [alice.id], parentPhaseId: 'shoot', parentPhaseIds: ['shoot'] });
  const workflow = mkWorkflow('wf_same_owner', [first, second]);
  const task = mkTask(workflow, ['shoot']);

  const advance = computeWorkflowAdvance(workflow, task, alice.id, 'shoot', settings, users);
  assert.ok(advance);
  assert.deepEqual(advance.nextActivePhaseIds, ['edit']);

  const progressedTask: Task = { ...task, workflowActivePhaseIds: advance.nextActivePhaseIds, workflowPhaseHistory: advance.history };
  const handoffs = computePhaseHandoffs(workflow, progressedTask, advance.nextActivePhaseIds, settings, users);
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].phaseName, 'Editing');
  assert.deepEqual(handoffs[0].ownerIds, [alice.id], 'same person must still be notified for their new step');
});

// ---------------------------------------------------------------------------
// 3. Explicit graph edges override array order; legacy array fallback bounded
// ---------------------------------------------------------------------------

test('explicit graph edges win over array order; a skipped-order node is not executed', () => {
  const first = mkPhase('first', { userIds: [alice.id] });
  const arrayNextDisconnected = mkPhase('array_next_but_unlinked', { userIds: [bob.id] });
  const graphTarget = mkPhase('graph_target', { userIds: [carol.id], parentPhaseId: 'first', parentPhaseIds: ['first'] });
  const workflow = mkWorkflow('wf_edges_win', [first, arrayNextDisconnected, graphTarget]);
  assert.equal(workflowHasExplicitEdges(workflow), true);

  const task = mkTask(workflow, ['first']);
  const advance = computeWorkflowAdvance(workflow, task, alice.id, 'first', settings, users);
  assert.ok(advance);
  assert.deepEqual(advance.nextActivePhaseIds, ['graph_target'], 'routing must follow the explicit edge, not array order');
});

test('legacy workflow with no graph connections keeps the bounded array-order fallback', () => {
  const first = mkPhase('content_review', { userIds: [alice.id] });
  const second = mkPhase('senior_review', { userIds: [bob.id] });
  const third = mkPhase('art_director_final', { userIds: [carol.id] });
  const workflow = mkWorkflow('wf_legacy', [first, second, third]);
  assert.equal(workflowHasExplicitEdges(workflow), false);

  const task = mkTask(workflow, ['content_review']);
  const advance = computeWorkflowAdvance(workflow, task, alice.id, 'content_review', settings, users);
  assert.ok(advance);
  assert.deepEqual(advance.nextActivePhaseIds, ['senior_review'], 'without graph connections the old array order still applies');
});

// ---------------------------------------------------------------------------
// 4. Parallel fork/join waits for all required parents; no premature finish
// ---------------------------------------------------------------------------

test('parallel fork activates branches; join waits for all parents; workflow finishes only after the join', () => {
  const brief = mkPhase('brief', { userIds: [alice.id] });
  const video = mkPhase('video', { name: 'Video Work', userIds: [alice.id], parentPhaseIds: ['brief'], mode: 'parallel' });
  const design = mkPhase('design', { name: 'Design Work', userIds: [bob.id], parentPhaseIds: ['brief'], mode: 'parallel' });
  const join = mkPhase('join_review', { name: 'Combined Review', userIds: [carol.id], parentPhaseIds: ['video', 'design'] });
  const done = mkPhase('ready', { phaseKind: 'final_review', reviewStyle: 'final_review', roleIds: ['art_director'], userIds: [carol.id], parentPhaseIds: ['join_review'] });
  const workflow = mkWorkflow('wf_parallel', [brief, video, design, join, done]);

  const task = mkTask(workflow, ['brief']);
  const forkAdvance = computeWorkflowAdvance(workflow, task, alice.id, 'brief', settings, users);
  assert.ok(forkAdvance);
  assert.deepEqual(new Set(forkAdvance.nextActivePhaseIds), new Set(['video', 'design']), 'both branches must start');

  const afterFork: Task = {
    ...task,
    workflowActivePhaseIds: forkAdvance.nextActivePhaseIds,
    workflowPhaseHistory: forkAdvance.history,
    workflowPhaseApprovals: forkAdvance.approvals,
  };
  const forkHandoffs = computePhaseHandoffs(workflow, afterFork, forkAdvance.nextActivePhaseIds, settings, users);
  assert.equal(forkHandoffs.length, 2, 'each simultaneous phase notifies with its own name');
  assert.deepEqual(forkHandoffs.map(group => group.phaseName), ['Video Work', 'Design Work']);
  assert.deepEqual(forkHandoffs[0].ownerIds, [alice.id]);
  assert.deepEqual(forkHandoffs[1].ownerIds, [bob.id]);

  const videoDone = computeWorkflowAdvance(workflow, afterFork, alice.id, 'video', settings, users);
  assert.ok(videoDone);
  assert.equal(videoDone.finished, false);
  assert.deepEqual(videoDone.nextActivePhaseIds, ['design'], 'completing one branch must not finish while the join is pending');
  assert.ok(!videoDone.nextActivePhaseIds.includes('join_review'), 'join must wait for all parents');

  const afterVideo: Task = { ...afterFork, workflowActivePhaseIds: videoDone.nextActivePhaseIds, workflowPhaseHistory: videoDone.history, workflowPhaseApprovals: videoDone.approvals };
  const designDone = computeWorkflowAdvance(workflow, afterVideo, bob.id, 'design', settings, users);
  assert.ok(designDone);
  assert.deepEqual(designDone.nextActivePhaseIds, ['join_review'], 'join activates only after both parents complete');

  const afterJoin: Task = { ...afterVideo, workflowActivePhaseIds: designDone.nextActivePhaseIds, workflowPhaseHistory: designDone.history, workflowPhaseApprovals: designDone.approvals };
  const joinDone = computeWorkflowAdvance(workflow, afterJoin, carol.id, 'join_review', settings, users);
  assert.ok(joinDone);
  assert.deepEqual(joinDone.nextActivePhaseIds, ['ready']);

  const afterReady: Task = { ...afterJoin, workflowActivePhaseIds: joinDone.nextActivePhaseIds, workflowPhaseHistory: joinDone.history, workflowPhaseApprovals: joinDone.approvals };
  const finalAdvance = computeWorkflowAdvance(workflow, afterReady, carol.id, 'ready', settings, users);
  assert.ok(finalAdvance);
  assert.equal(finalAdvance.finished, true, 'workflow may only finish after the join and final step complete');
  assert.deepEqual(finalAdvance.nextActivePhaseIds, []);
});

// ---------------------------------------------------------------------------
// 5. A disconnected node is never executed
// ---------------------------------------------------------------------------

test('disconnected node with no graph parents never activates, even at the end of the workflow', () => {
  const first = mkPhase('start', { userIds: [alice.id] });
  const end = mkPhase('end', { userIds: [bob.id], parentPhaseIds: ['start'] });
  const orphan = mkPhase('orphan', { userIds: [carol.id] });
  const workflow = mkWorkflow('wf_disconnected', [first, end, orphan]);

  assert.deepEqual(getInitialActivePhaseIds(workflow, mkTask(workflow, [])), ['start'], 'initialization must only start root-connected phases');

  const task = mkTask(workflow, ['start']);
  const firstAdvance = computeWorkflowAdvance(workflow, task, alice.id, 'start', settings, users);
  assert.deepEqual(firstAdvance?.nextActivePhaseIds, ['end']);

  const afterFirst: Task = { ...task, workflowActivePhaseIds: ['end'], workflowPhaseHistory: firstAdvance!.history, workflowPhaseApprovals: firstAdvance!.approvals };
  const finalAdvance = computeWorkflowAdvance(workflow, afterFirst, bob.id, 'end', settings, users);
  assert.ok(finalAdvance);
  assert.equal(finalAdvance.finished, false, 'a legacy route without Final Rev. must remain open for repair');
  assert.match(finalAdvance.blockedReason || '', /Final Rev/);
  assert.deepEqual(finalAdvance.nextActivePhaseIds, []);
  assert.ok(!finalAdvance.nextActivePhaseIds.includes('orphan'), 'the disconnected node must never execute');
  assert.ok(!finalAdvance.history.some(entry => entry.phaseId === 'orphan'), 'no history may be recorded for the orphan node');
});

// ---------------------------------------------------------------------------
// 6. Consecutive skip-eligible nodes recurse until an actionable step
// ---------------------------------------------------------------------------

test('consecutive skipped nodes recurse: skip chain advances to the first actionable step', () => {
  const work = mkPhase('work', { userIds: [alice.id] });
  const skipOne = mkPhase('skip_one', { parentPhaseIds: ['work'], skipRule: 'if_no_task_links' });
  const skipTwo = mkPhase('skip_two', { parentPhaseIds: ['skip_one'], skipRule: 'if_no_task_links' });
  const finalStep = mkPhase('final_step', { userIds: [bob.id], parentPhaseIds: ['skip_two'] });
  const workflow = mkWorkflow('wf_skips', [work, skipOne, skipTwo, finalStep]);
  const task = mkTask(workflow, ['work'], { assignmentLinks: [] });

  const advance = computeWorkflowAdvance(workflow, task, alice.id, 'work', settings, users);
  assert.ok(advance);
  assert.deepEqual(advance.nextActivePhaseIds, ['final_step'], 'every consecutive skipped node must be passed through');
  assert.ok(advance.history.some(entry => entry.phaseId === 'skip_one' && entry.action === 'skipped'), 'first skip recorded');
  assert.ok(advance.history.some(entry => entry.phaseId === 'skip_two' && entry.action === 'skipped'), 'second skip recorded');
});

// ---------------------------------------------------------------------------
// 7. Return / resubmit loop can revisit a step and its downstream path
// ---------------------------------------------------------------------------

test('return loop: a returned step and its downstream can be re-approved without stale completion blocking it', () => {
  const content = mkPhase('content', { name: 'Content Work', userIds: [alice.id] });
  const review = mkPhase('review', { name: 'Review', userIds: [bob.id], parentPhaseIds: ['content'], failToPhaseId: 'content' });
  const approval = mkPhase('approval', { name: 'Approval', userIds: [carol.id], parentPhaseIds: ['review'] });
  const workflow = mkWorkflow('wf_loop', [content, review, approval]);

  const task = mkTask(workflow, ['content']);
  const firstPass = computeWorkflowAdvance(workflow, task, alice.id, 'content', settings, users);
  assert.deepEqual(firstPass?.nextActivePhaseIds, ['review']);

  const returnResult = computeWorkflowReturn(workflow, {
    ...task, workflowActivePhaseIds: ['review'], workflowPhaseHistory: firstPass!.history,
    workflowPhaseApprovals: firstPass!.approvals,
  }, bob.id, 'review', 'content', settings, users);
  assert.ok(returnResult);
  assert.equal(returnResult.history.filter(entry => entry.phaseId === 'content' && entry.action === 'started').length, 2);
  const returnedTask: Task = {
    ...task,
    workflowActivePhaseIds: returnResult.nextActivePhaseIds,
    workflowCurrentPhaseId: returnResult.targetPhaseId,
    workflowPhaseHistory: returnResult.history,
    workflowPhaseApprovals: returnResult.approvals,
  };
  const secondPass = computeWorkflowAdvance(workflow, returnedTask, alice.id, 'content', settings, users);
  assert.ok(secondPass);
  assert.deepEqual(secondPass.nextActivePhaseIds, ['review'], 'stale completion of the review step must not block the revisit');

  const secondReview: Task = { ...returnedTask, workflowActivePhaseIds: secondPass!.nextActivePhaseIds, workflowPhaseHistory: secondPass!.history, workflowPhaseApprovals: secondPass!.approvals };
  const reviewed = computeWorkflowAdvance(workflow, secondReview, bob.id, 'review', settings, users);
  assert.ok(reviewed);
  assert.deepEqual(reviewed.nextActivePhaseIds, ['approval'], 'downstream path must re-open after the loop');
});

// ---------------------------------------------------------------------------
// 8. Unauthorized completion is blocked; invalid explicit ownership never
//    fans out to a whole department
// ---------------------------------------------------------------------------

test('unrelated reviewers cannot advance a step they do not own', () => {
  const owned = mkPhase('owned', { userIds: [bob.id] });
  const next = mkPhase('next', { userIds: [carol.id], parentPhaseIds: ['owned'] });
  const workflow = mkWorkflow('wf_ownership', [owned, next]);
  const task = mkTask(workflow, ['owned']);

  const blocked = computeWorkflowAdvance(workflow, task, carol.id, 'owned', settings, users);
  assert.equal(blocked, null, 'a user who is not responsible for the active step must not advance the workflow');
});

test('empty or invalid explicit step assignees do not fan out to the whole department', () => {
  const phase = mkPhase('vo', { phaseKind: 'work', roleIds: ['art_director'] });
  const workflow = mkWorkflow('wf_broken_assignees', [phase]);
  const task = mkTask(workflow, ['vo'], { workflowNodeAssigneeIds: { vo: ['ghost_user'] } });

  const owners = resolveWorkflowPhaseOwnerIds(phase, task, settings, users);
  assert.deepEqual(owners, [], 'invalid explicit assignees must resolve to nobody instead of all art directors');

  const blocked = computeWorkflowAdvance(workflow, task, carol.id, 'vo', settings, users);
  assert.equal(blocked, null, 'nobody may complete a step whose explicit assignees are invalid');
});

test('sequential steps honor requiredApprovals before advancing', () => {
  const gate = mkPhase('gate', { userIds: [bob.id, carol.id], mode: 'parallel', requiredApprovals: 2 });
  const next = mkPhase('next', { userIds: [alice.id], parentPhaseIds: ['gate'] });
  const workflow = mkWorkflow('wf_required', [gate, next]);
  const task = mkTask(workflow, ['gate']);

  const firstApproval = computeWorkflowAdvance(workflow, task, bob.id, 'gate', settings, users);
  assert.ok(firstApproval);
  assert.equal(firstApproval.phaseCompleted, false);
  assert.deepEqual(firstApproval.nextActivePhaseIds, ['gate'], 'the step must stay active until the required approvals are met');

  const afterFirst: Task = { ...task, workflowPhaseApprovals: firstApproval.approvals, workflowPhaseHistory: firstApproval.history };
  const secondApproval = computeWorkflowAdvance(workflow, afterFirst, carol.id, 'gate', settings, users);
  assert.ok(secondApproval);
  assert.equal(secondApproval.phaseCompleted, true);
  assert.deepEqual(secondApproval.nextActivePhaseIds, ['next']);
});

// ---------------------------------------------------------------------------
// 9. Notification recipients and names
// ---------------------------------------------------------------------------

test('handoff notifications: only newly active phase owners, one group per phase with its correct name', () => {
  const root = mkPhase('root', { userIds: [alice.id] });
  const video = mkPhase('video', { name: 'Video Lane', userIds: [alice.id], parentPhaseIds: ['root'], mode: 'parallel' });
  const design = mkPhase('design', { name: 'Design Lane', userIds: [dave.id], parentPhaseIds: ['root'], mode: 'parallel' });
  const later = mkPhase('later', { name: 'Later Step', userIds: [carol.id], parentPhaseIds: ['video'] });
  const workflow = mkWorkflow('wf_notify', [root, video, design, later]);

  const task = mkTask(workflow, ['root']);
  const advance = computeWorkflowAdvance(workflow, task, alice.id, 'root', settings, users);
  const progressed: Task = { ...task, workflowActivePhaseIds: advance!.nextActivePhaseIds, workflowPhaseHistory: advance!.history };

  const handoffs = computePhaseHandoffs(workflow, progressed, advance!.nextActivePhaseIds, settings, users);
  assert.equal(handoffs.length, 2);
  assert.deepEqual(handoffs[0], { phaseId: 'video', phaseName: 'Video Lane', ownerIds: [alice.id] });
  assert.deepEqual(handoffs[1], { phaseId: 'design', phaseName: 'Design Lane', ownerIds: [dave.id] });
  assert.ok(handoffs.every(group => !group.ownerIds.includes(carol.id)), 'future step owners must not be notified early');
});

// ---------------------------------------------------------------------------
// 10. Repeat clicks do not double-advance
// ---------------------------------------------------------------------------

test('a repeated approval by the same user on the same step is a no-op', () => {
  const first = mkPhase('work', { userIds: [bob.id] });
  const second = mkPhase('next', { userIds: [carol.id], parentPhaseIds: ['work'] });
  const workflow = mkWorkflow('wf_repeat', [first, second]);
  const task = mkTask(workflow, ['work']);

  const advance = computeWorkflowAdvance(workflow, task, bob.id, 'work', settings, users);
  assert.ok(advance);

  const progressed: Task = { ...task, workflowActivePhaseIds: advance.nextActivePhaseIds, workflowPhaseApprovals: advance.approvals, workflowPhaseHistory: advance.history };
  const repeated = computeWorkflowAdvance(workflow, progressed, bob.id, 'work', settings, users);
  assert.equal(repeated, null, 'approving an already-approved (no longer active) step must not advance again');
});

// ---------------------------------------------------------------------------
// Owner assignment preview used by the UI/store (assignable owners)
// ---------------------------------------------------------------------------

test('assignable owners: sequential steps assign one pending owner at a time', () => {
  const phase = mkPhase('seq', { userIds: [bob.id, carol.id], mode: 'sequential' });
  const task = mkTask(mkWorkflow('wf_seq', [phase]), ['seq']);

  const firstOwner = getPhaseAssignableOwnerIds(task, phase, settings, users, []);
  assert.deepEqual(firstOwner, [bob.id], 'sequential queue offers the first pending owner');

  const afterApproval: Task = { ...task, workflowPhaseApprovals: { seq: [bob.id] } };
  const secondOwner = getPhaseAssignableOwnerIds(afterApproval, phase, settings, users, [bob.id]);
  assert.deepEqual(secondOwner, [carol.id], 'after the first approval the next pending owner becomes assignable');
});


test('assignment omissions traverse consecutive middle steps and a passTo target', () => {
  const workflow = mkWorkflow('manual', [
    mkPhase('a', { userIds: [alice.id], parentPhaseIds: ['workflow-root'], passToPhaseId: 'b' }),
    mkPhase('unrelated', { userIds: [bob.id] }),
    mkPhase('b', { skipRule: 'manual', passToPhaseId: 'c' }),
    mkPhase('c', { skipRule: 'manual', parentPhaseIds: ['b'] }),
    mkPhase('final', { phaseKind: 'final_review', roleIds: ['art_director'], parentPhaseIds: ['c'] }),
  ]);
  const task = mkTask(workflow, ['a'], { workflowSkippedPhaseIds: ['b', 'c'] });
  const result = computeWorkflowAdvance(workflow, task, alice.id, 'a', settings, users)!;
  assert.deepEqual(result.nextActivePhaseIds, ['final']);
  assert.deepEqual(result.history.filter(entry => entry.action === 'skipped').map(entry => entry.phaseId), ['b', 'c']);
  assert.equal(result.finished, false);
});

test('omitted and rule-skipped root steps follow graph edges and persist join prerequisites', () => {
  const workflow = mkWorkflow('roots', [
    mkPhase('unrelated'),
    mkPhase('root', { parentPhaseIds: ['workflow-root'], skipRule: 'manual' }),
    mkPhase('rule', { parentPhaseIds: ['root'], skipRule: 'if_no_task_links' }),
    mkPhase('left', { parentPhaseIds: ['rule'], userIds: [alice.id] }),
    mkPhase('join', { parentPhaseIds: ['root', 'left'], userIds: [bob.id] }),
  ]);
  const task = mkTask(workflow, [], { workflowSkippedPhaseIds: ['root'], assignmentLinks: [] });
  const initial = computeWorkflowInitialization(workflow, task, alice.id, '2026-01-01T00:00:00Z');
  assert.deepEqual(getInitialActivePhaseIds(workflow, task), ['left']);
  assert.deepEqual(initial.history.map(entry => entry.phaseId), ['root', 'rule']);
  const next = computeWorkflowAdvance(workflow, { ...task, workflowActivePhaseIds: initial.nextActivePhaseIds,
    workflowPhaseHistory: initial.history }, alice.id, 'left', settings, users)!;
  assert.deepEqual(next.nextActivePhaseIds, ['join']);
});

test('disabled graph steps remain in snapshots and reconnect through a join', () => {
  const workflow = cloneWorkflow(mkWorkflow('disabled', [
    mkPhase('unrelated'),
    mkPhase('root', { parentPhaseIds: ['workflow-root'], disabled: true }),
    mkPhase('left', { parentPhaseIds: ['root'], disabled: true }),
    mkPhase('right', { parentPhaseIds: ['root'], disabled: true }),
    mkPhase('join', { parentPhaseIds: ['left', 'right'], userIds: [bob.id] }),
  ]));
  assert.ok(workflow.phases.some(phase => phase.id === 'root'));
  const initial = computeWorkflowInitialization(workflow, mkTask(workflow, []));
  assert.deepEqual(initial.nextActivePhaseIds, ['join']);
  assert.deepEqual(initial.history.map(entry => entry.phaseId), ['root', 'left', 'right']);
});

test('rooted graphs never initialize an unrelated array node or an invalid root note', () => {
  const workflow = mkWorkflow('invalid_root', [mkPhase('unrelated'), mkPhase('root_note', { nodeType: 'note', parentPhaseIds: ['workflow-root'] })]);
  assert.deepEqual(getInitialActivePhaseIds(workflow, mkTask(workflow, [])), []);
});

test('passTo respects joins and cannot activate note targets', () => {
  const workflow = mkWorkflow('pass_join', [
    mkPhase('a', { userIds: [alice.id], parentPhaseIds: ['workflow-root'], passToPhaseId: 'join' }),
    mkPhase('b', { userIds: [bob.id], parentPhaseIds: ['workflow-root'] }),
    mkPhase('join', { parentPhaseIds: ['a', 'b'], roleIds: ['art_director'], phaseKind: 'final_review' }),
  ]);
  const task = mkTask(workflow, ['a', 'b']);
  const first = computeWorkflowAdvance(workflow, task, alice.id, 'a', settings, users)!;
  assert.deepEqual(first.nextActivePhaseIds, ['b']);
  const second = computeWorkflowAdvance(workflow, { ...task, workflowActivePhaseIds: first.nextActivePhaseIds,
    workflowPhaseHistory: first.history, workflowPhaseApprovals: first.approvals }, bob.id, 'b', settings, users)!;
  assert.deepEqual(second.nextActivePhaseIds, ['join']);
  const invalid = mkWorkflow('bad_pass', [mkPhase('a', { userIds: [alice.id], passToPhaseId: 'note' }), mkPhase('note', { nodeType: 'note' })]);
  assert.deepEqual(computeWorkflowAdvance(invalid, mkTask(invalid, ['a']), alice.id, 'a', settings, users)!.nextActivePhaseIds, []);
});

test('explicitly empty task ownership blocks configured reviewer fallback and unrelated active-phase access', () => {
  const phase = mkPhase('review', { userIds: [bob.id], roleIds: ['reviewer'] });
  const workflow = mkWorkflow('empty', [phase]);
  const task = mkTask(workflow, ['review'], { workflowNodeAssigneeIds: { review: [] } });
  assert.deepEqual(resolveWorkflowPhaseOwnerIds(phase, task, settings, users), []);
  assert.equal(computeWorkflowAdvance(workflow, task, bob.id, 'review', settings, users), null);
  assert.equal(getActiveWorkflowPhaseForUser(task, bob.id, settings, users), null);
  assert.equal(canUserActAsCurrentOwner(task, bob), false);
  const invalidConfigured = mkPhase('invalid', { userIds: ['deleted-user'] });
  assert.deepEqual(resolveWorkflowPhaseOwnerIds(invalidConfigured, task, settings, users), []);
});

test('final Art Director review survives manual, automatic and disabled skips and cannot be bypassed at completion', () => {
  for (const skipRule of ['manual', 'if_no_task_links'] as const) {
    const final = mkPhase('final', { phaseKind: 'final_review', roleIds: ['art_director'], skipRule, disabled: true, parentPhaseIds: ['work'] });
    const workflow = mkWorkflow('mandatory', [mkPhase('work', { userIds: [alice.id] }), final]);
    const task = mkTask(workflow, ['work'], { workflowSkippedPhaseIds: ['final'] });
    const result = computeWorkflowAdvance(workflow, task, alice.id, 'work', settings, users)!;
    assert.deepEqual(result.nextActivePhaseIds, ['final']);
    assert.equal(canSkipWorkflowPhase(final), false);
    const atFinal = { ...task, workflowActivePhaseIds: ['final'], workflowPhaseHistory: result.history };
    assert.equal(computeWorkflowSkip(workflow, atFinal, carol.id, 'final'), null);
    assert.equal(computeWorkflowAdvance(workflow, atFinal, carol.id, 'final', settings, users)?.finished, true);
    const bypassed = { ...workflow, phases: [{ ...workflow.phases[0], passToPhaseId: 'missing' }, final] };
    assert.equal(computeWorkflowAdvance(bypassed, task, alice.id, 'work', settings, users)?.finished, false);
  }
});

test('return operation invalidates downstream completed phases and approvals while retaining unrelated branch state', () => {
  const workflow = mkWorkflow('return_completed', [
    mkPhase('content', { parentPhaseIds: ['workflow-root'], userIds: [alice.id] }),
    mkPhase('review', { parentPhaseIds: ['content'], userIds: [bob.id] }),
    mkPhase('final', { parentPhaseIds: ['review'], phaseKind: 'final_review', userIds: [carol.id], returnToPhaseId: 'content' }),
    mkPhase('unrelated', { parentPhaseIds: ['workflow-root'], userIds: [dave.id] }),
  ]);
  const task = mkTask(workflow, ['final', 'unrelated'], {
    workflowPhaseHistory: [historyEntry('content', 'completed'), historyEntry('review', 'completed'), historyEntry('final', 'started'), historyEntry('unrelated', 'started')],
    workflowPhaseApprovals: { content: [alice.id], review: [bob.id], unrelated: [dave.id] },
    workflowPhaseAvailableAtByPhaseId: { unrelated: '2099-01-01T00:00:00Z' },
  });
  assert.equal(computeWorkflowReturn(workflow, task, alice.id, 'final', undefined, settings, users), null);
  const result = computeWorkflowReturn(workflow, task, carol.id, 'final', undefined, settings, users)!;
  assert.deepEqual(result.nextActivePhaseIds, ['content', 'unrelated']);
  assert.deepEqual(result.approvals, { unrelated: [dave.id] });
  assert.deepEqual(result.availableAtByPhaseId, task.workflowPhaseAvailableAtByPhaseId);
  assert.deepEqual(new Set(result.invalidatedIds), new Set(['content', 'review', 'final']));
  assert.equal(getCompletedPhaseIdsFromHistory(result.history).has('review'), false);
  assert.ok(result.history.some(entry => entry.phaseId === 'review' && entry.action === 'completed'), 'retain the original audit evidence');
  const repeated = computeWorkflowAdvance(workflow, { ...task, workflowActivePhaseIds: result.nextActivePhaseIds,
    workflowPhaseApprovals: result.approvals, workflowPhaseHistory: result.history }, alice.id, 'content', settings, users)!;
  assert.deepEqual(repeated.nextActivePhaseIds, ['unrelated', 'review']);
});

test('parallel delays retain separate timestamps and only due phase owners become assignable', () => {
  const workflow = mkWorkflow('delay', [
    mkPhase('now', { userIds: [alice.id] }),
    mkPhase('short', { userIds: [bob.id], delayDays: 1 }),
    mkPhase('long', { userIds: [carol.id], delayDays: 3 }),
  ]);
  const now = '2026-09-13T09:00:00.000Z';
  const delays = splitHandoffsByDelay(workflow, ['now', 'short', 'long'], settings, now);
  assert.deepEqual(delays.immediatePhaseIds, ['now']);
  assert.deepEqual(delays.delayedPhaseIds, ['short', 'long']);
  assert.deepEqual(delays.availableAtByPhaseId, { short: '2026-09-14T09:00:00.000Z', long: '2026-09-16T09:00:00.000Z' });
  const task = mkTask(workflow, ['now', 'short', 'long'], { workflowPhaseAvailableAtByPhaseId: delays.availableAtByPhaseId, workflowPhaseAvailableAt: delays.availableAt });
  const shortDue = new Date('2026-09-14T09:00:00.000Z');
  assert.equal(isPhaseAvailable(task, new Date(now), 'now'), true);
  assert.equal(isPhaseAvailable(task, shortDue, 'short'), true);
  assert.equal(isPhaseAvailable(task, shortDue, 'long'), false);
  assert.deepEqual(getPhaseAssignableOwnerIds(task, workflow.phases[1], settings, users, [], shortDue), [bob.id]);
  assert.deepEqual(computePhaseHandoffs(workflow, task, ['short', 'long'], settings, users, shortDue).map(group => group.phaseId), ['short']);
  assert.deepEqual(computePhaseHandoffs(workflow, task, ['long'], settings, users, new Date('2026-09-16T09:00:00.000Z')).map(group => group.phaseId), ['long']);
  assert.deepEqual(getPhaseAssignableOwnerIds(task, workflow.phases[2], settings, users, [], shortDue), []);
  assert.deepEqual(getPhaseAssignableOwnerIds(task, workflow.phases[2], settings, users, [], new Date('2026-09-16T09:00:00.000Z')), [carol.id]);
});

test('work remains assigned_work for senior owners and empty/closed active phases cannot advance', () => {
  for (const role of ['reviewer', 'art_director', 'team_leader'] as const) {
    assert.equal(getStatusForWorkflowPhase(mkPhase('work', { phaseKind: 'work', roleIds: [role] })), 'assigned_work');
  }
  const phase = mkPhase('work', { userIds: [alice.id] });
  const workflow = mkWorkflow('guard', [phase]);
  const task = mkTask(workflow, ['work']);
  assert.equal(computeWorkflowAdvance(workflow, { ...task, workflowActivePhaseIds: [] }, alice.id, 'work', settings, users), null);
  for (const status of ['on_hold', 'completed', 'approved_by_art_director', 'archived', 'changes_requested_by_reviewer', 'changes_requested_by_art_director', 'changes_requested_by_content'] as const) {
    assert.equal(computeWorkflowAdvance(workflow, { ...task, status }, alice.id, 'work', settings, users), null);
  }
  assert.equal(getNextPhaseIndex(workflow, -1, task), 0, 'undefined nodeType is a legacy step');
});


test('default return finds nearest completed work ancestor and reapplies only its delay', () => {
  const workflow = mkWorkflow('default_return', [
    mkPhase('work', { phaseKind: 'work', userIds: [alice.id], parentPhaseIds: ['workflow-root'], delayDays: 2 }),
    mkPhase('review', { phaseKind: 'first_review', userIds: [bob.id], parentPhaseIds: ['work'] }),
    mkPhase('final', { phaseKind: 'final_review', userIds: [carol.id], parentPhaseIds: ['review'] }),
  ]);
  const task = mkTask(workflow, ['final'], { workflowPhaseHistory: [historyEntry('work', 'completed'), historyEntry('review', 'completed'), historyEntry('final', 'started')] });
  const before = Date.now();
  const result = computeWorkflowReturn(workflow, task, carol.id, 'final', undefined, settings, users)!;
  assert.equal(result.targetPhaseId, 'work');
  const due = new Date(result.availableAtByPhaseId.work).getTime();
  assert.ok(due >= before + 2 * 86400000 && due <= Date.now() + 2 * 86400000);
  assert.deepEqual(Object.keys(result.availableAtByPhaseId), ['work']);
});

test('review-only return reopens same phase but uploader alone may resubmit while revision is requested', () => {
  const workflow = mkWorkflow('review_only', [mkPhase('review', { phaseKind: 'first_review', userIds: [bob.id] })]);
  const task = mkTask(workflow, ['review']);
  const result = computeWorkflowReturn(workflow, task, bob.id, 'review', undefined, settings, users)!;
  assert.equal(result.targetPhaseId, 'review');
  const returned: Task = { ...task, status: 'changes_requested_by_reviewer', currentOwnerUserId: alice.id, currentOwnerUserIds: [alice.id] };
  assert.equal(canUserActAsCurrentOwner(returned, alice), true);
  assert.equal(canUserActAsCurrentOwner(returned, bob), false);
  assert.equal(computeWorkflowAdvance(workflow, returned, bob.id, 'review', settings, users), null);
});


test('legacy skipped final approval is reopened and never counts as mandatory completion', () => {
  const workflow = mkWorkflow('legacy_final_skip', [
    mkPhase('a', { userIds: [alice.id], parentPhaseIds: ['workflow-root'] }),
    mkPhase('final', { phaseKind: 'final_review', roleIds: ['art_director'], parentPhaseIds: ['a'] }),
  ]);
  const task = mkTask(workflow, ['a'], { workflowPhaseHistory: [historyEntry('final', 'skipped'), historyEntry('a', 'started')] });
  const result = computeWorkflowAdvance(workflow, task, alice.id, 'a', settings, users)!;
  assert.deepEqual(result.nextActivePhaseIds, ['final']);
  assert.equal(result.finished, false);
});


test('empty availability maps preserve legacy delay for owner actions and handoffs until due', () => {
  const phase = mkPhase('review', { userIds: [bob.id] });
  const workflow = mkWorkflow('legacy_delay', [phase]);
  const task = mkTask(workflow, ['review'], {
    workflowPhaseAvailableAtByPhaseId: {},
    workflowPhaseAvailableAt: '2099-01-03T09:00:00.000Z',
  });
  const before = new Date('2099-01-02T09:00:00.000Z');
  const due = new Date('2099-01-03T09:00:00.000Z');
  assert.equal(isPhaseAvailable(task, before), false);
  assert.equal(isPhaseAvailable(task, before, 'review'), false);
  assert.deepEqual(getPhaseAssignableOwnerIds(task, phase, settings, users, [], before), []);
  assert.deepEqual(computePhaseHandoffs(workflow, task, ['review'], settings, users, before), []);
  assert.equal(computeWorkflowAdvance(workflow, task, bob.id, 'review', settings, users), null);
  assert.equal(isPhaseAvailable(task, due, 'review'), true);
  assert.deepEqual(getPhaseAssignableOwnerIds(task, phase, settings, users, [], due), [bob.id]);
  assert.deepEqual(computePhaseHandoffs(workflow, task, ['review'], settings, users, due).map(group => group.phaseId), ['review']);
});

test('nonempty availability maps remain authoritative for phases absent from the map or already due', () => {
  const task = {
    workflowActivePhaseIds: ['ready', 'later'],
    workflowPhaseAvailableAt: '2099-01-05T09:00:00.000Z',
    workflowPhaseAvailableAtByPhaseId: { later: '2099-01-03T09:00:00.000Z' },
  };
  const before = new Date('2099-01-02T09:00:00.000Z');
  assert.equal(isPhaseAvailable(task, before), true);
  assert.equal(isPhaseAvailable(task, before, 'ready'), true);
  assert.equal(isPhaseAvailable(task, before, 'later'), false);
  assert.equal(isPhaseAvailable(task, new Date('2099-01-03T09:00:00.000Z'), 'later'), true);
});
