import type { WorkflowDefinition, WorkflowPhaseDefinition } from './types';
import { normalizeReviewPhase } from './reviewPolicy';

export const WORKFLOW_ROOT_ID = 'workflow-root';
export const WORKFLOW_UNLINKED_ID = '__unlinked__';
export const isWorkflowStep = (phase: WorkflowPhaseDefinition) => (phase.nodeType || 'step') === 'step';

export function getWorkflowParentIds(phase: WorkflowPhaseDefinition): string[] {
  return phase.parentPhaseIds?.length ? phase.parentPhaseIds : phase.parentPhaseId ? [phase.parentPhaseId] : [];
}

export function workflowHasExplicitEdges(workflow: WorkflowDefinition): boolean {
  return workflow.phases.some(phase => isWorkflowStep(phase) && (getWorkflowParentIds(phase).length > 0 || Boolean(phase.passToPhaseId)));
}

/** A pass target replaces ordinary outgoing edges; target joins still require every parent. */
export function getWorkflowSuccessors(workflow: WorkflowDefinition, parentId: string): WorkflowPhaseDefinition[] {
  const parent = workflow.phases.find(phase => phase.id === parentId);
  if (!parent) return [];
  if (parent.passToPhaseId) return workflow.phases.filter(phase => phase.id === parent.passToPhaseId && isWorkflowStep(phase));
  if (workflowHasExplicitEdges(workflow)) return workflow.phases.filter(phase => isWorkflowStep(phase) && getWorkflowParentIds(phase).includes(parentId));
  const next = workflow.phases.slice(workflow.phases.indexOf(parent) + 1).find(isWorkflowStep);
  return next ? [next] : [];
}

/** Saved legacy graphs retain their single implicit entry and array fallback. */
export function getWorkflowEntryPhases(workflow: WorkflowDefinition): WorkflowPhaseDefinition[] {
  const phases = workflow.phases.filter(isWorkflowStep);
  if (workflow.phases.some(phase => getWorkflowParentIds(phase).includes(WORKFLOW_ROOT_ID))) {
    return phases.filter(phase => getWorkflowParentIds(phase).includes(WORKFLOW_ROOT_ID));
  }
  if (!workflowHasExplicitEdges(workflow)) return phases.slice(0, 1);
  return phases.filter(phase => getWorkflowParentIds(phase).length === 0
    && !phases.some(other => other.passToPhaseId === phase.id)
    && getWorkflowSuccessors(workflow, phase.id).length > 0).slice(0, 1);
}

export function getWorkflowDownstreamIds(workflow: WorkflowDefinition, sourceId: string): Set<string> {
  const visited = new Set<string>();
  const queue = [sourceId];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    getWorkflowSuccessors(workflow, id).forEach(next => queue.push(next.id));
  }
  return visited;
}

export interface WorkflowGraphIssue { code: string; message: string; phaseId?: string }
export interface WorkflowGraphValidation { valid: boolean; issues: WorkflowGraphIssue[]; entryPhaseIds: string[] }

/** Compare execution, not canvas coordinates or optional JSON serialization defaults. */
export function getWorkflowExecutionDefinition(workflow: WorkflowDefinition) {
  return { id: workflow.id, phases: workflow.phases.filter(isWorkflowStep).map(phase => {
    const normalized = normalizeReviewPhase(phase);
    return { id: phase.id, name: phase.name, phaseKind: normalized.phaseKind, mode: phase.mode || 'parallel',
      userIds: phase.userIds || [], roleIds: phase.roleIds || [], responsibilityIds: phase.responsibilityIds || [],
      parentIds: getWorkflowParentIds(phase), passToPhaseId: phase.passToPhaseId || null,
      failToPhaseId: phase.failToPhaseId || null, returnToPhaseId: phase.returnToPhaseId || null,
      disabled: Boolean(phase.disabled), skipRule: phase.skipRule || 'none', requiredApprovals: phase.requiredApprovals ?? null,
      delayDays: phase.delayDays ?? null, maxRevisionRounds: phase.maxRevisionRounds ?? null,
      isReviewDecision: Boolean(phase.isReviewDecision), instructions: phase.instructions || '', deliverables: phase.deliverables || [],
    };
  }) };
}

/** Validate assignment, not draft persistence. Fail/return links are intentional revision loops. */
export function validateWorkflowGraph(workflow: WorkflowDefinition): WorkflowGraphValidation {
  const issues: WorkflowGraphIssue[] = [];
  const add = (code: string, message: string, phaseId?: string) => {
    if (!issues.some(issue => issue.code === code && issue.phaseId === phaseId)) issues.push({ code, message, phaseId });
  };
  const steps = workflow.phases.filter(isWorkflowStep);
  const byId = new Map(workflow.phases.map(phase => [phase.id, phase]));
  const seenIds = new Set<string>();
  for (const phase of workflow.phases) {
    if (!phase.id || seenIds.has(phase.id) || phase.id === WORKFLOW_ROOT_ID || phase.id === WORKFLOW_UNLINKED_ID) add('duplicate_id', `Give "${phase.name}" a unique step ID.`, phase.id);
    seenIds.add(phase.id);
    if (!isWorkflowStep(phase)) continue;
    for (const parentId of getWorkflowParentIds(phase)) {
      if (parentId === WORKFLOW_ROOT_ID) continue;
      if (parentId === WORKFLOW_UNLINKED_ID) add('unlinked_step', `Connect "${phase.name}" to the workflow before assigning it.`, phase.id);
      else if (!byId.has(parentId) || !isWorkflowStep(byId.get(parentId)!)) add('invalid_parent', `"${phase.name}" has a missing or non-step parent. Reconnect it.`, phase.id);
    }
    for (const key of ['passToPhaseId', 'failToPhaseId', 'returnToPhaseId'] as const) {
      const target = phase[key];
      if (target && (!byId.has(target) || !isWorkflowStep(byId.get(target)!))) add('invalid_target', `"${phase.name}" has a missing or non-step ${key === 'passToPhaseId' ? 'continue' : 'return'} target.`, phase.id);
      else if (target && key !== 'passToPhaseId' && !getWorkflowDownstreamIds(workflow, target).has(phase.id)) {
        add('invalid_return', `"${phase.name}" must return to itself or an earlier step on its own route.`, phase.id);
      }
    }
  }
  if (!steps.length) add('empty_workflow', 'Add work and Final Rev. steps before assigning this workflow.');
  const entries = getWorkflowEntryPhases(workflow);
  if (steps.length && !entries.length) add('missing_entry', 'Connect an initial step to the workflow root.');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (phase: WorkflowPhaseDefinition) => {
    if (visiting.has(phase.id)) { add('forward_cycle', `The continue route loops at "${phase.name}". Use a return link for revisions.`, phase.id); return; }
    if (visited.has(phase.id)) return;
    visiting.add(phase.id);
    getWorkflowSuccessors(workflow, phase.id).forEach(visit);
    visiting.delete(phase.id);
    visited.add(phase.id);
  };
  steps.forEach(visit);
  // Simulate successful completion with the runtime's actual entry, pass and
  // all-parent join rules. Plain graph reachability would miss blocked joins.
  const completed = new Set<string>();
  const candidates = new Set(entries.map(phase => phase.id));
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const phase of steps) {
      if (!candidates.has(phase.id) || completed.has(phase.id)) continue;
      if (!getWorkflowParentIds(phase).every(id => id === WORKFLOW_ROOT_ID || completed.has(id))) continue;
      completed.add(phase.id);
      getWorkflowSuccessors(workflow, phase.id).forEach(next => candidates.add(next.id));
      progressed = true;
    }
  }
  const finalIds = new Set(steps.filter(phase => {
    const normalized = normalizeReviewPhase(phase);
    return normalized.phaseKind !== 'work' && (normalized.phaseKind === 'final_review' || normalized.roleIds?.includes('art_director'));
  }).map(phase => phase.id));
  if (!finalIds.size) add('missing_final', 'Add mandatory Final Rev. by the Art Director before assigning this workflow.');
  for (const phase of steps.filter(phase => finalIds.has(phase.id))) {
    if (phase.disabled) add('disabled_final', `"${phase.name}" is mandatory and cannot be disabled.`, phase.id);
    if (phase.requiredApprovals != null && phase.requiredApprovals !== 1) add('invalid_final_count', `"${phase.name}" requires exactly one fixed Art Director approval.`, phase.id);
  }
  for (const phase of steps) {
    if (!completed.has(phase.id)) add(finalIds.has(phase.id) ? 'unreachable_final' : 'unreachable_step', `"${phase.name}" cannot run from the current connections. Check its parents and continue targets.`, phase.id);
  }
  // Every forward terminal must follow Final Rev.; a separate dead-end branch
  // must not silently finish outside the approval route.
  const afterFinal = new Set<string>();
  const queue = [...finalIds];
  while (queue.length) {
    const id = queue.shift()!;
    if (afterFinal.has(id)) continue;
    afterFinal.add(id);
    getWorkflowSuccessors(workflow, id).forEach(next => queue.push(next.id));
  }
  for (const phase of steps) {
    if (completed.has(phase.id) && !getWorkflowSuccessors(workflow, phase.id).length && !finalIds.has(phase.id)) {
      add(afterFinal.has(phase.id) ? 'work_after_final' : 'dead_end', `"${phase.name}" must continue to mandatory Final Rev. before the workflow can finish.`, phase.id);
    }
  }
  return { valid: issues.length === 0, issues, entryPhaseIds: entries.map(phase => phase.id) };
}
