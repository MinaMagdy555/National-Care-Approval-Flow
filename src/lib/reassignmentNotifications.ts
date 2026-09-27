import type { AppSettings, Notification, Task, User } from './types.js';
import { CLOSED_STATUSES, RETURNED_STATUSES, getPhaseAssignableOwnerIds, resolveWorkflowPhaseOwnerIds } from './workflowUtils.js';
import { hasStartedPhase } from './workSessions.js';
import { computePhaseHandoffs } from './workflowRuntime.js';
import { getDeadlineOwnerIds } from './deadlinePolicy.js';

export function getReassignmentNotifications(prior: Task, next: Task, settings: AppSettings, users: User[]): Notification[] {
  const notifications: Notification[] = [];
  if (CLOSED_STATUSES.includes(next.status)) return notifications;
  const active = prior.workflowActivePhaseIds ?? [prior.workflowCurrentPhaseId];
  for (const phase of prior.workflowSnapshot?.phases || []) {
    if (!active.includes(phase.id)) continue;
    const oldOwners = resolveWorkflowPhaseOwnerIds(phase, prior, settings, users);
    const nextOwners = resolveWorkflowPhaseOwnerIds(phase, next, settings, users);
    const removed = oldOwners.filter(id => !nextOwners.includes(id) && hasStartedPhase(prior, id, phase.id, settings, users));
    const nextActive = (next.workflowActivePhaseIds ?? [next.workflowCurrentPhaseId]).includes(phase.id);
    const added = nextActive && next.status !== 'on_hold' && !RETURNED_STATUSES.includes(next.status)
      ? getPhaseAssignableOwnerIds(next, phase, settings, users, next.workflowPhaseApprovals?.[phase.id] || []).filter(id => !oldOwners.includes(id)) : [];
    for (const [kind, ids] of [['removed', removed], ['added', added]] as const) for (const userId of ids) {
      notifications.push({ id: `reassignment:${next.id}:${phase.id}:${next.updatedAt}:${kind}:${userId}`, userId, taskId: next.id, createdAt: next.updatedAt, read: false,
        message: kind === 'removed' ? `Your work on "${next.name}" in ${phase.name} has stopped. You are no longer responsible for this step.` : `You are now responsible for "${next.name}" in ${phase.name}.` });
    }
  }
  return notifications;
}

export function getHandoffNotifications(after: Task, settings: AppSettings, users: User[], now: string, requestedPhaseIds?: string[]): Notification[] {
  const notifications: Notification[] = [];
  const workflow = after.workflowSnapshot;
  if (!workflow || after.archivedAt || CLOSED_STATUSES.includes(after.status) || after.status === 'on_hold') return notifications;
  const activeIds = after.workflowActivePhaseIds ?? (after.workflowCurrentPhaseId ? [after.workflowCurrentPhaseId] : []);
  const candidateIds = (requestedPhaseIds || activeIds).filter(id => activeIds.includes(id));
  const actionable = new Set(getDeadlineOwnerIds(after, settings, users, new Date(now)));
  const returned = RETURNED_STATUSES.includes(after.status);
  const groups = returned
    ? [{ phaseId: after.workflowCurrentPhaseId || activeIds[0], phaseName: workflow.phases.find(phase => phase.id === after.workflowCurrentPhaseId)?.name || 'revisions', ownerIds: [...actionable] }]
    : computePhaseHandoffs(workflow, after, candidateIds, settings, users, new Date(now));
  groups.forEach(group => {
    if (!group.phaseId) return;
    const visit = (after.workflowPhaseHistory || []).filter(entry => entry.phaseId === group.phaseId && entry.action === 'started').length;
    const latestAction = [...(after.workflowPhaseHistory || [])].reverse().find(entry => entry.phaseId === group.phaseId && ['started', 'approved', 'changes_requested'].includes(entry.action));
    const availableAt = after.workflowPhaseAvailableAtByPhaseId?.[group.phaseId] || after.workflowPhaseAvailableAt;
    const timestamps = [latestAction?.createdAt, availableAt, after.createdAt].filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!)) && Date.parse(value!) <= Date.parse(now));
    const createdAt = timestamps.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || now;
    group.ownerIds.filter(userId => actionable.has(userId)).forEach(userId => {
      const id = `workflow:${after.id}:${group.phaseId}:${visit}:${returned ? 'revision:' : ''}${userId}`;
      notifications.push({
        id, userId, taskId: after.id, read: false, createdAt,
        message: returned ? `Changes are requested for "${after.name}" in ${group.phaseName}. Upload the revised work to resume this step.`
          : `You are assigned to "${after.name}" in ${group.phaseName}. It is your turn to work on this task.`
      });
    });
  });

  return notifications;
}

/** Preserve read flags and reuse an assignment notice already delivered for this turn. */
export function mergeHandoffNotifications(existing: Notification[], additions: Notification[], clearedIds: string[] = []): Notification[] {
  const cleared = new Set(clearedIds);
  const notices = new Map(existing.filter(notice => !cleared.has(notice.id)).map(notice => [notice.id, notice]));
  for (const notice of additions) {
    if (cleared.has(notice.id) || notices.has(notice.id)) continue;
    if (notice.id.startsWith('workflow:')) {
      const phaseAndVisit = notice.id.slice(`workflow:${notice.taskId}:`.length, -(`:${notice.userId}`.length));
      const phaseId = phaseAndVisit.replace(/:\d+(?::revision)?$/, '');
      const alreadyAssigned = [...notices.values()].some(old => old.taskId === notice.taskId && old.userId === notice.userId
        && old.id.startsWith(`reassignment:${notice.taskId}:${phaseId}:`) && old.id.endsWith(`:added:${notice.userId}`)
        && Date.parse(old.createdAt) >= Date.parse(notice.createdAt));
      if (alreadyAssigned) continue;
    }
    notices.set(notice.id, notice);
  }
  return [...notices.values()];
}
