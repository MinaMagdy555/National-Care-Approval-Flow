import type { AppSettings, Task, User, WorkflowDefinition, WorkflowPhaseDefinition } from './types';
import { canViewTask } from './taskPolicy';
import { CLOSED_STATUSES, RETURNED_STATUSES, getCurrentOwnerUserIds, getCurrentReviewPhaseName, isMandatoryFinalReview, isPhaseAvailable, resolveWorkflowPhaseOwnerIds } from './workflowUtils';
import { getWorkflowSuccessors, isWorkflowStep } from './workflowGraph';
import { userRoleLabels } from './mockData';

export function canSeeWorkflowRoadmap(task: Task, viewer: User, settings: AppSettings, users: User[]) {
  return canViewTask(task, viewer, settings, users);
}

export function formatUserLabel(user: User | undefined): string {
  if (!user) return 'Unavailable member';
  return `${user.jobTitle || userRoleLabels[user.role] || 'Member'} · ${user.name}`;
}

export type WorkflowRoadmapStep = {
  id: string;
  name: string;
  state: 'Finished' | 'Current' | 'Scheduled' | 'Pending' | 'On hold' | 'Returned for revisions' | 'Skipped' | 'Disabled';
  ownerIds: string[];
  isActive: boolean;
};

/** Use the runtime's forward edges, including legacy parents and explicit pass targets. */
function getSortedSteps(workflow: WorkflowDefinition): WorkflowPhaseDefinition[] {
  const steps = workflow.phases.filter(isWorkflowStep);
  const successors = new Map(steps.map(phase => [phase.id, getWorkflowSuccessors(workflow, phase.id)]));
  const degrees = new Map(steps.map(phase => [phase.id, 0]));
  successors.forEach(children => children.forEach(child => degrees.set(child.id, (degrees.get(child.id) || 0) + 1)));
  const queue = steps.filter(phase => degrees.get(phase.id) === 0);
  const sorted: WorkflowPhaseDefinition[] = [];
  while (queue.length) {
    queue.sort((a, b) => steps.indexOf(a) - steps.indexOf(b));
    const phase = queue.shift()!;
    sorted.push(phase);
    for (const child of successors.get(phase.id) || []) {
      degrees.set(child.id, degrees.get(child.id)! - 1);
      if (degrees.get(child.id) === 0) queue.push(child);
    }
  }
  // Historical malformed graphs remain inspectable; never invent their completion.
  return [...sorted, ...steps.filter(phase => !sorted.includes(phase))];
}

export function getWorkflowRoadmap(task: Task, settings: AppSettings, users: User[], now = new Date()): WorkflowRoadmapStep[] {
  const closed = CLOSED_STATUSES.includes(task.status) || Boolean(task.archivedAt);
  const returned = RETURNED_STATUSES.includes(task.status);
  if (!task.workflowSnapshot?.phases.some(isWorkflowStep)) {
    return [{ id: 'legacy', name: getCurrentReviewPhaseName(task) || 'Assigned work',
      state: closed ? 'Finished' : task.status === 'on_hold' ? 'On hold' : !isPhaseAvailable(task, now) ? 'Scheduled' : returned ? 'Returned for revisions' : 'Current',
      ownerIds: closed ? [] : getCurrentOwnerUserIds(task), isActive: !closed }];
  }
  const activeIds = task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
  const latest = new Map((task.workflowPhaseHistory || []).map(entry => [entry.phaseId, entry.action]));
  return getSortedSteps(task.workflowSnapshot).map(phase => {
    const isActive = !closed && activeIds.includes(phase.id);
    const owners = resolveWorkflowPhaseOwnerIds(phase, task, settings, users);
    const approvals = (task.workflowPhaseApprovals?.[phase.id] || []).filter(id => owners.includes(id));
    const required = isMandatoryFinalReview(phase) ? 1 : phase.requiredApprovals || owners.length || 1;
    const completed = latest.get(phase.id) === 'completed'
      || (!latest.has(phase.id) && approvals.length >= required);
    let state: WorkflowRoadmapStep['state'] = 'Pending';
    if (!isMandatoryFinalReview(phase) && phase.disabled) state = 'Disabled';
    else if (!isMandatoryFinalReview(phase) && ((task.workflowSkippedPhaseIds || []).includes(phase.id) || latest.get(phase.id) === 'skipped')) state = 'Skipped';
    else if (isActive) state = task.status === 'on_hold' ? 'On hold' : !isPhaseAvailable(task, now, phase.id) ? 'Scheduled' : returned ? 'Returned for revisions' : 'Current';
    else if (completed) state = 'Finished';
    const pending = owners.filter(id => !approvals.includes(id));
    return { id: phase.id, name: phase.name, state, isActive,
      ownerIds: closed ? [] : returned && isActive ? getCurrentOwnerUserIds(task)
        : state === 'Finished' ? approvals : isActive && phase.mode === 'sequential' ? pending.slice(0, 1) : pending };
  });
}
