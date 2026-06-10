import React, { useState } from 'react';
import { Plus, Settings, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { PriorityTone, Role, TaskTypeConfig } from '../lib/types';
import { normalizeSettingId, priorityToneClasses, normalizeTaskTypeId, cleanTaskTypeKey, getTaskTypeConfigs } from '../lib/appSettings';
import { CustomSelect } from './CustomSelect';
import { cn } from '../lib/utils';
import { Trash2 } from 'lucide-react';

const TONES: Array<{ value: PriorityTone; label: string; tone: PriorityTone }> = [
  { value: 'emerald', label: 'Green', tone: 'emerald' },
  { value: 'slate', label: 'Slate', tone: 'slate' },
  { value: 'amber', label: 'Amber', tone: 'amber' },
  { value: 'rose', label: 'Red', tone: 'rose' },
  { value: 'blue', label: 'Blue', tone: 'blue' },
  { value: 'indigo', label: 'Indigo', tone: 'indigo' },
  { value: 'purple', label: 'Purple', tone: 'purple' },
];

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'team_member', label: 'Team Member' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'art_director', label: 'Art Director' },
  { value: 'team_leader', label: 'Team Leader' },
  { value: 'manager', label: 'Manager' },
  { value: 'developer', label: 'Developer' },
  { value: 'marketing_manager', label: 'Marketing Manager' },
  { value: 'admin', label: 'Admin' },
];

const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

export function SettingsManagement() {
  const { appSettings, canManageSettings, updateAppSettings, userList } = useAppStore();
  const [priorityLabel, setPriorityLabel] = useState('');
  const [priorityTone, setPriorityTone] = useState<PriorityTone>('blue');

  
  const [taskTypeName, setTaskTypeName] = useState('');
  const [taskTypeJobTitles, setTaskTypeJobTitles] = useState<string[]>([]);
  const [taskTypeDetailed, setTaskTypeDetailed] = useState(false);
  const [editingTaskTypeId, setEditingTaskTypeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [editingJobTitles, setEditingJobTitles] = useState<string[]>([]);
  const [editingDetailed, setEditingDetailed] = useState(false);

  const taskTypeConfigs = getTaskTypeConfigs(appSettings);

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
            };
          }
          return t;
        })
      };
    });
    setEditingTaskTypeId(null);
  };

  if (!canManageSettings) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-500">
          Settings are available only to configured settings managers.
        </div>
      </div>
    );
  }

  const seedUsers = userList.filter(user => user.id !== 'guest');

  const defaultColumns: Array<{
    key: 'settingsManagerUserIds' | 'workAssignmentCreatorIds' | 'contributorAssignerIds' | 'neverHandlerIds' | 'selfAssignmentBlockedIds' | 'videoOnlyHandlerIds';
    label: string;
    tooltip: string;
  }> = [
    { key: 'settingsManagerUserIds', label: 'Settings Manager', tooltip: 'Can access and change app settings.' },
    { key: 'workAssignmentCreatorIds', label: 'Work Creator', tooltip: 'Can create and edit assigned work/tasks.' },
    { key: 'contributorAssignerIds', label: 'Contributor Assigner', tooltip: 'Can assign handlers to tasks.' },
    { key: 'neverHandlerIds', label: 'Never Assignable', tooltip: 'Excluded from being assigned to any task.' },
    { key: 'selfAssignmentBlockedIds', label: 'Self Blocked', tooltip: 'Cannot assign tasks to themselves.' },
    { key: 'videoOnlyHandlerIds', label: 'Video Only', tooltip: 'Can only be assigned to video tasks.' },
  ];

  const columns = defaultColumns.filter(col => !(appSettings.hiddenColumns || []).includes(col.key));

  const addPriority = () => {
    const label = priorityLabel.trim();
    if (!label) return;
    updateAppSettings(settings => {
      const id = normalizeSettingId(label);
      if (settings.priorities.some(priority => priority.id === id || priority.label.toLowerCase() === label.toLowerCase())) return settings;
      return {
        ...settings,
        priorities: [
          ...settings.priorities,
          {
            id,
            label,
            tone: priorityTone,
            sortOrder: settings.priorities.length,
            active: true,
          },
        ],
      };
    });
    setPriorityLabel('');
  };



  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 pb-6 pt-0 sm:px-6 sm:py-6 lg:px-8">
      <div>
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <Settings className="h-5 w-5" />
        </div>
        <h1 className="text-2xl font-black text-slate-950">Tool Settings</h1>
        <p className="mt-1 text-sm font-semibold text-slate-500">Configure the flow without changing code.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-500">Business Calendar</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-black uppercase tracking-wider text-slate-400">
            Timezone
            <input
              value={appSettings.businessCalendar.timezone}
              onChange={event => updateAppSettings(settings => ({ ...settings, businessCalendar: { ...settings.businessCalendar, timezone: event.target.value } }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900"
            />
          </label>
          <label className="text-xs font-black uppercase tracking-wider text-slate-400">
            Start
            <input
              type="time"
              value={appSettings.businessCalendar.startTime}
              onChange={event => updateAppSettings(settings => ({ ...settings, businessCalendar: { ...settings.businessCalendar, startTime: event.target.value } }))}
              onClick={(e) => {
                try { e.currentTarget.showPicker(); } catch (err) {}
              }}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 cursor-pointer"
            />
          </label>
          <label className="text-xs font-black uppercase tracking-wider text-slate-400">
            End
            <input
              type="time"
              value={appSettings.businessCalendar.endTime}
              onChange={event => updateAppSettings(settings => ({ ...settings, businessCalendar: { ...settings.businessCalendar, endTime: event.target.value } }))}
              onClick={(e) => {
                try { e.currentTarget.showPicker(); } catch (err) {}
              }}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 cursor-pointer"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {WEEKDAYS.map(day => {
            const active = appSettings.businessCalendar.workdays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => updateAppSettings(settings => ({
                  ...settings,
                  businessCalendar: {
                    ...settings.businessCalendar,
                    workdays: active
                      ? settings.businessCalendar.workdays.filter(value => value !== day.value)
                      : [...settings.businessCalendar.workdays, day.value].sort(),
                  },
                }))}
                className={cn("rounded-lg border px-3 py-2 text-xs font-black", active ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-500")}
              >
                {day.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-500">Priorities</h2>
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr,180px,auto]">
          <input
            value={priorityLabel}
            onChange={event => setPriorityLabel(event.target.value)}
            placeholder="Add priority, e.g. Critical"
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900"
          />
          <CustomSelect value={priorityTone} onChange={value => setPriorityTone(value as PriorityTone)} options={TONES} buttonClassName="rounded-xl px-3 py-2" />
          <button type="button" onClick={addPriority} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white">
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {appSettings.priorities.map(priority => (
            <button
              key={priority.id}
              type="button"
              onClick={() => updateAppSettings(settings => ({
                ...settings,
                priorities: settings.priorities.map(item => item.id === priority.id ? { ...item, active: !item.active } : item),
              }))}
              className={cn("rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide", priorityToneClasses(priority.tone), !priority.active && "opacity-40")}
            >
              {priority.label}
            </button>
          ))}
        </div>
      </section>



      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-black uppercase tracking-wider text-slate-500">Task Types & Workflows</h2>
        <p className="text-xs text-slate-400 mb-3">Add and configure custom task types, assign recommended job titles, and toggle the detailed revision flow.</p>

        {/* Add Form */}
        <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3 space-y-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Create Task Type</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
            <input
              value={taskTypeName}
              onChange={event => setTaskTypeName(event.target.value)}
              placeholder="Task Type Name (e.g. Video, Content Revision)"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-sm"
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

          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-100 bg-white px-2 py-1 text-xs font-bold text-slate-600 shadow-sm">
              <input
                type="checkbox"
                checked={taskTypeDetailed}
                onChange={event => setTaskTypeDetailed(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Detailed Review Workflow (Request Edits Form)
            </label>
          </div>
        </div>

        {/* List & Edit Forms */}
        <div className="space-y-2">
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

                    <div className="flex items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-600">
                        <input
                          type="checkbox"
                          checked={editingDetailed}
                          onChange={event => setEditingDetailed(event.target.checked)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
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
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Suggested:</span>
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
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleStartEditingTaskType(config)}
                        className="rounded-lg border border-slate-200 bg-white p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                        title="Edit task type"
                      >
                        <Settings className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTaskType(config.id)}
                        className="rounded-lg border border-rose-200 bg-white p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                        title="Delete task type"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">Flow Access Permissions Matrix</h2>
            <p className="text-xs text-slate-400 mt-0.5">Toggle fine-grained access rules and system privileges for each team member.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              const hiddenBuiltIns = defaultColumns.filter(c => appSettings.hiddenColumns?.includes(c.key));
              if (hiddenBuiltIns.length > 0) {
                const optionsStr = hiddenBuiltIns.map((c, i) => `${i + 1}. ${c.label}`).join('\n');
                const choice = prompt(
                  `Enter the name of the new criteria,\nor choose a deleted category to restore (enter 1-${hiddenBuiltIns.length}):\n\n${optionsStr}`
                );
                if (!choice || !choice.trim()) return;

                const num = parseInt(choice.trim(), 10);
                if (!isNaN(num) && num >= 1 && num <= hiddenBuiltIns.length) {
                  const restoredCol = hiddenBuiltIns[num - 1];
                  updateAppSettings(settings => ({
                    ...settings,
                    hiddenColumns: (settings.hiddenColumns || []).filter(key => key !== restoredCol.key)
                  }));
                  return;
                }

                const label = choice.trim();
                const normalized = normalizeSettingId(label);
                const current = appSettings.customPermissions || [];
                if (current.some(c => c.id === normalized || c.label.toLowerCase() === label.toLowerCase())) {
                  alert('A criteria with this name already exists.');
                  return;
                }

                const matchedHidden = hiddenBuiltIns.find(c => c.label.toLowerCase() === label.toLowerCase());
                if (matchedHidden) {
                  updateAppSettings(settings => ({
                    ...settings,
                    hiddenColumns: (settings.hiddenColumns || []).filter(key => key !== matchedHidden.key)
                  }));
                  return;
                }

                updateAppSettings(settings => ({
                  ...settings,
                  customPermissions: [
                    ...current,
                    { id: normalized, label: label, userIds: [] }
                  ]
                }));
              } else {
                const label = prompt('Enter the name of the new permission criteria:');
                if (!label || !label.trim()) return;
                const normalized = normalizeSettingId(label);
                const current = appSettings.customPermissions || [];
                if (current.some(c => c.id === normalized || c.label.toLowerCase() === label.trim().toLowerCase())) {
                  alert('A criteria with this name already exists.');
                  return;
                }
                updateAppSettings(settings => ({
                  ...settings,
                  customPermissions: [
                    ...current,
                    { id: normalized, label: label.trim(), userIds: [] }
                  ]
                }));
              }
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-white hover:bg-indigo-700 transition-colors"
          >
            + Add Criteria
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-100 shadow-sm">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="sticky left-0 z-20 bg-slate-50 px-4 py-3 border-r border-slate-200 min-w-[180px]">Person / User</th>
                {columns.map(col => (
                  <th key={col.key} title={col.tooltip} className="group relative px-3 py-3 text-center border-r border-slate-200 last:border-r-0 hover:bg-slate-100 transition-colors">
                    <div className="flex items-center justify-center gap-1.5">
                      <span>{col.label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Are you sure you want to delete the criteria "${col.label}"?`)) {
                            updateAppSettings(settings => ({
                              ...settings,
                              hiddenColumns: Array.from(new Set([...(settings.hiddenColumns || []), col.key]))
                            }));
                          }
                        }}
                        className="invisible group-hover:visible inline-flex h-4 w-4 items-center justify-center rounded text-rose-500 hover:bg-rose-50 font-black text-sm transition-colors animate-fade-in"
                        title="Delete criteria"
                      >
                        &times;
                      </button>
                    </div>
                  </th>
                ))}
                {(appSettings.customPermissions || []).map(col => (
                  <th key={col.id} className="group relative px-3 py-3 text-center border-r border-slate-200 last:border-r-0 hover:bg-slate-100 transition-colors">
                    <div className="flex items-center justify-center gap-1.5">
                      <span>{col.label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Are you sure you want to delete the criteria "${col.label}"?`)) {
                            updateAppSettings(settings => ({
                              ...settings,
                              customPermissions: (settings.customPermissions || []).filter(c => c.id !== col.id)
                            }));
                          }
                        }}
                        className="invisible group-hover:visible inline-flex h-4 w-4 items-center justify-center rounded text-rose-500 hover:bg-rose-50 font-black text-sm transition-colors"
                        title="Delete criteria"
                      >
                        &times;
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {seedUsers.map((user, rowIndex) => (
                <tr key={user.id} className={cn("hover:bg-slate-50/80 transition-colors", rowIndex % 2 === 1 && "bg-slate-50/20")}>
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 border-r border-slate-200 font-bold text-slate-900 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                    <div className="flex flex-col">
                      <span>{user.name}</span>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mt-0.5">{user.role.replaceAll('_', ' ')}</span>
                    </div>
                  </td>
                  {columns.map(col => {
                    const values = appSettings[col.key];
                    const active = values.includes(user.id);
                    return (
                      <td key={col.key} className={cn("px-3 py-3 text-center border-r border-slate-200 last:border-r-0 transition-colors", active && "bg-indigo-50/20")}>
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => updateAppSettings(settings => ({
                              ...settings,
                              [col.key]: toggleValue(settings[col.key], user.id),
                            }))}
                            className="h-4.5 w-4.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30 transition-all cursor-pointer"
                          />
                        </div>
                      </td>
                    );
                  })}
                  {(appSettings.customPermissions || []).map(col => {
                    const active = col.userIds.includes(user.id);
                    return (
                      <td key={col.id} className={cn("px-3 py-3 text-center border-r border-slate-200 last:border-r-0 transition-colors", active && "bg-indigo-50/20")}>
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => updateAppSettings(settings => {
                              const current = settings.customPermissions || [];
                              return {
                                ...settings,
                                customPermissions: current.map(item => {
                                  if (item.id !== col.id) return item;
                                  return {
                                    ...item,
                                    userIds: item.userIds.includes(user.id)
                                      ? item.userIds.filter(id => id !== user.id)
                                      : [...item.userIds, user.id],
                                  };
                                }),
                              };
                            })}
                            className="h-4.5 w-4.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30 transition-all cursor-pointer"
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
