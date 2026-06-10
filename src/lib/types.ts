export type Role = 'team_member' | 'reviewer' | 'art_director' | 'team_leader' | 'manager' | 'developer' | 'marketing_manager' | 'admin';
export type Environment = 'production' | 'demo' | 'archived';
export type ReviewMode = 'full_review' | 'quick_look' | 'direct_to_ad';
export type Priority = string;
export type AssignmentPeriod = 'day' | 'week' | 'month';
export type PriorityTone = 'emerald' | 'slate' | 'amber' | 'rose' | 'blue' | 'indigo' | 'purple';


export type TaskType = string;

export type TaskStatus = 
  | 'draft'
  | 'assigned_work'
  | 'submitted'
  | 'waiting_reviewer_full_review'
  | 'waiting_reviewer_quick_look'
  | 'changes_requested_by_reviewer'
  | 'reviewer_approved'
  | 'sent_to_art_director'
  | 'waiting_art_director_approval'
  | 'changes_requested_by_art_director'
  | 'approved_by_art_director'
  | 'team_leader_notified'
  | 'completed'
  | 'archived'
  | 'reopened_after_approval'
  | 'on_hold'
  | 'waiting_content_revision'
  | 'changes_requested_by_content';

export interface User {
  id: string;
  email?: string;
  name: string;
  role: Role;
  avatar?: string;
  jobTitle?: string;
  requestedRole?: Role;
  approvalStatus?: AccountApprovalStatus;
  isAdmin?: boolean;
  legacyId?: string | null;
}

export type AccountApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface AccountProfile {
  id: string;
  email: string;
  name: string;
  role: Role;
  jobTitle?: string;
  requestedRole: Role;
  approvalStatus: AccountApprovalStatus;
  isAdmin: boolean;
  legacyId?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResponsibilityOption {
  id: string;
  label: string;
  permissionRole: Role;
  grantsSettingsAccess?: boolean;
}

export interface PriorityOption {
  id: string;
  label: string;
  tone: PriorityTone;
  sortOrder: number;
  active: boolean;
}

export interface BusinessCalendarSettings {
  timezone: string;
  workdays: number[];
  startTime: string;
  endTime: string;
}

export interface TaskTypeConfig {
  id: string;
  label: string;
  suggestedJobTitles: string[];
  isDetailedReview: boolean;
  fullReviewerUserIds?: string[];
  quickLookUserIds?: string[];
  finalReviewerUserIds?: string[];
}

export interface AppSettings {
  responsibilities: ResponsibilityOption[];
  priorities: PriorityOption[];
  businessCalendar: BusinessCalendarSettings;
  settingsManagerUserIds: string[];
  settingsManagerResponsibilityIds: string[];
  workAssignmentCreatorIds: string[];
  contributorAssignerIds: string[];
  neverHandlerIds: string[];
  selfAssignmentBlockedIds: string[];
  videoOnlyHandlerIds: string[];
  alwaysAssignableHandlerIds: string[];
  flowLabels: Record<string, string>;
  customPermissions?: Array<{ id: string; label: string; userIds: string[] }>;
  taskTypes?: Array<string | TaskTypeConfig>;
  campaignPlatforms?: string[];
  hiddenColumns?: string[];
  firstReviewerUserIds?: string[];
  finalReviewerUserIds?: string[];
  viewAllWorkloadUserIds?: string[];
  updatedAt: string;
}

export type AuthStatus =
  | 'loading'
  | 'signed_out'
  | 'approved';

export interface UploadedTaskFile {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  storageProvider?: 'drive' | 'local' | 'link';
  storagePath?: string;
  previewUrl?: string;
  previewStoragePath?: string;
  driveFileId?: string;
  driveFolderId?: string;
  webViewLink?: string;
  downloadUrl?: string;
  blob?: Blob;
}

export interface TaskVersion {
  id: string;
  versionNumber: number;
  submittedBy: string; // user id
  submissionNote?: string;
  fileUrl: string;
  files?: UploadedTaskFile[];
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  taskId: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface TaskCommentSection {
  id: string;
  note: string;
  imageName?: string;
  imageUrl?: string;
  imageStoragePath?: string;
}

export interface TaskCommentEditVersion {
  id: string;
  previousMessage?: string;
  previousSections: TaskCommentSection[];
  nextMessage?: string;
  nextSections: TaskCommentSection[];
  editedBy: string;
  editedAt: string;
}

export interface TaskComment {
  id: string;
  authorId: string;
  action:
    | 'review_note'
    | 'request_edits'
    | 'sent_to_marwa'
    | 'marwa_rejection'
    | 'content_approved'
    | 'content_rejected'
    | 'assignment_change'
    | 'review_route_change'
    | 'publish_schedule_change'
    | 'campaign_published'
    | 'work_assignment_created'
    | 'work_assignment_updated'
    | 'work_assignment_uploaded'
    | 'version_added';
  message?: string;
  sections: TaskCommentSection[];
  createdAt: string;
  updatedAt?: string;
  editedBy?: string;
  isEdited?: boolean;
  editHistory?: TaskCommentEditVersion[];
  deletedAt?: string;
  deletedBy?: string;
  isDeleted?: boolean;
}

export interface Task {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  taskType: TaskType;
  reviewMode: ReviewMode;
  environment: Environment;
  createdBy: string; // user id
  handledBy: string[]; // user ids
  status: TaskStatus;
  currentOwnerRole: Role | null;
  currentOwnerUserId: string | null;
  currentOwnerUserIds: string[];
  priority: Priority;
  deadlineText: string | null;
  assignmentPeriod?: AssignmentPeriod | null;
  assignmentLinks?: string[];
  deadlineAt?: string | null;
  assignmentUploadedAt?: string | null;
  scheduledPublishAt?: string | null;
  publishNote?: string | null;
  publishedAt?: string | null;
  publishReminderSentAt?: string | null;
  platform?: string | null;
  weekReminderSentAt?: string | null;
  budgetAmount?: number | null;
  budgetCurrency?: string | null;
  versions: TaskVersion[];
  comments?: TaskComment[];
  thumbnailUrl: string;
  thumbnailStoragePath?: string;
  driveFolderId?: string;
  driveMetadataFileId?: string;
  archivedAt?: string | null;
  archivedReason?: string | null;
  isOvertime?: boolean | null;
  needsContentRevision?: boolean | null;
  previousStatusBeforeHold?: TaskStatus | null;
  createdAt: string;
  updatedAt: string;
}
