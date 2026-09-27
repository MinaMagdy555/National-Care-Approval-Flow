import type { AppSettings, DeletedMember, MemberDeletionResult, Task, User, WorkflowPhaseDefinition } from './types.js';
import { isLeaderboardUser } from './workAssignmentUtils.js';
import { CLOSED_STATUSES, RETURNED_STATUSES, isWorkflowPhaseSkippedForTask, getCurrentOwnerUserIds, resolveWorkflowPhaseOwnerIds } from './workflowUtils.js';
import { getCompletedPhaseIdsFromHistory, getPhaseParentIds, workflowHasExplicitEdges } from './workflowRuntime.js';
import { isMemberDeleted, memberDeletionIdentities } from './memberIdentity.js';
import { getVoiceOverDeliveryOwnerId, hasVoiceOverProviderSelection } from './voiceOverPolicy.js';

export function canRemoveMember(actor: Pick<User, 'id' | 'role' | 'isAdmin'>): boolean {
  return actor.id !== 'guest' && Boolean(actor.isAdmin || actor.role === 'admin' || isLeaderboardUser(actor.id));
}

function pendingPhases(task: Task): WorkflowPhaseDefinition[] {
  const workflow = task.workflowSnapshot;
  if (!workflow) return [];
  const completed = getCompletedPhaseIdsFromHistory(task.workflowPhaseHistory || []);
  const activeIds = task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
  const visited = new Set<string>();
  const queue = activeIds.length ? [...activeIds] : workflow.phases.filter(phase => getPhaseParentIds(phase).includes('workflow-root')).map(phase => phase.id);
  // Legacy tasks without an active-phase pointer still have a pending array position.
  if (!queue.length) queue.push(...workflow.phases.slice(task.workflowCurrentPhaseIndex ?? 0, (task.workflowCurrentPhaseIndex ?? 0) + 1).map(phase => phase.id));
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const phase = workflow.phases.find(item => item.id === id);
    if (!phase) continue;
    if (phase.passToPhaseId) queue.push(phase.passToPhaseId);
    else if (workflowHasExplicitEdges(workflow)) queue.push(...workflow.phases.filter(item => getPhaseParentIds(item).includes(id)).map(item => item.id));
    else queue.push(...workflow.phases.slice(workflow.phases.indexOf(phase) + 1, workflow.phases.indexOf(phase) + 2).map(item => item.id));
  }
  return workflow.phases.filter(phase => visited.has(phase.id) && (phase.nodeType || 'step') === 'step'
    && (!completed.has(phase.id) || activeIds.includes(phase.id))
    && !isWorkflowPhaseSkippedForTask(phase, task));
}

export function findMemberDeletionBlockers(tasks: Task[], identities: DeletedMember[], settings: AppSettings, roster: User[]): NonNullable<MemberDeletionResult['blockingTasks']> {
  const ids = new Set(identities.map(record => record.id));
  const blocks: NonNullable<MemberDeletionResult['blockingTasks']> = [];
  const add = (task: Task, phaseName: string) => {
    if (!blocks.some(item => item.taskId === task.id && item.phaseName === phaseName)) blocks.push({ taskId: task.id, taskCode: task.code || task.id, phaseName });
  };
  for (const task of tasks) {
    if (task.archivedAt || task.environment === 'archived' || CLOSED_STATUSES.includes(task.status)) continue;
    if (task.workSessions?.some(session => ids.has(session.userId) && !session.finishedAt) || (task.activeWorkBy && !task.activeWorkFinishedAt && ids.has(task.activeWorkBy))) add(task, 'Active work');
    if (RETURNED_STATUSES.includes(task.status) && getCurrentOwnerUserIds(task).some(id => ids.has(id))) add(task, 'Revised upload');
    const phases = pendingPhases(task);
    for (const phase of phases) {
      const owners = resolveWorkflowPhaseOwnerIds(phase, task, settings, roster);
      const approved = task.workflowPhaseApprovals?.[phase.id] || [];
      const explicit = task.workflowNodeAssigneeIds?.[phase.id] ?? phase.userIds ?? [];
      const aiId = explicit.includes('voice_over_ai') ? task.workflowNodeAIAssigneeIds?.[phase.id] : undefined;
      const deliveryId = hasVoiceOverProviderSelection(task, phase) ? getVoiceOverDeliveryOwnerId(task, phase, roster)
        || task.workflowNodeVoiceOverDeliveryOwnerIds?.[phase.id] || aiId : undefined;
      const deletedOwners = new Set([...owners, ...explicit, ...(deliveryId ? [deliveryId] : [])].filter(id => ids.has(id)));
      if (!deletedOwners.size) continue;
      const required = phase.requiredApprovals && phase.requiredApprovals > 0 ? phase.requiredApprovals : owners.length || 1;
      // An approval already given remains in the audit, but runtime counts current eligible
      // owners. Block removal when it would make the outstanding phase impossible to finish.
      const remainingOwners = owners.filter(id => !ids.has(id));
      if ([...deletedOwners].some(id => !approved.includes(id)) || remainingOwners.length < required) add(task, phase.name);
    }
    if (!task.workflowSnapshot && [
      ...getCurrentOwnerUserIds(task), ...(task.handledBy || []), ...(task.contentRevisionAssigneeIds || []),
    ].some(id => ids.has(id))) add(task, 'Assigned work');
  }
  return blocks;
}

export function prepareMemberDeletion(actor: User, target: User, roster: User[], tasks: Task[], settings: AppSettings, now = new Date().toISOString()): MemberDeletionResult & { deletedMembers?: DeletedMember[] } {
  if (!canRemoveMember(actor) || isMemberDeleted(actor, settings.deletedMembers)) return { ok: false, message: 'Only an admin or leaderboard member can remove members.' };
  const records = memberDeletionIdentities(target, roster, actor.id, now);
  if (isMemberDeleted(actor, records)) return { ok: false, message: 'You cannot remove your own membership.' };
  if (isMemberDeleted(target, settings.deletedMembers)) return { ok: true, message: 'This membership has already been removed.', deletedMembers: settings.deletedMembers };
  const blockingTasks = findMemberDeletionBlockers(tasks, records, settings, roster);
  if (blockingTasks.length) return { ok: false, message: 'Reassign this member’s unfinished workflow steps before removing their membership.', blockingTasks };
  return { ok: true, deletedMembers: records };
}
