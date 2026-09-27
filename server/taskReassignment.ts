import type { AppSettings, Task, User } from '../src/lib/types';
import { canReassignWorkflowTask } from '../src/lib/workAssignmentUtils';
import { getCompletedPhaseIdsFromHistory } from '../src/lib/workflowRuntime';
import { isMandatoryFinalReview, resolveWorkflowPhaseOwnerIds } from '../src/lib/workflowUtils';
import { canStartTaskWork, reconcileWorkSessions } from '../src/lib/workSessions';
import { ReportAccessError } from './reportAccess';

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function validateTaskReassignment(prior: Task | undefined, task: Task, actor: User, settings: AppSettings, users: User[]) {
  if (!prior) {
    if (task.workSessions?.length) throw new ReportAccessError('A new assignment cannot invent prior work sessions.');
    return task;
  }
  const keys = ['workflowNodeAssigneeIds', 'workflowNodeAIAssigneeIds', 'workflowNodeVoiceOverDeliveryOwnerIds', 'handledBy', 'contentRevisionAssigneeIds'] as const;
  const normalizeOwners = (task: Task, key: typeof keys[number]) => key === 'handledBy' || key === 'contentRevisionAssigneeIds'
    ? [...new Set(task[key] || [])].sort()
    : Object.fromEntries(Object.entries(task[key] || {}).sort(([a], [b]) => a.localeCompare(b)));
  const changed = keys.some(key => !same(normalizeOwners(prior, key), normalizeOwners(task, key)));
  const ownerFieldsChanged = !same(prior.currentOwnerUserIds, task.currentOwnerUserIds) || !same(prior.currentOwnerUserId, task.currentOwnerUserId);
  const sameRoute = prior.status === task.status && same(prior.workflowActivePhaseIds, task.workflowActivePhaseIds) && same(prior.workflowPhaseApprovals, task.workflowPhaseApprovals);
  if ((changed || (sameRoute && ownerFieldsChanged)) && !canReassignWorkflowTask(actor)) throw new ReportAccessError('Only leadership can reassign workflow owners.');
  if (changed && prior.workflowSnapshot && task.workflowId === prior.workflowId) {
    const completed = getCompletedPhaseIdsFromHistory(prior.workflowPhaseHistory || []);
    for (const phase of prior.workflowSnapshot.phases) {
      const previous = resolveWorkflowPhaseOwnerIds(phase, prior, settings, users);
      const next = resolveWorkflowPhaseOwnerIds(phase, task, settings, users);
      if (same(previous, next)) continue;
      if (isMandatoryFinalReview(phase) || completed.has(phase.id) || ['completed','archived','approved_by_art_director'].includes(prior.status)) throw new ReportAccessError('Only active or future non-final steps can be reassigned.');
      if (!next.length || next.length < (phase.requiredApprovals || 1)) throw new ReportAccessError('The reassigned step needs enough eligible owners for its required approvals.');
    }
  }
  const started = task.activeWorkBy && task.activeWorkStartedAt && (task.activeWorkBy !== prior.activeWorkBy || task.activeWorkStartedAt !== prior.activeWorkStartedAt);
  if (started && (task.activeWorkBy !== actor.id || !canStartTaskWork(prior, actor.id, settings, users))) throw new ReportAccessError('Only the current owner can start their own work session.');
  const finished = task.activeWorkFinishedAt && task.activeWorkFinishedAt !== prior.activeWorkFinishedAt;
  if (finished && task.activeWorkFinishedById && task.activeWorkFinishedById !== actor.id && !changed) throw new ReportAccessError('Another member’s work cannot be marked finished.');
  const canonical = reconcileWorkSessions(prior, task, settings, users);
  // Preserve canonical history; accept only this actor's explicit finish of an open session.
  if (task.workSessions && !same(task.workSessions, prior.workSessions || [])) {
    for (const supplied of task.workSessions) {
      const expected = canonical.workSessions!.find(session => session.id === supplied.id);
      if (!expected) throw new ReportAccessError('Work sessions cannot be invented.');
      if (same(supplied, expected)) continue;
      const old = prior.workSessions?.find(session => session.id === supplied.id);
      if (!old || old.finishedAt || supplied.userId !== actor.id || !supplied.finishedAt
        || !Number.isFinite(Date.parse(supplied.finishedAt)) || Date.parse(supplied.finishedAt) < Date.parse(old.startedAt)
        || !same({...supplied,finishedAt:null,endReason:undefined}, {...old,finishedAt:null,endReason:undefined})) {
        throw new ReportAccessError('Work history cannot be rewritten or impersonated.');
      }
      Object.assign(expected, { finishedAt: supplied.finishedAt, endReason: 'finished' });
    }
  }
  return canonical;
}
