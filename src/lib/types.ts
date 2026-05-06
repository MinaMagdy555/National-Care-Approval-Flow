export type Role = 'team_member' | 'reviewer' | 'art_director' | 'team_leader' | 'admin';
export type Environment = 'production' | 'demo' | 'archived';
export type ReviewMode = 'full_review' | 'quick_look' | 'direct_to_ad';
export type Priority = 'low' | 'normal' | 'high' | 'urgent' | 'not_set';

export type TaskType = 
  | 'video' 
  | 'ai_packet'
  | 'sales_material'
  | 'website_material'
  | 'campaign'
  | 'others';

export type TaskStatus = 
  | 'draft'
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
  | 'reopened_after_approval';

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
  requestedRole: Role;
  approvalStatus: AccountApprovalStatus;
  isAdmin: boolean;
  legacyId?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
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
  storagePath?: string;
  previewUrl?: string;
  previewStoragePath?: string;
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

export interface TaskComment {
  id: string;
  authorId: string;
  action: 'review_note' | 'request_edits' | 'sent_to_marwa' | 'marwa_rejection';
  message?: string;
  sections: TaskCommentSection[];
  createdAt: string;
}

export interface Task {
  id: string;
  code: string;
  name: string;
  taskType: TaskType;
  reviewMode: ReviewMode;
  environment: Environment;
  createdBy: string; // user id
  handledBy: string[]; // user ids
  status: TaskStatus;
  currentOwnerRole: Role | null;
  currentOwnerUserId: string | null;
  priority: Priority;
  deadlineText: string | null;
  versions: TaskVersion[];
  comments?: TaskComment[];
  thumbnailUrl: string;
  thumbnailStoragePath?: string;
  archivedAt?: string | null;
  archivedReason?: string | null;
  createdAt: string;
  updatedAt: string;
}
