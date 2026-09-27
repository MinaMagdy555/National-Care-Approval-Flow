import type { AppSettings, Task, User } from './types.js';
import { CLOSED_STATUSES, RETURNED_STATUSES, getCurrentOwnerUserIds, getPhaseAssignableOwnerIds, resolveWorkflowPhaseOwnerIds } from './workflowUtils.js';

export function getTaskWorkSessions(task: Task, settings: AppSettings, users: User[]): NonNullable<Task['workSessions']> {
  const sessions = [...(task.workSessions || [])];
  if (task.activeWorkBy && task.activeWorkStartedAt && !sessions.some(s => s.userId === task.activeWorkBy && s.startedAt === task.activeWorkStartedAt)) {
    const phase = task.workflowSnapshot?.phases.find(p => (task.workflowActivePhaseIds || [task.workflowCurrentPhaseId]).includes(p.id) && (RETURNED_STATUSES.includes(task.status) ? getCurrentOwnerUserIds(task).includes(task.activeWorkBy!) : resolveWorkflowPhaseOwnerIds(p, task, settings, users).includes(task.activeWorkBy!)));
    sessions.push({ id: `work:${task.id}:${task.activeWorkBy}:${task.activeWorkStartedAt}`, userId: task.activeWorkBy, phaseId: phase?.id || null, startedAt: task.activeWorkStartedAt, finishedAt: task.activeWorkFinishedAt || null, note: task.activeWorkNote || null });
  }
  return sessions;
}

export function hasStartedPhase(task: Task, userId: string, phaseId: string, settings: AppSettings, users: User[]) {
  return getTaskWorkSessions(task, settings, users).some(s => s.userId === userId && s.phaseId === phaseId);
}

/** Derive durable work records from explicit start/finish actions and canonical route changes. */
export function reconcileWorkSessions(prior: Task, next: Task, settings: AppSettings, users: User[]): Task {
  const sessions = getTaskWorkSessions(prior, settings, users);
  const started = next.activeWorkBy && next.activeWorkStartedAt && (next.activeWorkBy !== prior.activeWorkBy || next.activeWorkStartedAt !== prior.activeWorkStartedAt);
  if (started) {
    const added = getTaskWorkSessions({ ...next, workSessions: sessions }, settings, users).filter(s => !sessions.some(old => old.id === s.id));
    sessions.push(...added);
  }
  const finishActor = next.activeWorkFinishedAt && (next.activeWorkFinishedAt !== prior.activeWorkFinishedAt || next.activeWorkFinishedById !== prior.activeWorkFinishedById) ? next.activeWorkFinishedById : null;
  const activeIds = next.workflowActivePhaseIds ?? [next.workflowCurrentPhaseId];
  const now = next.updatedAt || new Date().toISOString();
  const result = sessions.map(session => {
    if (session.finishedAt) return session;
    if (finishActor === session.userId) return { ...session, finishedAt: next.activeWorkFinishedAt!, endReason: 'finished' as const };
    const phase = next.workflowSnapshot?.phases.find(p => p.id === session.phaseId);
    const stillAssigned = phase ? resolveWorkflowPhaseOwnerIds(phase, next, settings, users).includes(session.userId) : getCurrentOwnerUserIds(next).includes(session.userId);
    const stepClosed = CLOSED_STATUSES.includes(next.status) || Boolean(next.archivedAt) || next.status === 'on_hold' || (session.phaseId && !activeIds.includes(session.phaseId)) || Boolean(phase && (next.workflowPhaseApprovals?.[phase.id] || []).includes(session.userId));
    return !stillAssigned || stepClosed ? { ...session, finishedAt: now, endReason: !stillAssigned ? 'reassigned' as const : 'step_closed' as const } : session;
  });
  const latest = result.find(s => s.userId === next.activeWorkBy && s.startedAt === next.activeWorkStartedAt);
  return { ...next, workSessions: result, ...(latest ? { activeWorkFinishedAt: latest.finishedAt } : {}) };
}

export function canStartTaskWork(task: Task, userId: string, settings: AppSettings, users: User[]) {
  if (CLOSED_STATUSES.includes(task.status) || task.archivedAt || task.status === 'on_hold') return false;
  if (!task.workflowSnapshot || RETURNED_STATUSES.includes(task.status)) return getCurrentOwnerUserIds(task).includes(userId);
  return task.workflowSnapshot.phases.some(phase => (task.workflowActivePhaseIds || [task.workflowCurrentPhaseId]).includes(phase.id) && getPhaseAssignableOwnerIds(task, phase, settings, users, task.workflowPhaseApprovals?.[phase.id] || []).includes(userId));
}
