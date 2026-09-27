import { validateTaskReassignment } from './taskReassignment.js';
import type { AppSettings, Notification, Task, User } from '../src/lib/types.js';
import { canDeleteTask, canEditTask, canViewTask } from '../src/lib/taskPolicy.js';
import { isDeadlineNotification } from '../src/lib/deadlinePolicy.js';
import { isReportNotification, ReportAccessError } from './reportAccess.js';
import { canSetActiveWorkForMember } from '../src/lib/workAssignmentUtils.js';
import { getValidatedFinalApproverMap, validateTaskWorkflowAssignment } from './workflowAssignment.js';
import { validateTaskWorkflowOmissions } from './workflowOmissions.js';
import { validateWorkflowTransition } from './workflowTransitions.js';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${stable(value)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function canCreateTaskForActor(task: Task, actor: User): boolean {
  return actor.id !== 'guest' && Boolean(task.createdBy) && (task.createdBy === actor.id
    || actor.role === 'reviewer' || actor.role === 'admin' || Boolean(actor.isAdmin));
}

function validateWorkAttribution(prior: Task | undefined, task: Task, actor: User) {
  const allowed = new Set([actor.id]);
  if (!prior && canCreateTaskForActor(task, actor)) allowed.add(task.createdBy);
  const history = task.workflowPhaseHistory || [];
  const oldHistory = prior?.workflowPhaseHistory || [];
  if (stable(history.slice(0, oldHistory.length)) !== stable(oldHistory)
    || history.slice(oldHistory.length).some(entry => !allowed.has(entry.actorId))) {
    throw new ReportAccessError('Work history attribution cannot be changed or impersonated.');
  }
  for (const [phaseId, approvals] of Object.entries(task.workflowPhaseApprovals || {})) {
    const previous = prior?.workflowPhaseApprovals?.[phaseId] || [];
    if (approvals.some(id => !previous.includes(id) && !allowed.has(id))) throw new ReportAccessError('Another member’s approval cannot be fabricated.');
  }
  for (const version of task.versions || []) {
    const previous = prior?.versions?.find(item => item.id === version.id);
    if (previous ? version.submittedBy !== previous.submittedBy : !allowed.has(version.submittedBy)) throw new ReportAccessError('Upload attribution cannot be impersonated.');
    const hasFile = (entry: typeof version | undefined) => Boolean(entry && (entry.fileUrl || entry.files?.some(file => file.url || file.driveFileId || file.blob)));
    if (previous && !hasFile(previous) && hasFile(version) && !allowed.has(version.submittedBy)) throw new ReportAccessError('Upload evidence cannot be fabricated for another member.');
  }
  if (task.activeWorkBy && task.activeWorkStartedAt && (task.activeWorkBy !== prior?.activeWorkBy || task.activeWorkStartedAt !== prior?.activeWorkStartedAt)
    && !allowed.has(task.activeWorkBy) && !canSetActiveWorkForMember(actor)) throw new ReportAccessError('Another member’s work session cannot be fabricated.');
}

export function mergeAuthorizedTasks(existing: Task[], incoming: Task[], actor: User, settings: AppSettings, users: User[], options: { changedTaskIds?: string[]; deletedTaskIds?: string[] } = {}, now = new Date()) {
  const tasks = new Map(existing.map(task => [task.id, task]));
  const changed = new Set(options.changedTaskIds);
  const hasExplicitChanges = Array.isArray(options.changedTaskIds);
  const authorizedIds = new Set<string>();
  for (const task of incoming) {
    if (!task || typeof task.id !== 'string' || !task.id) throw new ReportAccessError('Invalid task identity.');
    if (hasExplicitChanges && !changed.has(task.id)) continue;
    const prior = tasks.get(task.id);
    if (prior && stable(prior) === stable(task)) continue;
    // Incoming ownership or fabricated history never grants authority over preexisting work.
    if (prior ? !canEditTask(prior, actor, settings, users, now) : !canCreateTaskForActor(task, actor)) {
      throw new ReportAccessError('You cannot change this task before your workflow turn or from read-only history.');
    }
    if (prior && task.createdBy !== prior.createdBy) throw new ReportAccessError('Task creator attribution cannot be changed.');
    validateWorkAttribution(prior, task, actor);
    validateTaskWorkflowAssignment(task, prior, settings, actor, users);
    validateTaskWorkflowOmissions(prior, task, actor, settings, users, now);
    validateWorkflowTransition(prior, task, actor, settings, users, now);
    const reconciled = validateTaskReassignment(prior, task, actor, settings, users);
    tasks.set(task.id, task.workflowSnapshot?.phases.some(phase => phase.phaseKind === 'final_review' || phase.roleIds?.includes('art_director'))
      ? { ...reconciled, workflowFinalApproverIdsByPhaseId: getValidatedFinalApproverMap(task, prior, settings, users) } : reconciled);
    authorizedIds.add(task.id);
  }
  for (const id of options.deletedTaskIds || []) {
    const prior = existing.find(task => task.id === id);
    if (!prior || !canDeleteTask(prior, actor, settings, users, now)) throw new ReportAccessError('You cannot delete this task.');
    tasks.delete(id);
    authorizedIds.add(id);
  }
  // Omission from a projected full-state payload is never a deletion request.
  return { tasks: [...tasks.values()], authorizedIds };
}

export function mergeAuthorizedTaskNotifications(existing: Notification[], incoming: Notification[], tasks: Task[], actor: User, settings: AppSettings, users: User[], authorizedTaskIds: Set<string>, now = new Date()): Notification[] {
  const special = (notice: Notification) => isReportNotification(notice) || isDeadlineNotification(notice);
  const notices = new Map(existing.filter(notice => !special(notice)).map(notice => [notice.id, notice]));
  for (const notice of incoming.filter(notice => !special(notice))) {
    const prior = notices.get(notice.id);
    if (prior) {
      if (prior.userId === actor.id) notices.set(prior.id, { ...prior, read: Boolean(notice.read) });
      continue;
    }
    const task = tasks.find(task => task.id === notice.taskId);
    const receiver = users.find(user => user.id === notice.userId);
    if (task && receiver && authorizedTaskIds.has(task.id) && canViewTask(task, receiver, settings, users, now)) notices.set(notice.id, notice);
  }
  return [...notices.values(), ...incoming.filter(special)];
}
