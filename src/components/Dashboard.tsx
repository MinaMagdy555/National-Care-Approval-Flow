import React from 'react';
import { useAppStore } from '../lib/store';
import { TaskCard } from './TaskCard';
import { AlertCircle, Clock, CheckCircle2, History, LucideIcon, XCircle } from 'lucide-react';
import { initialUsers } from '../lib/mockData';

function SummaryCard({
  label,
  value,
  icon: Icon,
  textClassName,
  borderClassName,
  iconClassName,
  onClick,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  textClassName: string;
  borderClassName: string;
  iconClassName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative min-w-0 overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${borderClassName}`}
    >
      <div className="absolute right-0 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
        <Icon className={`h-16 w-16 ${iconClassName}`} />
      </div>
      <div className="relative z-10 flex h-full flex-col justify-between p-4">
        <span className={`mb-4 text-sm font-bold ${textClassName}`}>{label}</span>
        <span className={`text-3xl font-black ${textClassName}`}>{value}</span>
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

  const envTasks = tasks.filter(t => t.environment === environment);
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
    needsAction = envTasks.filter(t => ['waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status));
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

  const needsFullReviewCount = envTasks.filter(t => t.status === 'waiting_reviewer_full_review').length;
  const needsQuickLookCount = envTasks.filter(t => t.status === 'waiting_reviewer_quick_look').length;
  const waitingMarwaCount = envTasks.filter(t => ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status)).length;
  const approvedCount = envTasks.filter(t => t.status === 'approved_by_art_director').length;
  const rejectedCount = returned.length;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8 lg:space-y-12">
      <div className="mb-4">
        <h2 className="mb-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Welcome, {currentUser.name.split(' ')[0]}</h2>
        <p className="font-medium text-slate-500">Here's an overview of the current workspace.</p>
      </div>

      <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${isMemberOrLeader ? 'xl:grid-cols-4' : 'xl:grid-cols-5'}`}>
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

      {!isMemberOrLeader && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="group relative overflow-hidden rounded-2xl border border-rose-100 bg-rose-50 p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold text-rose-800">Due Today</span>
              <span className="rounded-full bg-rose-200 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-800">Urgent</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-rose-900">0</span>
              <span className="text-sm font-semibold text-rose-700">Tasks</span>
            </div>
          </div>
          <div className="group relative overflow-hidden rounded-2xl border border-orange-100 bg-orange-50 p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold text-orange-800">Due This Week</span>
              <span className="rounded-full bg-orange-200 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-orange-800">Upcoming</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-orange-900">2</span>
              <span className="text-sm font-semibold text-orange-700">Tasks</span>
            </div>
          </div>
        </div>
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
