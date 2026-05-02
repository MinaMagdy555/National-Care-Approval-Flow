import React from 'react';
import { useAppStore } from '../lib/store';
import { TaskCard } from './TaskCard';
import { AlertCircle, Clock, CheckCircle2, History, LucideIcon, XCircle } from 'lucide-react';
import { initialUsers } from '../lib/mockData';
import { isDueThisWeek, isDueToday } from '../lib/deadlineUtils';
import { isTaskArchived } from '../lib/archiveUtils';

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
      <div className="flex items-baseline">
        <span className="text-2xl font-black leading-none sm:text-3xl">{value}</span>
      </div>
    </button>
  );
}

export function Dashboard({
  onOpenTask,
  onNavigate,
}: {
  onOpenTask: (id: string) => void;
  onNavigate: (view: string) => void;
}) {
  const { tasks, currentUser, environment } = useAppStore();

  const envTasks = tasks.filter(t => t.environment === environment && !isTaskArchived(t));
  const minaName = initialUsers.find(u => u.role === 'reviewer')?.name.split(' ')[0] || 'Mina';
  const marwaName = initialUsers.find(u => u.role === 'art_director')?.name.split(' ')[0] || 'Marwa';
  const isMemberOrLeader = currentUser.role === 'team_member' || currentUser.role === 'team_leader';

  let needsAction = [];
  let waitingOthers = [];
  let approved = [];
  let returned = [];
  let waitingForMina = [];
  let waitingForMarwa = [];

  if (currentUser.role === 'team_member') {
    needsAction = envTasks.filter(t => t.createdBy === currentUser.id && (t.status === 'changes_requested_by_reviewer' || t.status === 'changes_requested_by_art_director'));
    waitingOthers = envTasks.filter(t => t.createdBy === currentUser.id && ['waiting_reviewer_full_review', 'waiting_reviewer_quick_look', 'reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status));
    approved = envTasks.filter(t => t.createdBy === currentUser.id && t.status === 'approved_by_art_director');
    returned = needsAction;
    waitingForMina = envTasks.filter(t => t.createdBy === currentUser.id && ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status));
    waitingForMarwa = envTasks.filter(t => t.createdBy === currentUser.id && ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status));
  } else if (currentUser.role === 'reviewer') {
    needsAction = envTasks.filter(t => ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status));
    waitingOthers = envTasks.filter(t => ['sent_to_art_director', 'waiting_art_director_approval'].includes(t.status));
    approved = envTasks.filter(t => t.status === 'approved_by_art_director');
    returned = envTasks.filter(t => ['changes_requested_by_reviewer', 'changes_requested_by_art_director'].includes(t.status));
  } else if (currentUser.role === 'art_director') {
    needsAction = envTasks.filter(t => ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status) || (t.reviewMode === 'direct_to_ad' && t.status === 'sent_to_art_director'));
    waitingOthers = envTasks.filter(t => t.status === 'changes_requested_by_art_director' || t.status === 'waiting_reviewer_full_review' || t.status === 'waiting_reviewer_quick_look');
    approved = envTasks.filter(t => t.status === 'approved_by_art_director');
    returned = envTasks.filter(t => t.status === 'changes_requested_by_art_director');
  } else {
    approved = envTasks.filter(t => t.status === 'approved_by_art_director' || t.status === 'completed');
    waitingOthers = envTasks.filter(t => t.status !== 'approved_by_art_director' && t.status !== 'completed' && !t.status.includes('changes_requested'));
    returned = envTasks.filter(t => ['changes_requested_by_reviewer', 'changes_requested_by_art_director'].includes(t.status));
    waitingForMina = envTasks.filter(t => ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status));
    waitingForMarwa = envTasks.filter(t => ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status));
  }

  const needsFullReviewCount = envTasks.filter(t => ['submitted', 'waiting_reviewer_full_review'].includes(t.status)).length;
  const needsQuickLookCount = envTasks.filter(t => t.status === 'waiting_reviewer_quick_look').length;
  const waitingMarwaCount = envTasks.filter(t => ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status)).length;
  const approvedCount = envTasks.filter(t => t.status === 'approved_by_art_director').length;
  const rejectedCount = returned.length;
  const dueTodayCount = envTasks.filter(isDueToday).length;
  const dueThisWeekCount = envTasks.filter(isDueThisWeek).length;
  const hasStatusCards = isMemberOrLeader || currentUser.role === 'reviewer' || currentUser.role === 'art_director';

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 pb-6 pt-0 sm:space-y-8 sm:px-6 sm:py-6 lg:space-y-12 lg:px-8">
      <div className="mb-1 sm:mb-4">
        <h2 className="mb-1 text-2xl font-black tracking-tight text-slate-900 sm:mb-2 sm:text-3xl">Welcome, {currentUser.name.split(' ')[0]}</h2>
        <p className="text-sm font-medium text-slate-500 sm:text-base">Here's an overview of the current workspace.</p>
      </div>

      <div className="space-y-3 sm:space-y-4">
        {hasStatusCards && (
          <div className={`grid auto-rows-fr grid-cols-2 gap-3 sm:gap-4 ${isMemberOrLeader ? 'xl:grid-cols-4' : currentUser.role === 'reviewer' ? 'xl:grid-cols-5' : 'xl:grid-cols-3'}`}>
            {isMemberOrLeader ? (
              <>
            <SummaryCard
              label={`Waiting for ${minaName}`}
              value={waitingForMina.length}
              icon={AlertCircle}
              textClassName="text-amber-800"
              borderClassName="border-amber-100"
              iconClassName="text-amber-600"
              onClick={() => onNavigate('waiting_for_mina')}
            />
            <SummaryCard
              label={`Waiting for ${marwaName}`}
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
            ) : currentUser.role === 'reviewer' ? (
              <>
            <SummaryCard
              label="Needs Full Review"
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
              label={`Waiting for ${marwaName}`}
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
            ) : currentUser.role === 'art_director' ? (
              <>
            <SummaryCard
              label="Needs Your Action"
              value={needsAction.length}
              icon={AlertCircle}
              textClassName="text-amber-800"
              borderClassName="border-amber-100"
              iconClassName="text-amber-600"
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
            ) : null}
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
              Waiting for Others
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

      {needsAction.length === 0 && returned.length === 0 && waitingOthers.length === 0 && approved.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-20 text-center">
          <p className="font-medium text-slate-500">No tasks in your queue.</p>
        </div>
      )}
    </div>
  );
}
