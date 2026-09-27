import type { AppSettings, Task, User, WorkflowPhaseDefinition } from './types';
import { isMemberDeleted } from './memberIdentity';

/** Template/snapshot configuration may select one real AD; task overrides never select the final approver. */
export function resolveFixedArtDirector(phase: WorkflowPhaseDefinition, settings: AppSettings, users: User[]): { ok: boolean; ownerId?: string; message?: string } {
  const directors = users.filter(user => user.id !== 'guest' && user.role === 'art_director' && !isMemberDeleted(user, settings.deletedMembers));
  const configured = directors.filter(user => phase.userIds?.includes(user.id));
  const settingsDirectors = directors.filter(user => settings.finalReviewerUserIds?.includes(user.id));
  const candidates = configured.length ? configured : settingsDirectors.length ? settingsDirectors : directors;
  if (candidates.length === 1) return { ok: true, ownerId: candidates[0].id };
  return { ok: false, message: candidates.length
    ? `"${phase.name}" needs one fixed Art Director. Select the intended Art Director in the workflow configuration.`
    : `"${phase.name}" needs an active member with the Art Director role before this workflow can run.` };
}

/**
 * Returns the durable task-bound final approver for a phase if one exists.
 * 1. The explicit `workflowFinalApproverIdsByPhaseId` map frozen at creation or
 *    workflow replacement always wins.
 * 2. Otherwise, a previously valid single-actual-AD entry in
 *    `workflowNodeAssigneeIds` migrates legacy tasks.
 * Incoming arbitrary overrides (multiple IDs, non-AD, missing IDs) are not
 * considered authority, so the function returns null. Callers that need a
 * runtime answer for unbound phases can chain `resolveFixedArtDirector`.
 */
export function resolveFrozenFinalApproverId(
  phase: WorkflowPhaseDefinition | null | undefined,
  task: Pick<Task, 'workflowFinalApproverIdsByPhaseId' | 'workflowNodeAssigneeIds'>,
  settings: AppSettings,
  users: User[],
): string | null {
  if (!phase) return null;
  const frozen = task.workflowFinalApproverIdsByPhaseId?.[phase.id];
  if (Object.prototype.hasOwnProperty.call(task.workflowFinalApproverIdsByPhaseId || {}, phase.id)) {
    return frozen && isActualArtDirector(frozen, settings, users) ? frozen : null;
  }
  const legacy = task.workflowNodeAssigneeIds?.[phase.id];
  if (legacy && legacy.length === 1 && isActualArtDirector(legacy[0], settings, users)) return legacy[0];
  return null;
}

export function resolveTaskFinalArtDirector(
  phase: WorkflowPhaseDefinition,
  task: Pick<Task, 'workflowFinalApproverIdsByPhaseId' | 'workflowNodeAssigneeIds'>,
  settings: AppSettings,
  users: User[],
): ReturnType<typeof resolveFixedArtDirector> {
  const ownerId = resolveFrozenFinalApproverId(phase, task, settings, users);
  if (ownerId) return { ok: true, ownerId };
  if (Object.prototype.hasOwnProperty.call(task.workflowFinalApproverIdsByPhaseId || {}, phase.id)) {
    return { ok: false, message: `"${phase.name}" is bound to an unavailable Art Director. Restore that member's Art Director role or explicitly replace the workflow.` };
  }
  return resolveFixedArtDirector(phase, settings, users);
}

function isActualArtDirector(userId: string, settings: AppSettings, users: User[]): boolean {
  if (userId === 'guest') return false;
  const user = users.find(candidate => candidate.id === userId);
  if (!user) return false;
  if (isMemberDeleted(user, settings.deletedMembers)) return false;
  return user.role === 'art_director';
}
