import type { AppSettings, Task, User, WorkflowPhaseDefinition } from './types.js';
import { canEditTask } from './taskPolicy.js';
import { isLeaderboardUser } from './workAssignmentUtils.js';
import { canManageWorkflowBuilder, canSkipWorkflowPhase, CLOSED_STATUSES, RETURNED_STATUSES, getPhaseAssignableOwnerIds, getPhaseOwnerRole, getReviewModeForWorkflowPhase, getStatusForWorkflowPhase, isMandatoryFinalReview, resolveWorkflowPhaseOwnerIds, uniqueIds } from './workflowUtils.js';
import { appendStartedEntries, computeWorkflowOmissions, splitHandoffsByDelay } from './workflowRuntime.js';
import { getWorkflowDownstreamIds } from './workflowGraph.js';
import { isContentReviewPhase } from './reviewPolicy.js';
import { validateVoiceOverAssignment, isVoiceOverPhase, hasVoiceOverProviderSelection } from './voiceOverPolicy.js';
import type { WorkflowAssignmentResult } from './workflowAssignment.js';

export function canManageWorkflowOmissions(user: User, settings: AppSettings, task?: Task, users: User[] = [], now = new Date()): boolean {
  const manager = user.id !== 'guest' && (canManageWorkflowBuilder(user, settings) || isLeaderboardUser(user.id)
    || user.isAdmin || ['admin', 'team_leader', 'art_director', 'manager'].includes(user.role));
  return Boolean(manager && (!task || canEditTask(task, user, settings, users, now)));
}

export function canChangeWorkflowPhaseOmission(task: Task, phase: WorkflowPhaseDefinition, omit: boolean): WorkflowAssignmentResult {
  if (!canSkipWorkflowPhase(phase)) return { ok: false, message: 'Final Rev. by the Art Director cannot be removed.' };
  if (task.archivedAt || CLOSED_STATUSES.includes(task.status)) return { ok: false, message: 'Finished tasks cannot change their workflow steps.' };
  const history = task.workflowPhaseHistory || [];
  const latest = history.filter(entry => entry.phaseId === phase.id).at(-1)?.action;
  if (latest === 'completed' || latest === 'skipped') return { ok: false, message: `"${phase.name}" has already been passed. Its history must be preserved.` };
  if (!omit) {
    if (phase.disabled) return { ok: false, message: `"${phase.name}" is disabled in this task’s saved workflow.` };
    const downstream = task.workflowSnapshot ? getWorkflowDownstreamIds(task.workflowSnapshot, phase.id) : new Set<string>();
    downstream.delete(phase.id);
    if ((task.workflowActivePhaseIds || []).some(id => downstream.has(id))
      || history.some(entry => downstream.has(entry.phaseId) && ['completed', 'approved', 'skipped'].includes(entry.action))) {
      return { ok: false, message: `"${phase.name}" cannot be restored after its route has passed it.` };
    }
  }
  return { ok: true };
}

function validateRetainedPhaseOwner(task: Task, phase: WorkflowPhaseDefinition, settings: AppSettings, users: User[]): WorkflowAssignmentResult {
  if (isVoiceOverPhase(phase) || hasVoiceOverProviderSelection(task, phase)) {
    const voice = validateVoiceOverAssignment(task, phase, users);
    if (!voice.ok) return voice;
  }
  const owners = uniqueIds(resolveWorkflowPhaseOwnerIds(phase, task, settings, users)).filter(id => users.some(user => user.id === id && id !== 'guest'));
  if (!owners.length) return { ok: false, message: `Select an accountable member for "${phase.name}" before including it in this route.` };
  if (isMandatoryFinalReview(phase) && owners.some(id => users.find(user => user.id === id)?.role !== 'art_director')) return { ok: false, message: `"${phase.name}" requires an Art Director as its assigned approver.` };
  const count = phase.requiredApprovals;
  if (count != null && (!Number.isInteger(count) || count < 1 || count > owners.length)) return { ok: false, message: `"${phase.name}" needs a valid approval count matching its assigned members.` };
  return { ok: true };
}

/** Validate the submitted IDs before sanitizing, so crafted Final Rev omissions fail visibly. */
export function validateWorkflowOmissionSelection(task: Task, skippedIds: string[], actor: User, settings: AppSettings, users: User[], prior?: Task): WorkflowAssignmentResult {
  const workflow = task.workflowSnapshot;
  if (!workflow) return skippedIds.length ? { ok: false, message: 'Select a workflow before removing steps.' } : { ok: true };
  const oldIds = new Set(prior?.workflowSkippedPhaseIds || []);
  const nextIds = new Set(skippedIds);
  for (const id of nextIds) {
    const phase = workflow.phases.find(phase => phase.id === id);
    if (!phase || !canSkipWorkflowPhase(phase)) return { ok: false, message: phase ? 'Final Rev. by the Art Director cannot be removed.' : 'The removed step does not belong to this workflow.' };
  }
  const changed = [...new Set([...oldIds, ...nextIds])].filter(id => oldIds.has(id) !== nextIds.has(id));
  if (!changed.length) return { ok: true };
  const manager = canManageWorkflowOmissions(actor, settings, prior, users);
  for (const id of changed) {
    const phase = workflow.phases.find(phase => phase.id === id);
    if (!phase) return { ok: false, message: 'The changed step does not belong to this saved workflow.' };
    if (!manager && (prior || !isContentReviewPhase(phase))) return { ok: false, message: 'Only workflow managers can remove or restore task steps.' };
    if (prior) {
      const allowed = canChangeWorkflowPhaseOmission(prior, phase, nextIds.has(id));
      if (!allowed.ok) return allowed;
      if (!nextIds.has(id)) {
        const owner = validateRetainedPhaseOwner(task, phase, settings, users);
        if (!owner.ok) return owner;
      }
    }
  }
  return { ok: true };
}

/** Omission mutates only this task. The saved graph and all audit entries remain intact. */
export function reconcileWorkflowOmissions(prior: Task, candidate: Task, actor: User, settings: AppSettings, users: User[], now = new Date()): WorkflowAssignmentResult & { task?: Task } {
  const ids = uniqueIds(candidate.workflowSkippedPhaseIds || []);
  const validation = validateWorkflowOmissionSelection(candidate, ids, actor, settings, users, prior);
  if (!validation.ok) return validation;
  const workflow = prior.workflowSnapshot;
  if (!workflow) return { ok: true, task: candidate };
  const beforeIds = uniqueIds(prior.workflowSkippedPhaseIds || []);
  if (beforeIds.length === ids.length && beforeIds.every(id => ids.includes(id))) return { ok: true, task: candidate };
  let updated = { ...candidate, workflowSkippedPhaseIds: ids, workflowPhaseHistory: prior.workflowPhaseHistory,
    workflowActivePhaseIds: prior.workflowActivePhaseIds, workflowCurrentPhaseId: prior.workflowCurrentPhaseId,
    workflowCurrentPhaseIndex: prior.workflowCurrentPhaseIndex, workflowPhaseApprovals: prior.workflowPhaseApprovals,
    workflowPhaseAvailableAtByPhaseId: prior.workflowPhaseAvailableAtByPhaseId, workflowPhaseAvailableAt: prior.workflowPhaseAvailableAt,
    workflowPendingHandoffPhaseIds: prior.workflowPendingHandoffPhaseIds, status: prior.status, updatedAt: now.toISOString() };
  const content = workflow.phases.filter(isContentReviewPhase);
  if (content.some(phase => beforeIds.includes(phase.id) !== ids.includes(phase.id))) updated.needsContentRevision = content.some(phase => !ids.includes(phase.id) && !phase.disabled);
  const activeBefore = prior.workflowActivePhaseIds ?? (prior.workflowCurrentPhaseId ? [prior.workflowCurrentPhaseId] : []);
  const removed = activeBefore.filter(id => ids.includes(id));
  if (!removed.length) return { ok: true, task: updated };
  const result = computeWorkflowOmissions(workflow, { ...candidate, workflowPhaseHistory: prior.workflowPhaseHistory, workflowActivePhaseIds: activeBefore }, ids, actor.id, now.toISOString());
  if (result.blockedReason) return { ok: false, message: result.blockedReason };
  const active = result.nextActivePhaseIds;
  const newlyActive = active.filter(id => !activeBefore.includes(id));
  for (const id of newlyActive) {
    const owner = validateRetainedPhaseOwner(updated, workflow.phases.find(phase => phase.id === id)!, settings, users);
    if (!owner.ok) return owner;
  }
  const delay = splitHandoffsByDelay(workflow, newlyActive, settings, now.toISOString());
  const availability = Object.fromEntries(Object.entries(prior.workflowPhaseAvailableAtByPhaseId || {}).filter(([id]) => active.includes(id)));
  // Preserve the legacy delay for an unaffected parallel branch.
  if (!Object.keys(prior.workflowPhaseAvailableAtByPhaseId || {}).length && prior.workflowPhaseAvailableAt) active.filter(id => activeBefore.includes(id)).forEach(id => { availability[id] = prior.workflowPhaseAvailableAt!; });
  Object.assign(availability, delay.availableAtByPhaseId);
  const phases = active.map(id => workflow.phases.find(phase => phase.id === id)!).filter(Boolean);
  const ready = phases.filter(phase => !availability[phase.id] || new Date(availability[phase.id]) <= now);
  const primary = ready[0] || phases[0];
  const approvals = Object.fromEntries(Object.entries(prior.workflowPhaseApprovals || {}).filter(([id]) => !removed.includes(id)));
  updated = { ...updated, workflowActivePhaseIds: active, workflowCurrentPhaseId: primary?.id || null,
    workflowCurrentPhaseIndex: primary ? workflow.phases.findIndex(phase => phase.id === primary.id) : null,
    workflowPhaseApprovals: approvals, workflowPhaseHistory: appendStartedEntries(result.history, phases, actor.id),
    workflowPhaseAvailableAtByPhaseId: availability,
    workflowPhaseAvailableAt: ready.length ? null : Object.values(availability).sort()[0] || null,
    workflowPendingHandoffPhaseIds: uniqueIds([...(prior.workflowPendingHandoffPhaseIds || []).filter(id => active.includes(id)),
      ...(prior.status === 'on_hold' || RETURNED_STATUSES.includes(prior.status) ? newlyActive : delay.delayedPhaseIds)]),
    status: result.finished ? 'approved_by_art_director' : getStatusForWorkflowPhase(primary),
    reviewMode: primary ? getReviewModeForWorkflowPhase(primary) : candidate.reviewMode,
    currentOwnerRole: primary ? getPhaseOwnerRole(primary) : 'art_director', currentOwnerUserId: null, currentOwnerUserIds: [] };
  const owners = uniqueIds(ready.flatMap(phase => getPhaseAssignableOwnerIds(updated, phase, settings, users, approvals[phase.id] || [], now)));
  updated.currentOwnerUserIds = owners;
  updated.currentOwnerUserId = owners[0] || null;
  const pendingRevision = RETURNED_STATUSES.includes(prior.status) || (prior.status === 'on_hold' && prior.previousStatusBeforeHold && RETURNED_STATUSES.includes(prior.previousStatusBeforeHold));
  if (pendingRevision) {
    updated.currentOwnerRole = prior.currentOwnerRole;
    updated.currentOwnerUserIds = prior.currentOwnerUserIds;
    updated.currentOwnerUserId = prior.currentOwnerUserId;
    updated.status = prior.status;
  }
  if (prior.status === 'on_hold') {
    updated.previousStatusBeforeHold = pendingRevision ? prior.previousStatusBeforeHold : updated.status;
    updated.status = 'on_hold';
  }
  if (RETURNED_STATUSES.includes(prior.status)) updated.status = prior.status;
  if (prior.activeWorkBy && prior.activeWorkStartedAt && !prior.activeWorkFinishedAt
    && removed.some(id => { const phase = workflow.phases.find(phase => phase.id === id)!; return resolveWorkflowPhaseOwnerIds(phase, prior, settings, users).includes(prior.activeWorkBy!); })
    && !activeBefore.filter(id => !removed.includes(id)).some(id => {
      const phase = workflow.phases.find(phase => phase.id === id);
      return phase && resolveWorkflowPhaseOwnerIds(phase, prior, settings, users).includes(prior.activeWorkBy!);
    })) updated.activeWorkFinishedAt = now.toISOString();
  return { ok: true, task: updated };
}
