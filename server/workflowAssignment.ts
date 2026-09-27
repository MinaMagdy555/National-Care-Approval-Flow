import type { AppSettings, Task, User } from '../src/lib/types';
import { prepareWorkflowAssignmentOwners, resolveWorkflowAssignment } from '../src/lib/workflowAssignment';
import { getWorkflowExecutionDefinition } from '../src/lib/workflowGraph';
import { ReportAccessError } from './reportAccess';
import { computeWorkflowInitialization } from '../src/lib/workflowRuntime';
import { canManageWorkflowBuilder, isMandatoryFinalReview } from '../src/lib/workflowUtils';
import { validateVoiceOverTaskChanges } from '../src/lib/voiceOverPolicy';
import { resolveFixedArtDirector, resolveTaskFinalArtDirector } from '../src/lib/finalApprovalPolicy';

export function workflowAssignmentChanged(prior: Task | undefined, task: Task): boolean {
  return !prior || prior.workflowId !== task.workflowId || JSON.stringify(prior.workflowSnapshot && getWorkflowExecutionDefinition(prior.workflowSnapshot)) !== JSON.stringify(task.workflowSnapshot && getWorkflowExecutionDefinition(task.workflowSnapshot));
}

/** Validate incoming bindings against the canonical prestate, then materialize legacy bindings. */
export function getValidatedFinalApproverMap(task: Task, prior: Task | undefined, settings: AppSettings, users: User[]): Record<string, string> {
  const replaced = workflowAssignmentChanged(prior, task);
  const result: Record<string, string> = {};
  for (const phase of task.workflowSnapshot?.phases.filter(isMandatoryFinalReview) || []) {
    const priorFrozen = !replaced ? prior?.workflowFinalApproverIdsByPhaseId?.[phase.id] : undefined;
    const fixed = !replaced && prior ? resolveTaskFinalArtDirector(phase, prior, settings, users) : resolveFixedArtDirector(phase, settings, users);
    // A historical binding may be retained while its member is unavailable;
    // runtime action authorization still requires an active actual AD.
    const expected = priorFrozen || (fixed.ok ? fixed.ownerId : undefined);
    if (!expected) throw new ReportAccessError(fixed.message || 'Final Rev. requires its fixed Art Director.');
    result[phase.id] = expected;
    const supplied = task.workflowFinalApproverIdsByPhaseId?.[phase.id];
    if ((supplied !== undefined && supplied !== expected) || (priorFrozen && supplied !== priorFrozen)) {
      throw new ReportAccessError(`"${phase.name}" is fixed to its Art Director and cannot be reassigned or cleared.`);
    }
    const oldOwners = !replaced ? prior?.workflowNodeAssigneeIds?.[phase.id] : undefined;
    const nextOwners = task.workflowNodeAssigneeIds?.[phase.id];
    const changed = JSON.stringify(oldOwners) !== JSON.stringify(nextOwners);
    if ((replaced || changed) && (nextOwners !== undefined || oldOwners !== undefined)
      && (!Array.isArray(nextOwners) || nextOwners.length !== 1 || nextOwners[0] !== expected)) {
      throw new ReportAccessError(`"${phase.name}" is fixed to its Art Director and cannot be reassigned or cleared.`);
    }
  }
  if (Object.keys(task.workflowFinalApproverIdsByPhaseId || {}).some(id => !(id in result))) {
    throw new ReportAccessError('Final approver bindings must match the saved workflow.');
  }
  return result;
}

/** Current templates govern new work; existing tasks retain their saved execution graph. */
export function validateTaskWorkflowAssignment(task: Task, prior: Task | undefined, settings: AppSettings, actor?: User, users?: User[]): void {
  if (users) {
    const voiceOver = validateVoiceOverTaskChanges(prior, task, users);
    if (!voiceOver.ok) throw new ReportAccessError(voiceOver.message || 'Invalid Voice Over assignment.');
  }
  const changedWorkflow = prior && workflowAssignmentChanged(prior, task);
  if (users) getValidatedFinalApproverMap(task, prior, settings, users);
  if (prior && !changedWorkflow) {
    return;
  }
  if (prior?.workflowSnapshot && changedWorkflow && actor && !canManageWorkflowBuilder(actor, settings)) {
    throw new ReportAccessError('Only a workflow manager can replace a task’s saved workflow.');
  }
  // Publishing-calendar records are completed legacy records, not workflow assignments.
  if (!prior?.workflowSnapshot && !prior?.workflowId && !task.workflowId && !task.workflowSnapshot && task.status === 'completed' && task.scheduledPublishAt) return;
  const selection = resolveWorkflowAssignment(settings, task.taskType, task.workflowId || task.workflowSnapshot?.id);
  if (!selection.ok || !selection.workflow) throw new ReportAccessError(selection.message || 'This workflow cannot be assigned.');
  if (!task.workflowSnapshot || JSON.stringify(getWorkflowExecutionDefinition(task.workflowSnapshot)) !== JSON.stringify(getWorkflowExecutionDefinition(selection.workflow))) {
    throw new ReportAccessError('The workflow changed before this assignment was saved. Reload its current steps and try again.');
  }
  if (users) {
    const owners = prepareWorkflowAssignmentOwners(selection.workflow, task, settings, users);
    if (!owners.ok) throw new ReportAccessError(owners.message || 'Every required step needs an accountable member.');
  }
  if (!prior) {
    const initialized = computeWorkflowInitialization(selection.workflow, task);
    const supplied = task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
    if (JSON.stringify([...supplied].sort()) !== JSON.stringify([...initialized.nextActivePhaseIds].sort())
      || Object.values(task.workflowPhaseApprovals || {}).some(ids => ids.length > 0)
      || (task.workflowPhaseHistory || []).some(entry => !['started', 'skipped'].includes(entry.action))) {
      throw new ReportAccessError('A new assignment must begin at its configured initial workflow steps.');
    }
  }
}
