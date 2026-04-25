import React from 'react';
import { Task } from '../lib/types';
import { useAppStore } from '../lib/store';
import { getStatusInfo, getNextActionLabel, getTaskTypeLabel, getReviewModeLabel, getPriorityLabel } from '../lib/taskUtils';
import { cn } from '../lib/utils';
import { initialUsers } from '../lib/mockData';

export function TaskCard({ task, onClick }: { task: Task; onClick: (id: string) => void; key?: string | number }) {
  const { currentUser } = useAppStore();
  const statusInfo = getStatusInfo(task, currentUser.role);
  const nextAction = getNextActionLabel(task, currentUser.role);

  const creator = initialUsers.find(u => u.id === task.createdBy)?.name || 'Unknown';
  const handledByNames = task.handledBy.map(id => initialUsers.find(u => u.id === id)?.name).filter(Boolean).join(' + ');

  const version = task.versions.length > 0 ? task.versions[0].versionNumber : 1;

  const colorStyles = {
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    green: "bg-emerald-50 border-emerald-200 text-emerald-800",
    red: "bg-rose-50 border-rose-200 text-rose-800",
    gray: "bg-slate-50 border-slate-200 text-slate-800",
    purple: "bg-indigo-50 border-indigo-200 text-indigo-800",
  };

  const getPriorityBadgeStyle = (p: string) => {
    switch(p) {
      case 'urgent': return "bg-rose-500 text-white border-rose-600";
      case 'high': return "bg-amber-500 text-black border-amber-600";
      case 'normal': return "bg-slate-200 text-slate-600 border-slate-300";
      case 'low': return "bg-slate-100 text-slate-500 border-slate-200";
      default: return "hidden";
    }
  };

  return (
    <div 
      onClick={() => onClick(task.id)}
      className="bg-white rounded-2xl border-2 border-slate-200 hover:border-indigo-400 transition-colors shadow-sm flex flex-col cursor-pointer overflow-hidden group h-full"
    >
      <div className="h-40 bg-slate-100 relative overflow-hidden text-slate-900">
        {task.thumbnailUrl ? (
          <img 
            src={task.thumbnailUrl} 
            alt={task.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300 font-mono italic text-sm">{task.code}.FILE</div>
        )}
        
        <div className="absolute top-3 left-3 bg-white/90 backdrop-blur px-2 py-1 rounded text-[10px] font-bold shadow-sm text-slate-800">
          {task.code}
        </div>
        
        <div className={cn("absolute bottom-3 right-3 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm border", getPriorityBadgeStyle(task.priority))}>
           {getPriorityLabel(task.priority)}
        </div>
      </div>

      <div className="p-5 flex flex-col flex-1">
        <h3 className="font-bold text-lg text-slate-900 leading-tight mb-1 line-clamp-2">{task.name}</h3>
        
        <div className="flex flex-wrap gap-x-4 gap-y-2 mb-4 mt-2 text-[11px] text-slate-500">
           <div><span className="font-bold text-slate-700">Creator:</span> {creator}</div>
           <div><span className="font-bold text-slate-700">Type:</span> {getTaskTypeLabel(task.taskType)}</div>
           <div><span className="font-bold text-slate-700">Version:</span> V{version}</div>
        </div>

        <div className="mt-auto">
          <div className={cn("border p-3 rounded-xl mb-4", colorStyles[statusInfo.color])}>
            <div className="flex justify-between items-start mb-1">
              <p className="text-[10px] uppercase font-black tracking-wider opacity-60">Next Action</p>
              <div className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/50">{statusInfo.label}</div>
            </div>
            <p className="text-xs font-semibold">{nextAction}</p>
          </div>
          
          <button className="w-full py-2.5 bg-slate-50 text-slate-700 font-bold rounded-xl text-sm border border-slate-200 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-colors">
            Open Workflow
          </button>
        </div>
      </div>
    </div>
  );
}
