import { AppSettings, ReviewMode, Role, Task, TaskStatus, User, WorkflowDefinition, WorkflowPhaseDefinition } from './types';
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
  return task.createdBy === user.id || 
         task.handledBy.includes(user.id) || 
         getCurrentOwnerUserIds(task).includes(user.id) ||
         (task.contentRevisionAssigneeIds || []).includes(user.id);
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
  const ownerIds = getCurrentOwnerUserIds(task);
  return ownerIds.length === 0 || ownerIds.includes(user.id);
}

export function getReviewRouteTarget(mode: ReviewMode): { status: TaskStatus; ownerRole: Role } {
  if (mode === 'quick_look') {
    return { status: 'waiting_reviewer_quick_look', ownerRole: 'reviewer' };
  }

  if (mode === 'direct_to_ad') {
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
  const workflowId = configWorkflowId || mappedWorkflowId || getDefaultWorkflowIdForTaskType(taskType) || settings.defaultWorkflowId;
  return getWorkflowById(settings, workflowId) || getWorkflowById(settings, settings.defaultWorkflowId) || (settings.workflows || [])[0] || null;
}

export function cloneWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    ...workflow,
    phases: workflow.phases.map(phase => ({
      ...phase,
      userIds: [...(phase.userIds || [])],
      roleIds: [...(phase.roleIds || [])],
      responsibilityIds: [...(phase.responsibilityIds || [])],
    })),
  };
}

export function getWorkflowPhase(task: Pick<Task, 'workflowSnapshot' | 'workflowCurrentPhaseIndex' | 'workflowCurrentPhaseId'>) {
  const phases = task.workflowSnapshot?.phases || [];
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

export function getPhaseOwnerRole(phase: WorkflowPhaseDefinition | null | undefined): Role | null {
  if (!phase) return null;
  if (phase.reviewStyle === 'final_approval' || (phase.roleIds || []).includes('art_director')) return 'art_director';
  if ((phase.roleIds || []).includes('team_member') || (phase.responsibilityIds || []).includes('content_creator')) return 'team_member';
  if ((phase.roleIds || []).includes('team_leader')) return 'team_leader';
  return 'reviewer';
}

export function getStatusForWorkflowPhase(phase: WorkflowPhaseDefinition | null | undefined): TaskStatus {
  if (!phase) return 'approved_by_art_director';
  if (phase.reviewStyle === 'final_approval' || (phase.roleIds || []).includes('art_director')) return 'sent_to_art_director';
  if ((phase.roleIds || []).includes('team_member') || (phase.responsibilityIds || []).includes('content_creator')) return 'waiting_content_revision';
  return phase.reviewStyle === 'full_review' ? 'waiting_reviewer_full_review' : 'waiting_reviewer_quick_look';
}

export function getReviewModeForWorkflowPhase(phase: WorkflowPhaseDefinition | null | undefined): ReviewMode {
  if (!phase) return 'full_review';
  if (phase.reviewStyle === 'final_approval') return 'direct_to_ad';
  return phase.reviewStyle === 'full_review' ? 'full_review' : 'quick_look';
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
