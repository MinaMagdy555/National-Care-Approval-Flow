import { AppSettings, Task, User, WorkflowDefinition, WorkflowPhaseDefinition, WorkflowPhaseHistoryEntry } from './types';
import { getWorkflowParentIds as getPhaseParentIds, getWorkflowSuccessors as successors, getWorkflowEntryPhases as initialCandidates, isWorkflowStep as isStepPhase, getWorkflowDownstreamIds } from './workflowGraph';
import {
  computePhaseAvailableAt,
  isWorkflowPhaseSkippedForTask,
  canSkipWorkflowPhase,
  CLOSED_STATUSES,
  RETURNED_STATUSES,
  isMandatoryFinalReview,
  isPhaseAvailable,
  getPhaseAssignableOwnerIds,
  getPhaseOwnerRole,
  getWorkflowPhaseIndex,
  resolveWorkflowPhaseOwnerIds,
  uniqueIds,
} from './workflowUtils';

/**
 * Pure workflow runtime. The store actions delegate every routing, ownership
 * and handoff decision to these functions so the behavior can be regression
 * tested without a duplicated, test-only algorithm.
 *
 * Routing rules:
 * - Explicit graph connections (parentPhaseIds / passToPhaseId) decide the
 *   route as soon as any step in the workflow uses them.
 * - The old array-order behavior is kept only as a bounded compatibility
 *   fallback for legacy workflows that carry no graph connections at all.
 * - A phase with multiple parents (a join) only starts once every parent is
 *   completed. Phases reached through a return loop can be revisited: the
 *   latest history action per phase decides whether it counts as completed.
 */

export { getPhaseAssignableOwnerIds, resolveWorkflowPhaseOwnerIds } from './workflowUtils';
export { getWorkflowParentIds as getPhaseParentIds, workflowHasExplicitEdges } from './workflowGraph';

type TaskRouteFields = Pick<Task, 'assignmentLinks' | 'versions' | 'workflowSkippedPhaseIds' | 'needsContentRevision'>;

export interface WorkflowAdvanceResult {
  targetPhaseId: string;
  nextActivePhaseIds: string[];
  history: WorkflowPhaseHistoryEntry[];
  approvals: Record<string, string[]>;
  phaseCompleted: boolean;
  finished: boolean;
  blockedReason?: string;
}

export interface WorkflowSkipResult {
  targetPhaseId: string;
  nextActivePhaseIds: string[];
  history: WorkflowPhaseHistoryEntry[];
  finished: boolean;
  blockedReason?: string;
}

export interface PhaseHandoffGroup {
  phaseId: string;
  phaseName: string;
  ownerIds: string[];
}

function makeHistoryEntry(phase: WorkflowPhaseDefinition, action: WorkflowPhaseHistoryEntry['action'], actorId: string, createdAt: string, note?: string): WorkflowPhaseHistoryEntry {
  return {
    phaseId: phase.id,
    phaseName: phase.name,
    action,
    actorId,
    createdAt,
    note,
  };
}

function getLatestActionByPhase(history: WorkflowPhaseHistoryEntry[]): Map<string, WorkflowPhaseHistoryEntry['action']> {
  const latest = new Map<string, WorkflowPhaseHistoryEntry['action']>();
  history.forEach(entry => {
    latest.set(entry.phaseId, entry.action);
  });
  return latest;
}

/**
 * A phase counts as completed only when its latest terminal action ('completed'
 * or 'skipped') is newer than its latest 'started'. This is what lets return /
 * resubmit loops revisit a step and its downstream path: a fresh 'started'
 * entry reopens the phase even though older completion records exist.
 */
export function getCompletedPhaseIdsFromHistory(history: WorkflowPhaseHistoryEntry[]): Set<string> {
  const latest = getLatestActionByPhase(history);
  const completed = new Set<string>();
  latest.forEach((action, phaseId) => {
    if (action === 'completed' || action === 'skipped') completed.add(phaseId);
  });
  return completed;
}

/**
 * Adds a 'started' entry for every phase whose latest action is not already
 * 'started'. Re-entering a returned phase therefore records a fresh start,
 * while repeated rebuilds of the same active step stay idempotent.
 */
export function appendStartedEntries(
  history: WorkflowPhaseHistoryEntry[],
  phases: WorkflowPhaseDefinition[],
  actorId: string,
): WorkflowPhaseHistoryEntry[] {
  const latest = getLatestActionByPhase(history);
  const createdAt = new Date().toISOString();
  const additions = phases
    .filter(phase => latest.get(phase.id) !== 'started')
    .map(phase => makeHistoryEntry(phase, 'started', actorId, createdAt));
  return additions.length > 0 ? [...history, ...additions] : history;
}

function isSkipEligible(candidate: WorkflowPhaseDefinition, task: TaskRouteFields): boolean {
  return isWorkflowPhaseSkippedForTask(candidate, task);
}

/** Edges retain disabled/omitted steps so traversal can reconnect their successors. */
export function getGraphChildren(
  workflow: WorkflowDefinition,
  parentId: string,
  completedIds: Set<string>,
  _task: TaskRouteFields,
): WorkflowPhaseDefinition[] {
  return workflow.phases.filter(candidate => isStepPhase(candidate)
    && getPhaseParentIds(candidate).includes(parentId)
    && parentsAreComplete(candidate, completedIds));
}

function parentsAreComplete(phase: WorkflowPhaseDefinition, completedIds: Set<string>): boolean {
  return getPhaseParentIds(phase).every(id => id === 'workflow-root' || completedIds.has(id));
}

function traverseCandidates(
  workflow: WorkflowDefinition,
  task: TaskRouteFields,
  history: WorkflowPhaseHistoryEntry[],
  activeIds: string[],
  candidates: WorkflowPhaseDefinition[],
  actorId: string,
  now: string,
): { nextActivePhaseIds: string[]; history: WorkflowPhaseHistoryEntry[] } {
  const completed = getCompletedPhaseIdsFromHistory(history);
  const latest = getLatestActionByPhase(history);
  workflow.phases.filter(isMandatoryFinalReview).forEach(phase => {
    if (latest.get(phase.id) !== 'completed') completed.delete(phase.id);
  });
  const nextActivePhaseIds = uniqueIds(activeIds);
  const nextHistory = [...history];
  const visited = new Set<string>();
  const queue = [...candidates];
  while (queue.length) {
    const candidate = queue.shift()!;
    // A join can be queued again after another omitted branch completes.
    if (visited.has(candidate.id) || !parentsAreComplete(candidate, completed)) continue;
    visited.add(candidate.id);
    if (nextActivePhaseIds.includes(candidate.id)) continue;
    if (completed.has(candidate.id)) continue;
    if (isSkipEligible(candidate, task)) {
      completed.add(candidate.id);
      nextHistory.push(makeHistoryEntry(candidate, 'skipped', actorId, now,
        candidate.disabled ? 'Disabled workflow step.' : (task.workflowSkippedPhaseIds || []).includes(candidate.id)
          ? 'Skipped for this task during assignment.' : `Skipped by rule: ${candidate.skipRule}.`));
      queue.push(...successors(workflow, candidate.id));
    } else {
      nextActivePhaseIds.push(candidate.id);
    }
  }
  return { nextActivePhaseIds, history: nextHistory };
}

/** Initialization also persists skip history, needed by downstream joins. */
export function computeWorkflowInitialization(
  workflow: WorkflowDefinition,
  task: TaskRouteFields,
  actorId = '',
  nowIso = new Date().toISOString(),
): { nextActivePhaseIds: string[]; history: WorkflowPhaseHistoryEntry[] } {
  return traverseCandidates(workflow, task, [], [], initialCandidates(workflow), actorId, nowIso);
}

export function getInitialActivePhaseIds(workflow: WorkflowDefinition, task: TaskRouteFields): string[] {
  return computeWorkflowInitialization(workflow, task).nextActivePhaseIds;
}

/** A route cannot silently finish while its configured final approval is pending. */
function isWorkflowFinished(workflow: WorkflowDefinition, activeIds: string[], history: WorkflowPhaseHistoryEntry[]): boolean {
  if (activeIds.length) return false;
  const latest = getLatestActionByPhase(history);
  const finalPhases = workflow.phases.filter(phase => isStepPhase(phase) && isMandatoryFinalReview(phase));
  const lastCompleted = [...history].reverse().find(entry => entry.action === 'completed');
  return finalPhases.length > 0 && finalPhases.some(phase => phase.id === lastCompleted?.phaseId)
    && finalPhases.every(phase => latest.get(phase.id) === 'completed');
}

function getTerminalBlockReason(workflow: WorkflowDefinition, activeIds: string[], history: WorkflowPhaseHistoryEntry[]): string | undefined {
  if (activeIds.length || isWorkflowFinished(workflow, activeIds, history)) return undefined;
  return 'This workflow cannot finish without Final Rev. by the Art Director. Ask a workflow manager to repair the final approval route.';
}

/**
 * Computes the phases that become active after a terminated phase, following
 * explicit edges when the workflow has any and the bounded array-order
 * fallback otherwise. Skip-eligible candidates are recorded as skipped and
 * the traversal recurses, so consecutive skipped nodes resolve to the first
 * actionable step.
 */
function routeAfterTermination(
  workflow: WorkflowDefinition,
  task: TaskRouteFields,
  history: WorkflowPhaseHistoryEntry[],
  remainingActiveIds: string[],
  terminatedPhaseId: string,
  actorId: string,
  now: string,
): { nextActivePhaseIds: string[]; history: WorkflowPhaseHistoryEntry[] } {
  return traverseCandidates(workflow, task, history, remainingActiveIds,
    successors(workflow, terminatedPhaseId), actorId, now);
}

/**
 * Advances the workflow after an owner approves their active step. Returns
 * null when the actor is not assignable for the step, the step is not active,
 * or the actor already approved it, so repeat clicks cannot double-advance.
 */
export function computeWorkflowAdvance(
  workflow: WorkflowDefinition,
  task: Task,
  actorId: string,
  phaseId: string | undefined,
  settings: AppSettings,
  users: User[],
): WorkflowAdvanceResult | null {
  if (!workflow || workflow.phases.length === 0 || CLOSED_STATUSES.includes(task.status) || RETURNED_STATUSES.includes(task.status) || task.status === 'on_hold' || task.archivedAt) return null;
  const activeIds = task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
  const existingApprovals = task.workflowPhaseApprovals || {};

  const phase = phaseId
    ? workflow.phases.find(candidate => candidate.id === phaseId)
    : activeIds
      .map(id => workflow.phases.find(candidate => candidate.id === id))
      .filter((candidate): candidate is WorkflowPhaseDefinition => Boolean(candidate))
      .find(candidate => getPhaseAssignableOwnerIds(task, candidate, settings, users, existingApprovals[candidate.id] || []).includes(actorId));

  if (!phase || !isStepPhase(phase) || (phase.disabled && !isMandatoryFinalReview(phase)) || !activeIds.includes(phase.id) || !isPhaseAvailable(task, new Date(), phase.id)) return null;
  const validOwnerIds = resolveWorkflowPhaseOwnerIds(phase, task, settings, users);
  const priorApprovals = uniqueIds(existingApprovals[phase.id] || []).filter(id => validOwnerIds.includes(id));
  if (priorApprovals.includes(actorId)) return null;
  if (!getPhaseAssignableOwnerIds(task, phase, settings, users, priorApprovals).includes(actorId)) return null;

  const approvals = {
    ...existingApprovals,
    [phase.id]: uniqueIds([...priorApprovals, actorId]),
  };
  const allOwnerIds = resolveWorkflowPhaseOwnerIds(phase, task, settings, users);
  const requiredApprovals = isMandatoryFinalReview(phase) ? 1 : typeof phase.requiredApprovals === 'number' && phase.requiredApprovals > 0
    ? phase.requiredApprovals
    : (allOwnerIds.length || 1);
  const approvedIds = approvals[phase.id] || [];
  const phaseCompleted = approvedIds.length >= requiredApprovals;
  const now = new Date().toISOString();
  const approvedHistory = [
    ...(task.workflowPhaseHistory || []),
    makeHistoryEntry(phase, 'approved', actorId, now),
  ];

  if (!phaseCompleted) {
    return {
      targetPhaseId: phase.id,
      nextActivePhaseIds: activeIds,
      history: approvedHistory,
      approvals,
      phaseCompleted: false,
      finished: false,
    };
  }

  const completedHistory = [
    ...approvedHistory,
    makeHistoryEntry(phase, 'completed', actorId, now),
  ];
  const remainingActiveIds = activeIds.filter(id => id !== phase.id);
  const routed = routeAfterTermination(workflow, task, completedHistory, remainingActiveIds, phase.id, actorId, now);

  return {
    targetPhaseId: phase.id,
    nextActivePhaseIds: routed.nextActivePhaseIds,
    history: routed.history,
    approvals,
    phaseCompleted: true,
    finished: isWorkflowFinished(workflow, routed.nextActivePhaseIds, routed.history),
    blockedReason: getTerminalBlockReason(workflow, routed.nextActivePhaseIds, routed.history),
  };
}

/**
 * Leaderboard manual skip: records the step as skipped and routes onward with
 * the same graph/fallback rules as a normal completion.
 */
export function computeWorkflowSkip(
  workflow: WorkflowDefinition,
  task: Task,
  actorId: string,
  phaseId: string,
): WorkflowSkipResult | null {
  if (!workflow || workflow.phases.length === 0 || CLOSED_STATUSES.includes(task.status) || task.archivedAt) return null;
  const activeIds = task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
  const phase = workflow.phases.find(candidate => candidate.id === phaseId);
  if (!phase || !isStepPhase(phase) || !canSkipWorkflowPhase(phase)
    || getCompletedPhaseIdsFromHistory(task.workflowPhaseHistory || []).has(phase.id)) return null;
  if (!activeIds.includes(phase.id)) return { targetPhaseId: phase.id, nextActivePhaseIds: activeIds,
    history: task.workflowPhaseHistory || [], finished: false };

  const now = new Date().toISOString();
  const history = [
    ...(task.workflowPhaseHistory || []),
    makeHistoryEntry(phase, 'skipped', actorId, now, 'Skipped manually by leaderboard.'),
  ];
  const remainingActiveIds = activeIds.filter(id => id !== phase.id);
  const routed = routeAfterTermination(workflow, task, history, remainingActiveIds, phase.id, actorId, now);

  return {
    targetPhaseId: phase.id,
    nextActivePhaseIds: routed.nextActivePhaseIds,
    history: routed.history,
    finished: isWorkflowFinished(workflow, routed.nextActivePhaseIds, routed.history),
    blockedReason: getTerminalBlockReason(workflow, routed.nextActivePhaseIds, routed.history),
  };
}

/** Reconcile all active removals together so parallel joins see every skipped parent. */
export function computeWorkflowOmissions(workflow: WorkflowDefinition, task: Task, skippedIds: string[], actorId: string, now = new Date().toISOString()): WorkflowSkipResult {
  const activeIds = task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
  const removed = workflow.phases.filter(phase => activeIds.includes(phase.id) && skippedIds.includes(phase.id) && canSkipWorkflowPhase(phase));
  const history = [...(task.workflowPhaseHistory || []), ...removed.map(phase => makeHistoryEntry(phase, 'skipped', actorId, now, 'Omitted for this task by a workflow manager.'))];
  const routed = traverseCandidates(workflow, { ...task, workflowSkippedPhaseIds: skippedIds }, history,
    activeIds.filter(id => !removed.some(phase => phase.id === id)), removed.flatMap(phase => successors(workflow, phase.id)), actorId, now);
  return { targetPhaseId: removed[0]?.id || '', ...routed,
    finished: isWorkflowFinished(workflow, routed.nextActivePhaseIds, routed.history),
    blockedReason: getTerminalBlockReason(workflow, routed.nextActivePhaseIds, routed.history) };
}

export interface WorkflowReturnResult {
  sourcePhaseId: string;
  targetPhaseId: string;
  nextActivePhaseIds: string[];
  history: WorkflowPhaseHistoryEntry[];
  approvals: Record<string, string[]>;
  invalidatedIds: string[];
  availableAtByPhaseId: Record<string, string>;
}

function findDefaultReturnTarget(workflow: WorkflowDefinition, source: WorkflowPhaseDefinition, history: WorkflowPhaseHistoryEntry[]): WorkflowPhaseDefinition {
  const completed = getCompletedPhaseIdsFromHistory(history);
  const visited = new Set([source.id]);
  const queue = [source];
  while (queue.length) {
    const phase = queue.shift()!;
    const predecessors = workflow.phases.filter(candidate => isStepPhase(candidate)
      && successors(workflow, candidate.id).some(next => next.id === phase.id));
    for (const candidate of predecessors) {
      if (visited.has(candidate.id)) continue;
      visited.add(candidate.id);
      if (!candidate.disabled && completed.has(candidate.id) && (candidate.phaseKind === 'work'
        || candidate.phaseKind === 'content_review' || (!candidate.phaseKind && getPhaseOwnerRole(candidate) === 'team_member'))) return candidate;
      queue.push(candidate);
    }
  }
  return source;
}

/** Reopens a prior step and invalidates every downstream approval without erasing audit history. */
export function computeWorkflowReturn(
  workflow: WorkflowDefinition,
  task: Task,
  actorId: string,
  sourcePhaseId: string,
  targetPhaseId?: string,
  settings?: AppSettings,
  users?: User[],
): WorkflowReturnResult | null {
  if (CLOSED_STATUSES.includes(task.status) || RETURNED_STATUSES.includes(task.status) || task.status === 'on_hold' || task.archivedAt) return null;
  const activeIds = task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
  const source = workflow.phases.find(phase => phase.id === sourcePhaseId);
  const targetId = targetPhaseId || source?.returnToPhaseId || source?.failToPhaseId
    || (source ? findDefaultReturnTarget(workflow, source, task.workflowPhaseHistory || []).id : undefined);
  let target = workflow.phases.find(phase => phase.id === targetId);
  // A removed return destination reconnects backwards, never forwards across an approval.
  if (target && source && isSkipEligible(target, task)) {
    const completed = getCompletedPhaseIdsFromHistory(task.workflowPhaseHistory || []);
    const visited = new Set<string>();
    const queue = [target];
    target = undefined;
    while (queue.length && !target) {
      const candidate = queue.shift()!;
      if (visited.has(candidate.id)) continue;
      visited.add(candidate.id);
      if (!isSkipEligible(candidate, task) && completed.has(candidate.id)
        && (candidate.phaseKind === 'work' || candidate.phaseKind === 'content_review' || getPhaseOwnerRole(candidate) === 'team_member')) target = candidate;
      else queue.push(...workflow.phases.filter(phase => isStepPhase(phase) && successors(workflow, phase.id).some(next => next.id === candidate.id)));
    }
    target ||= source;
  }
  if (!source || !target || !activeIds.includes(source.id) || !isStepPhase(target) || isSkipEligible(target, task)
    || !isPhaseAvailable(task, new Date(), source.id)) return null;
  if (settings && users && !getPhaseAssignableOwnerIds(task, source, settings, users,
    task.workflowPhaseApprovals?.[source.id] || []).includes(actorId)) return null;

  const invalidated = getWorkflowDownstreamIds(workflow, target.id);
  if (!invalidated.has(source.id)) return null;
  const now = new Date().toISOString();
  const history = [
    ...(task.workflowPhaseHistory || []),
    makeHistoryEntry(source, 'changes_requested', actorId, now),
    ...workflow.phases.filter(phase => invalidated.has(phase.id))
      .map(phase => makeHistoryEntry(phase, 'invalidated', actorId, now, `Reopened from ${source.name} to ${target.name}.`)),
  ];
  const approvals = Object.fromEntries(Object.entries(task.workflowPhaseApprovals || {})
    .filter(([id]) => !invalidated.has(id)));
  const availableAtByPhaseId = Object.fromEntries(Object.entries(task.workflowPhaseAvailableAtByPhaseId || {})
    .filter(([id]) => !invalidated.has(id)));
  if (settings) {
    Object.assign(availableAtByPhaseId, splitHandoffsByDelay(workflow, [target.id], settings, now).availableAtByPhaseId);
  }
  return {
    sourcePhaseId: source.id,
    targetPhaseId: target.id,
    nextActivePhaseIds: uniqueIds([target.id, ...activeIds.filter(id => !invalidated.has(id))]),
    history: appendStartedEntries(history, [target], actorId),
    approvals,
    invalidatedIds: [...invalidated],
    availableAtByPhaseId,
  };
}

/**
 * One notification group per newly active phase, resolved at the task's
 * current state. The same person owning consecutive steps still receives the
 * new step handoff, and simultaneous parallel phases each keep their own name
 * and recipients instead of being merged under the first phase's label.
 */
export function computePhaseHandoffs(
  workflow: WorkflowDefinition,
  task: Task,
  phaseIds: string[],
  settings: AppSettings,
  users: User[],
  now = new Date(),
): PhaseHandoffGroup[] {
  return uniqueIds(phaseIds)
    .map(id => workflow.phases.find(phase => phase.id === id))
    .filter((phase): phase is WorkflowPhaseDefinition => Boolean(phase && isStepPhase(phase) && (!phase.disabled || isMandatoryFinalReview(phase))))
    .map(phase => ({
      phaseId: phase.id,
      phaseName: phase.name,
      ownerIds: getPhaseAssignableOwnerIds(task, phase, settings, users, task.workflowPhaseApprovals?.[phase.id] || [], now),
    }))
    .filter(group => group.ownerIds.length > 0);
}

/**
 * Splits newly activated phase ids into those whose handoff may be notified
 * immediately and those whose delay makes the handoff (and availability) only
 * become reachable later. The earliest future availability timestamp is
 * returned for scheduling; the per-phase map controls which handoffs are due.
 */
export function splitHandoffsByDelay(
  workflow: WorkflowDefinition,
  phaseIds: string[],
  settings: AppSettings,
  nowIso: string,
): { immediatePhaseIds: string[]; delayedPhaseIds: string[]; availableAt: string | null; availableAtByPhaseId: Record<string, string> } {
  const immediate: string[] = [];
  const delayed: string[] = [];
  const availableTimes: string[] = [];
  const availableAtByPhaseId: Record<string, string> = {};
  uniqueIds(phaseIds).forEach(id => {
    const phase = workflow.phases.find(candidate => candidate.id === id);
    if (!phase) return;
    const availableAt = computePhaseAvailableAt(nowIso, phase.delayDays, settings.businessCalendar);
    if (availableAt && new Date(availableAt).getTime() > new Date(nowIso).getTime()) {
      delayed.push(id);
      availableTimes.push(availableAt);
      availableAtByPhaseId[id] = availableAt;
    } else {
      immediate.push(id);
    }
  });
  return {
    immediatePhaseIds: immediate,
    delayedPhaseIds: delayed,
    availableAt: availableTimes.sort()[0] || null,
    availableAtByPhaseId,
  };
}
