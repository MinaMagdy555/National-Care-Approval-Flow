import React, { useState } from 'react';
import { CalendarDays, Check, Clock3, Edit3, Link2, Plus, RotateCcw, X, Trash2, Settings, Search, Calendar, Clock, HelpCircle } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { Priority, Task, Role, TaskTypeConfig } from '../lib/types';
import { canCreateWorkAssignment, canManageWorkAssignment, canUploadWorkAssignment, isWorkAssignmentAssignee, sortWorkAssignments } from '../lib/workAssignmentUtils';
import { getPriorityLabel, getTaskTypeLabel, getStatusInfo } from '../lib/taskUtils';
import { isAssignableContributorForTask } from '../lib/handlerUtils';
import { CustomSelect } from './CustomSelect';
import { UserMultiSelect } from './UserMultiSelect';
import { ThemedDatePicker } from './ThemedDatePicker';
import { ThemedTimePicker } from './ThemedTimePicker';
import { cn } from '../lib/utils';
import { initialUsers } from '../lib/mockData';
import { getActivePriorityOptions, getPriorityTone, isDeadlineInsideBusinessHours, getWorkingHoursForUser, priorityToneClasses, MINA_ID, normalizeTaskTypeId, cleanTaskTypeKey, getTaskTypeConfigs } from '../lib/appSettings';
import { userCanViewFullWorkspace } from '../lib/workflowUtils';

const CONTROL_CLASS = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10';
const SELECT_BUTTON_CLASS = 'rounded-xl border-slate-200 px-3 py-2.5 text-sm font-black text-slate-900 shadow-sm hover:bg-slate-50 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10';

function getUserName(users: ReturnType<typeof useAppStore>['users'], userId: string) {
  return users[userId]?.name || initialUsers.find(user => user.id === userId)?.name || userId;
}

function getDateInputValue(date: string) {
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return '';

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const day = String(parsedDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidUrl(str: string) {
  const trimmed = str.trim();
  if (!trimmed) return false;
  if (/\s/.test(trimmed)) return false;
  try {
    let urlString = trimmed;
    if (!/^https?:\/\//i.test(trimmed)) {
      urlString = 'https://' + trimmed;
    }
    const url = new URL(urlString);
    return url.hostname.includes('.') && url.hostname.split('.').every(part => part.length > 0);
  } catch (e) {
    return false;
  }
}

function formatDeadline(value?: string | null) {
  if (!value) return 'No deadline';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function normalizeLinks(links: string[]) {
  return links.map(link => link.trim()).filter(Boolean);
}

function splitDeadline(value?: string | null) {
  if (!value) return { date: '', time: '' };
  const [datePart, timePart = ''] = value.split('T');
  return {
    date: datePart || '',
    time: timePart.slice(0, 5),
  };
}

function isDateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00`);
  return !Number.isNaN(parsed.getTime());
}

function isTimeValue(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function combineDeadline(date: string, time: string) {
  return isDateValue(date) && isTimeValue(time) ? `${date}T${time}` : '';
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

function getAssignmentGroups(tasks: Task[], users: ReturnType<typeof useAppStore>['users'], currentUserId: string, appSettings: ReturnType<typeof useAppStore>['appSettings']) {
  const groups = new Map<string, Task[]>();

  sortWorkAssignments(tasks, appSettings).forEach(task => {
    task.handledBy.forEach(userId => {
      groups.set(userId, [...(groups.get(userId) || []), task]);
    });
  });

  return Array.from(groups.entries())
    .map(([userId, groupTasks]) => ({
      userId,
      name: getUserName(users, userId),
      tasks: sortWorkAssignments(groupTasks, appSettings),
    }))
    .sort((a, b) => {
      if (a.userId === currentUserId) return -1;
      if (b.userId === currentUserId) return 1;
      return a.name.localeCompare(b.name);
    });
}

export function AssignedWorkSection({
  tasks,
  onOpenAssignmentUpload,
  onOpenTask,
  mode = 'create',
}: {
  tasks: Task[];
  onOpenAssignmentUpload: (taskId: string) => void;
  onOpenTask?: (taskId: string) => void;
  mode?: 'create' | 'tracking';
}) {
  const { currentUser, userList, users, appSettings, updateAppSettings, createWorkAssignment, updateWorkAssignment, addTaskComment, addNotifications } = useAppStore();
  const [activeTab, setActiveTab] = useState<'assignments' | 'task_types'>('assignments');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [name, setName] = useState('');
  
  // Advanced filters state for tracking tasks
  const [filterCreator, setFilterCreator] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Assignment Date
  const [dateFilterMode, setDateFilterMode] = useState<'all' | 'single' | 'range'>('all');
  const [singleDate, setSingleDate] = useState('');
  const [rangeStartDate, setRangeStartDate] = useState('');
  const [rangeEndDate, setRangeEndDate] = useState('');

  // Deadline Date
  const [deadlineFilterMode, setDeadlineFilterMode] = useState<'all' | 'single' | 'range'>('all');
  const [deadlineSingleDate, setDeadlineSingleDate] = useState('');
  const [deadlineStartDate, setDeadlineStartDate] = useState('');
  const [deadlineEndDate, setDeadlineEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('');
  const [isOvertime, setIsOvertime] = useState(false);
  const [needsContentRevision, setNeedsContentRevision] = useState(false);
  const [taskType, setTaskType] = useState<string>('video');
  const [showAllUsers, setShowAllUsers] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [linkInput, setLinkInput] = useState('');
  const [deadlineError, setDeadlineError] = useState('');

  // Task type management states
  const [taskTypeName, setTaskTypeName] = useState('');
  const [taskTypeJobTitles, setTaskTypeJobTitles] = useState<string[]>([]);
  const [taskTypeDetailed, setTaskTypeDetailed] = useState(false);
  const [taskTypeFullReviewers, setTaskTypeFullReviewers] = useState<string[]>([]);
  const [taskTypeQuickLookReviewers, setTaskTypeQuickLookReviewers] = useState<string[]>([]);
  const [taskTypeFinalReviewers, setTaskTypeFinalReviewers] = useState<string[]>([]);

  const [editingTaskTypeId, setEditingTaskTypeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [editingJobTitles, setEditingJobTitles] = useState<string[]>([]);
  const [editingDetailed, setEditingDetailed] = useState(false);
  const [editingFullReviewers, setEditingFullReviewers] = useState<string[]>([]);
  const [editingQuickLookReviewers, setEditingQuickLookReviewers] = useState<string[]>([]);
  const [editingFinalReviewers, setEditingFinalReviewers] = useState<string[]>([]);
  const [clarificationTaskId, setClarificationTaskId] = useState<string | null>(null);
  const [clarificationQuestion, setClarificationQuestion] = useState('');

  const handleSendClarification = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clarificationTaskId || !clarificationQuestion.trim()) return;

    addTaskComment(clarificationTaskId, {
      authorId: currentUser.id,
      action: 'clarification_needed',
      message: clarificationQuestion.trim(),
      sections: [],
    });

    const task = tasks.find(t => t.id === clarificationTaskId);
    if (task) {
      const notifyUsers = new Set<string>();
      if (task.createdBy && task.createdBy !== currentUser.id) {
        notifyUsers.add(task.createdBy);
      }
      task.handledBy.forEach(userId => {
        if (userId !== currentUser.id) {
          notifyUsers.add(userId);
        }
      });
      if (notifyUsers.size > 0) {
        addNotifications(
          Array.from(notifyUsers),
          clarificationTaskId,
          `${currentUser.name} requested clarifications on "${task.name}": ${clarificationQuestion.trim().slice(0, 60)}${clarificationQuestion.trim().length > 60 ? '...' : ''}`
        );
      }
    }

    setClarificationTaskId(null);
    setClarificationQuestion('');
  };

  const canCreate = canCreateWorkAssignment(currentUser, appSettings);
  const priorityOptions = getActivePriorityOptions(appSettings);
  const assigneeOptions = userList.filter(user => {
    if (user.id === 'guest') return false;
    return isWorkAssignmentAssignee(user, currentUser.id, appSettings);
  });
  
  const suggestedUsers = assigneeOptions.filter(user => {
    return isAssignableContributorForTask(user, taskType, undefined, appSettings);
  });

  const otherUsers = assigneeOptions.filter(user => !suggestedUsers.some(su => su.id === user.id));

  const canViewAllWorkload = userCanViewFullWorkspace(currentUser, appSettings);

  const visibleTasks = tasks.filter(task => {
    return canViewAllWorkload || task.handledBy.includes(currentUser.id) || task.createdBy === currentUser.id;
  });

  const filteredTasks = visibleTasks.filter(task => {
    if (filterCreator !== 'all' && task.createdBy !== filterCreator) return false;
    if (filterType !== 'all' && task.taskType !== filterType) return false;
    if (filterAssignee !== 'all') {
      if (filterAssignee === 'solo' && task.handledBy.length !== 1) return false;
      if (filterAssignee === 'cooperation' && task.handledBy.length <= 1) return false;
    }
    if (filterPriority !== 'all' && task.priority !== filterPriority) return false;

    const statusInfo = getStatusInfo(task, currentUser.role, users);
    if (filterStatus !== 'all' && statusInfo.label !== filterStatus) return false;

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
      const matchesDescription = (task.description || '').toLowerCase().includes(lowerQuery);
      const matchesId = task.id.toLowerCase().includes(lowerQuery);
      const matchesCode = (task.code || '').toLowerCase().includes(lowerQuery);
      const matchesDate = new Date(task.createdAt).toLocaleDateString().includes(lowerQuery);
      if (!matchesName && !matchesDescription && !matchesId && !matchesCode && !matchesDate) return false;
    }

    return true;
  });

  const assignmentGroups = getAssignmentGroups(filteredTasks, users, currentUser.id, appSettings);

  const getUserById = (id: string) => users[id] || (id === currentUser.id ? currentUser : undefined) || initialUsers.find(user => user.id === id);

  const uniqueCreators = Array.from(new Set(visibleTasks.map(t => t.createdBy))).map(getUserById).filter(Boolean) as Array<NonNullable<ReturnType<typeof getUserById>>>;
  const filterCreatorOptions = [
    { value: 'all', label: 'All Assigners' },
    ...uniqueCreators.map(u => ({ value: u.id, label: u.name }))
  ];

  const filterAssigneeOptions = [
    { value: 'all', label: 'All (Solo/Coop)' },
    { value: 'solo', label: 'Solo Task' },
    { value: 'cooperation', label: 'Cooperation' }
  ];

  const filterPriorityOptions = [
    { value: 'all', label: 'All Priorities' },
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' }
  ];

  const uniqueStatuses = Array.from(new Set(visibleTasks.map(t => getStatusInfo(t, currentUser.role, users).label)));
  const filterStatusOptions = [
    { value: 'all', label: 'All Statuses' },
    ...uniqueStatuses.map(label => ({ value: label, label }))
  ];

  const uniqueTypes = Array.from(new Set(visibleTasks.map(t => t.taskType)));
  const filterTypeOptions = [
    { value: 'all', label: 'All Types' },
    ...uniqueTypes.map(t => ({ value: t, label: getTaskTypeLabel(t, appSettings) }))
  ];

  const dateFilterOptions = [
    { value: 'all', label: 'All Dates' },
    { value: 'single', label: 'Specific Date' },
    { value: 'range', label: 'Date Range' },
  ];
  const deadlineAt = combineDeadline(deadlineDate, deadlineTime);
  const deadlineValidation = deadlineAt ? isDeadlineInsideBusinessHours(appSettings, deadlineAt, new Date(), isOvertime, assigneeIds, userList) : { ok: false, message: 'Select a deadline.' };

  const normalizeSettingId = (value: string) => {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `custom_${Date.now().toString(36)}`;
  };

  const resetForm = () => {
    setEditingTaskId(null);
    setName('');
    setDescription('');
    setPriority('normal');
    setDeadlineDate('');
    setDeadlineTime('');
    setIsOvertime(false);
    setNeedsContentRevision(false);
    setTaskType('video');
    setShowAllUsers(false);
    setAssigneeIds([]);
    setLinks([]);
    setLinkInput('');
    setDeadlineError('');
  };

  const taskTypeConfigs = getTaskTypeConfigs(appSettings);
  const seedUsers = userList.filter(user => user.id !== 'guest');

  const handleAddTaskType = () => {
    const name = taskTypeName.trim();
    if (!name) return;
    const normalized = normalizeTaskTypeId(name);
    
    if (taskTypeConfigs.some(c => cleanTaskTypeKey(c.id) === cleanTaskTypeKey(normalized))) {
      alert('This task type already exists.');
      return;
    }

    const newConfig: TaskTypeConfig = {
      id: normalized,
      label: name,
      suggestedJobTitles: taskTypeJobTitles,
      isDetailedReview: taskTypeDetailed,
      fullReviewerUserIds: taskTypeFullReviewers,
      quickLookUserIds: taskTypeQuickLookReviewers,
      finalReviewerUserIds: taskTypeFinalReviewers,
    };

    updateAppSettings(settings => {
      const current = settings.taskTypes || [];
      return {
        ...settings,
        taskTypes: [...current, newConfig]
      };
    });

    setTaskTypeName('');
    setTaskTypeJobTitles([]);
    setTaskTypeDetailed(false);
    setTaskTypeFullReviewers([]);
    setTaskTypeQuickLookReviewers([]);
    setTaskTypeFinalReviewers([]);
  };

  const handleDeleteTaskType = (id: string) => {
    if (!confirm(`Are you sure you want to delete the task type "${id}"?`)) return;
    updateAppSettings(settings => {
      const current = settings.taskTypes || [];
      return {
        ...settings,
        taskTypes: current.filter(t => {
          const tId = typeof t === 'object' && t !== null ? t.id : String(t);
          return cleanTaskTypeKey(tId) !== cleanTaskTypeKey(id);
        })
      };
    });
  };

  const handleStartEditingTaskType = (config: TaskTypeConfig) => {
    setEditingTaskTypeId(config.id);
    setEditingLabel(config.label);
    setEditingJobTitles(config.suggestedJobTitles);
    setEditingDetailed(config.isDetailedReview);
    setEditingFullReviewers(config.fullReviewerUserIds || []);
    setEditingQuickLookReviewers(config.quickLookUserIds || []);
    setEditingFinalReviewers(config.finalReviewerUserIds || []);
  };

  const handleSaveEditTaskType = () => {
    if (!editingLabel.trim()) return;
    updateAppSettings(settings => {
      const current = settings.taskTypes || [];
      return {
        ...settings,
        taskTypes: current.map(t => {
          const tId = typeof t === 'object' && t !== null ? t.id : String(t);
          if (cleanTaskTypeKey(tId) === cleanTaskTypeKey(editingTaskTypeId || '')) {
            return {
              id: tId,
              label: editingLabel.trim(),
              suggestedJobTitles: editingJobTitles,
              isDetailedReview: editingDetailed,
              fullReviewerUserIds: editingFullReviewers,
              quickLookUserIds: editingQuickLookReviewers,
              finalReviewerUserIds: editingFinalReviewers,
            };
          }
          return t;
        })
      };
    });
    setEditingTaskTypeId(null);
  };

  const addLink = () => {
    const nextLink = linkInput.trim();
    if (!nextLink || !isValidUrl(nextLink)) return;

    let formattedLink = nextLink;
    if (!/^https?:\/\//i.test(nextLink)) {
      formattedLink = 'https://' + nextLink;
    }

    setLinks(prev => prev.includes(formattedLink) ? prev : [...prev, formattedLink]);
    setLinkInput('');
  };

  const submitAssignment = (event: React.FormEvent) => {
    event.preventDefault();

    const hasDeadlineInput = Boolean(deadlineDate || deadlineTime);
    if (hasDeadlineInput) {
      const validation = isDeadlineInsideBusinessHours(appSettings, deadlineAt, new Date(), isOvertime, assigneeIds, userList);
      if (!validation.ok) {
        setDeadlineError(validation.message);
        return;
      }
    }

    const input = {
      name,
      description,
      priority,
      deadlineAt: hasDeadlineInput ? deadlineAt : null,
      assignmentLinks: normalizeLinks(links),
      handledByIds: assigneeIds,
      isOvertime,
      taskType,
      needsContentRevision,
    };

    if (editingTaskId) {
      updateWorkAssignment(editingTaskId, input);
    } else {
      createWorkAssignment(input);
    }
    resetForm();
  };

  const startEditing = (task: Task) => {
    const deadline = splitDeadline(task.deadlineAt);
    setEditingTaskId(task.id);
    setName(task.name);
    setDescription(task.description || '');
    setPriority(task.priority === 'not_set' ? 'normal' : task.priority);
    setDeadlineDate(deadline.date);
    setDeadlineTime(deadline.time);
    setIsOvertime(task.isOvertime || false);
    setNeedsContentRevision(task.needsContentRevision || false);
    setTaskType(task.taskType || 'video');
    setAssigneeIds(task.handledBy);
    setLinks(task.assignmentLinks || []);
  };

  const handleCardClick = (task: Task, canUpload: boolean, isUploaded: boolean) => {
    if (isUploaded) {
      onOpenTask?.(task.id);
    } else if (canUpload) {
      onOpenAssignmentUpload(task.id);
    } else {
      onOpenTask?.(task.id);
    }
  };

  const hasDeadlineInput = Boolean(deadlineDate || deadlineTime);
  const deadlineIsValid = !hasDeadlineInput || (Boolean(deadlineDate && deadlineTime) && deadlineValidation.ok);
  const formIsValid = name.trim() && description.trim() && deadlineIsValid && assigneeIds.length > 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-2">
        <h3 className="text-lg font-black text-slate-900 font-extrabold uppercase tracking-wider">Assigned Work</h3>
        
        {canCreate && mode === 'create' && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('assignments')}
              className={cn(
                "px-3 py-1.5 text-xs font-black uppercase tracking-wider border-b-2 transition-all",
                activeTab === 'assignments'
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-400 hover:text-slate-700"
              )}
            >
              Assignments
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('task_types')}
              className={cn(
                "px-3 py-1.5 text-xs font-black uppercase tracking-wider border-b-2 transition-all",
                activeTab === 'task_types'
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-400 hover:text-slate-700"
              )}
            >
              Task Types & Workflows
            </button>
          </div>
        )}
      </div>

      {activeTab === 'task_types' && canCreate && mode === 'create' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 space-y-6">
          <div>
            <h4 className="text-base font-black text-slate-900">Configure Task Types & Workflows</h4>
            <p className="text-xs font-semibold text-slate-500">Configure suggested roles, detailed review flows, and naming of task types.</p>
          </div>

          {/* Add form */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-4">
            <h5 className="text-xs font-black uppercase tracking-wider text-slate-500">Create Task Type</h5>
            <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
              <input
                value={taskTypeName}
                onChange={event => setTaskTypeName(event.target.value)}
                placeholder="Task Type Name (e.g. Video, Content Revision)"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
              <button
                type="button"
                onClick={handleAddTaskType}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 transition-colors"
              >
                <Plus className="h-4 w-4" /> Add Type
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Suggested Roles / Job Titles</label>
              <div className="flex flex-wrap gap-2">
                {appSettings.responsibilities.map(r => {
                  const active = taskTypeJobTitles.includes(r.label);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setTaskTypeJobTitles(prev =>
                          prev.includes(r.label) ? prev.filter(l => l !== r.label) : [...prev, r.label]
                        );
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-bold transition-all",
                        active
                          ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-black"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3 pt-2">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Full Reviewers (Custom)</label>
                <div className="flex flex-wrap gap-1.5">
                  {seedUsers.map(user => {
                    const active = taskTypeFullReviewers.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => {
                          setTaskTypeFullReviewers(prev => toggleValue(prev, user.id));
                        }}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs font-bold transition-all",
                          active
                            ? "bg-blue-50 border-blue-200 text-blue-700 font-black"
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        )}
                      >
                        {user.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Quick Look Reviewers (Custom)</label>
                <div className="flex flex-wrap gap-1.5">
                  {seedUsers.map(user => {
                    const active = taskTypeQuickLookReviewers.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => {
                          setTaskTypeQuickLookReviewers(prev => toggleValue(prev, user.id));
                        }}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs font-bold transition-all",
                          active
                            ? "bg-amber-50 border-amber-200 text-amber-700 font-black"
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        )}
                      >
                        {user.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Final Reviewers (Custom)</label>
                <div className="flex flex-wrap gap-1.5">
                  {seedUsers.map(user => {
                    const active = taskTypeFinalReviewers.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => {
                          setTaskTypeFinalReviewers(prev => toggleValue(prev, user.id));
                        }}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs font-bold transition-all",
                          active
                            ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-black"
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        )}
                      >
                        {user.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-100 bg-white px-2 py-1 text-xs font-bold text-slate-600 shadow-sm">
                <input
                  type="checkbox"
                  checked={taskTypeDetailed}
                  onChange={event => setTaskTypeDetailed(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                />
                Detailed Review Workflow (Request Edits Form)
              </label>
            </div>
          </div>

          {/* List */}
          <div className="space-y-3">
            <h5 className="text-xs font-black uppercase tracking-wider text-slate-500">Existing Task Types</h5>
            <div className="grid gap-3 sm:grid-cols-2">
              {taskTypeConfigs.map(config => {
                const isEditing = editingTaskTypeId === config.id;
                return (
                  <div key={config.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:border-slate-300">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <input
                            value={editingLabel}
                            onChange={event => setEditingLabel(event.target.value)}
                            className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-900 shadow-sm"
                          />
                          <button
                            type="button"
                            onClick={handleSaveEditTaskType}
                            className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-black text-white hover:bg-indigo-700 transition-colors"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingTaskTypeId(null)}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-50 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>

                        <div className="space-y-1">
                          <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Suggested Roles</label>
                          <div className="flex flex-wrap gap-1.5">
                            {appSettings.responsibilities.map(r => {
                              const active = editingJobTitles.includes(r.label);
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => {
                                    setEditingJobTitles(prev =>
                                      prev.includes(r.label) ? prev.filter(l => l !== r.label) : [...prev, r.label]
                                    );
                                  }}
                                  className={cn(
                                    "rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition-all",
                                    active
                                      ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-black"
                                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                  )}
                                >
                                  {r.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3 pt-1">
                          <div className="space-y-1">
                            <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Full Reviewers (Custom)</label>
                            <div className="flex flex-wrap gap-1.5">
                              {seedUsers.map(user => {
                                const active = editingFullReviewers.includes(user.id);
                                return (
                                  <button
                                    key={user.id}
                                    type="button"
                                    onClick={() => {
                                      setEditingFullReviewers(prev => toggleValue(prev, user.id));
                                    }}
                                    className={cn(
                                      "rounded-full border px-2 py-0.5 text-[11px] font-bold transition-all",
                                      active
                                        ? "bg-blue-50 border-blue-200 text-blue-700 font-black"
                                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                    )}
                                  >
                                    {user.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Quick Look Reviewers (Custom)</label>
                            <div className="flex flex-wrap gap-1.5">
                              {seedUsers.map(user => {
                                const active = editingQuickLookReviewers.includes(user.id);
                                return (
                                  <button
                                    key={user.id}
                                    type="button"
                                    onClick={() => {
                                      setEditingQuickLookReviewers(prev => toggleValue(prev, user.id));
                                    }}
                                    className={cn(
                                      "rounded-full border px-2 py-0.5 text-[11px] font-bold transition-all",
                                      active
                                        ? "bg-amber-50 border-amber-200 text-amber-700 font-black"
                                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                    )}
                                  >
                                    {user.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Final Reviewers (Custom)</label>
                            <div className="flex flex-wrap gap-1.5">
                              {seedUsers.map(user => {
                                const active = editingFinalReviewers.includes(user.id);
                                return (
                                  <button
                                    key={user.id}
                                    type="button"
                                    onClick={() => {
                                      setEditingFinalReviewers(prev => toggleValue(prev, user.id));
                                    }}
                                    className={cn(
                                      "rounded-full border px-2 py-0.5 text-[11px] font-bold transition-all",
                                      active
                                        ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-black"
                                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                    )}
                                  >
                                    {user.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-600 font-medium">
                            <input
                              type="checkbox"
                              checked={editingDetailed}
                              onChange={event => setEditingDetailed(event.target.checked)}
                              className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                            />
                            Detailed Review Workflow
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-black text-slate-900">{config.label}</h4>
                            <span className="text-[10px] font-bold text-slate-400 font-mono">ID: {config.id}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 font-medium">Suggested:</span>
                            {config.suggestedJobTitles.length > 0 ? (
                              config.suggestedJobTitles.map(title => (
                                <span key={title} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{title}</span>
                              ))
                            ) : (
                              <span className="text-[10px] font-medium text-slate-500 italic">Anyone</span>
                            )}
                            <span className="text-[10px] text-slate-300 font-bold">|</span>
                            <span className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold",
                              config.isDetailedReview 
                                ? "bg-amber-50 text-amber-700 border border-amber-200/50" 
                                : "bg-slate-50 text-slate-500 border border-slate-200/50"
                            )}>
                              {config.isDetailedReview ? 'Detailed Review' : 'Simple Feedback'}
                            </span>
                          </div>

                          {/* Custom Reviewers Display */}
                          {((config.fullReviewerUserIds?.length || 0) > 0 || 
                            (config.quickLookUserIds?.length || 0) > 0 || 
                            (config.finalReviewerUserIds?.length || 0) > 0) && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                              {config.fullReviewerUserIds && config.fullReviewerUserIds.length > 0 && (
                                <div className="flex items-center gap-1">
                                  <span className="font-black text-blue-600 uppercase tracking-wider text-[9px]">Full Reviewers:</span>
                                  <span className="font-bold text-slate-700 bg-blue-50/50 px-1.5 py-0.5 rounded border border-blue-100/50">
                                    {config.fullReviewerUserIds.map(uid => users[uid]?.name || uid).join(', ')}
                                  </span>
                                </div>
                              )}
                              {config.quickLookUserIds && config.quickLookUserIds.length > 0 && (
                                <div className="flex items-center gap-1">
                                  <span className="font-black text-amber-600 uppercase tracking-wider text-[9px]">Quick Look:</span>
                                  <span className="font-bold text-slate-700 bg-amber-50/50 px-1.5 py-0.5 rounded border border-amber-100/50">
                                    {config.quickLookUserIds.map(uid => users[uid]?.name || uid).join(', ')}
                                  </span>
                                </div>
                              )}
                              {config.finalReviewerUserIds && config.finalReviewerUserIds.length > 0 && (
                                <div className="flex items-center gap-1">
                                  <span className="font-black text-indigo-600 uppercase tracking-wider text-[9px]">Final Review:</span>
                                  <span className="font-bold text-slate-700 bg-indigo-50/50 px-1.5 py-0.5 rounded border border-indigo-100/50">
                                    {config.finalReviewerUserIds.map(uid => users[uid]?.name || uid).join(', ')}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleStartEditingTaskType(config)}
                            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                            title="Edit task type"
                          >
                            <Settings className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTaskType(config.id)}
                            className="rounded-lg border border-rose-200 bg-white p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                            title="Delete task type"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <>
          {((canCreate && mode === 'create') || Boolean(editingTaskId)) && (
            <form onSubmit={submitAssignment} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={event => setName(event.target.value)}
                  className={CONTROL_CLASS}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">Description *</label>
                <textarea
                  rows={4}
                  value={description}
                  onChange={event => setDescription(event.target.value)}
                  className={`${CONTROL_CLASS} min-h-28 resize-y font-medium leading-relaxed`}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">Links</label>
                <div className="grid gap-2 sm:grid-cols-[1fr,auto]">
                  <div className="relative">
                    <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="url"
                      value={linkInput}
                      onChange={event => setLinkInput(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && linkInput.trim() && isValidUrl(linkInput)) {
                          event.preventDefault();
                          addLink();
                        }
                      }}
                      className={`${CONTROL_CLASS} pl-10`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addLink}
                    disabled={!linkInput.trim() || !isValidUrl(linkInput)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>
                {links.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {links.map(link => (
                      <span key={link} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-600">
                        <span className="max-w-[220px] truncate">{link}</span>
                        <button type="button" onClick={() => setLinks(prev => prev.filter(item => item !== link))} className="text-slate-400 hover:text-rose-600" aria-label={`Remove ${link}`}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">Task Type *</label>
                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <CustomSelect
                      value={taskType}
                      onChange={value => setTaskType(value)}
                      options={(appSettings.taskTypes || []).map(t => {
                        const id = typeof t === 'object' && t !== null ? t.id : String(t);
                        return { value: id, label: getTaskTypeLabel(id, appSettings).toUpperCase() };
                      })}
                      buttonClassName={SELECT_BUTTON_CLASS}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newType = prompt('Enter new task type name:');
                      if (!newType || !newType.trim()) return;
                      const normalized = normalizeTaskTypeId(newType);
                      updateAppSettings(settings => {
                        const current = settings.taskTypes || [];
                        const exists = current.some(t => {
                          const existingId = typeof t === 'object' && t !== null ? (t as any).id : String(t);
                          return existingId.toLowerCase() === normalized.toLowerCase();
                        });
                        if (exists) {
                          alert('This task type already exists.');
                          return settings;
                        }
                        return {
                          ...settings,
                          taskTypes: [...current, normalized]
                        };
                      });
                      setTaskType(normalized);
                    }}
                    className="h-11 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-black uppercase tracking-wider text-slate-500 hover:text-slate-800 transition-colors shrink-0"
                    title="Add new task type"
                  >
                    + Add Type
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">Priority *</label>
                <CustomSelect
                  value={priority}
                  onChange={value => setPriority(value as Priority)}
                  options={priorityOptions}
                  buttonClassName={SELECT_BUTTON_CLASS}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">Deadline</label>
                <div className="grid gap-2 sm:grid-cols-[1fr,140px]">
                  <ThemedDatePicker
                    value={deadlineDate}
                    onChange={val => {
                      setDeadlineDate(val);
                      setDeadlineError('');
                    }}
                  />
                  <ThemedTimePicker
                    value={deadlineTime}
                    onChange={val => {
                      setDeadlineTime(val);
                      setDeadlineError('');
                    }}
                  />
                </div>
                {(deadlineError || (deadlineAt && !deadlineValidation.ok)) && (
                  <p className="mt-1.5 text-xs font-bold text-rose-600">{deadlineError || deadlineValidation.message}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-slate-400">
                    Working hours: {(() => {
                      if (assigneeIds.length === 1) {
                        const selectedUser = userList.find(u => u.id === assigneeIds[0]);
                        if (selectedUser) {
                          const schedule = getWorkingHoursForUser(appSettings, selectedUser);
                          return `${schedule.startTime} - ${schedule.endTime}`;
                        }
                      } else if (assigneeIds.length > 1) {
                        return "Multiple assignees (custom hours apply per employee)";
                      }
                      return `${appSettings.businessCalendar.startTime} - ${appSettings.businessCalendar.endTime}`;
                    })()}
                  </p>
                  <div className="flex gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-slate-500 hover:bg-slate-100 transition-colors">
                      <input
                        type="checkbox"
                        checked={isOvertime}
                        onChange={event => {
                          setIsOvertime(event.target.checked);
                          setDeadlineError('');
                        }}
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      Overtime Task
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-slate-500 hover:bg-slate-100 transition-colors">
                      <input
                        type="checkbox"
                        checked={needsContentRevision}
                        onChange={event => {
                          setNeedsContentRevision(event.target.checked);
                        }}
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      Needs Content Revision
                    </label>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Suggested Assignees (based on Task Type) *</label>
                <UserMultiSelect
                  users={suggestedUsers}
                  selectedIds={assigneeIds}
                  onChange={setAssigneeIds}
                  emptyText="No suggested users available"
                />

                {otherUsers.length > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAllUsers(!showAllUsers)}
                      className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-indigo-600 transition-colors"
                    >
                      {showAllUsers ? '- Hide other team members' : '+ Show other team members (outside filter)'}
                    </button>
                    {showAllUsers && (
                      <div className="mt-2 animate-in fade-in duration-200">
                        <UserMultiSelect
                          users={otherUsers}
                          selectedIds={assigneeIds}
                          onChange={setAssigneeIds}
                          emptyText="No other users available"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="submit"
                  disabled={!formIsValid}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {editingTaskId ? 'Update Assignment' : 'Add Assignment'}
                </button>
                {editingTaskId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      )}

      {/* Filtering Panel */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {/* Search */}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Search</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Search by name, desc, code or ID..."
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
              value={filterCreator} 
              onChange={setFilterCreator}
              options={filterCreatorOptions}
            />
          </div>

          {/* Solo / Cooperation */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Solo / Cooperation</label>
            <CustomSelect 
              value={filterAssignee} 
              onChange={setFilterAssignee}
              options={filterAssigneeOptions}
            />
          </div>

          {/* Task Type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Task Type</label>
            <CustomSelect 
              value={filterType} 
              onChange={setFilterType}
              options={filterTypeOptions}
            />
          </div>

          {/* Priority */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Priority</label>
            <CustomSelect 
              value={filterPriority} 
              onChange={setFilterPriority}
              options={filterPriorityOptions}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Status */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Status</label>
            <CustomSelect 
              value={filterStatus} 
              onChange={setFilterStatus}
              options={filterStatusOptions}
            />
          </div>

          {/* Assignment Date */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Assignment Date</label>
              {(dateFilterMode !== 'all' || singleDate || rangeStartDate || rangeEndDate) && (
                <button 
                  onClick={() => {
                    setDateFilterMode('all');
                    setSingleDate('');
                    setRangeStartDate('');
                    setRangeEndDate('');
                  }}
                  className="text-[10px] font-black text-rose-600 uppercase hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="w-full">
                <CustomSelect 
                  value={dateFilterMode} 
                  onChange={(val) => setDateFilterMode(val as any)}
                  options={dateFilterOptions}
                />
              </div>
              <div className="w-full">
                {dateFilterMode === 'single' && (
                  <input 
                    type="date"
                    value={singleDate}
                    onChange={e => setSingleDate(e.target.value)}
                    className="w-full h-10 border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                )}
                {dateFilterMode === 'range' && (
                  <div className="grid gap-2 grid-cols-[1fr,auto,1fr] items-center">
                    <input 
                      type="date"
                      value={rangeStartDate}
                      onChange={e => setRangeStartDate(e.target.value)}
                      className="w-full h-10 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <span className="text-xs font-bold text-slate-400 text-center">to</span>
                    <input 
                      type="date"
                      value={rangeEndDate}
                      onChange={e => setRangeEndDate(e.target.value)}
                      className="w-full h-10 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
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
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Deadline Date</label>
              {(deadlineFilterMode !== 'all' || deadlineSingleDate || deadlineStartDate || deadlineEndDate) && (
                <button 
                  onClick={() => {
                    setDeadlineFilterMode('all');
                    setDeadlineSingleDate('');
                    setDeadlineStartDate('');
                    setDeadlineEndDate('');
                  }}
                  className="text-[10px] font-black text-rose-600 uppercase hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="w-full">
                <CustomSelect 
                  value={deadlineFilterMode} 
                  onChange={(val) => setDeadlineFilterMode(val as any)}
                  options={dateFilterOptions}
                />
              </div>
              <div className="w-full">
                {deadlineFilterMode === 'single' && (
                  <input 
                    type="date"
                    value={deadlineSingleDate}
                    onChange={e => setDeadlineSingleDate(e.target.value)}
                    className="w-full h-10 border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                )}
                {deadlineFilterMode === 'range' && (
                  <div className="grid gap-2 grid-cols-[1fr,auto,1fr] items-center">
                    <input 
                      type="date"
                      value={deadlineStartDate}
                      onChange={e => setDeadlineStartDate(e.target.value)}
                      className="w-full h-10 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <span className="text-xs font-bold text-slate-400 text-center">to</span>
                    <input 
                      type="date"
                      value={deadlineEndDate}
                      onChange={e => setDeadlineEndDate(e.target.value)}
                      className="w-full h-10 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
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

      <div className="space-y-4">
        {assignmentGroups.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-10 text-center text-sm font-bold text-slate-400">
            No assigned work yet.
          </div>
        ) : assignmentGroups.map(group => {
          const workingOnTasks = group.tasks.filter(task => !Boolean(task.assignmentUploadedAt || task.status !== 'assigned_work'));
          const sentForApprovalTasks = group.tasks.filter(task => Boolean(task.assignmentUploadedAt || task.status !== 'assigned_work'));

          const renderTaskCard = (task: Task) => {
            const assigneeNames = task.handledBy.map(userId => getUserName(users, userId));
            const creatorName = getUserName(users, task.createdBy);
            const isUploaded = Boolean(task.assignmentUploadedAt || task.status !== 'assigned_work');
            const canUpload = canUploadWorkAssignment(task, currentUser);
            const canEdit = canManageWorkAssignment(task, currentUser, appSettings);
            const teamStatus = assigneeNames.length > 1 ? `Team task (${assigneeNames.length} people)` : 'Solo task';

            return (
              <article
                key={`${group.userId}-${task.id}`}
                onClick={() => handleCardClick(task, canUpload, isUploaded)}
                className={cn(
                  'rounded-2xl border bg-white p-4 shadow-sm transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md hover:-translate-y-0.5',
                  isUploaded ? 'border-emerald-100 bg-emerald-50/30' : 'border-slate-200'
                )}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide', priorityToneClasses(getPriorityTone(appSettings, task.priority)))}>
                        {getPriorityLabel(task.priority, appSettings)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                        {teamStatus}
                      </span>
                      {isUploaded && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-700">
                          Uploaded
                        </span>
                      )}
                    </div>
                    <h4 className="text-base font-black leading-tight text-slate-900">{task.name}</h4>
                    <p className="mt-1 text-xs font-bold text-slate-500">By {creatorName} - Due {formatDeadline(task.deadlineAt)}</p>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        startEditing(task);
                      }}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-indigo-600"
                      aria-label={`Edit ${task.name}`}
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {task.description && <p className="mb-3 text-sm font-medium leading-relaxed text-slate-700">{task.description}</p>}

                <div className="mb-3 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                  {assigneeNames.map(assigneeName => (
                    <span key={assigneeName} className="rounded-lg bg-slate-100 px-2 py-1 text-slate-700">{assigneeName}</span>
                  ))}
                </div>

                {(task.assignmentLinks || []).length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {(task.assignmentLinks || []).map(link => (
                      <a
                        key={link}
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-black text-indigo-600 hover:bg-indigo-50"
                      >
                        <Link2 className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{link}</span>
                      </a>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenAssignmentUpload(task.id);
                    }}
                    disabled={isUploaded || !canUpload}
                    className={cn(
                      'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition-colors',
                      isUploaded
                        ? 'cursor-default border border-emerald-200 bg-emerald-50 text-emerald-700'
                        : canUpload
                          ? 'bg-slate-900 text-white hover:bg-black'
                          : 'cursor-not-allowed border border-slate-200 bg-slate-50 text-slate-400'
                    )}
                  >
                    <Check className="h-4 w-4" />
                    {isUploaded ? 'Finished Work Uploaded' : canUpload ? 'Upload Finished Work' : 'Waiting for Upload'}
                  </button>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setClarificationTaskId(task.id);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <HelpCircle className="h-4 w-4" />
                    Need Clarifications
                  </button>
                </div>
              </article>
            );
          };

          return (
            <div key={group.userId} className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <h4 className="text-sm font-black text-slate-900">{group.name}</h4>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                  {group.tasks.length} {group.tasks.length === 1 ? 'Task' : 'Tasks'}
                </span>
              </div>

              <div className="space-y-4">
                {workingOnTasks.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-black tracking-wider text-slate-400 uppercase pl-1">Still Working On ({workingOnTasks.length})</div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {workingOnTasks.map(task => renderTaskCard(task))}
                    </div>
                  </div>
                )}

                {sentForApprovalTasks.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-black tracking-wider text-slate-400 uppercase pl-1">Sent for Approval ({sentForApprovalTasks.length})</div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {sentForApprovalTasks.map(task => renderTaskCard(task))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
        </>
      )}

      {clarificationTaskId && (() => {
        const task = tasks.find(t => t.id === clarificationTaskId);
        if (!task) return null;
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm transition-all" onClick={() => { setClarificationTaskId(null); setClarificationQuestion(''); }}>
            <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
              <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between bg-slate-50/50">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Need Clarifications</h3>
                  <p className="text-xs font-bold text-slate-500 mt-0.5">Ask a question about: {task.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setClarificationTaskId(null);
                    setClarificationQuestion('');
                  }}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSendClarification} className="p-6 space-y-4">
                <div>
                  <label htmlFor="clarification-msg" className="block text-xs font-black uppercase tracking-wider text-slate-500 mb-2">
                    Your Question / Request
                  </label>
                  <textarea
                    id="clarification-msg"
                    value={clarificationQuestion}
                    onChange={(e) => setClarificationQuestion(e.target.value)}
                    placeholder="Type your question or what needs clarification..."
                    rows={4}
                    required
                    autoFocus
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setClarificationTaskId(null);
                      setClarificationQuestion('');
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-600/10 focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                  >
                    Submit Question
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
