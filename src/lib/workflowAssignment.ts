import type { AppSettings, Task, User, WorkflowDefinition } from './types.js';
import { findWorkflowTaskTypeCollisions, getTaskTypeConfigs, normalizeWorkflowTaskTypeId } from './appSettings.js';
import { getWorkflowExecutionDefinition, validateWorkflowGraph } from './workflowGraph.js';
import { isMandatoryFinalReview, resolveWorkflowPhaseOwnerIds } from './workflowUtils.js';
import { normalizeReviewPhase } from './reviewPolicy.js';
import { resolveFixedArtDirector, resolveTaskFinalArtDirector } from './finalApprovalPolicy.js';
import { getVoiceOverDeliveryOwnerId, hasVoiceOverProviderSelection, isVoiceOverPhase, validateVoiceOverAssignment, validateVoiceOverTaskChanges } from './voiceOverPolicy.js';

export type WorkflowAssignmentResult = { ok: boolean; message?: string };

type AssignmentOwnerFields = Pick<Task, 'id' | 'createdBy' | 'handledBy' | 'versions' | 'assignmentLinks' | 'contentRevisionAssigneeIds' | 'workflowNodeAssigneeIds' | 'workflowNodeAIAssigneeIds' | 'workflowNodeVoiceOverDeliveryOwnerIds' | 'workflowFinalApproverIdsByPhaseId' | 'workflowSnapshot' | 'workflowSkippedPhaseIds' | 'needsContentRevision'>;

/** Explicit creation input becomes durable step ownership; runtime fallback remains strict. */
export function prepareWorkflowAssignmentOwners(
  workflow: WorkflowDefinition,
  task: AssignmentOwnerFields,
  settings: AppSettings,
  users: User[],
  fallbackWorkOwnerIds?: string[],
  priorTask?: AssignmentOwnerFields,
): WorkflowAssignmentResult & { workflowNodeAssigneeIds?: Record<string, string[]>; workflowNodeVoiceOverDeliveryOwnerIds?: Record<string, string>; workflowFinalApproverIdsByPhaseId?: Record<string, string> } {
  const activeUsers = users.filter(user => user.id !== 'guest');
  const voiceOverValidation = validateVoiceOverTaskChanges(undefined, { ...task, workflowSnapshot: workflow }, activeUsers);
  if (!voiceOverValidation.ok) return voiceOverValidation;
  const validIds = new Set(activeUsers.map(user => user.id));
  const nodeOwners = { ...task.workflowNodeAssigneeIds };
  const deliveryOwners = { ...task.workflowNodeVoiceOverDeliveryOwnerIds };
  const fallback = [...new Set(fallbackWorkOwnerIds || [])].filter(id => validIds.has(id));
  // Only a separately supplied canonical prestate can preserve an assignment.
  // Fresh incoming fields never select the fixed final approver.
  const existing = priorTask?.workflowSnapshot && JSON.stringify(getWorkflowExecutionDefinition(priorTask.workflowSnapshot)) === JSON.stringify(getWorkflowExecutionDefinition(workflow)) ? priorTask : undefined;
  const frozenMap: Record<string, string> = {};
  const prepared = { ...task, workflowNodeAssigneeIds: nodeOwners, workflowNodeVoiceOverDeliveryOwnerIds: deliveryOwners, workflowFinalApproverIdsByPhaseId: frozenMap };
  for (const phase of workflow.phases) {
    // Conditional rules may change after another upload. Only durable per-task
    // omissions and disabled nonfinal nodes can waive an owner at creation.
    if ((phase.nodeType || 'step') !== 'step' || (!isMandatoryFinalReview(phase)
      && (phase.disabled || task.workflowSkippedPhaseIds?.includes(phase.id)))) continue;
    if (isMandatoryFinalReview(phase)) {
      const fixed = existing ? resolveTaskFinalArtDirector(phase, existing, settings, activeUsers) : resolveFixedArtDirector(phase, settings, activeUsers);
      if (!fixed.ok) return { ok: false, message: fixed.message };
      const ownerId = fixed.ownerId!;
      frozenMap[phase.id] = ownerId;
      nodeOwners[phase.id] = [ownerId];
    }
    if (isVoiceOverPhase(phase) || hasVoiceOverProviderSelection(prepared, phase)) {
      const voiceOver = validateVoiceOverAssignment(prepared, phase, activeUsers);
      if (!voiceOver.ok) return voiceOver;
      deliveryOwners[phase.id] = getVoiceOverDeliveryOwnerId(prepared, phase, activeUsers)!;
    }
    if (fallbackWorkOwnerIds && normalizeReviewPhase(phase).phaseKind === 'work'
      && !Object.prototype.hasOwnProperty.call(nodeOwners, phase.id)
      && !phase.userIds?.length && !phase.roleIds?.length && !phase.responsibilityIds?.length) nodeOwners[phase.id] = [...fallback];
    const owners = [...new Set(resolveWorkflowPhaseOwnerIds(phase, prepared, settings, activeUsers))].filter(id => validIds.has(id));
    if (!owners.length) return { ok: false, message: `Select an accountable member for "${phase.name}" before assigning this workflow.` };
    if (isMandatoryFinalReview(phase) && owners.some(id => activeUsers.find(user => user.id === id)?.role !== 'art_director')) {
      return { ok: false, message: `"${phase.name}" requires an Art Director as its assigned approver.` };
    }
    const count = phase.requiredApprovals ?? (isMandatoryFinalReview(phase) ? 1 : undefined);
    if (count != null && (!Number.isFinite(count) || !Number.isInteger(count) || count < 1 || count > owners.length)) {
      return { ok: false, message: `"${phase.name}" needs an approval count from 1 to ${owners.length}, matching its distinct assigned members.` };
    }
  }
  return { ok: true, workflowNodeAssigneeIds: nodeOwners, workflowNodeVoiceOverDeliveryOwnerIds: deliveryOwners, workflowFinalApproverIdsByPhaseId: frozenMap };
}

/** Resolve current canonical settings only at a new-assignment boundary. */
export function resolveWorkflowAssignment(settings: AppSettings, taskType: string, workflowId?: string | null): WorkflowAssignmentResult & { workflow?: WorkflowDefinition; taskType?: string } {
  const type = normalizeWorkflowTaskTypeId(taskType);
  const config = getTaskTypeConfigs(settings).find(item => item.id === type);
  const active = (settings.workflows || []).filter(item => item.active !== false && !(settings.deletedWorkflowIds || []).includes(item.id));
  const collision = findWorkflowTaskTypeCollisions(active).find(item => item.taskTypeId === type);
  if (collision) return { ok: false, message: `Task type "${type}" belongs to more than one workflow. Give each workflow a unique task type before assigning it.` };
  const workflow = active.find(item => item.id === config?.workflowId);
  if (!workflow || (workflowId && workflow.id !== workflowId)) return { ok: false, message: 'The selected task type no longer belongs to this active workflow. Select it again.' };
  const validation = validateWorkflowGraph(workflow);
  if (!validation.valid) return { ok: false, message: validation.issues.map(issue => issue.message).join(' ') };
  return { ok: true, workflow, taskType: type };
}
