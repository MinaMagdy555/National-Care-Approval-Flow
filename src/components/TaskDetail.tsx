import React, { useState } from 'react';
import { useAppStore } from '../lib/store';
import { Priority } from '../lib/types';
import { initialUsers } from '../lib/mockData';
import { getStatusInfo, getNextActionLabel, getTaskTypeLabel, getReviewModeLabel } from '../lib/taskUtils';
import { cn } from '../lib/utils';
import { ArrowLeft, Check, X, AlertCircle, Clock } from 'lucide-react';
import { CustomSelect } from './CustomSelect';

const reasonOptions = [
  { value: 'spelling', label: 'Spelling/content issue' },
  { value: 'visual', label: 'Visual quality issue' },
  { value: 'brand', label: 'Brand mismatch' },
  { value: 'export', label: 'Technical export issue' },
  { value: 'info', label: 'Wrong info / price' },
  { value: 'other', label: 'Other' },
];

export function TaskDetail({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const { tasks, currentUser, updateTaskStatus, updateTaskPriority } = useAppStore();
  const task = tasks.find(t => t.id === taskId);
  
  const [modal, setModal] = useState<'request_changes' | 'send_to_ad' | 'quick_look_done' | 'ad_reject' | null>(null);
  const [changeReason, setChangeReason] = useState('');
  const [adRejectReason, setAdRejectReason] = useState('');

  if (!task) return <div>Task not found</div>;

  const statusInfo = getStatusInfo(task, currentUser.role);
  const nextAction = getNextActionLabel(task, currentUser.role);
  const creator = initialUsers.find(u => u.id === task.createdBy)?.name || 'Unknown';
  const handledByNames = task.handledBy.map(id => initialUsers.find(u => u.id === id)?.name).filter(Boolean).join(' + ');

  const currentVersion = task.versions[0];

  const handleSendToAD = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const priority = formData.get('priority') as Priority;
    const deadline = formData.get('deadline') as string;
    
    updateTaskPriority(task.id, priority, deadline);
    updateTaskStatus(task.id, 'sent_to_art_director', 'art_director');
    setModal(null);
  };

  const handleRequestChanges = (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeReason) return;
    // In real app, save the comment
    updateTaskStatus(task.id, 'changes_requested_by_reviewer', 'team_member');
    setChangeReason('');
    setModal(null);
  };

  const handleADReject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adRejectReason) return;
    updateTaskStatus(task.id, 'changes_requested_by_art_director', 'team_member');
    setAdRejectReason('');
    setModal(null);
  };

  const handleADApprove = () => {
    updateTaskStatus(task.id, 'approved_by_art_director', null);
  };

  const colorStyles = {
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    green: "bg-emerald-50 border-emerald-200 text-emerald-800",
    red: "bg-rose-50 border-rose-200 text-rose-800",
    gray: "bg-slate-50 border-slate-200 text-slate-800",
    purple: "bg-indigo-50 border-indigo-200 text-indigo-800",
  };

  return (
    <div className="relative flex min-h-full flex-col bg-[#f8fafc] text-slate-900 md:h-full md:flex-row md:border-l md:border-slate-200">
      {/* Left Side: Media Preview */}
      <div className="relative flex min-h-[42dvh] flex-col bg-slate-100 md:min-h-0 md:flex-1 md:border-r md:border-slate-200">
        <div className="absolute top-4 left-4 z-10 hidden md:block">
          <button 
            onClick={onBack}
            className="flex items-center gap-2 bg-white/90 backdrop-blur text-sm font-bold px-4 py-2 rounded-lg shadow-sm hover:bg-white text-slate-700 hover:text-indigo-600 border border-slate-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </button>
        </div>
        
        {task.environment === 'demo' && (
          <div className="absolute top-0 inset-x-0 bg-purple-100 text-purple-700 text-xs font-bold py-1.5 text-center border-b border-purple-200 z-10">
            DEMO TASK — This task is safe to test. Actions here will not notify production users.
          </div>
        )}

        <div className="mt-0 flex flex-1 items-center justify-center overflow-auto p-4 pt-16 sm:p-6 sm:pt-16 md:mt-10 md:p-8">
          {currentVersion?.fileUrl ? (
            <div className="relative max-w-full max-h-full rounded-md overflow-hidden bg-white shadow-2xl ring-1 ring-gray-900/5">
              <img src={currentVersion.fileUrl} alt="Preview" className="max-w-full max-h-[80vh] object-contain" />
            </div>
          ) : (
            <div className="text-gray-400 font-medium bg-gray-200 w-full h-full rounded-2xl flex items-center justify-center">No file uploaded</div>
          )}
        </div>
      </div>

      {/* Right Side: Info & Actions */}
      <div className="w-full shrink-0 overflow-y-auto bg-white md:w-[420px] lg:w-[450px] md:border-l md:border-slate-200">
        <div className="border-b border-slate-200 p-4 sm:p-6">
          <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-indigo-600 mb-4 md:hidden text-sm font-bold">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          <h2 className="text-2xl font-black text-slate-900 leading-tight mb-2">{task.name}</h2>
          <p className="text-sm font-mono text-slate-500 mb-6 font-bold">{task.code} · Version {currentVersion?.versionNumber || 1}</p>

          <div className="mb-6 grid grid-cols-1 gap-y-4 text-sm sm:grid-cols-2">
            <div>
              <span className="block text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1">Created by</span>
              <span className="font-semibold text-slate-900">{creator}</span>
            </div>
            <div>
              <span className="block text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1">Handled by</span>
              <span className="font-semibold text-slate-900">{handledByNames}</span>
            </div>
            <div>
              <span className="block text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1">Task type</span>
              <span className="font-semibold text-slate-900">{getTaskTypeLabel(task.taskType)}</span>
            </div>
            <div>
              <span className="block text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1">Review mode</span>
              <span className="font-semibold text-slate-900">{getReviewModeLabel(task.reviewMode)}</span>
            </div>
            <div>
              <span className="block text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1">Environment</span>
              <span className="font-semibold text-slate-900 capitalize">{task.environment}</span>
            </div>
          </div>
          
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col gap-3">
            <div>
              <span className="block text-[11px] uppercase tracking-wider text-slate-400 font-black mb-2">Current Status</span>
              <span className={cn(
                "inline-block px-3 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-lg border",
                colorStyles[statusInfo.color] || colorStyles.gray
              )}>
                {statusInfo.label}
              </span>
            </div>
            <div className="pt-2 mt-1 border-t border-slate-200">
              <span className="block text-[11px] uppercase tracking-wider text-slate-400 font-black mb-1">Next Action</span>
              <span className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                {nextAction}
              </span>
            </div>
          </div>
        </div>

        {/* Actions Section */}
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-white p-4 sm:p-6">
          
          {currentUser.role === 'reviewer' && ['waiting_reviewer_full_review', 'waiting_reviewer_quick_look', 'draft'].includes(task.status) && (
            <>
              <button 
                onClick={() => setModal('send_to_ad')}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl shadow-sm transition-all focus:ring-4 focus:ring-indigo-100"
              >
                {task.status === 'waiting_reviewer_full_review' ? 'Approve & Send to Marwa' : 
                 task.status === 'waiting_reviewer_quick_look' ? 'Quick Look Done & Send to Marwa' : 'Send to Marwa'}
              </button>
              {task.status !== 'draft' && (
                <button 
                  onClick={() => setModal('request_changes')}
                  className="w-full bg-white hover:bg-slate-50 text-slate-700 font-bold py-3 px-4 rounded-xl border border-slate-200 shadow-sm transition-all focus:ring-4 focus:ring-slate-100"
                >
                  Request Changes
                </button>
              )}
            </>
          )}

          {currentUser.role === 'reviewer' && task.status === 'sent_to_art_director' && (
            <div className="text-sm font-medium text-gray-500 flex items-center gap-2 justify-center py-2">
              <Check className="w-4 h-4" /> Sent to Marwa
            </div>
          )}

          {currentUser.role === 'art_director' && ['sent_to_art_director', 'waiting_art_director_approval', 'reviewer_approved'].includes(task.status) && (
            <>
              <button 
                onClick={handleADApprove}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-xl shadow-sm transition-all focus:ring-4 focus:ring-emerald-100 flex items-center justify-center gap-2"
              >
                <Check className="w-5 h-5" /> Approve
              </button>
              <button 
                onClick={() => setModal('ad_reject')}
                className="w-full bg-white hover:bg-rose-50 text-rose-600 font-bold py-3 px-4 rounded-xl border border-rose-200 shadow-sm transition-all focus:ring-4 focus:ring-rose-100 flex items-center justify-center gap-2"
              >
                <X className="w-5 h-5" /> Reject
              </button>
            </>
          )}

          {currentUser.role === 'art_director' && task.status === 'approved_by_art_director' && (
            <>
              <div className="bg-green-50 text-green-700 border border-green-200 rounded-xl p-4 mb-2 flex items-start gap-3">
                <Check className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                <div>
                  <div className="font-semibold mb-1">Approved by You</div>
                  <div className="text-xs">At {new Date(task.updatedAt).toLocaleString()}</div>
                </div>
              </div>
              <button 
                onClick={() => setModal('ad_reject')}
                className="w-full bg-white hover:bg-gray-50 text-gray-700 font-semibold py-2 px-4 rounded-lg border border-gray-200 shadow-sm transition-all text-sm"
              >
                Reject / Reopen
              </button>
            </>
          )}

        </div>

        {/* Versions & Comments (Stubbed for now) */}
        <div className="flex-1 bg-slate-50 p-4 sm:p-6">
          <h3 className="text-[11px] font-black text-slate-400 mb-4 uppercase tracking-wider flex items-center gap-2"><Clock className="w-4 h-4 text-slate-400"/> VERSION HISTORY</h3>
          <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 md:before:mx-auto before:-translate-x-px md:before:translate-x-0 before:h-full before:w-[2px] before:bg-slate-200">
            {task.versions.map((v, i) => (
              <div key={v.id} className="relative flex items-start gap-4">
                <div className="flex-shrink-0 w-4 h-4 rounded-full bg-white border-4 border-indigo-500 z-10 mt-1"></div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-sm text-slate-900">Version {v.versionNumber}</span>
                    <span className="text-xs font-bold text-slate-400">{new Date(v.createdAt).toLocaleDateString()}</span>
                  </div>
                  {v.submissionNote && <p className="text-sm text-slate-600 mt-2 font-medium">"{v.submissionNote}"</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* MODALS */}
      {modal === 'send_to_ad' && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-black text-slate-900">Approve & Send to Marwa</h3>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-indigo-600 transition-colors"><X className="w-5 h-5"/></button>
            </div>
            <form onSubmit={handleSendToAD} className="p-6 space-y-5">
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Priority *</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className="cursor-pointer">
                    <input type="radio" name="priority" value="low" className="peer sr-only" required />
                    <div className="text-center text-sm font-bold py-2 px-1 rounded-lg border border-slate-200 text-slate-500 peer-checked:bg-slate-900 peer-checked:text-white peer-checked:border-slate-900 transition-colors">Low</div>
                  </label>
                  <label className="cursor-pointer">
                    <input type="radio" name="priority" value="normal" className="peer sr-only" defaultChecked />
                    <div className="text-center text-sm font-bold py-2 px-1 rounded-lg border border-slate-200 text-slate-500 peer-checked:bg-indigo-600 peer-checked:text-white peer-checked:border-indigo-600 transition-colors">Normal</div>
                  </label>
                  <label className="cursor-pointer">
                    <input type="radio" name="priority" value="high" className="peer sr-only" />
                    <div className="text-center text-sm font-bold py-2 px-1 rounded-lg border border-slate-200 text-slate-500 peer-checked:bg-amber-500 peer-checked:text-white peer-checked:border-amber-500 transition-colors">High</div>
                  </label>
                  <label className="cursor-pointer">
                    <input type="radio" name="priority" value="urgent" className="peer sr-only" />
                    <div className="text-center text-sm font-bold py-2 px-1 rounded-lg border border-slate-200 text-slate-500 peer-checked:bg-rose-500 peer-checked:text-white peer-checked:border-rose-500 transition-colors">Urgent</div>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1">Deadline</label>
                <input type="text" name="deadline" placeholder="e.g. Before Thursday 8 PM" className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1">Reviewer Note (Optional)</label>
                <textarea name="note" rows={2} className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"></textarea>
              </div>
              <div className="pt-2">
                <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 px-4 rounded-xl shadow-sm transition-colors">Send to Marwa</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal === 'request_changes' && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-black text-slate-900">Request Changes</h3>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-indigo-600 transition-colors"><X className="w-5 h-5"/></button>
            </div>
            <form onSubmit={handleRequestChanges} className="p-6 space-y-5">
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Reason category *</label>
                <CustomSelect
                  value={changeReason}
                  onChange={setChangeReason}
                  options={reasonOptions}
                  placeholder="Select a reason"
                  buttonClassName="rounded-lg border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-900 shadow-none hover:bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1">Comment *</label>
                <textarea name="comment" required rows={3} placeholder="What needs to be fixed?" className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"></textarea>
              </div>
              <div className="pt-2">
                <button type="submit" disabled={!changeReason} className="w-full bg-slate-900 hover:bg-black text-white font-black py-3 px-4 rounded-xl shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-slate-300">Request Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal === 'ad_reject' && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-rose-200">
            <div className="p-6 border-b border-rose-100 bg-rose-50 flex justify-between items-center">
              <h3 className="text-lg font-black text-rose-900 flex items-center gap-2"><AlertCircle className="w-5 h-5"/> Reject Task</h3>
              <button onClick={() => setModal(null)} className="text-rose-400 hover:text-rose-600 transition-colors"><X className="w-5 h-5"/></button>
            </div>
            <form onSubmit={handleADReject} className="p-6 space-y-5">
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Reason category *</label>
                <CustomSelect
                  value={adRejectReason}
                  onChange={setAdRejectReason}
                  options={reasonOptions.filter(option => option.value !== 'info')}
                  placeholder="Select a reason"
                  buttonClassName="rounded-lg border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-900 shadow-none hover:bg-white focus:ring-2 focus:ring-rose-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1">Comment *</label>
                <textarea name="comment" required rows={3} placeholder="Provide feedback for rejection..." className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-rose-500 outline-none"></textarea>
              </div>
              <div className="pt-2">
                <button type="submit" disabled={!adRejectReason} className="w-full bg-rose-600 hover:bg-rose-700 text-white font-black py-3 px-4 rounded-xl shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-slate-300">Reject and Return</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
