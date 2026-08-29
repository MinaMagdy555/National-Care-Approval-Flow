import { AppSettings, BusinessCalendarSettings, ReviewMode, Role, Task, TaskStatus, User, WorkflowDefinition, WorkflowPhaseDefinition } from './types';
import { isTaskArchived } from './archiveUtils';
import { AHMED_SOBEEH_ID, DINA_ID, FAWZY_ID, MARWA_ID, MINA_ID, cleanTaskTypeKey, getDefaultWorkflowIdForTaskType, getResponsibilityForLabel, getTaskTypeConfigs } from './appSettings';

export const REVIEWER_WAITING_STATUSES: TaskStatus[] = ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'];
export const ART_DIRECTOR_WAITING_STATUSES: TaskStatus[] = ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'];
export const RETURNED_STATUSES: TaskStatus[] = ['changes_requested_by_reviewer', 'changes_requested_by_art_director', 'changes_requested_by_content'];
export const CLOSED_STATUSES: TaskStatus[] = ['approved_by_art_director', 'completed', 'archived'];

export function uniqueIds(ids: Array<string | null | undefined>) {
  return Array.from(new Set(ids.filter(Boolean) as string[]));
}

export function getCurrentOwnerUserIds(task: Pick<Task, 'currentOwnerUserIds' | 'currentOwnerUserId'>) {
  return uniqueIds([
    ...(Array.isArray(task.currentOwnerUserIds) ? task.currentOwnerUserIds : []),
    task.currentOwnerUserId,
  ]);
}

export function userCanViewFullWorkspace(user: Pick<User, 'id' | 'role' | 'isAdmin'>, settings?: AppSettings) {
  if (user.isAdmin || user.role === 'admin') return true;
  if (settings && settings.viewAllWorkloadUserIds?.includes(user.id)) return true;
  if (!settings || !settings.viewAllWorkloadUserIds) {
    return ['reviewer', 'art_director', 'team_leader', 'manager', 'developer', 'marketing_manager'].includes(user.role);
  }
  return false;
}

export function canUserAccessTask(task: Task, user: Pick<User, 'id' | 'role' | 'isAdmin'>, settings?: AppSettings) {
  if (userCanViewFullWorkspace(user, settings)) return true;
  // Contributors see a task only when their phase is active. This prevents a
  // later workflow owner from seeing work before it reaches their step.
  if (task.createdBy === user.id) return true;
  return isPhaseAvailable(task) && getCurrentOwnerUserIds(task).includes(user.id);
}

export function canManageWorkflow(user: Pick<User, 'id' | 'role' | 'isAdmin'>, settings?: AppSettings) {
  if (user.isAdmin || user.role === 'admin') return true;
  if (settings) {
    if (settings.firstReviewerUserIds?.includes(user.id) || settings.finalReviewerUserIds?.includes(user.id)) return true;
    const configs = getTaskTypeConfigs(settings);
    const inCustomList = configs.some(c => 
      c.fullReviewerUserIds?.includes(user.id) || 
      c.quickLookUserIds?.includes(user.id) || 
      c.finalReviewerUserIds?.includes(user.id)
    );
    if (inCustomList) return true;
  }
  if (!settings) {
    return ['reviewer', 'art_director', 'team_leader'].includes(user.role);
  }
  return false;
}

export function canManageWorkflowBuilder(user: Pick<User, 'id' | 'role' | 'isAdmin' | 'jobTitle'>, settings?: AppSettings) {
  if (user.isAdmin || user.role === 'admin') return true;
  if ([MINA_ID, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID].includes(user.id)) return true;
  if (['art_director', 'team_leader', 'manager', 'marketing_manager'].includes(user.role)) return true;
  if (settings && user.jobTitle) {
    const responsibility = getResponsibilityForLabel(settings, user.jobTitle);
    if (responsibility?.id === 'hr' || responsibility?.grantsSettingsAccess) return true;
  }
  return false;
}

export function isContentCreatorProfile(user?: Pick<User, 'role' | 'jobTitle'> | null) {
  if (!user) return false;
  return user.jobTitle === 'Content Creator' || (user.role === 'team_member' && user.jobTitle === 'Content Creator');
}

export function isDirectToFinalReviewUploader(user?: Pick<User, 'role' | 'jobTitle' | 'isAdmin'> | null) {
  if (!user) return false;
  if (user.isAdmin || user.role === 'admin') return true;
  if (['reviewer', 'team_leader', 'art_director'].includes(user.role)) return true;
  return (user.jobTitle || '').trim().toLowerCase().includes('senior');
}

export function canUserActAsCurrentOwner(task: Task, user: Pick<User, 'id'>) {
  if (!isPhaseAvailable(task)) return false;
  const ownerIds = getCurrentOwnerUserIds(task);
  return ownerIds.length === 0 || ownerIds.includes(user.id);
}

export function getReviewRouteTarget(mode: ReviewMode): { status: TaskStatus; ownerRole: Role } {
  if (mode === 'content_review') {
    return { status: 'waiting_content_revision', ownerRole: 'team_member' };
  }

  if (mode === 'final_review' || mode === 'direct_to_ad') {
    return { status: 'sent_to_art_director', ownerRole: 'art_director' };
  }

  return { status: 'waiting_reviewer_full_review', ownerRole: 'reviewer' };
}

export function getWorkflowById(settings: AppSettings, workflowId?: string | null) {
  return (settings.workflows || []).find(workflow => workflow.id === workflowId && workflow.active !== false) || null;
}

export function getWorkflowForTaskType(settings: AppSettings, taskType: string) {
  const cleanType = cleanTaskTypeKey(taskType);
  const configWorkflowId = getTaskTypeConfigs(settings).find(c => cleanTaskTypeKey(c.id) === cleanType)?.workflowId;
  const mappedWorkflowId = settings.taskTypeWorkflowIds?.[cleanType];
  const workflowId = configWorkflowId || mappedWorkflowId || getDefaultWorkflowIdForTaskType(taskType);
  return getWorkflowById(settings, workflowId) || null;
}

export function cloneWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    ...workflow,
    taskTypeIds: [...(workflow.taskTypeIds || [])],
    phases: workflow.phases.filter(phase => (phase.nodeType || 'step') === 'step' && !phase.disabled).map(phase => ({
      ...phase,
      groupId: null,
      userIds: [...(phase.userIds || [])],
      roleIds: [...(phase.roleIds || [])],
      responsibilityIds: [...(phase.responsibilityIds || [])],
      subPhases: (phase.subPhases || []).map(subPhase => ({
        ...subPhase,
        responsibilityIds: [...(subPhase.responsibilityIds || [])],
      })),
    })),
  };
}

export function getWorkflowPhase(task: Pick<Task, 'workflowSnapshot' | 'workflowCurrentPhaseIndex' | 'workflowCurrentPhaseId' | 'workflowActivePhaseIds'>) {
  const phases = task.workflowSnapshot?.phases || [];
  const activePhaseId = task.workflowActivePhaseIds?.[0];
  if (activePhaseId) {
    const activePhase = phases.find(phase => phase.id === activePhaseId);
    if (activePhase) return activePhase;
  }
  if (task.workflowCurrentPhaseId) {
    const byId = phases.find(phase => phase.id === task.workflowCurrentPhaseId);
    if (byId) return byId;
  }
  const index = task.workflowCurrentPhaseIndex ?? 0;
  return phases[index] || null;
}

export function getWorkflowPhaseIndex(workflow: WorkflowDefinition | null | undefined, phaseId?: string | null) {
  if (!workflow || !phaseId) return -1;
  return workflow.phases.findIndex(phase => phase.id === phaseId);
}

function userMatchesResponsibility(user: User, responsibilityId: string, settings: AppSettings) {
  const responsibility = settings.responsibilities.find(item => item.id === responsibilityId);
  const label = responsibility?.label || responsibilityId;
  const normalizedLabel = label.trim().toLowerCase();
  const normalizedId = responsibilityId.replace(/_/g, ' ').trim().toLowerCase();
  const jobTitle = (user.jobTitle || '').trim().toLowerCase();
  return jobTitle === normalizedLabel || jobTitle === normalizedId || jobTitle.includes(normalizedLabel) || jobTitle.includes(normalizedId);
}

export function resolveWorkflowPhaseReviewerIds(phase: WorkflowPhaseDefinition | null | undefined, settings: AppSettings, users: User[], task?: Task) {
  if (!phase) return [];
  const ids = new Set<string>();
  (phase.userIds || []).forEach(id => id && ids.add(id));
  users.forEach(user => {
    if (user.id === 'guest') return;
    if ((phase.roleIds || []).includes(user.role)) ids.add(user.id);
    if ((phase.responsibilityIds || []).some(responsibilityId => userMatchesResponsibility(user, responsibilityId, settings))) {
      ids.add(user.id);
    }
  });

  if (task && phase.id === 'content_review' && (task.contentRevisionAssigneeIds || []).length > 0) {
    task.contentRevisionAssigneeIds?.forEach(id => id && ids.add(id));
  }

  return Array.from(ids);
}

export function getActiveWorkflowPhaseForUser(
  task: Task,
  userId: string,
  settings: AppSettings,
  users: User[],
) {
  const activePhaseIds = task.workflowActivePhaseIds?.length
    ? task.workflowActivePhaseIds
    : [task.workflowCurrentPhaseId].filter(Boolean) as string[];
  const activePhases = (task.workflowSnapshot?.phases || [])
    .filter(phase => activePhaseIds.includes(phase.id));

  const ownedPhase = activePhases.find(phase => {
    const explicitAssignees = task.workflowNodeAssigneeIds?.[phase.id] || [];
    const ownerIds = explicitAssignees.length > 0
      ? uniqueIds([
          ...explicitAssignees.filter(id => id !== 'voice_over_ai'),
          ...(explicitAssignees.includes('voice_over_ai') && task.workflowNodeAIAssigneeIds?.[phase.id]
            ? [task.workflowNodeAIAssigneeIds[phase.id]]
            : []),
        ])
      : resolveWorkflowPhaseReviewerIds(phase, settings, users, task);
    return ownerIds.includes(userId);
  });

  return ownedPhase || getWorkflowPhase(task);
}

export function getPhaseOwnerRole(phase: WorkflowPhaseDefinition | null | undefined): Role | null {
  if (!phase) return null;
  const roleIds = phase.roleIds || [];
  // Explicit ownership always wins over a visual review style. For example,
  // the senior owns the "Submit Campaign for Art Director Approval" step,
  // even though that step leads into final approval.
  if (roleIds.includes('art_director')) return 'art_director';
  if (roleIds.includes('reviewer')) return 'reviewer';
  if (roleIds.includes('team_member') || (phase.responsibilityIds || []).includes('content_creator')) return 'team_member';
  if (roleIds.includes('team_leader')) return 'team_leader';
  if (phase.phaseKind === 'content_review') return 'team_member';
  if (phase.phaseKind === 'first_review') return 'reviewer';
  if (phase.phaseKind === 'final_review' || phase.reviewStyle === 'final_approval') return 'art_director';
  return 'reviewer';
}

export function canSkipWorkflowPhase(phase: WorkflowPhaseDefinition | null | undefined) {
  if (!phase || phase.skipRule !== 'manual') return false;
  // Final Art Director approval is never optional. A workflow can mark other
  // steps as manual skips, but it cannot silently bypass the final approver.
  return getPhaseOwnerRole(phase) !== 'art_director';
}

export function getStatusForWorkflowPhase(phase: WorkflowPhaseDefinition | null | undefined): TaskStatus {
  if (!phase) return 'approved_by_art_director';
  const ownerRole = getPhaseOwnerRole(phase);
  if (ownerRole === 'art_director') return 'sent_to_art_director';
  if (phase.phaseKind === 'content_review') return 'waiting_content_revision';
  if (ownerRole === 'reviewer' || phase.phaseKind === 'first_review' || phase.reviewStyle === 'full_review') return 'waiting_reviewer_full_review';
  return 'assigned_work';
}

export function getReviewModeForWorkflowPhase(phase: WorkflowPhaseDefinition | null | undefined): ReviewMode {
  if (!phase) return 'first_review';
  if (getPhaseOwnerRole(phase) === 'art_director') return 'final_review';
  if (phase.phaseKind === 'content_review') return 'content_review';
  return 'first_review';
}

export function getWorkflowApprovalIds(task: Pick<Task, 'workflowPhaseApprovals'>, phaseId: string) {
  return task.workflowPhaseApprovals?.[phaseId] || [];
}

export function hasUserApprovedWorkflowPhase(task: Pick<Task, 'workflowPhaseApprovals'>, phaseId: string, userId: string) {
  return getWorkflowApprovalIds(task, phaseId).includes(userId);
}

export function canReviewRouteUpdateStatus(task: Task) {
  return !isTaskArchived(task) && !CLOSED_STATUSES.includes(task.status) && !RETURNED_STATUSES.includes(task.status);
}

export function getTaskParticipantIds(task: Task, teamLeaderIds: string[] = []) {
  return uniqueIds([
    task.createdBy,
    ...task.handledBy,
    ...getCurrentOwnerUserIds(task),
    ...teamLeaderIds,
  ]);
}

export function parsePublishDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isScheduledCampaign(task: Task) {
  return task.taskType === 'campaign' && Boolean(task.scheduledPublishAt);
}

export function getCurrentReviewPhaseName(task: Pick<Task, 'workflowSnapshot' | 'workflowCurrentPhaseId' | 'workflowCurrentPhaseIndex' | 'status' | 'reviewMode'>): string | null {
  const phase = getWorkflowPhase(task);
  if (phase) return phase.name;
  if (task.status === 'reviewer_approved' || task.status === 'sent_to_art_director' || task.status === 'waiting_art_director_approval' || task.status === 'changes_requested_by_art_director' || task.status === 'approved_by_art_director') {
    return 'Final approval';
  }
  if (task.status === 'waiting_reviewer_full_review' || task.status === 'waiting_reviewer_quick_look') return 'First Rev.';
  if (task.status === 'waiting_content_revision') return 'Content Rev.';
  return null;
}

export function evaluateSkipRule(
  rule: WorkflowPhaseDefinition['skipRule'] | undefined,
  task: Pick<Task, 'assignmentLinks' | 'versions' | 'workflowSkippedPhaseIds'>,
): boolean {
  if (!rule || rule === 'none') return false;
  if (rule === 'manual') return false;
  if (rule === 'if_no_task_links') {
    return !Array.isArray(task.assignmentLinks) || task.assignmentLinks.length === 0;
  }
  if (rule === 'if_no_files_in_previous_version') {
    const previousVersion = task.versions[1];
    if (!previousVersion) return true;
    return !previousVersion.files || previousVersion.files.length === 0;
  }
  return false;
}

function startOfDay(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function addBusinessDays(start: Date, days: number, workdays: number[]): Date {
  const cursor = new Date(start);
  let added = 0;
  while (added < days) {
    cursor.setDate(cursor.getDate() + 1);
    if (workdays.includes(cursor.getDay())) {
      added += 1;
    }
  }
  return cursor;
}

export function computePhaseAvailableAt(startIso: string, delayDays: number | null | undefined, calendar?: BusinessCalendarSettings | null): string | null {
  if (!delayDays || delayDays <= 0) return null;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;
  const useBusinessDays = Boolean(calendar?.workdays && calendar.workdays.length > 0);
  const next = useBusinessDays
    ? addBusinessDays(start, delayDays, calendar!.workdays)
    : (() => { const d = new Date(start); d.setDate(d.getDate() + delayDays); return d; })();
  return next.toISOString();
}

export function isPhaseAvailable(task: Pick<Task, 'workflowPhaseAvailableAt'>, now = new Date()): boolean {
  if (!task.workflowPhaseAvailableAt) return true;
  return new Date(task.workflowPhaseAvailableAt).getTime() <= now.getTime();
}

export function getNextPhaseIndex(workflow: WorkflowDefinition, fromIndex: number, task: Pick<Task, 'assignmentLinks' | 'versions' | 'workflowSkippedPhaseIds' | 'workflowPhaseApprovals'>): number {
  let index = fromIndex + 1;
  while (index < workflow.phases.length) {
    const candidate = workflow.phases[index];
    if (candidate && (candidate.nodeType !== 'step' || candidate.disabled || (task.workflowSkippedPhaseIds || []).includes(candidate.id))) {
      index += 1;
      continue;
    }
    if (candidate && evaluateSkipRule(candidate.skipRule, task)) {
      index += 1;
      continue;
    }
    return index;
  }
  return workflow.phases.length;
}
