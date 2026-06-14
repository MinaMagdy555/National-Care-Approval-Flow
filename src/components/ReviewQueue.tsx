import React, { useState } from 'react';
import { useAppStore } from '../lib/store';
import { Task } from '../lib/types';
import { getStatusInfo, getTaskTypeLabel, getPriorityLabel } from '../lib/taskUtils';
import { cn } from '../lib/utils';
import { initialUsers } from '../lib/mockData';
import { getCurrentOwnerUserIds } from '../lib/workflowUtils';
import { CalendarDays, Search, X, Calendar, Clock } from 'lucide-react';
import { CustomSelect } from './CustomSelect';
import { TaskThumbnail } from './FilePreview';
import { MINA_ID, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID, getPriorityTone, priorityToneClasses } from '../lib/appSettings';

type DateFilterMode = 'all' | 'single' | 'range';

function getDateInputValue(date: string) {
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return '';

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const day = String(parsedDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ReviewQueue({
  onOpenTask,
  onOpenUploadTask,
  tasks,
  title
}: {
  onOpenTask: (id: string) => void;
  onOpenUploadTask?: (id: string) => void;
  tasks: Task[];
  title: string;
}) {
  const { currentUser, users, appSettings, toggleTaskHold } = useAppStore();
  const isHighboard = [MINA_ID, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID].includes(currentUser.id);
  
  // Advanced filters state
  const [creatorFilter, setCreatorFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Assignment Date
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('all');
  const [singleDate, setSingleDate] = useState('');
  const [rangeStartDate, setRangeStartDate] = useState('');
  const [rangeEndDate, setRangeEndDate] = useState('');

  // Deadline Date
  const [deadlineFilterMode, setDeadlineFilterMode] = useState<DateFilterMode>('all');
  const [deadlineSingleDate, setDeadlineSingleDate] = useState('');
  const [deadlineStartDate, setDeadlineStartDate] = useState('');
  const [deadlineEndDate, setDeadlineEndDate] = useState('');

  const filteredTasks = tasks.filter(task => {
    if (creatorFilter !== 'all' && task.createdBy !== creatorFilter) return false;
    if (typeFilter !== 'all' && task.taskType !== typeFilter) return false;
    if (assigneeFilter !== 'all') {
      if (assigneeFilter === 'solo' && task.handledBy.length !== 1) return false;
      if (assigneeFilter === 'cooperation' && task.handledBy.length <= 1) return false;
    }
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
    
    const statusInfo = getStatusInfo(task, currentUser.role, users);
    if (statusFilter !== 'all' && statusInfo.label !== statusFilter) return false;

    const taskDate = getDateInputValue(task.createdAt);
    if (dateFilterMode === 'single' && singleDate && taskDate !== singleDate) return false;
    if (dateFilterMode === 'range' && (rangeStartDate || rangeEndDate)) {
      const [startDate, endDate] = rangeStartDate && rangeEndDate && rangeStartDate > rangeEndDate
        ? [rangeEndDate, rangeStartDate]
        : [rangeStartDate, rangeEndDate];

      if (startDate && taskDate < startDate) return false;
      if (endDate && taskDate > endDate) return false;
    }

    if (deadlineFilterMode !== 'all') {
      if (!task.deadlineAt) return false;
      const dlDate = getDateInputValue(task.deadlineAt);
      if (deadlineFilterMode === 'single' && deadlineSingleDate && dlDate !== deadlineSingleDate) return false;
      if (deadlineFilterMode === 'range' && (deadlineStartDate || deadlineEndDate)) {
        const [startDate, endDate] = deadlineStartDate && deadlineEndDate && deadlineStartDate > deadlineEndDate
          ? [deadlineEndDate, deadlineStartDate]
          : [deadlineStartDate, deadlineEndDate];

        if (startDate && dlDate < startDate) return false;
        if (endDate && dlDate > endDate) return false;
      }
    }
    
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      const matchesName = task.name.toLowerCase().includes(lowerQuery);
      const matchesCode = task.code.toLowerCase().includes(lowerQuery);
      const matchesId = task.id.toLowerCase().includes(lowerQuery);
      const matchesDate = new Date(task.createdAt).toLocaleDateString().includes(lowerQuery);
      if (!matchesName && !matchesCode && !matchesId && !matchesDate) return false;
    }

    return true;
  });

  const getUserById = (id: string) => users[id] || (id === currentUser.id ? currentUser : undefined) || initialUsers.find(user => user.id === id);
  const uniqueCreators = Array.from(new Set(tasks.map(t => t.createdBy))).map(getUserById).filter(Boolean) as Array<NonNullable<ReturnType<typeof getUserById>>>;
  const uniqueTypes = Array.from(new Set(tasks.map(t => t.taskType)));

  const creatorOptions = [
    { value: 'all', label: 'All Assigners' },
    ...uniqueCreators.map(u => ({ value: u.id, label: u.name }))
  ];

  const assigneeOptions = [
    { value: 'all', label: 'All (Solo/Coop)' },
    { value: 'solo', label: 'Solo Task' },
    { value: 'cooperation', label: 'Cooperation' }
  ];

  const priorityOptions = [
    { value: 'all', label: 'All Priorities' },
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' }
  ];

  const uniqueStatuses = Array.from(new Set(tasks.map(t => getStatusInfo(t, currentUser.role, users).label)));
  const statusOptions = [
    { value: 'all', label: 'All Statuses' },
    ...uniqueStatuses.map(label => ({ value: label, label }))
  ];

  const typeOptions = [
    { value: 'all', label: 'All Types' },
    ...uniqueTypes.map(t => ({ value: t, label: getTaskTypeLabel(t, appSettings) }))
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

      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {/* Search */}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Search</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Search by name or ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full h-10 border border-slate-300 rounded-lg pl-10 pr-4 py-2 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:font-medium"
              />
            </div>
          </div>

          {/* Assigner */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Assigner</label>
            <CustomSelect 
              value={creatorFilter} 
              onChange={setCreatorFilter}
              options={creatorOptions}
            />
          </div>

          {/* Solo / Cooperation */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Solo / Cooperation</label>
            <CustomSelect 
              value={assigneeFilter} 
              onChange={setAssigneeFilter}
              options={assigneeOptions}
            />
          </div>

          {/* Task Type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Task Type</label>
            <CustomSelect 
              value={typeFilter} 
              onChange={setTypeFilter}
              options={typeOptions}
            />
          </div>

          {/* Priority */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Priority</label>
            <CustomSelect 
              value={priorityFilter} 
              onChange={setPriorityFilter}
              options={priorityOptions}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Status */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Status</label>
            <CustomSelect 
              value={statusFilter} 
              onChange={setStatusFilter}
              options={statusOptions}
            />
          </div>

          {/* Assignment Date */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Assignment Date</label>
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
            <div className="flex flex-col gap-2">
              <CustomSelect
                value={dateFilterMode}
                onChange={value => setDateFilterMode(value as DateFilterMode)}
                options={dateFilterOptions}
              />
              <div className="w-full">
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
                  <div className="grid gap-2 grid-cols-[1fr,auto,1fr] items-center">
                    <div className="relative">
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="date"
                        aria-label="Start assignment date"
                        value={rangeStartDate}
                        onChange={event => setRangeStartDate(event.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-300 pl-10 pr-3 text-xs font-bold text-slate-700 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <span className="text-xs font-bold text-slate-400">to</span>
                    <div className="relative">
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="date"
                        aria-label="End assignment date"
                        value={rangeEndDate}
                        onChange={event => setRangeEndDate(event.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-300 pl-10 pr-3 text-xs font-bold text-slate-700 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                )}
                {dateFilterMode === 'all' && (
                  <div className="w-full h-10 border border-slate-200 bg-slate-50 rounded-lg flex items-center px-3 text-xs font-semibold text-slate-400">
                    Showing all assignment dates
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Deadline Date */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Deadline Date</label>
              {(deadlineFilterMode !== 'all' || deadlineSingleDate || deadlineStartDate || deadlineEndDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setDeadlineFilterMode('all');
                    setDeadlineSingleDate('');
                    setDeadlineStartDate('');
                    setDeadlineEndDate('');
                  }}
                  className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400 transition-colors hover:text-rose-600"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <CustomSelect
                value={deadlineFilterMode}
                onChange={value => setDeadlineFilterMode(value as DateFilterMode)}
                options={dateFilterOptions}
              />
              <div className="w-full">
                {deadlineFilterMode === 'single' && (
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="date"
                      value={deadlineSingleDate}
                      onChange={event => setDeadlineSingleDate(event.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 pl-10 pr-3 text-sm font-bold text-slate-700 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}
                {deadlineFilterMode === 'range' && (
                  <div className="grid gap-2 grid-cols-[1fr,auto,1fr] items-center">
                    <div className="relative">
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="date"
                        aria-label="Start deadline date"
                        value={deadlineStartDate}
                        onChange={event => setDeadlineStartDate(event.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-300 pl-10 pr-3 text-xs font-bold text-slate-700 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <span className="text-xs font-bold text-slate-400">to</span>
                    <div className="relative">
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="date"
                        aria-label="End deadline date"
                        value={deadlineEndDate}
                        onChange={event => setDeadlineEndDate(event.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-300 pl-10 pr-3 text-xs font-bold text-slate-700 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                )}
                {deadlineFilterMode === 'all' && (
                  <div className="w-full h-10 border border-slate-200 bg-slate-50 rounded-lg flex items-center px-3 text-xs font-semibold text-slate-400">
                    Showing all deadline dates
                  </div>
                )}
              </div>
            </div>
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
              <th className="p-4">Assigner</th>
              <th className="p-4">Priority</th>
              <th className="p-4">Deadline</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredTasks.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500 font-medium">No tasks match your filters.</td>
              </tr>
            )}
            {filteredTasks.map(task => {
              const statusInfo = getStatusInfo(task, currentUser.role, users);
              const creator = getUserById(task.createdBy);
              const version = task.versions.length > 0 ? task.versions[0].versionNumber : 1;
              const isDemo = task.environment === 'demo';
              const assignedNames = task.handledBy.map(getUserById).filter(Boolean).map(user => user!.name.split(' ')[0]).join(', ');

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
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                      <span>V{version}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                      {isDemo ? (
                        <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] tracking-widest font-black uppercase">Demo</span>
                      ) : (
                        <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] tracking-widest font-black uppercase">Production</span>
                      )}
                    </div>
                    {task.scheduledPublishAt && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
                        <span>Publish: <span className="text-slate-800">{new Date(task.scheduledPublishAt).toLocaleString()}</span></span>
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
                  <td className="p-4 align-top">
                    {task.priority !== 'not_set' ? (
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide', priorityToneClasses(getPriorityTone(appSettings, task.priority)))}>
                        {getPriorityLabel(task.priority, appSettings)}
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-slate-400">—</span>
                    )}
                  </td>
                  <td className="p-4 align-top">
                    {task.deadlineAt ? (
                      <div className="flex flex-col gap-1 text-xs font-bold text-slate-700 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{new Date(task.deadlineAt).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{new Date(task.deadlineAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-slate-400">—</span>
                    )}
                  </td>
                  <td className="p-4 align-top">
                    <div className={cn("inline-flex items-center px-2 py-1 rounded-full text-xs font-bold gap-1.5", colorStyles[statusInfo.color] || colorStyles.gray)}>
                       <span className={cn("w-1.5 h-1.5 rounded-full", `bg-${statusInfo.color === 'gray' ? 'slate' : statusInfo.color}-500`)}></span>
                       {statusInfo.label}
                    </div>
                  </td>
                  <td className="p-4 text-right align-top">
                    {(() => {
                      const isAssignedToMe = task.handledBy.includes(currentUser.id);
                      const isTaskActiveForUpload = task.status === 'assigned_work';

                      if (isAssignedToMe && isTaskActiveForUpload) {
                        return (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onOpenUploadTask) {
                                onOpenUploadTask(task.id);
                              }
                            }}
                            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-lg transition-colors shadow-sm whitespace-nowrap"
                          >
                            Upload the Task
                          </button>
                        );
                      }

                      const leaderboardIds = [MINA_ID, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID];
                      const canToggleHold = currentUser.role === 'reviewer' || leaderboardIds.includes(currentUser.id);
                      if (canToggleHold) {
                        if (task.status === 'on_hold') {
                          return (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTaskHold(task.id);
                              }}
                              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-lg transition-colors shadow-sm"
                            >
                              Resume
                            </button>
                          );
                        } else if (!['approved', 'completed', 'archived', 'approved_by_art_director'].includes(task.status)) {
                          return (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTaskHold(task.id);
                              }}
                              className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm rounded-lg transition-colors shadow-sm"
                            >
                              Hold
                            </button>
                          );
                        }
                      }
                      
                      const isReviewerOrLeader = currentUser.role === 'reviewer' || leaderboardIds.includes(currentUser.id);
                      if (isReviewerOrLeader) {
                        return (
                          <button className="px-4 py-1.5 border border-dashed border-indigo-300 text-indigo-600 font-bold text-sm rounded-lg hover:bg-indigo-50 transition-colors">
                            Review
                          </button>
                        );
                      } else {
                        return (
                          <button className="px-4 py-1.5 border border-dashed border-slate-300 text-slate-600 font-bold text-sm rounded-lg hover:bg-slate-50 transition-colors">
                            View
                          </button>
                        );
                      }
                    })()}
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
