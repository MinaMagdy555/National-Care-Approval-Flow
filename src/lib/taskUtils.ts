import { Task, Role, Priority, TaskType, ReviewMode } from './types';
import { isTaskArchived } from './archiveUtils';

export function getTaskTypeLabel(type: TaskType): string {
  switch (type) {
    case 'video': return 'Video';
    case 'ai_packet': return 'AI Packets';
    case 'sales_material': return 'Sales Material';
    case 'website_material': return 'Website Material';
    case 'campaign': return 'Campaign';
    case 'others': return 'Others';
    default: return 'Asset';
  }
}

export function getReviewModeLabel(mode: ReviewMode): string {
  switch (mode) {
    case 'full_review': return 'Full Review';
    case 'quick_look': return 'Quick Look';
    case 'direct_to_ad': return 'Direct to Art Director';
    default: return 'Review';
  }
}

export function getPriorityLabel(priority: Priority): string {
  switch (priority) {
    case 'not_set': return 'Not Set';
    case 'low': return 'Low';
    case 'normal': return 'Normal';
    case 'high': return 'High';
    case 'urgent': return 'Urgent';
    default: return 'Not Set';
  }
}

export function getStatusInfo(task: Task, viewerRole: Role): { label: string; color: 'amber' | 'blue' | 'green' | 'red' | 'gray' | 'purple' } {
  const { status } = task;

  if (isTaskArchived(task)) {
    return { label: 'Archived', color: 'gray' };
  }

  if (viewerRole === 'team_member') {
    switch (status) {
      case 'submitted': return { label: 'Waiting for reviewer', color: 'blue' };
      case 'waiting_reviewer_full_review': return { label: 'Waiting for reviewer', color: 'blue' };
      case 'waiting_reviewer_quick_look': return { label: 'Waiting for reviewer quick look', color: 'blue' };
      case 'changes_requested_by_reviewer': return { label: 'Changes requested by reviewer', color: 'red' };
      case 'reviewer_approved': return { label: 'Passed reviewer - waiting for art director', color: 'blue' };
      case 'sent_to_art_director': return { label: 'Waiting for art director', color: 'blue' };
      case 'waiting_art_director_approval': return { label: 'Waiting for art director', color: 'blue' };
      case 'changes_requested_by_art_director': return { label: 'Changes requested by art director', color: 'red' };
      case 'approved_by_art_director': return { label: 'Approved', color: 'green' };
      case 'completed': return { label: 'Completed', color: 'green' };
      case 'archived': return { label: 'Archived', color: 'gray' };
      default: return { label: 'In Progress', color: 'gray' };
    }
  }

  if (viewerRole === 'reviewer') {
    switch (status) {
      case 'waiting_reviewer_full_review': return { label: 'Waiting for your full review', color: 'amber' };
      case 'submitted': return { label: 'Needs your review', color: 'amber' };
      case 'waiting_reviewer_quick_look': return { label: 'Needs your quick look', color: 'amber' };
      case 'changes_requested_by_reviewer': return { label: 'Returned to creator for changes', color: 'red' };
      case 'reviewer_approved': return { label: 'Sent to art director', color: 'blue' };
      case 'sent_to_art_director': return { label: 'Sent to art director', color: 'blue' };
      case 'waiting_art_director_approval': return { label: 'Waiting for art director', color: 'blue' };
      case 'changes_requested_by_art_director': return { label: 'Art director requested changes', color: 'red' };
      case 'approved_by_art_director': return { label: 'Approved by art director', color: 'green' };
      case 'completed': return { label: 'Completed', color: 'green' };
      case 'archived': return { label: 'Archived', color: 'gray' };
      default: return { label: status, color: 'gray' };
    }
  }

  if (viewerRole === 'art_director') {
    switch (status) {
      case 'reviewer_approved': return { label: 'Ready for your approval', color: 'amber' };
      case 'sent_to_art_director': return { label: 'Ready for your approval', color: 'amber' };
      case 'waiting_art_director_approval': return { label: 'Ready for your approval', color: 'amber' };
      case 'approved_by_art_director': return { label: 'You approved this', color: 'green' };
      case 'changes_requested_by_art_director': return { label: 'You requested changes', color: 'red' };
      case 'waiting_reviewer_full_review': return { label: 'With Reviewer', color: 'gray' };
      case 'submitted': return { label: 'With Reviewer', color: 'gray' };
      case 'waiting_reviewer_quick_look': return { label: 'With Reviewer', color: 'gray' };
      case 'changes_requested_by_reviewer': return { label: 'Returned by Reviewer', color: 'gray' };
      case 'completed': return { label: 'Completed', color: 'green' };
      case 'archived': return { label: 'Archived', color: 'gray' };
      default: return { label: status, color: 'gray' };
    }
  }

  switch (status) {
    case 'submitted':
    case 'waiting_reviewer_full_review':
    case 'waiting_reviewer_quick_look': return { label: 'In Review', color: 'blue' };
    case 'changes_requested_by_reviewer':
    case 'changes_requested_by_art_director': return { label: 'Changes Requested', color: 'red' };
    case 'sent_to_art_director':
    case 'waiting_art_director_approval': return { label: 'With art director', color: 'blue' };
    case 'approved_by_art_director': return { label: 'Approved', color: 'green' };
    case 'completed': return { label: 'Completed', color: 'green' };
    default: return { label: status, color: 'gray' };
  }
}

export function getNextActionLabel(task: Task, viewerRole: Role): string {
  const { status } = task;

  if (isTaskArchived(task)) {
    return 'Archived';
  }

  if (viewerRole === 'team_member') {
    if (status === 'changes_requested_by_reviewer' || status === 'changes_requested_by_art_director') {
      return 'Resubmit new version';
    }
    return 'Waiting';
  }

  if (viewerRole === 'reviewer') {
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

  return 'None';
}
