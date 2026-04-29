import React, { useState } from 'react';
import { useAppStore } from '../lib/store';
import { Task } from '../lib/types';
import { getStatusInfo, getTaskTypeLabel } from '../lib/taskUtils';
import { cn } from '../lib/utils';
import { initialUsers } from '../lib/mockData';
import { CalendarDays, Search, X } from 'lucide-react';
import { CustomSelect } from './CustomSelect';
import { TaskThumbnail } from './FilePreview';

type DateFilterMode = 'all' | 'single' | 'range';

function getDateInputValue(date: string) {
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return '';

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const day = String(parsedDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ReviewQueue({ onOpenTask, tasks, title }: { onOpenTask: (id: string) => void, tasks: Task[], title: string }) {
  const { currentUser } = useAppStore();
  const [creatorFilter, setCreatorFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('all');
  const [singleDate, setSingleDate] = useState('');
  const [rangeStartDate, setRangeStartDate] = useState('');
  const [rangeEndDate, setRangeEndDate] = useState('');

  const filteredTasks = tasks.filter(task => {
    if (creatorFilter !== 'all' && task.createdBy !== creatorFilter) return false;
    if (typeFilter !== 'all' && task.taskType !== typeFilter) return false;

    const taskDate = getDateInputValue(task.createdAt);
    if (dateFilterMode === 'single' && singleDate && taskDate !== singleDate) return false;
    if (dateFilterMode === 'range' && (rangeStartDate || rangeEndDate)) {
      const [startDate, endDate] = rangeStartDate && rangeEndDate && rangeStartDate > rangeEndDate
        ? [rangeEndDate, rangeStartDate]
        : [rangeStartDate, rangeEndDate];

      if (startDate && taskDate < startDate) return false;
      if (endDate && taskDate > endDate) return false;
    }
    
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      const matchesName = task.name.toLowerCase().includes(lowerQuery);
      const matchesCode = task.code.toLowerCase().includes(lowerQuery);
      const matchesDate = new Date(task.createdAt).toLocaleDateString().includes(lowerQuery);
      if (!matchesName && !matchesCode && !matchesDate) return false;
    }

    return true;
  });

  const uniqueCreators = Array.from(new Set(tasks.map(t => t.createdBy))).map(id => initialUsers.find(u => u.id === id)).filter(Boolean) as typeof initialUsers;
  const uniqueTypes = Array.from(new Set(tasks.map(t => t.taskType)));

  const creatorOptions = [
    { value: 'all', label: 'All Creators' },
    ...uniqueCreators.map(u => ({ value: u.id, label: u.name.split(' ')[0] }))
  ];

  const typeOptions = [
    { value: 'all', label: 'All Types' },
    ...uniqueTypes.map(t => ({ value: t, label: getTaskTypeLabel(t) }))
  ];
  const dateFilterOptions = [
    { value: 'all', label: 'All Dates' },
    { value: 'single', label: 'Specific Date' },
    { value: 'range', label: 'Date Range' },
  ];

  const hasDateFilter = dateFilterMode !== 'all' || singleDate || rangeStartDate || rangeEndDate;
  const clearDateFilter = () => {
    setDateFilterMode('all');
    setSingleDate('');
    setRangeStartDate('');
    setRangeEndDate('');
  };

  const colorStyles = {
    amber: "bg-amber-50 text-amber-800",
    blue: "bg-blue-50 text-blue-800",
    green: "bg-emerald-50 text-emerald-800",
    red: "bg-rose-50 text-rose-800",
    gray: "bg-slate-50 text-slate-800",
    purple: "bg-indigo-50 text-indigo-800",
  } as Record<string, string>;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h2 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{title}</h2>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        
        <div className="flex min-w-full flex-col gap-1.5 xl:min-w-[250px] xl:flex-[2]">
          <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Search</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Search by name or ID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full border border-slate-300 rounded-lg pl-10 pr-4 py-2 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:font-medium"
            />
          </div>
        </div>

        {currentUser.role !== 'team_member' && (
          <div className="flex min-w-full flex-col gap-1.5 sm:min-w-[180px] sm:flex-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Creator</label>
            <CustomSelect 
              value={creatorFilter} 
              onChange={setCreatorFilter}
              options={creatorOptions}
            />
          </div>
        )}

        <div className="flex min-w-full flex-col gap-1.5 sm:min-w-[180px] sm:flex-1">
          <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Task Type</label>
          <CustomSelect 
            value={typeFilter} 
            onChange={setTypeFilter}
            options={typeOptions}
          />
        </div>

        <div className="flex min-w-full flex-col gap-1.5 lg:min-w-[220px] lg:flex-1">
          <div className="flex items-center justify-between gap-3">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Upload Date</label>
            {hasDateFilter && (
              <button
                type="button"
                onClick={clearDateFilter}
                className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400 transition-colors hover:text-rose-600"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(150px,0.9fr),minmax(180px,1fr)]">
            <CustomSelect
              value={dateFilterMode}
              onChange={value => setDateFilterMode(value as DateFilterMode)}
              options={dateFilterOptions}
            />
            {dateFilterMode === 'single' && (
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  value={singleDate}
                  onChange={event => setSingleDate(event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 pl-10 pr-3 text-sm font-bold text-slate-700 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}
            {dateFilterMode === 'range' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="date"
                    aria-label="Start upload date"
                    value={rangeStartDate}
                    onChange={event => setRangeStartDate(event.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 pl-10 pr-3 text-sm font-bold text-slate-700 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="date"
                    aria-label="End upload date"
                    value={rangeEndDate}
                    onChange={event => setRangeEndDate(event.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 pl-10 pr-3 text-sm font-bold text-slate-700 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider font-black text-slate-400">
              <th className="p-4 w-32">Asset</th>
              <th className="p-4">Details</th>
              <th className="p-4">Creator</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredTasks.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-500 font-medium">No tasks match your filters.</td>
              </tr>
            )}
            {filteredTasks.map(task => {
              const statusInfo = getStatusInfo(task, currentUser.role);
              const creator = initialUsers.find(u => u.id === task.createdBy);
              const version = task.versions.length > 0 ? task.versions[0].versionNumber : 1;
              const isDemo = task.environment === 'demo';

              return (
                <tr key={task.id} className="hover:bg-slate-50/50 transition-colors group cursor-pointer border-b border-slate-100 last:border-0" onClick={() => onOpenTask(task.id)}>
                  <td className="p-4 align-top">
                    <div className="w-24 h-16 bg-slate-100 rounded-lg overflow-hidden border border-slate-200 relative">
                      <TaskThumbnail task={task} />
                    </div>
                  </td>
                  <td className="p-4 align-top">
                    <div className="font-bold text-slate-900 mb-1 leading-tight">{task.name}</div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-slate-400 font-mono mb-2">
                      <span>{task.code}</span>
                      <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                      <span>V{version}</span>
                      <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                      {isDemo ? (
                        <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] tracking-widest font-black uppercase">Demo</span>
                      ) : (
                        <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] tracking-widest font-black uppercase">Production</span>
                      )}
                    </div>
                    {(task.deadlineText || task.priority !== 'not_set') && (
                      <div className="flex items-center gap-3 mt-1">
                        {task.deadlineText && (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                             <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                             Due: <span className="text-slate-900">{task.deadlineText}</span>
                          </div>
                        )}
                        {task.priority !== 'not_set' && (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 capitalize">
                             <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                             Priority: <span className="text-slate-900">{task.priority}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-4 align-top">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                        {creator?.avatar ? <img src={creator.avatar} className="w-full h-full rounded-full object-cover"/> : creator?.name.charAt(0)}
                      </div>
                      <span className="font-semibold text-sm text-slate-700">{creator?.name.split(' ')[0]}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className={cn("inline-flex items-center px-2 py-1 rounded-full text-xs font-bold gap-1.5", colorStyles[statusInfo.color] || colorStyles.gray)}>
                       <span className={cn("w-1.5 h-1.5 rounded-full", `bg-${statusInfo.color === 'gray' ? 'slate' : statusInfo.color}-500`)}></span>
                       {statusInfo.label}
                    </div>
                  </td>
                  <td className="p-4 text-right">
                     <button className="px-4 py-1.5 border border-dashed border-indigo-300 text-indigo-600 font-bold text-sm rounded-lg hover:bg-indigo-50 transition-colors">
                       Review
                     </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
