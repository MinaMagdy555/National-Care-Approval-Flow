import React from 'react';
import { useAppStore } from '../lib/store';
import { TaskCard } from './TaskCard';
import { AlertCircle, Clock, CheckCircle2, History, XCircle } from 'lucide-react';

export function Dashboard({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { tasks, currentUser, environment } = useAppStore();

  const envTasks = tasks.filter(t => t.environment === environment);

  let needsAction = [];
  let waitingOthers = [];
  let approved = [];
  let returned = [];

  if (currentUser.role === 'team_member') {
    needsAction = envTasks.filter(t => t.createdBy === currentUser.id && (t.status === 'changes_requested_by_reviewer' || t.status === 'changes_requested_by_art_director'));
    waitingOthers = envTasks.filter(t => t.createdBy === currentUser.id && ['waiting_reviewer_full_review', 'waiting_reviewer_quick_look', 'reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status));
    approved = envTasks.filter(t => t.createdBy === currentUser.id && t.status === 'approved_by_art_director');
    returned = needsAction; // For team member, returned tasks are their actionable tasks
  } else if (currentUser.role === 'reviewer') {
    needsAction = envTasks.filter(t => ['waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status));
    waitingOthers = envTasks.filter(t => ['sent_to_art_director', 'waiting_art_director_approval'].includes(t.status));
    approved = envTasks.filter(t => t.status === 'approved_by_art_director');
    returned = envTasks.filter(t => ['changes_requested_by_reviewer', 'changes_requested_by_art_director'].includes(t.status));
  } else if (currentUser.role === 'art_director') {
    needsAction = envTasks.filter(t => ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status) || (t.reviewMode === 'direct_to_ad' && t.status === 'sent_to_art_director'));
    waitingOthers = envTasks.filter(t => t.status === 'changes_requested_by_art_director' || t.status === 'waiting_reviewer_full_review' || t.status === 'waiting_reviewer_quick_look'); // Assuming AD can see all, but mostly cares about forwarded
    approved = envTasks.filter(t => t.status === 'approved_by_art_director');
    returned = envTasks.filter(t => t.status === 'changes_requested_by_art_director');
  } else {
    // Admin / Team Leader
    approved = envTasks.filter(t => t.status === 'approved_by_art_director' || t.status === 'completed');
    waitingOthers = envTasks.filter(t => t.status !== 'approved_by_art_director' && t.status !== 'completed' && !t.status.includes('changes_requested'));
    returned = envTasks.filter(t => ['changes_requested_by_reviewer', 'changes_requested_by_art_director'].includes(t.status));
  }

  const needsFullReviewCount = envTasks.filter(t => t.status === 'waiting_reviewer_full_review').length;
  const needsQuickLookCount = envTasks.filter(t => t.status === 'waiting_reviewer_quick_look').length;
  const waitingAdCount = envTasks.filter(t => ['sent_to_art_director', 'waiting_art_director_approval'].includes(t.status)).length;
  const approvedCount = envTasks.filter(t => t.status === 'approved_by_art_director').length;
  const rejectedCount = returned.length;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-12">
      
      <div className="mb-4">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-2">Welcome, {currentUser.name.split(' ')[0]}</h2>
        <p className="text-slate-500 font-medium">Here's an overview of the current workspace.</p>
      </div>

      <div className="grid grid-cols-1 md:flex md:flex-row gap-4">
        {currentUser.role !== 'art_director' && (
          <>
            <div className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden relative group flex-1">
               <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <AlertCircle className="w-16 h-16 text-amber-600"/>
               </div>
               <div className="p-4 flex flex-col justify-between h-full relative z-10">
                  <span className="text-amber-800 font-bold text-sm mb-4">Needs {currentUser.role === 'team_member' ? 'My' : 'Full'} Review</span>
                  <span className="text-3xl font-black text-amber-900">{currentUser.role === 'team_member' ? returned.length : needsFullReviewCount}</span>
               </div>
            </div>

            <div className="bg-white rounded-2xl border border-indigo-100 shadow-sm overflow-hidden relative group flex-1">
               <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Clock className="w-16 h-16 text-indigo-600"/>
               </div>
               <div className="p-4 flex flex-col justify-between h-full relative z-10">
                  <span className="text-indigo-800 font-bold text-sm mb-4">Needs Quick Look</span>
                  <span className="text-3xl font-black text-indigo-900">{needsQuickLookCount}</span>
               </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative group flex-1">
               <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <History className="w-16 h-16 text-slate-600"/>
               </div>
               <div className="p-4 flex flex-col justify-between h-full relative z-10">
                  <span className="text-slate-800 font-bold text-sm mb-4">Waiting for AD</span>
                  <span className="text-3xl font-black text-slate-900">{waitingAdCount}</span>
               </div>
            </div>
          </>
        )}

        {currentUser.role === 'art_director' && (
          <div className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden relative group flex-1">
             <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <AlertCircle className="w-16 h-16 text-amber-600"/>
             </div>
             <div className="p-4 flex flex-col justify-between h-full relative z-10">
                <span className="text-amber-800 font-bold text-sm mb-4">Needs Action</span>
                <span className="text-3xl font-black text-amber-900">{needsAction.length}</span>
             </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-rose-100 shadow-sm overflow-hidden relative group flex-1">
           <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <XCircle className="w-16 h-16 text-rose-600"/>
           </div>
           <div className="p-4 flex flex-col justify-between h-full relative z-10">
              <span className="text-rose-800 font-bold text-sm mb-4">Rejected</span>
              <span className="text-3xl font-black text-rose-900">{rejectedCount}</span>
           </div>
        </div>

        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden relative group flex-1">
           <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <CheckCircle2 className="w-16 h-16 text-emerald-600"/>
           </div>
           <div className="p-4 flex flex-col justify-between h-full relative z-10">
              <span className="text-emerald-800 font-bold text-sm mb-4">Approved</span>
              <span className="text-3xl font-black text-emerald-900">{approvedCount}</span>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-rose-50 rounded-2xl border border-rose-100 shadow-sm overflow-hidden relative group p-5">
           <div className="flex justify-between items-center mb-2">
              <span className="text-rose-800 font-bold text-sm">Due Today</span>
              <span className="bg-rose-200 text-rose-800 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full">Urgent</span>
           </div>
           <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-rose-900">0</span>
              <span className="text-sm font-semibold text-rose-700">Tasks</span>
           </div>
        </div>
        <div className="bg-orange-50 rounded-2xl border border-orange-100 shadow-sm overflow-hidden relative group p-5">
           <div className="flex justify-between items-center mb-2">
              <span className="text-orange-800 font-bold text-sm">Due This Week</span>
              <span className="bg-orange-200 text-orange-800 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full">Upcoming</span>
           </div>
           <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-orange-900">2</span>
              <span className="text-sm font-semibold text-orange-700">Tasks</span>
           </div>
        </div>
      </div>

      {needsAction.length > 0 && (
        <section>
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-6">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-3">
              Needs My Action
              <span className="bg-indigo-100 text-indigo-700 text-xs font-black px-2.5 py-0.5 rounded-full">{needsAction.length}</span>
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {needsAction.map(task => (
              <TaskCard key={task.id} task={task} onClick={onOpenTask} />
            ))}
          </div>
        </section>
      )}

      {returned.length > 0 && (
        <section>
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-6">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-3">
              Returned / Changes Requested
              <span className="bg-rose-100 text-rose-700 text-xs font-black px-2.5 py-0.5 rounded-full">{returned.length}</span>
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {returned.map(task => (
              <TaskCard key={task.id} task={task} onClick={onOpenTask} />
            ))}
          </div>
        </section>
      )}

      {waitingOthers.length > 0 && (
        <section>
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-6">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-3">
              Waiting for Others
              <span className="bg-slate-100 text-slate-600 text-xs font-black px-2.5 py-0.5 rounded-full">{waitingOthers.length}</span>
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {waitingOthers.map(task => (
              <TaskCard key={task.id} task={task} onClick={onOpenTask} />
            ))}
          </div>
        </section>
      )}

      {approved.length > 0 && (
        <section>
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-6">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-3">
              Approved Recently
              <span className="bg-emerald-100 text-emerald-700 text-xs font-black px-2.5 py-0.5 rounded-full">{approved.length}</span>
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 opacity-90">
            {approved.map(task => (
              <TaskCard key={task.id} task={task} onClick={onOpenTask} />
            ))}
          </div>
        </section>
      )}

      {needsAction.length === 0 && returned.length === 0 && waitingOthers.length === 0 && approved.length === 0 && (
        <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-slate-200">
          <p className="text-slate-500 font-medium">No tasks in your queue.</p>
        </div>
      )}

    </div>
  );
}
