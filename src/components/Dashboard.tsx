import React from 'react';
import { useAppStore } from '../lib/store';
import { TaskCard } from './TaskCard';
import { AlertCircle, Clock, CheckCircle2, History, LucideIcon, XCircle, Search, Users, LayoutDashboard, X, FileText, BriefcaseBusiness } from 'lucide-react';
import { initialUsers } from '../lib/mockData';
import { isDueThisWeek, isDueToday } from '../lib/deadlineUtils';
import { isTaskArchived } from '../lib/archiveUtils';
import { canUserAccessTask, canUserActAsCurrentOwner, userCanViewFullWorkspace } from '../lib/workflowUtils';
import { cn } from '../lib/utils';
import { getResponsibilityForLabel, MINA_ID, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID, getTaskTypeConfigs } from '../lib/appSettings';
import { Task } from '../lib/types';
import { isLeaderboardUser } from '../lib/workAssignmentUtils';

function SummaryCard({
  label,
  value,
  icon: Icon,
  textClassName,
  borderClassName,
  iconClassName,
  className = '',
  onClick,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  textClassName: string;
  borderClassName: string;
  iconClassName: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex h-28 min-w-0 overflow-hidden rounded-xl border bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:h-32 sm:rounded-2xl ${borderClassName} ${className}`}
    >
      <div className="absolute right-0 top-0 p-3 opacity-10 transition-opacity group-hover:opacity-20 sm:p-4">
        <Icon className={`h-9 w-9 sm:h-12 sm:w-12 ${iconClassName}`} />
      </div>
      <div className="relative z-10 flex w-full flex-col justify-between p-4">
        <span className={`max-w-[72%] text-sm font-bold leading-tight sm:text-base ${textClassName}`}>{label}</span>
        <span className={`text-2xl font-black leading-none sm:text-3xl ${textClassName}`}>{value}</span>
      </div>
    </button>
  );
}

function DueSummaryCard({
  label,
  value,
  tone,
  badge,
  onClick,
}: {
  label: string;
  value: number;
  tone: 'rose' | 'orange';
  badge: string;
  onClick: () => void;
}) {
  const toneClass = tone === 'rose'
    ? 'border-rose-100 bg-rose-50 text-rose-900'
    : 'border-orange-100 bg-orange-50 text-orange-900';
  const badgeClass = tone === 'rose'
    ? 'bg-rose-200 text-rose-800'
    : 'bg-orange-200 text-orange-800';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex h-28 min-w-0 flex-col justify-between overflow-hidden rounded-xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:h-32 sm:rounded-2xl ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-bold leading-tight sm:text-base">{label}</span>
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider sm:px-2 sm:text-[10px] ${badgeClass}`}>{badge}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-black leading-none sm:text-3xl">{value}</span>
        <span className="text-sm font-semibold">Tasks</span>
      </div>
    </button>
  );
}

export function Dashboard({
  viewMode = 'overview',
  onOpenTask,
  onNavigate,
}: {
  viewMode?: 'overview' | 'performance';
  onOpenTask: (id: string) => void;
  onNavigate: (view: string) => void;
}) {
  const { tasks, currentUser, environment, userList, appSettings } = useAppStore();
  const [popupCreatorId, setPopupCreatorId] = React.useState<string | null>(null);
  const [popupState, setPopupState] = React.useState<'total' | 'finished' | 'active' | 'on_hold' | 'working' | 'waiting_review' | 'to_review' | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const configs = getTaskTypeConfigs(appSettings);

  React.useEffect(() => {
    if (viewMode === 'performance') {
      const prefCreator = window.sessionStorage.getItem('preferred-perf-creator');
      const prefState = window.sessionStorage.getItem('preferred-perf-state');
      if (prefCreator) {
        setPopupCreatorId(prefCreator);
        setPopupState((prefState as any) || 'active');
        window.sessionStorage.removeItem('preferred-perf-creator');
        window.sessionStorage.removeItem('preferred-perf-state');
      }
    }
  }, [viewMode]);

  const canSeeCreatorCards = React.useMemo(() => {
    return (
      appSettings.workAssignmentCreatorIds.includes(currentUser.id) ||
      appSettings.settingsManagerUserIds.includes(currentUser.id) ||
      appSettings.contributorAssignerIds.includes(currentUser.id) ||
      ['reviewer', 'art_director', 'admin', 'team_leader', 'marketing_manager', 'manager'].includes(currentUser.role)
    );
  }, [currentUser, appSettings]);

  const isLeaderboardOrMinaUser = React.useMemo(() => {
    const leaderboardIds = [MINA_ID, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID];
    return leaderboardIds.includes(currentUser.id) || 
      currentUser.name.includes('Mina') || 
      currentUser.name.includes('Dina') || 
      currentUser.name.includes('Marwa') || 
      currentUser.name.includes('Sobeeh') || 
      currentUser.name.includes('Fawzy') ||
      currentUser.email === 'minamagdy5555@gmail.com';
  }, [currentUser]);

  const graphicAndVideoUsers = React.useMemo(() => {
    return userList.filter(u => {
      if (u.id === 'guest') return false;

      // Include Mina (reviewer or by email)
      const isMina = u.role === 'reviewer' || u.email === 'minamagdy5555@gmail.com' || u.id === MINA_ID || u.id === 'user_1';
      if (isMina) return true;

      if (u.role !== 'team_member') return false;
      if (!u.jobTitle) return false;
      
      const jobTitleLower = u.jobTitle.toLowerCase();
      if (
        jobTitleLower.includes('manager') ||
        jobTitleLower.includes('leader') ||
        jobTitleLower.includes('director') ||
        jobTitleLower.includes('developer') ||
        jobTitleLower.includes('hr') ||
        jobTitleLower.includes('admin')
      ) {
        return false;
      }

      if (appSettings.neverHandlerIds.includes(u.id)) return false;

      return true;
    });
  }, [userList, appSettings]);

  const creatorsWithStats = React.useMemo(() => {
    return graphicAndVideoUsers.map(creator => {
      const creatorTasks = tasks.filter(t => {
        if (t.environment !== environment) return false;
        return t.handledBy.includes(creator.id) || (t.contentRevisionAssigneeIds || []).includes(creator.id);
      });
      
      const onHoldTasks = creatorTasks.filter(t => t.status === 'on_hold');
      const onHoldCount = onHoldTasks.length;
      
      const finishedTasks = creatorTasks.filter(t => 
        t.status === 'approved' || 
        t.status === 'completed' || 
        t.status === 'approved_by_art_director' || 
        isTaskArchived(t)
      );
      
      const finishedCount = finishedTasks.length;
      const activeCount = creatorTasks.length - finishedCount - onHoldCount;
      const workingCount = creatorTasks.filter(t => 
        t.status === 'assigned_work' || 
        t.status === 'draft' ||
        (t.status === 'waiting_content_revision' && (t.contentRevisionAssigneeIds || []).includes(creator.id))
      ).length;
      const reviewCount = activeCount - workingCount;

      const creatorIsFirstRev = (appSettings.firstReviewerUserIds || []).includes(creator.id) ||
        configs.some(c => c.fullReviewerUserIds?.includes(creator.id) || c.quickLookUserIds?.includes(creator.id));
      const creatorIsFinalRev = (appSettings.finalReviewerUserIds || []).includes(creator.id) ||
        configs.some(c => c.finalReviewerUserIds?.includes(creator.id));
      const creatorIsContentCreator = creator.jobTitle === 'Content Creator' || (creator.role === 'team_member' && creator.jobTitle === 'Content Creator');

      let toReviewCount = 0;
      if (creatorIsFirstRev) {
        toReviewCount = tasks.filter(t => 
          t.environment === environment && 
          !isTaskArchived(t) &&
          ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status) &&
          canUserActAsCurrentOwner(t, creator)
        ).length;
      } else if (creatorIsFinalRev) {
        toReviewCount = tasks.filter(t => 
          t.environment === environment && 
          !isTaskArchived(t) &&
          (['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status) || (t.reviewMode === 'direct_to_ad' && t.status === 'sent_to_art_director')) &&
          canUserActAsCurrentOwner(t, creator)
        ).length;
      } else if (creatorIsContentCreator) {
        toReviewCount = tasks.filter(t => 
          t.environment === environment && 
          !isTaskArchived(t) &&
          t.status === 'waiting_content_revision' &&
          (t.contentRevisionAssigneeIds || []).includes(creator.id)
        ).length;
      }
      
      return {
        creator,
        finishedCount,
        activeCount,
        onHoldCount,
        workingCount,
        reviewCount,
        toReviewCount,
        creatorIsFirstRev,
        creatorIsFinalRev,
        creatorIsContentCreator,
        totalCount: creatorTasks.length,
      };
    });
  }, [graphicAndVideoUsers, tasks, environment, appSettings, configs]);

  const filteredCreators = React.useMemo(() => {
    if (!searchQuery.trim()) return creatorsWithStats;
    const q = searchQuery.toLowerCase().trim();
    return creatorsWithStats.filter(c => 
      c.creator.name.toLowerCase().includes(q) ||
      (c.creator.jobTitle || '').toLowerCase().includes(q)
    );
  }, [creatorsWithStats, searchQuery]);

  const isFirstRev = (appSettings.firstReviewerUserIds || []).includes(currentUser.id) ||
    configs.some(c => c.fullReviewerUserIds?.includes(currentUser.id) || c.quickLookUserIds?.includes(currentUser.id)) ||
    currentUser.role === 'team_leader';
  const isFinalRev = (appSettings.finalReviewerUserIds || []).includes(currentUser.id) ||
    configs.some(c => c.finalReviewerUserIds?.includes(currentUser.id));
  const isContentCreator = currentUser.jobTitle === 'Content Creator' || (currentUser.role === 'team_member' && currentUser.jobTitle === 'Content Creator');
  const isHighboard = isFirstRev || isFinalRev || currentUser.role !== 'team_member' || isLeaderboardUser(currentUser.id);

  const canViewFullWorkspace = userCanViewFullWorkspace(currentUser, appSettings);
  const envTasks = tasks.filter(t => t.environment === environment && !isTaskArchived(t) && (canViewFullWorkspace || canUserAccessTask(t, currentUser, appSettings)));
  const workflowTasks = envTasks.filter(task => task.status !== 'assigned_work');
  const myActiveTasks = envTasks.filter(t => t.status === 'assigned_work' && t.handledBy.includes(currentUser.id));
  const isScopedToCurrentOwner = (task: typeof envTasks[number]) => (
    !isFirstRev && !isFinalRev
      ? true
      : canUserActAsCurrentOwner(task, currentUser)
  );
  const minaName = 'Mina';
  const marwaName = 'Marwa';
  const isWorkspaceMonitor = ['team_leader', 'manager', 'developer', 'marketing_manager', 'admin'].includes(currentUser.role) || (appSettings.viewAllWorkloadUserIds || []).includes(currentUser.id);
  const usesWorkspaceOverview = !isFirstRev && !isFinalRev;

  let needsAction = [];
  let waitingOthers = [];
  let approved = [];
  let returned = [];
  let waitingForMina = [];
  let waitingForMarwa = [];

  if (isFirstRev) {
    needsAction = workflowTasks.filter(t => ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status) && isScopedToCurrentOwner(t));
    waitingOthers = workflowTasks.filter(t => ['sent_to_art_director', 'waiting_art_director_approval'].includes(t.status));
    approved = workflowTasks.filter(t => t.status === 'approved_by_art_director');
    returned = workflowTasks.filter(t => ['changes_requested_by_reviewer', 'changes_requested_by_art_director'].includes(t.status));
  } else if (isFinalRev) {
    needsAction = workflowTasks.filter(t => (['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status) || (t.reviewMode === 'direct_to_ad' && t.status === 'sent_to_art_director')) && isScopedToCurrentOwner(t));
    waitingOthers = workflowTasks.filter(t => t.status === 'changes_requested_by_art_director' || t.status === 'waiting_reviewer_full_review' || t.status === 'waiting_reviewer_quick_look');
    approved = workflowTasks.filter(t => t.status === 'approved_by_art_director');
    returned = workflowTasks.filter(t => t.status === 'changes_requested_by_art_director');
    waitingForMina = workflowTasks.filter(t => ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status));
  } else if (isContentCreator) {
    needsAction = workflowTasks.filter(t => t.status === 'waiting_content_revision' && (t.currentOwnerUserIds || []).includes(currentUser.id));
    waitingForMina = workflowTasks.filter(t => ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status));
    waitingForMarwa = workflowTasks.filter(t => ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status));
    returned = workflowTasks.filter(t => t.status === 'changes_requested_by_content');
    approved = workflowTasks.filter(t => t.status === 'approved_by_art_director' || t.status === 'completed');
  } else if (isWorkspaceMonitor) {
    approved = workflowTasks.filter(t => t.status === 'approved_by_art_director' || t.status === 'completed');
    waitingOthers = workflowTasks.filter(t => t.status !== 'approved_by_art_director' && t.status !== 'completed' && !t.status.includes('changes_requested'));
    returned = workflowTasks.filter(t => ['changes_requested_by_reviewer', 'changes_requested_by_art_director'].includes(t.status));
    waitingForMina = workflowTasks.filter(t => ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status));
    waitingForMarwa = workflowTasks.filter(t => ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status));
  } else {
    needsAction = workflowTasks.filter(t => (t.createdBy === currentUser.id || t.handledBy.includes(currentUser.id) || (t.currentOwnerUserIds || []).includes(currentUser.id)) && (t.status === 'changes_requested_by_reviewer' || t.status === 'changes_requested_by_art_director'));
    waitingOthers = workflowTasks.filter(t => (t.createdBy === currentUser.id || t.handledBy.includes(currentUser.id) || (t.currentOwnerUserIds || []).includes(currentUser.id)) && ['waiting_reviewer_full_review', 'waiting_reviewer_quick_look', 'reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status));
    approved = workflowTasks.filter(t => (t.createdBy === currentUser.id || t.handledBy.includes(currentUser.id) || (t.currentOwnerUserIds || []).includes(currentUser.id)) && t.status === 'approved_by_art_director');
    returned = needsAction;
    waitingForMina = workflowTasks.filter(t => (t.createdBy === currentUser.id || t.handledBy.includes(currentUser.id) || (t.currentOwnerUserIds || []).includes(currentUser.id)) && ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status));
    waitingForMarwa = workflowTasks.filter(t => (t.createdBy === currentUser.id || t.handledBy.includes(currentUser.id) || (t.currentOwnerUserIds || []).includes(currentUser.id)) && ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status));
  }

  const popupTasks = React.useMemo(() => {
    if (!popupCreatorId || !popupState) return [];

    const creator = userList.find(u => u.id === popupCreatorId);
    const creatorIsFirstRev = creator ? (appSettings.firstReviewerUserIds || []).includes(creator.id) ||
      configs.some(c => c.fullReviewerUserIds?.includes(creator.id) || c.quickLookUserIds?.includes(creator.id)) ||
      creator.role === 'team_leader' : false;
    const creatorIsFinalRev = creator ? (appSettings.finalReviewerUserIds || []).includes(creator.id) ||
      configs.some(c => c.finalReviewerUserIds?.includes(creator.id)) : false;
    const creatorIsContentCreator = creator ? (creator.jobTitle === 'Content Creator' || (creator.role === 'team_member' && creator.jobTitle === 'Content Creator')) : false;

    return tasks.filter(t => {
      if (t.environment !== environment) return false;
      
      // If we clicked on 'to_review' (from Team Performance)
      if (popupState === 'to_review') {
        if (creatorIsFirstRev) {
          return ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status) && !isTaskArchived(t) && creator && canUserActAsCurrentOwner(t, creator);
        }
        if (creatorIsFinalRev) {
          return (['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status) || (t.reviewMode === 'direct_to_ad' && t.status === 'sent_to_art_director')) && !isTaskArchived(t) && creator && canUserActAsCurrentOwner(t, creator);
        }
        if (creatorIsContentCreator) {
          return t.status === 'waiting_content_revision' && (t.contentRevisionAssigneeIds || []).includes(popupCreatorId) && !isTaskArchived(t);
        }
        return false;
      }

      // Check if task belongs to the creator
      const belongsToCreator = t.handledBy.includes(popupCreatorId) || (t.contentRevisionAssigneeIds || []).includes(popupCreatorId);

      // If we are looking for 'active' tasks, for reviewers we also include tasks waiting for their review
      if (popupState === 'active') {
        const isFinished = t.status === 'approved' || t.status === 'completed' || t.status === 'approved_by_art_director' || isTaskArchived(t);
        if (isFinished || t.status === 'on_hold') return false;
        
        if (belongsToCreator) return true;
        
        // If it doesn't belong to them but they are a reviewer, check if it is waiting for their review
        if (creatorIsFirstRev) {
          return ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status) && creator && canUserActAsCurrentOwner(t, creator);
        }
        if (creatorIsFinalRev) {
          return (['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status) || (t.reviewMode === 'direct_to_ad' && t.status === 'sent_to_art_director')) && creator && canUserActAsCurrentOwner(t, creator);
        }
        return false;
      }

      // Otherwise, the task must belong to the creator:
      if (!belongsToCreator) return false;

      // Filter based on selected state:
      if (popupState === 'finished') {
        return t.status === 'approved' || t.status === 'completed' || t.status === 'approved_by_art_director' || isTaskArchived(t);
      }
      if (popupState === 'on_hold') {
        return t.status === 'on_hold';
      }
      if (popupState === 'working') {
        return t.status === 'assigned_work' || t.status === 'draft' || (t.status === 'waiting_content_revision' && (t.contentRevisionAssigneeIds || []).includes(popupCreatorId));
      }
      if (popupState === 'waiting_review') {
        const isFinished = t.status === 'approved' || t.status === 'completed' || t.status === 'approved_by_art_director' || isTaskArchived(t);
        const isWorking = t.status === 'assigned_work' || t.status === 'draft' || (t.status === 'waiting_content_revision' && (t.contentRevisionAssigneeIds || []).includes(popupCreatorId));
        return !isFinished && t.status !== 'on_hold' && !isWorking;
      }
      
      return true;
    });
  }, [tasks, popupCreatorId, popupState, environment, userList, appSettings, configs]);

  const needsFullReviewCount = workflowTasks.filter(t => ['submitted', 'waiting_reviewer_full_review'].includes(t.status) && isScopedToCurrentOwner(t)).length;
  const needsQuickLookCount = workflowTasks.filter(t => t.status === 'waiting_reviewer_quick_look' && isScopedToCurrentOwner(t)).length;
  const waitingMarwaCount = workflowTasks.filter(t => ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status) && (currentUser.role !== 'art_director' || isScopedToCurrentOwner(t))).length;
  const approvedCount = workflowTasks.filter(t => t.status === 'approved_by_art_director').length;
  const waitingContentRevCount = workflowTasks.filter(t => t.status === 'waiting_content_revision').length;
  const rejectedCount = returned.length;
  const dueTodayCount = workflowTasks.filter(isDueToday).length;
  const dueThisWeekCount = workflowTasks.filter(isDueThisWeek).length;
  const hasStatusCards = usesWorkspaceOverview || isFirstRev || isFinalRev || currentUser.role === 'reviewer' || currentUser.role === 'art_director' || isContentCreator;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 pb-6 pt-0 sm:space-y-8 sm:px-6 sm:py-6 lg:space-y-12 lg:px-8">
      <div className="mb-1 sm:mb-4">
        <h2 className="mb-1 text-2xl font-black tracking-tight text-slate-900 sm:mb-2 sm:text-3xl">Welcome, {currentUser.name.split(' ')[0]}</h2>
        <p className="text-sm font-medium text-slate-500 sm:text-base">Here's an overview of the current workspace.</p>
      </div>

      {viewMode === 'overview' && (
        <div className="space-y-3 sm:space-y-4">
        {hasStatusCards && (
          <div className={`grid auto-rows-fr grid-cols-2 gap-3 sm:gap-4 ${
            isFirstRev ? 'xl:grid-cols-6' : 
            (isFinalRev || isHighboard) ? 'xl:grid-cols-5' : 
            isContentCreator ? 'xl:grid-cols-3' : 'xl:grid-cols-4'
          }`}>
            {isFirstRev ? (
              <>
            <SummaryCard
              label="Waiting for Content Rev."
              value={waitingContentRevCount}
              icon={FileText}
              textClassName="text-amber-800"
              borderClassName="border-amber-100"
              iconClassName="text-amber-600"
              onClick={() => onNavigate('content_revision_queue')}
            />
            <SummaryCard
              label="Waiting for First Rev."
              value={needsFullReviewCount}
              icon={AlertCircle}
              textClassName="text-amber-800"
              borderClassName="border-amber-100"
              iconClassName="text-amber-600"
              onClick={() => onNavigate('review_queue')}
            />
            <SummaryCard
              label="Needs Quick Look"
              value={needsQuickLookCount}
              icon={Clock}
              textClassName="text-indigo-800"
              borderClassName="border-indigo-100"
              iconClassName="text-indigo-600"
              onClick={() => onNavigate('quick_look_queue')}
            />
            <SummaryCard
              label="Waiting for Final Rev."
              value={waitingMarwaCount}
              icon={History}
              textClassName="text-slate-800"
              borderClassName="border-slate-200"
              iconClassName="text-slate-600"
              className="col-span-2 xl:col-span-1"
              onClick={() => onNavigate('ad_queue')}
            />
            <SummaryCard
              label="Rejected"
              value={rejectedCount}
              icon={XCircle}
              textClassName="text-rose-800"
              borderClassName="border-rose-100"
              iconClassName="text-rose-600"
              className="order-5 xl:order-none"
              onClick={() => onNavigate('rejected_reopened')}
            />
            <SummaryCard
              label="Approved"
              value={approvedCount}
              icon={CheckCircle2}
              textClassName="text-emerald-800"
              borderClassName="border-emerald-100"
              iconClassName="text-emerald-600"
              className="order-4 xl:order-none"
              onClick={() => onNavigate('approved_by_me')}
            />
              </>
            ) : isContentCreator ? (
              <>
            <SummaryCard
              label="Waiting for Content Rev."
              value={needsAction.length}
              icon={FileText}
              textClassName="text-amber-800"
              borderClassName="border-amber-100"
              iconClassName="text-amber-600"
              onClick={() => onNavigate('content_revision_queue')}
            />
            <SummaryCard
              label="Rejected"
              value={returned.length}
              icon={XCircle}
              textClassName="text-rose-800"
              borderClassName="border-rose-100"
              iconClassName="text-rose-600"
              onClick={() => onNavigate('rejected_reopened')}
            />
            <SummaryCard
              label="Approved"
              value={approved.length}
              icon={CheckCircle2}
              textClassName="text-emerald-800"
              borderClassName="border-emerald-100"
              iconClassName="text-emerald-600"
              className="col-span-2 xl:col-span-1"
              onClick={() => onNavigate('approved_by_me')}
            />
              </>
            ) : isFinalRev ? (
              <>
            <SummaryCard
              label="Waiting for Content Rev."
              value={waitingContentRevCount}
              icon={FileText}
              textClassName="text-amber-800"
              borderClassName="border-amber-100"
              iconClassName="text-amber-600"
              onClick={() => onNavigate('content_revision_queue')}
            />
            <SummaryCard
              label="Waiting for First Rev."
              value={waitingForMina.length}
              icon={AlertCircle}
              textClassName="text-amber-800"
              borderClassName="border-amber-100"
              iconClassName="text-amber-600"
              onClick={() => onNavigate('waiting_for_mina')}
            />
            <SummaryCard
              label="Waiting for Final Rev."
              value={needsAction.length}
              icon={History}
              textClassName="text-slate-800"
              borderClassName="border-slate-200"
              iconClassName="text-slate-600"
              onClick={() => onNavigate('ad_queue')}
            />
            <SummaryCard
              label="Rejected"
              value={rejectedCount}
              icon={XCircle}
              textClassName="text-rose-800"
              borderClassName="border-rose-100"
              iconClassName="text-rose-600"
              onClick={() => onNavigate('rejected_reopened')}
            />
            <SummaryCard
              label="Approved"
              value={approvedCount}
              icon={CheckCircle2}
              textClassName="text-emerald-800"
              borderClassName="border-emerald-100"
              iconClassName="text-emerald-600"
              onClick={() => onNavigate('approved_by_me')}
            />
              </>
            ) : (
              <>
            {isHighboard && (
              <SummaryCard
                label="Waiting for Content Rev."
                value={waitingContentRevCount}
                icon={FileText}
                textClassName="text-amber-800"
                borderClassName="border-amber-100"
                iconClassName="text-amber-600"
                onClick={() => onNavigate('content_revision_queue')}
              />
            )}
            <SummaryCard
              label="Waiting for First Rev."
              value={waitingForMina.length}
              icon={AlertCircle}
              textClassName="text-amber-800"
              borderClassName="border-amber-100"
              iconClassName="text-amber-600"
              onClick={() => onNavigate('waiting_for_mina')}
            />
            <SummaryCard
              label="Waiting for Final Rev."
              value={waitingForMarwa.length}
              icon={History}
              textClassName="text-slate-800"
              borderClassName="border-slate-200"
              iconClassName="text-slate-600"
              onClick={() => onNavigate('waiting_for_marwa')}
            />
            <SummaryCard
              label="Rejected"
              value={returned.length}
              icon={XCircle}
              textClassName="text-rose-800"
              borderClassName="border-rose-100"
              iconClassName="text-rose-600"
              onClick={() => onNavigate('rejected_reopened')}
            />
            <SummaryCard
              label="Approved"
              value={approved.length}
              icon={CheckCircle2}
              textClassName="text-emerald-800"
              borderClassName="border-emerald-100"
              iconClassName="text-emerald-600"
              onClick={() => onNavigate('approved_by_me')}
            />
              </>
            )}

            {isLeaderboardOrMinaUser && creatorsWithStats.map(({ creator, workingCount, reviewCount, toReviewCount, creatorIsFirstRev, creatorIsFinalRev, creatorIsContentCreator }) => {
              const isReviewer = creatorIsFirstRev || creatorIsFinalRev || creatorIsContentCreator;
              return (
                <button
                  key={creator.id}
                  type="button"
                  onClick={() => {
                    setPopupCreatorId(creator.id);
                    setPopupState('active');
                  }}
                  className="group relative flex h-32 sm:h-36 min-w-0 overflow-hidden rounded-xl border bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md border-slate-200 sm:rounded-2xl"
                >
                  <div className="relative z-10 flex w-full flex-col justify-between p-4">
                    <div className="flex flex-col min-w-0">
                      <span className="truncate text-sm font-bold leading-tight sm:text-base text-slate-800">{creator.name.split(' ')[0]}</span>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mt-0.5 truncate">{creator.jobTitle || 'Content Creator'}</span>
                    </div>
                    <div className="flex flex-col gap-1 mt-auto">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="text-slate-500">Active:</span>
                        <span className="font-bold text-amber-600">{workingCount}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="text-slate-500">Sent to Approve:</span>
                        <span className="font-bold text-indigo-600">{reviewCount}</span>
                      </div>
                      {isReviewer && (
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span className="text-slate-500">To Review:</span>
                          <span className="font-bold text-rose-600">{toReviewCount}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:gap-4">
          <DueSummaryCard
            label="Due Today"
            value={dueTodayCount}
            tone="rose"
            badge="Urgent"
            onClick={() => onNavigate('due_today')}
          />
          <DueSummaryCard
            label="This Week"
            value={dueThisWeekCount}
            tone="orange"
            badge="Upcoming"
            onClick={() => onNavigate('due_this_week')}
          />
        </div>
      </div>
      )}

      {viewMode === 'performance' && filteredCreators.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h3 className="text-lg font-black text-slate-950">Team Performance Overview</h3>
              <p className="text-xs font-semibold text-slate-500 mt-0.5">Click on any status on a designer or editor's card to view their tasks in a popup.</p>
            </div>
          </div>

          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search team members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm font-bold text-slate-900 outline-none transition-all placeholder:text-slate-400 placeholder:font-medium focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-col gap-4 w-full">
            {filteredCreators.map(({ creator, finishedCount, activeCount, onHoldCount, totalCount, workingCount, reviewCount, toReviewCount, creatorIsFirstRev, creatorIsFinalRev, creatorIsContentCreator }) => {
              const handleCreatorSelect = () => {
                setPopupCreatorId(creator.id);
                setPopupState('total');
              };

              const handleStateClick = (state: 'total' | 'finished' | 'active' | 'on_hold' | 'working' | 'waiting_review' | 'to_review') => {
                setPopupCreatorId(creator.id);
                setPopupState(state);
              };

              const isReviewer = creatorIsFirstRev || creatorIsFinalRev || creatorIsContentCreator;
              const gridStyle = isReviewer 
                ? { gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' } 
                : { gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' };

              return (
                <div
                  key={creator.id}
                  onClick={handleCreatorSelect}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer w-full hover:border-slate-300"
                >
                  <div className="flex items-center gap-3">
                    {creator.avatar ? (
                      <img
                        src={creator.avatar}
                        alt={creator.name}
                        className="h-10 w-10 rounded-full object-cover border border-slate-100"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-600 uppercase">
                        {creator.name.slice(0, 2)}
                      </div>
                    )}
                    <div>
                      <h4 className="font-bold text-slate-900 leading-tight">{creator.name}</h4>
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mt-0.5">{creator.jobTitle || 'Team Member'}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-center" style={gridStyle}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStateClick('total');
                      }}
                      className="rounded-lg p-1.5 transition-colors hover:bg-slate-100 flex flex-col items-center"
                    >
                      <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wide">Total</span>
                      <span className="mt-0.5 block text-sm font-black text-slate-800 sm:text-base">{totalCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStateClick('finished');
                      }}
                      className="rounded-lg p-1.5 transition-colors hover:bg-emerald-50/50 flex flex-col items-center"
                    >
                      <span className="block text-[9px] font-black text-emerald-600/80 uppercase tracking-wide">Finished</span>
                      <span className="mt-0.5 block text-sm font-black text-emerald-600 sm:text-base">{finishedCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStateClick('working');
                      }}
                      className="rounded-lg p-1.5 transition-colors hover:bg-amber-50/50 flex flex-col items-center"
                    >
                      <span className="block text-[9px] font-black text-amber-600/80 uppercase tracking-wide">Working On</span>
                      <span className="mt-0.5 block text-sm font-black text-amber-600 sm:text-base">{workingCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStateClick('waiting_review');
                      }}
                      className="rounded-lg p-1.5 transition-colors hover:bg-indigo-50/50 flex flex-col items-center"
                    >
                      <span className="block text-[9px] font-black text-indigo-600/80 uppercase tracking-wide">Waiting Review</span>
                      <span className="mt-0.5 block text-sm font-black text-indigo-600 sm:text-base">{reviewCount}</span>
                    </button>
                    {isReviewer && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStateClick('to_review');
                        }}
                        className="rounded-lg p-1.5 transition-colors hover:bg-rose-50/50 flex flex-col items-center"
                      >
                        <span className="block text-[9px] font-black text-rose-600/80 uppercase tracking-wide">To Review</span>
                        <span className="mt-0.5 block text-sm font-black text-rose-600 sm:text-base">{toReviewCount}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStateClick('on_hold');
                      }}
                      className="rounded-lg p-1.5 transition-colors hover:bg-slate-100 flex flex-col items-center"
                    >
                      <span className="block text-[9px] font-black text-slate-500/80 uppercase tracking-wide">On Hold</span>
                      <span className="mt-0.5 block text-sm font-black text-slate-500 sm:text-base">{onHoldCount}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {viewMode === 'overview' && (
        <>
          {myActiveTasks.length > 0 && (
            <section>
              <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-3">
                <h3 className="flex items-center gap-3 text-lg font-bold text-slate-900">
                  Active Tasks to Work On
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-black text-amber-700">{myActiveTasks.length}</span>
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {myActiveTasks.map(task => (
                  <TaskCard key={task.id} task={task} onClick={onOpenTask} />
                ))}
              </div>
            </section>
          )}

          {needsAction.length > 0 && (
            <section>
              <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-3">
                <h3 className="flex items-center gap-3 text-lg font-bold text-slate-900">
                  Needs My Action
                  <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-black text-indigo-700">{needsAction.length}</span>
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {needsAction.map(task => (
                  <TaskCard key={task.id} task={task} onClick={onOpenTask} />
                ))}
              </div>
            </section>
          )}

          {returned.length > 0 && (
            <section>
              <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-3">
                <h3 className="flex items-center gap-3 text-lg font-bold text-slate-900">
                  Returned / Changes Requested
                  <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-black text-rose-700">{returned.length}</span>
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {returned.map(task => (
                  <TaskCard key={task.id} task={task} onClick={onOpenTask} />
                ))}
              </div>
            </section>
          )}

          {waitingOthers.length > 0 && (
            <section>
              <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-3">
                <h3 className="flex items-center gap-3 text-lg font-bold text-slate-900">
                  {isWorkspaceMonitor ? 'Active / In Progress' : 'Waiting for Others'}
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-black text-slate-600">{waitingOthers.length}</span>
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {waitingOthers.map(task => (
                  <TaskCard key={task.id} task={task} onClick={onOpenTask} />
                ))}
              </div>
            </section>
          )}

          {approved.length > 0 && (
            <section>
              <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-3">
                <h3 className="flex items-center gap-3 text-lg font-bold text-slate-900">
                  Approved Recently
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-700">{approved.length}</span>
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-6 opacity-90 md:grid-cols-2 xl:grid-cols-3">
                {approved.map(task => (
                  <TaskCard key={task.id} task={task} onClick={onOpenTask} />
                ))}
              </div>
            </section>
          )}

          {needsAction.length === 0 && returned.length === 0 && waitingOthers.length === 0 && approved.length === 0 && myActiveTasks.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-20 text-center">
              <p className="font-medium text-slate-500">{isWorkspaceMonitor ? 'No tasks in this workspace.' : 'No tasks in your queue.'}</p>
            </div>
          )}
        </>
      )}

      {popupCreatorId && popupState && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => {
            setPopupCreatorId(null);
            setPopupState(null);
          }}
        >
          <div 
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  {popupState === 'total' && 'All Tasks'}
                  {popupState === 'finished' && 'Finished Tasks'}
                  {popupState === 'active' && 'Active Tasks'}
                  {popupState === 'on_hold' && 'On Hold Tasks'}
                  {popupState === 'working' && 'Working On Tasks'}
                  {popupState === 'waiting_review' && 'Waiting Review Tasks'}
                  {popupState === 'to_review' && 'Tasks to Review'}
                </h3>
                <p className="text-xs font-semibold text-slate-500 mt-0.5">
                  For {userList.find(u => u.id === popupCreatorId)?.name} • {popupTasks.length} {popupTasks.length === 1 ? 'task' : 'tasks'} found
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPopupCreatorId(null);
                  setPopupState(null);
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {popupTasks.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm font-semibold text-slate-400">No tasks in this category.</p>
                </div>
              ) : popupState === 'active' ? (
                (() => {
                  const workingTasks = popupTasks.filter(t => 
                    (t.handledBy.includes(popupCreatorId) || (t.contentRevisionAssigneeIds || []).includes(popupCreatorId)) && 
                    (t.status === 'assigned_work' || t.status === 'draft' || (t.status === 'waiting_content_revision' && (t.contentRevisionAssigneeIds || []).includes(popupCreatorId)))
                  );
                  const approvalTasks = popupTasks.filter(t => 
                    (t.handledBy.includes(popupCreatorId) || (t.contentRevisionAssigneeIds || []).includes(popupCreatorId)) && 
                    !workingTasks.some(wt => wt.id === t.id)
                  );
                  const toReviewTasks = popupTasks.filter(t => 
                    !t.handledBy.includes(popupCreatorId) && 
                    !(t.contentRevisionAssigneeIds || []).includes(popupCreatorId)
                  );

                  const renderTaskItem = (task: Task) => {
                    const getStatusBadge = (status: string) => {
                      switch (status) {
                        case 'approved':
                        case 'completed':
                        case 'approved_by_art_director':
                          return 'bg-emerald-50 text-emerald-700 border-emerald-100';
                        case 'on_hold':
                          return 'bg-slate-100 text-slate-700 border-slate-200';
                        case 'changes_requested_by_reviewer':
                        case 'changes_requested_by_art_director':
                          return 'bg-rose-50 text-rose-700 border-rose-100';
                        default:
                          return 'bg-blue-50 text-blue-700 border-blue-100';
                      }
                    };

                    const getReadableStatus = (status: string) => {
                      if (status === 'submitted' || status === 'waiting_reviewer_full_review') return 'Waiting for First Review';
                      if (status === 'waiting_reviewer_quick_look') return 'Waiting for First Review (Quick Look)';
                      if (status === 'reviewer_approved' || status === 'sent_to_art_director' || status === 'waiting_art_director_approval') return 'Waiting for Final Approvement';
                      if (status === 'changes_requested_by_art_director') return 'Final Approvement Requested Changes';
                      return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    };

                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => {
                          onOpenTask(task.id);
                          setPopupCreatorId(null);
                          setPopupState(null);
                        }}
                        className="w-full text-left p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/5 transition-all flex items-center justify-between gap-4 group"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-black text-indigo-600 font-mono tracking-wider bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 uppercase">
                              {task.code || 'TSK'}
                            </span>
                            <h4 className="font-bold text-slate-900 group-hover:text-indigo-900 transition-colors truncate">
                              {task.name}
                            </h4>
                          </div>
                          <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                            {task.description || 'No description provided.'}
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-2.5 shrink-0">
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${getStatusBadge(task.status)}`}>
                            {getReadableStatus(task.status)}
                          </span>
                          {task.deadlineAt && (
                            <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(task.deadlineAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  };

                  return (
                    <div className="space-y-6">
                      {workingTasks.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-black tracking-wider text-slate-400 uppercase pl-1">Still Working On ({workingTasks.length})</div>
                          <div className="space-y-2">
                            {workingTasks.map(renderTaskItem)}
                          </div>
                        </div>
                      )}

                      {approvalTasks.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-black tracking-wider text-slate-400 uppercase pl-1">Sent for Approval ({approvalTasks.length})</div>
                          <div className="space-y-2">
                            {approvalTasks.map(renderTaskItem)}
                          </div>
                        </div>
                      )}

                      {toReviewTasks.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-black tracking-wider text-slate-400 uppercase pl-1">Tasks I Need to Review ({toReviewTasks.length})</div>
                          <div className="space-y-2">
                            {toReviewTasks.map(renderTaskItem)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                popupTasks.map(task => {
                  const getStatusBadge = (status: string) => {
                    switch (status) {
                      case 'approved':
                      case 'completed':
                      case 'approved_by_art_director':
                        return 'bg-emerald-50 text-emerald-700 border-emerald-100';
                      case 'on_hold':
                        return 'bg-slate-100 text-slate-700 border-slate-200';
                      case 'changes_requested_by_reviewer':
                      case 'changes_requested_by_art_director':
                        return 'bg-rose-50 text-rose-700 border-rose-100';
                      default:
                        return 'bg-blue-50 text-blue-700 border-blue-100';
                    }
                  };

                  const getReadableStatus = (status: string) => {
                    if (status === 'submitted' || status === 'waiting_reviewer_full_review') return 'Waiting for First Review';
                    if (status === 'waiting_reviewer_quick_look') return 'Waiting for First Review (Quick Look)';
                    if (status === 'reviewer_approved' || status === 'sent_to_art_director' || status === 'waiting_art_director_approval') return 'Waiting for Final Approvement';
                    if (status === 'changes_requested_by_art_director') return 'Final Approvement Requested Changes';
                    return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                  };

                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => {
                        onOpenTask(task.id);
                        setPopupCreatorId(null);
                        setPopupState(null);
                      }}
                      className="w-full text-left p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/5 transition-all flex items-center justify-between gap-4 group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-black text-indigo-600 font-mono tracking-wider bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 uppercase">
                            {task.code || 'TSK'}
                          </span>
                          <h4 className="font-bold text-slate-900 group-hover:text-indigo-900 transition-colors truncate">
                            {task.name}
                          </h4>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                          {task.description || 'No description provided.'}
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${getStatusBadge(task.status)}`}>
                          {getReadableStatus(task.status)}
                        </span>
                        {task.deadlineAt && (
                          <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(task.deadlineAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
