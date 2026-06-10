import React, { useState } from 'react';
import { CalendarDays, Check, Clock3, Edit3, Link2, Plus, RotateCcw, X } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { Priority, Task } from '../lib/types';
import { canCreateWorkAssignment, canManageWorkAssignment, canUploadWorkAssignment, isWorkAssignmentAssignee, sortWorkAssignments } from '../lib/workAssignmentUtils';
import { getPriorityLabel } from '../lib/taskUtils';
import { CustomSelect } from './CustomSelect';
import { UserMultiSelect } from './UserMultiSelect';
import { ThemedDatePicker } from './ThemedDatePicker';
import { ThemedTimePicker } from './ThemedTimePicker';
import { cn } from '../lib/utils';
import { initialUsers } from '../lib/mockData';
import { getActivePriorityOptions, getPriorityTone, isDeadlineInsideBusinessHours, priorityToneClasses } from '../lib/appSettings';
import { userCanViewFullWorkspace } from '../lib/workflowUtils';

const CONTROL_CLASS = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10';
const SELECT_BUTTON_CLASS = 'rounded-xl border-slate-200 px-3 py-2.5 text-sm font-black text-slate-900 shadow-sm hover:bg-slate-50 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10';

function getUserName(users: ReturnType<typeof useAppStore>['users'], userId: string) {
  return users[userId]?.name || initialUsers.find(user => user.id === userId)?.name || userId;
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
}: {
  tasks: Task[];
  onOpenAssignmentUpload: (taskId: string) => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const { currentUser, userList, users, appSettings, updateAppSettings, createWorkAssignment, updateWorkAssignment } = useAppStore();
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [name, setName] = useState('');
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
  const canCreate = canCreateWorkAssignment(currentUser, appSettings);
  const priorityOptions = getActivePriorityOptions(appSettings);
  const assigneeOptions = userList.filter(user => {
    if (user.id === 'guest') return false;
    return isWorkAssignmentAssignee(user, currentUser.id, appSettings);
  });
  
  const suggestedUsers = assigneeOptions.filter(user => {
    const isVideoHandler = appSettings.videoOnlyHandlerIds.includes(user.id);
    if (taskType === 'video') {
      return isVideoHandler;
    } else {
      return !isVideoHandler;
    }
  });

  const otherUsers = assigneeOptions.filter(user => !suggestedUsers.some(su => su.id === user.id));

  const canViewAllWorkload = userCanViewFullWorkspace(currentUser, appSettings);

  const visibleTasks = tasks.filter(task => {
    return canViewAllWorkload || task.handledBy.includes(currentUser.id) || task.createdBy === currentUser.id;
  });

  const assignmentGroups = getAssignmentGroups(visibleTasks, users, currentUser.id, appSettings);
  const deadlineAt = combineDeadline(deadlineDate, deadlineTime);
  const deadlineValidation = deadlineAt ? isDeadlineInsideBusinessHours(appSettings, deadlineAt, new Date(), isOvertime) : { ok: false, message: 'Select a deadline.' };

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

  const addLink = () => {
    const nextLink = linkInput.trim();
    if (!nextLink) return;
    setLinks(prev => prev.includes(nextLink) ? prev : [...prev, nextLink]);
    setLinkInput('');
  };

  const submitAssignment = (event: React.FormEvent) => {
    event.preventDefault();
    const validation = isDeadlineInsideBusinessHours(appSettings, deadlineAt, new Date(), isOvertime);
    if (!validation.ok) {
      setDeadlineError(validation.message);
      return;
    }

    const input = {
      name,
      description,
      priority,
      deadlineAt,
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

  const formIsValid = name.trim() && description.trim() && deadlineAt && deadlineValidation.ok && assigneeIds.length > 0;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-lg font-black text-slate-900">Assigned Work</h3>
      </div>

      {canCreate && (
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
                        if (event.key === 'Enter' && linkInput.trim()) {
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
                    disabled={!linkInput.trim()}
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
                      options={(appSettings.taskTypes || []).map(t => ({ value: t, label: t.toUpperCase().replace('_', ' ') }))}
                      buttonClassName={SELECT_BUTTON_CLASS}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newType = prompt('Enter new task type name:');
                      if (!newType || !newType.trim()) return;
                      const normalized = normalizeSettingId(newType);
                      updateAppSettings(settings => {
                        const current = settings.taskTypes || [];
                        if (current.includes(normalized)) {
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
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">Deadline *</label>
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
                    Working hours: {appSettings.businessCalendar.startTime} - {appSettings.businessCalendar.endTime}
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
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
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
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
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

      <div className="space-y-4">
        {assignmentGroups.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-10 text-center text-sm font-bold text-slate-400">
            No assigned work yet.
          </div>
        ) : assignmentGroups.map(group => (
          <div key={group.userId} className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h4 className="text-sm font-black text-slate-900">{group.name}</h4>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                {group.tasks.length} {group.tasks.length === 1 ? 'Task' : 'Tasks'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {group.tasks.map(task => {
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

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenAssignmentUpload(task.id);
                      }}
                      disabled={isUploaded || !canUpload}
                      className={cn(
                        'inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-colors',
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
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
