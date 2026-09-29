import type { AppSettings, Task, User, WorkflowDefinition, WorkflowPhaseDefinition } from './types';
import { canViewTask } from './taskPolicy';
import { CLOSED_STATUSES, RETURNED_STATUSES, getCurrentOwnerUserIds, getCurrentReviewPhaseName, isMandatoryFinalReview, isPhaseAvailable, resolveWorkflowPhaseOwnerIds } from './workflowUtils';
import { getWorkflowParentIds, getWorkflowSuccessors, isWorkflowStep } from './workflowGraph';
import { userRoleLabels } from './mockData';

export function canSeeWorkflowRoadmap(task: Task, viewer: User, settings: AppSettings, users: User[]) {
  return canViewTask(task, viewer, settings, users);
}

export function formatUserLabel(user: User | undefined): string {
  if (!user) return 'Unavailable member';
  return `${user.jobTitle || userRoleLabels[user.role] || 'Member'} · ${user.name}`;
}

export function formatGroupedOwners(ownerIds: string[], users: Record<string, User>): string {
  if (ownerIds.length === 0) return 'No member assigned';
  const groups = new Map<string, { title: string; names: string[] }>();
  for (const id of new Set(ownerIds)) {
    const user = users[id];
    const name = user?.name || 'Unavailable member';
    const title = (user?.jobTitle || (user ? userRoleLabels[user.role] : 'Member') || 'Member').trim();
    const key = title.toLocaleLowerCase().replace(/\s+/g, ' ');
    if (!groups.has(key)) groups.set(key, { title, names: [] });
    groups.get(key)!.names.push(name);
  }
  return Array.from(groups.values())
    .map(({ title, names }) => `${title} · ${names.join(', ')}`)
    .join(' | ');
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

  const steps = getSortedSteps(task.workflowSnapshot);
  const activeIds = task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
  const latest = new Map((task.workflowPhaseHistory || []).map(entry => [entry.phaseId, entry.action]));

  const predecessors = new Map<string, string[]>();
  steps.forEach(phase => {
    getWorkflowSuccessors(task.workflowSnapshot!, phase.id).forEach(child => {
      predecessors.set(child.id, [...(predecessors.get(child.id) || []), phase.id]);
    });
  });

  const explicitCompleted = new Set<string>();
  steps.forEach(phase => {
    const owners = resolveWorkflowPhaseOwnerIds(phase, task, settings, users);
    const approvals = (task.workflowPhaseApprovals?.[phase.id] || []).filter(id => owners.includes(id));
    const required = isMandatoryFinalReview(phase) ? 1 : phase.requiredApprovals || owners.length || 1;
    if (latest.get(phase.id) === 'completed' || (!latest.has(phase.id) && approvals.length >= required)) {
      explicitCompleted.add(phase.id);
    }
  });

  const provenExecuted = new Set<string>();
  const queue = [...(closed ? [] : activeIds), ...explicitCompleted];
  while (queue.length) {
    const id = queue.shift()!;
    const phase = steps.find(step => step.id === id);
    const requiredParents = phase ? getWorkflowParentIds(phase).filter(parent => steps.some(step => step.id === parent)) : [];
    const incoming = predecessors.get(id) || [];
    // Parent joins require all parents; a pass-only merge may arrive from
    // either branch, so merely reaching it does not prove both branches ran.
    const provenParents = requiredParents.length ? requiredParents : incoming.length === 1 ? incoming : [];
    for (const parentId of provenParents) {
      if (!provenExecuted.has(parentId)) {
        provenExecuted.add(parentId);
        queue.push(parentId);
      }
    }
  }

  return steps.map(phase => {
    const isActive = !closed && activeIds.includes(phase.id);
    const owners = resolveWorkflowPhaseOwnerIds(phase, task, settings, users);
    const approvals = (task.workflowPhaseApprovals?.[phase.id] || []).filter(id => owners.includes(id));

    let completed = explicitCompleted.has(phase.id);
    if (!completed && provenExecuted.has(phase.id) && !latest.has(phase.id) && !phase.disabled && approvals.length === 0 && !isActive) {
      completed = true;
    }

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
