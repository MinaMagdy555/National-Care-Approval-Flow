import { Task, Role, Priority, TaskType, ReviewMode, AppSettings, User } from './types';
import { isTaskArchived } from './archiveUtils';
import { defaultAppSettings, getPriorityLabelFromSettings } from './appSettings';

export function getTaskTypeLabel(type: TaskType, settings?: AppSettings): string {
  if (!type) return 'Asset';
  if (settings && settings.taskTypes) {
    const found = settings.taskTypes.find(t => {
      const id = typeof t === 'object' && t !== null ? t.id : String(t);
      return id.toLowerCase().trim() === type.toLowerCase().trim();
    });
    if (found && typeof found === 'object' && found.label) {
      return found.label;
    }
  }
  const clean = type.toLowerCase().replace(/_/g, ' ').trim();
  switch (clean) {
    case 'video': return 'Video';
    case 'ai packet': return 'AI Packets';
    case 'sales material': return 'Sales Material';
    case 'website material': return 'Website Material';
    case 'campaign': return 'Campaign';
    case 'write content': return 'Write Content';
    case 'write caption': return 'Write Caption';
    case 'reels voice over script': return 'Reels Voice Over Script';
    case 'others': return 'Others';
    default: {
      return clean
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
  }
}

export function getReviewModeLabel(mode: ReviewMode): string {
  switch (mode) {
    case 'full_review': return 'Full Review';
    case 'quick_look': return 'Quick Look';
    case 'direct_to_ad': return 'Direct to Final Approvement';
    default: return 'Review';
  }
}

export function getPriorityLabel(priority: Priority, settings = defaultAppSettings): string {
  return getPriorityLabelFromSettings(settings, priority);
}

export function getStatusInfo(task: Task, viewerRole: Role, users?: Record<string, User>): { label: string; color: 'amber' | 'blue' | 'green' | 'red' | 'gray' | 'purple' } {
  const { status } = task;

  if (isTaskArchived(task)) {
    return { label: 'Archived', color: 'gray' };
  }

  if (status === 'on_hold') {
    return { label: 'On Hold', color: 'gray' };
  }

  const waitingReviewStatuses = [
    'submitted',
    'waiting_reviewer_full_review',
    'waiting_reviewer_quick_look',
    'reviewer_approved',
    'sent_to_art_director',
    'waiting_art_director_approval'
  ];

  const hasActiveComments = !!(
    task.comments &&
    task.comments.some(c => {
      if (c.isDeleted || c.deletedAt) return false;
      const messageText = c.message?.trim() || '';
      const hasContent = messageText.length > 0 || (c.sections && c.sections.length > 0);
      if (!hasContent) return false;

      // Filter only reviewer comments (ignore creator/contributor upload comments or non-reviewer notes)
      const feedbackActions = ['review_note', 'request_edits', 'sent_to_marwa', 'marwa_rejection', 'content_approved', 'content_rejected'];
      if (!feedbackActions.includes(c.action)) return false;

      // Check author role if users map is available
      if (users && users[c.authorId]) {
        const authorRole = users[c.authorId].role;
        // If author is a team member, it's not a reviewer comment (it might be a reply or request comments)
        if (authorRole === 'team_member') return false;
      } else {
        // Fallback to known reviewer/admin/leader IDs
        const reviewerIds = [
          '83e02bb4-11f9-41b0-becb-33e6c4c52b2a', // MINA_ID
          'd65ea68d-1749-45b9-b0f9-1fdaf23b8f94', // MARWA_ID
          '094d2844-ca2f-401b-8819-b464eace00d2', // DINA_ID
          '6d7f8829-23f3-40d3-ba30-b079fda01899', // FAWZY_ID
          '697a804f-d7b0-4edb-9a0a-b42f0e7f8b53'  // AHMED_SOBEEH_ID
        ];
        if (!reviewerIds.includes(c.authorId)) return false;
      }

      return true;
    })
  );

  if (waitingReviewStatuses.includes(status) && hasActiveComments) {
    return { label: 'Had some comments', color: 'amber' };
  }

  if (viewerRole === 'team_member') {
    switch (status) {
      case 'submitted': return { label: 'Waiting for First Review', color: 'blue' };
      case 'assigned_work': return { label: 'Active', color: 'purple' };
      case 'waiting_reviewer_full_review': return { label: 'Waiting for First Review', color: 'blue' };
      case 'waiting_reviewer_quick_look': return { label: 'Waiting for First Review', color: 'blue' };
      case 'changes_requested_by_reviewer': return { label: 'Changes requested in First Review', color: 'red' };
      case 'reviewer_approved': return { label: 'Waiting for Final Review', color: 'blue' };
      case 'sent_to_art_director': return { label: 'Waiting for Final Review', color: 'blue' };
      case 'waiting_art_director_approval': return { label: 'Waiting for Final Review', color: 'blue' };
      case 'changes_requested_by_art_director': return { label: 'Changes requested in Final Approvement', color: 'red' };
      case 'waiting_content_revision': return { label: 'Waiting for content rev.', color: 'amber' };
      case 'changes_requested_by_content': return { label: 'Content changes requested', color: 'red' };
      case 'approved_by_art_director': return { label: 'Approved', color: 'green' };
      case 'completed': return { label: 'Completed', color: 'green' };
      case 'archived': return { label: 'Archived', color: 'gray' };
      default: return { label: 'In Progress', color: 'gray' };
    }
  }

  if (viewerRole === 'reviewer') {
    switch (status) {
      case 'waiting_reviewer_full_review': return { label: 'Waiting for First Review', color: 'amber' };
      case 'assigned_work': return { label: 'Active', color: 'purple' };
      case 'submitted': return { label: 'Waiting for First Review', color: 'amber' };
      case 'waiting_reviewer_quick_look': return { label: 'Waiting for First Review', color: 'amber' };
      case 'changes_requested_by_reviewer': return { label: 'Returned to creator for changes', color: 'red' };
      case 'reviewer_approved': return { label: 'Waiting for Final Review', color: 'blue' };
      case 'sent_to_art_director': return { label: 'Waiting for Final Review', color: 'blue' };
      case 'waiting_art_director_approval': return { label: 'Waiting for Final Review', color: 'blue' };
      case 'changes_requested_by_art_director': return { label: 'Final Approvement requested changes', color: 'red' };
      case 'waiting_content_revision': return { label: 'Waiting for content rev.', color: 'gray' };
      case 'changes_requested_by_content': return { label: 'Returned for content changes', color: 'red' };
      case 'approved_by_art_director': return { label: 'Approved by Final Approvement', color: 'green' };
      case 'completed': return { label: 'Completed', color: 'green' };
      case 'archived': return { label: 'Archived', color: 'gray' };
      default: return { label: status, color: 'gray' };
    }
  }

  if (viewerRole === 'art_director') {
    switch (status) {
      case 'reviewer_approved': return { label: 'Waiting for Final Review', color: 'amber' };
      case 'assigned_work': return { label: 'Active', color: 'purple' };
      case 'sent_to_art_director': return { label: 'Waiting for Final Review', color: 'amber' };
      case 'waiting_art_director_approval': return { label: 'Waiting for Final Review', color: 'amber' };
      case 'approved_by_art_director': return { label: 'Approved by Final Approvement', color: 'green' };
      case 'changes_requested_by_art_director': return { label: 'Changes requested by Final Approvement', color: 'red' };
      case 'waiting_reviewer_full_review': return { label: 'Waiting for First Review', color: 'gray' };
      case 'submitted': return { label: 'Waiting for First Review', color: 'gray' };
      case 'waiting_reviewer_quick_look': return { label: 'Waiting for First Review', color: 'gray' };
      case 'changes_requested_by_reviewer': return { label: 'Returned by Reviewer', color: 'gray' };
      case 'waiting_content_revision': return { label: 'Waiting for content rev.', color: 'gray' };
      case 'changes_requested_by_content': return { label: 'Returned for content changes', color: 'red' };
      case 'completed': return { label: 'Completed', color: 'green' };
      case 'archived': return { label: 'Archived', color: 'gray' };
      default: return { label: status, color: 'gray' };
    }
  }

  switch (status) {
    case 'assigned_work': return { label: 'Active', color: 'purple' };
    case 'submitted':
    case 'waiting_reviewer_full_review':
    case 'waiting_reviewer_quick_look': return { label: 'Waiting for First Review', color: 'blue' };
    case 'changes_requested_by_reviewer': return { label: 'First Review Changes Requested', color: 'red' };
    case 'changes_requested_by_art_director': return { label: 'Final Approvement Changes Requested', color: 'red' };
    case 'changes_requested_by_content': return { label: 'Content Changes Requested', color: 'red' };
    case 'waiting_content_revision': return { label: 'Waiting for content rev.', color: 'amber' };
    case 'sent_to_art_director':
    case 'waiting_art_director_approval':
    case 'reviewer_approved': return { label: 'Waiting for Final Review', color: 'blue' };
    case 'approved_by_art_director': return { label: 'Approved by Final Approvement', color: 'green' };
    case 'completed': return { label: 'Completed', color: 'green' };
    default: return { label: status, color: 'gray' };
  }
}

export function getNextActionLabel(task: Task, viewerRole: Role): string {
  const { status } = task;

  if (isTaskArchived(task)) {
    return 'Archived';
  }

  if (status === 'on_hold') {
    return 'On Hold';
  }

  if (viewerRole === 'team_member') {
    if (status === 'assigned_work') {
      return 'Upload finished work';
    }

    if (status === 'changes_requested_by_reviewer' || status === 'changes_requested_by_art_director' || status === 'changes_requested_by_content') {
      return 'Resubmit version';
    }
    if (status === 'waiting_content_revision') {
      return 'Review Content';
    }
    return 'Waiting';
  }

  if (viewerRole === 'reviewer') {
    if (status === 'assigned_work') {
      return 'Waiting for upload';
    }

    if (status === 'submitted' || status === 'waiting_reviewer_full_review') {
      return 'Review now';
    }
    if (status === 'waiting_reviewer_quick_look') {
      return 'Quick look & send';
    }
    if (status === 'approved_by_art_director') {
      return 'No action needed - approved';
    }
  }

  if (viewerRole === 'art_director') {
    if (status === 'assigned_work') {
      return 'Waiting for upload';
    }

    if (status === 'sent_to_art_director' || status === 'waiting_art_director_approval' || status === 'reviewer_approved') {
      return 'Review & Decide';
    }
    if (status === 'approved_by_art_director') {
      return 'No action needed - you approved';
    }
    if (status === 'changes_requested_by_art_director') {
      return 'Waiting for creator to resubmit';
    }
  }

  if (status === 'assigned_work') return 'Waiting for upload';

  return 'None';
}
