import { AppSettings, BusinessCalendarSettings, ReviewMode, Role, Task, TaskStatus, User, WorkflowDefinition, WorkflowPhaseDefinition } from './types';
import { isTaskArchived } from './archiveUtils';
import { AHMED_SOBEEH_ID, DINA_ID, FAWZY_ID, MARWA_ID, MINA_ID, defaultAppSettings, cleanTaskTypeKey, normalizeWorkflowTaskTypeId, getDefaultWorkflowIdForTaskType, getResponsibilityForLabel, getTaskTypeConfigs } from './appSettings';
import { canViewTask } from './taskPolicy';
import { isContentReviewPhase, normalizeReviewMode, normalizeReviewPhase } from './reviewPolicy';
import { getVoiceOverDeliveryOwnerId, hasVoiceOverProviderSelection } from './voiceOverPolicy';
import { resolveTaskFinalArtDirector } from './finalApprovalPolicy';

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

export function canUserAccessTask(task: Task, user: Pick<User, 'id' | 'role' | 'isAdmin' | 'jobTitle'>, settings?: AppSettings, users?: User[], now = new Date()) {
  const directory = users || settings?.manualUsers || [];
  return canViewTask(task, { name: '', ...user }, settings || defaultAppSettings, directory.length ? directory : [{ name: '', ...user }], now);
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

export function canUserActAsCurrentOwner(task: Task, user: Pick<User, 'id'>, phaseId?: string, settings?: AppSettings, users?: User[]) {
  if (task.archivedAt || CLOSED_STATUSES.includes(task.status) || task.status === 'on_hold') return false;
  if (RETURNED_STATUSES.includes(task.status)) {
    return getCurrentOwnerUserIds(task).includes(user.id) && isPhaseAvailable(task, new Date(), phaseId || task.workflowCurrentPhaseId || undefined);
  }
  if (settings && users && task.workflowSnapshot) {
    const phase = phaseId ? task.workflowSnapshot.phases.find(candidate => candidate.id === phaseId)
      : getActiveWorkflowPhaseForUser(task, user.id, settings, users);
    const activeIds = task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
    return Boolean(phase && activeIds.includes(phase.id) && getPhaseAssignableOwnerIds(task, phase, settings, users,
      task.workflowPhaseApprovals?.[phase.id] || []).includes(user.id));
  }
  const ownerIds = getCurrentOwnerUserIds(task);
  if (!ownerIds.includes(user.id)) return false;
  if (!task.workflowSnapshot) return isPhaseAvailable(task);
  const activeIds = task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
  return task.workflowSnapshot.phases.some(phase => {
    if (!activeIds.includes(phase.id) || (phaseId && phase.id !== phaseId) || !isPhaseAvailable(task, new Date(), phase.id)) return false;
    if ((task.workflowPhaseApprovals?.[phase.id] || []).includes(user.id)) return false;
    if (Object.prototype.hasOwnProperty.call(task.workflowNodeAssigneeIds || {}, phase.id)) {
      return resolveExplicitPhaseAssignees(task, phase, [user]).includes(user.id);
    }
    if (phase.userIds?.length) return phase.userIds.includes(user.id);
    // Without roster/settings only the task's current phase has a known owner queue.
    return phase.id === (task.workflowCurrentPhaseId || activeIds[0]);
  });
}


export function getReviewRouteTarget(mode: ReviewMode): { status: TaskStatus; ownerRole: Role } {
  mode = normalizeReviewMode(mode);
  if (mode === 'content_review') {
    return { status: 'waiting_content_revision', ownerRole: 'team_member' };
  }

  if (mode === 'final_review') {
    return { status: 'sent_to_art_director', ownerRole: 'art_director' };
  }

  return { status: 'waiting_reviewer_full_review', ownerRole: 'reviewer' };
}

export function getWorkflowById(settings: AppSettings, workflowId?: string | null) {
  return (settings.workflows || []).find(workflow => workflow.id === workflowId && workflow.active !== false) || null;
}

export function getWorkflowForTaskType(settings: AppSettings, taskType: string) {
  const cleanType = normalizeWorkflowTaskTypeId(taskType);
  const workflowId = getTaskTypeConfigs(settings).find(c => c.id === cleanType)?.workflowId;
  return workflowId ? getWorkflowById(settings, workflowId) : null;
}

export function cloneWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    ...workflow,
    taskTypeIds: [...(workflow.taskTypeIds || [])],
    phases: workflow.phases.filter(phase => (phase.nodeType || 'step') === 'step').map(phase => ({
      ...normalizeReviewPhase(phase),
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
  const validIds = new Set(users.filter(user => user.id !== 'guest').map(user => user.id));
  (phase.userIds || []).forEach(id => validIds.has(id) && ids.add(id));
  users.forEach(user => {
    if (user.id === 'guest') return;
    if ((phase.roleIds || []).includes(user.role)) ids.add(user.id);
    if ((phase.responsibilityIds || []).some(responsibilityId => userMatchesResponsibility(user, responsibilityId, settings))) {
      ids.add(user.id);
    }
  });

  if (task && phase.id === 'content_review' && (task.contentRevisionAssigneeIds || []).length > 0) {
    task.contentRevisionAssigneeIds?.forEach(id => validIds.has(id) && ids.add(id));
  }

  return Array.from(ids);
}

/** Resolves the task-level explicit step assignees; the 'voice_over_ai' placeholder maps to its chosen human owner. */
export function resolveExplicitPhaseAssignees(
  task: Pick<Task, 'workflowNodeAssigneeIds' | 'workflowNodeAIAssigneeIds' | 'workflowNodeVoiceOverDeliveryOwnerIds'>,
  phase: WorkflowPhaseDefinition,
  users: Array<Pick<User, 'id'> & Partial<Pick<User, 'name'>>>,
): string[] {
  if (!phase) return [];
  const rawAssignees = task.workflowNodeAssigneeIds?.[phase.id] || [];
  if (rawAssignees.length === 0) return [];
  if (hasVoiceOverProviderSelection(task, phase)) {
    const owner = getVoiceOverDeliveryOwnerId(task, phase, users as User[]);
    return owner ? [owner] : [];
  }
  const validIds = new Set(users.filter(user => user.id !== 'guest').map(user => user.id));
  const aiOwnerId = task.workflowNodeAIAssigneeIds?.[phase.id];
  return uniqueIds([
    ...rawAssignees.filter(id => validIds.has(id)),
    ...(rawAssignees.includes('voice_over_ai') && aiOwnerId && validIds.has(aiOwnerId) ? [aiOwnerId] : []),
  ]);
}

export function getActiveWorkflowPhaseForUser(
  task: Task,
  userId: string,
  settings: AppSettings,
  users: User[],
) {
  const activePhaseIds = task.workflowActivePhaseIds ?? [task.workflowCurrentPhaseId].filter(Boolean) as string[];
  const activePhases = (task.workflowSnapshot?.phases || [])
    .filter(phase => activePhaseIds.includes(phase.id));

  return activePhases.find(phase => isPhaseAvailable(task, new Date(), phase.id)
    && getPhaseAssignableOwnerIds(task, phase, settings, users, task.workflowPhaseApprovals?.[phase.id] || []).includes(userId)) || null;
}

export function getPhaseOwnerRole(phase: WorkflowPhaseDefinition | null | undefined): Role | null {
  if (!phase) return null;
  phase = normalizeReviewPhase(phase);
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

export function isMandatoryFinalReview(phase: WorkflowPhaseDefinition | null | undefined): boolean {
  if (phase) phase = normalizeReviewPhase(phase);
  return Boolean(phase && phase.phaseKind !== 'work' && (phase.phaseKind === 'final_review'
    || phase.reviewStyle === 'final_review' || phase.reviewStyle === 'final_approval'
    || getPhaseOwnerRole(phase) === 'art_director'));
}

export function canSkipWorkflowPhase(phase: WorkflowPhaseDefinition | null | undefined) {
  if (!phase || (phase.nodeType || 'step') !== 'step') return false;
  // Final Art Director approval is never optional. A workflow can mark other
  // steps as manual skips, but it cannot silently bypass the final approver.
  return !isMandatoryFinalReview(phase);
}

export function isWorkflowPhaseSkippedForTask(
  phase: WorkflowPhaseDefinition,
  task: Pick<Task, 'assignmentLinks' | 'versions' | 'workflowSkippedPhaseIds' | 'needsContentRevision'>,
): boolean {
  if (isMandatoryFinalReview(phase)) return false;
  return Boolean(phase.disabled) || (task.workflowSkippedPhaseIds || []).includes(phase.id) || evaluateSkipRule(phase.skipRule, task);
}

export function getStatusForWorkflowPhase(phase: WorkflowPhaseDefinition | null | undefined): TaskStatus {
  if (!phase) return 'assigned_work';
  phase = normalizeReviewPhase(phase);
  if (phase.phaseKind === 'work') return 'assigned_work';
  const ownerRole = getPhaseOwnerRole(phase);
  if (ownerRole === 'art_director') return 'sent_to_art_director';
  if (phase.phaseKind === 'content_review') return 'waiting_content_revision';
  if (ownerRole === 'reviewer' || phase.phaseKind === 'first_review' || phase.reviewStyle === 'full_review') return 'waiting_reviewer_full_review';
  return 'assigned_work';
}

export function getReviewModeForWorkflowPhase(phase: WorkflowPhaseDefinition | null | undefined): ReviewMode {
  if (!phase) return 'first_review';
  phase = normalizeReviewPhase(phase);
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

export function isPhaseAvailable(
  task: Pick<Task, 'workflowPhaseAvailableAt' | 'workflowPhaseAvailableAtByPhaseId' | 'workflowActivePhaseIds' | 'workflowCurrentPhaseId'>,
  now = new Date(),
  phaseId?: string,
): boolean {
  const times = task.workflowPhaseAvailableAtByPhaseId;
  // Older tasks may acquire an empty map during hydration; preserve their scalar delay.
  if (times && Object.keys(times).length > 0) {
    if (phaseId) return !times[phaseId] || new Date(times[phaseId]).getTime() <= now.getTime();
    const activeIds = task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
    return activeIds.some(id => !times[id] || new Date(times[id]).getTime() <= now.getTime());
  }
  return !task.workflowPhaseAvailableAt || new Date(task.workflowPhaseAvailableAt).getTime() <= now.getTime();
}


export function getNextPhaseIndex(workflow: WorkflowDefinition, fromIndex: number, task: Pick<Task, 'assignmentLinks' | 'versions' | 'workflowSkippedPhaseIds' | 'workflowPhaseApprovals' | 'needsContentRevision'>): number {
  let index = fromIndex + 1;
  while (index < workflow.phases.length) {
    const candidate = workflow.phases[index];
    if (candidate && ((candidate.nodeType || 'step') !== 'step' || isWorkflowPhaseSkippedForTask(candidate, task))) {
      index += 1;
      continue;
    }
    return index;
  }
  return workflow.phases.length;
}

/**
 * Resolves who is responsible for a phase:
 * 1. Task-level explicit step assignees always win. If they were configured
 *    but are now empty/invalid, the phase resolves to nobody instead of
 *    silently fanning out to a whole department.
 * 2. Phase-configured users/roles/responsibilities.
 * 3. A bounded legacy fallback by owner role.
 */
export function resolveWorkflowPhaseOwnerIds(
  phase: WorkflowPhaseDefinition | null | undefined,
  task: Pick<Task, 'createdBy' | 'handledBy' | 'contentRevisionAssigneeIds' | 'workflowNodeAssigneeIds' | 'workflowNodeAIAssigneeIds' | 'workflowNodeVoiceOverDeliveryOwnerIds' | 'workflowFinalApproverIdsByPhaseId' | 'id'>,
  settings: AppSettings,
  users: User[],
): string[] {
  if (!phase) return [];
  if (isMandatoryFinalReview(phase)) {
    const fixed = resolveTaskFinalArtDirector(phase, task, settings, users);
    return fixed.ok ? [fixed.ownerId!] : [];
  }
  if (hasVoiceOverProviderSelection(task, phase)) {
    const owner = getVoiceOverDeliveryOwnerId(task, phase, users);
    return owner ? [owner] : [];
  }
  if (Object.prototype.hasOwnProperty.call(task.workflowNodeAssigneeIds || {}, phase.id)) {
    // Explicit ownership was configured; invalid entries do not fall through
    // to a department-wide queue.
    return resolveExplicitPhaseAssignees(task, phase, users);
  }
  const configured = uniqueIds(resolveWorkflowPhaseReviewerIds(phase, settings, users, task as Task));
  if (configured.length > 0 || phase.userIds?.length || phase.roleIds?.length || phase.responsibilityIds?.length || phase.phaseKind === 'work') return configured;
  const ownerRole = getPhaseOwnerRole(phase);
  const activeUsers = users.filter(user => user.id !== 'guest');
  if (ownerRole === 'team_member') {
    return uniqueIds([...(task.contentRevisionAssigneeIds || []), task.createdBy, ...task.handledBy]).filter(id => activeUsers.some(user => user.id === id));
  }
  if (ownerRole === 'art_director') return activeUsers.filter(user => user.role === 'art_director').map(user => user.id);
  if (ownerRole === 'team_leader') return activeUsers.filter(user => user.role === 'team_leader').map(user => user.id);
  if (ownerRole === 'reviewer') {
    return uniqueIds([
      ...activeUsers.filter(user => user.role === 'reviewer' || user.role === 'admin').map(user => user.id),
      ...(settings.firstReviewerUserIds || []),
    ]);
  }
  return [];
}

/**
 * Who can act on the phase right now. Sequential queues offer one pending
 * owner at a time and honor requiredApprovals; parallel queues offer every
 * pending owner.
 */
export function getPhaseAssignableOwnerIds(
  task: Pick<Task, 'createdBy' | 'handledBy' | 'contentRevisionAssigneeIds' | 'workflowNodeAssigneeIds' | 'workflowNodeAIAssigneeIds' | 'workflowNodeVoiceOverDeliveryOwnerIds' | 'id' | 'workflowPhaseAvailableAt' | 'workflowPhaseAvailableAtByPhaseId' | 'workflowActivePhaseIds' | 'workflowCurrentPhaseId'>,
  phase: WorkflowPhaseDefinition | null | undefined,
  settings: AppSettings,
  users: User[],
  approvals: string[] = [],
  now = new Date(),
): string[] {
  if (!phase || !isPhaseAvailable(task, now, phase.id)) return [];
  const allOwnerIds = resolveWorkflowPhaseOwnerIds(phase, task, settings, users);
  const pendingIds = allOwnerIds.filter(id => !approvals.includes(id));
  if (phase.mode === 'sequential') {
    return pendingIds.slice(0, 1);
  }
  return pendingIds;
}
