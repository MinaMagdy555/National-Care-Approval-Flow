import React, { useState, useEffect } from 'react';
import { Plus, Settings, ShieldCheck, X, Clock } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { PriorityTone, TaskTypeConfig } from '../lib/types';
import { normalizeSettingId, priorityToneClasses, normalizeTaskTypeId, cleanTaskTypeKey, getTaskTypeConfigs } from '../lib/appSettings';
import { CustomSelect } from './CustomSelect';
import { UserMultiSelect } from './UserMultiSelect';
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
  const { appSettings, canManageSettings, updateAppSettings, userList, users } = useAppStore();
  const [priorityLabel, setPriorityLabel] = useState('');
  const [showCustomWorkingHoursModal, setShowCustomWorkingHoursModal] = useState(false);
  const [customHoursTargetType, setCustomHoursTargetType] = useState<'employee' | 'position' | 'role'>('employee');
  const [customHoursTargetValue, setCustomHoursTargetValue] = useState<string>('');
  const [customHoursStartTime, setCustomHoursStartTime] = useState<string>('09:00');
  const [customHoursEndTime, setCustomHoursEndTime] = useState<string>('17:30');
  const [customHoursWorkdays, setCustomHoursWorkdays] = useState<number[]>([0, 1, 2, 3, 4]);

  // Sync target value on target type change
  useEffect(() => {
    if (customHoursTargetType === 'employee') {
      setCustomHoursTargetValue(userList[0]?.id || '');
    } else if (customHoursTargetType === 'position') {
      const uniquePositions = Array.from(new Set(userList.map(u => u.jobTitle).filter(Boolean))) as string[];
      setCustomHoursTargetValue(uniquePositions[0] || '');
    } else {
      setCustomHoursTargetValue('team_member');
    }
  }, [customHoursTargetType, userList]);
  const [priorityTone, setPriorityTone] = useState<PriorityTone>('blue');
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

  const taskTypeConfigs = getTaskTypeConfigs(appSettings);
  const workflowOptions = (appSettings.workflows || []).map(workflow => ({ value: workflow.id, label: workflow.name }));
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
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
          
          <button
            type="button"
            onClick={() => setShowCustomWorkingHoursModal(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Clock className="h-4 w-4" /> Customize Working Hours
          </button>
        </div>
      </section>

      {showCustomWorkingHoursModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-xl flex flex-col max-h-[85vh] overflow-hidden border border-slate-100">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <Clock className="h-5 w-5 text-indigo-600" /> Customized Working Hours
                </h3>
                <p className="text-xs font-semibold text-slate-400 mt-0.5">Configure schedules for specific positions, roles, or employees.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCustomWorkingHoursModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Tabs Header */}
            <div className="flex border-b border-slate-200 bg-slate-50/50 p-1">
              {(['position', 'role', 'employee'] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setCustomHoursTargetType(tab)}
                  className={cn(
                    "flex-1 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all border border-transparent",
                    customHoursTargetType === tab
                      ? "bg-white text-indigo-600 shadow-sm border-slate-200/50 font-black"
                      : "text-slate-500 hover:text-slate-800 font-bold"
                  )}
                >
                  {tab === 'position' ? 'Position' : tab === 'role' ? 'Role' : 'Employee'}
                </button>
              ))}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Form Card */}
              <div className="rounded-xl border border-slate-100 bg-slate-50/30 p-3.5 space-y-3.5">
                <h4 className="text-xs font-black uppercase tracking-wider text-indigo-600">
                  New {customHoursTargetType === 'position' ? 'Position' : customHoursTargetType === 'role' ? 'Role' : 'Employee'} Schedule
                </h4>
                
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400">
                    Select {customHoursTargetType === 'position' ? 'Position' : customHoursTargetType === 'role' ? 'Role' : 'Employee'}
                    {customHoursTargetType === 'employee' ? (
                      <select
                        value={customHoursTargetValue}
                        onChange={event => setCustomHoursTargetValue(event.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-sm outline-none"
                      >
                        {userList.map(u => (
                          <option key={u.id} value={u.id}>{u.name} ({u.jobTitle || u.role})</option>
                        ))}
                      </select>
                    ) : customHoursTargetType === 'position' ? (
                      <select
                        value={customHoursTargetValue}
                        onChange={event => setCustomHoursTargetValue(event.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-sm outline-none"
                      >
                        {Array.from(new Set(userList.map(u => u.jobTitle).filter(Boolean))).map(pos => (
                          <option key={pos} value={pos}>{pos}</option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={customHoursTargetValue}
                        onChange={event => setCustomHoursTargetValue(event.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-sm outline-none"
                      >
                        <option value="team_member">Team Member</option>
                        <option value="reviewer">Reviewer</option>
                        <option value="art_director">Art Director</option>
                        <option value="team_leader">Team Leader</option>
                        <option value="manager">Manager</option>
                        <option value="developer">Developer</option>
                        <option value="marketing_manager">Marketing Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-black uppercase tracking-wider text-slate-400">
                      Start Time
                      <input
                        type="time"
                        value={customHoursStartTime}
                        onChange={event => setCustomHoursStartTime(event.target.value)}
                        onClick={(e) => {
                          try { e.currentTarget.showPicker(); } catch (err) {}
                        }}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 cursor-pointer outline-none"
                      />
                    </label>
                    <label className="text-xs font-black uppercase tracking-wider text-slate-400">
                      End Time
                      <input
                        type="time"
                        value={customHoursEndTime}
                        onChange={event => setCustomHoursEndTime(event.target.value)}
                        onClick={(e) => {
                          try { e.currentTarget.showPicker(); } catch (err) {}
                        }}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 cursor-pointer outline-none"
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Workdays</label>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map(day => {
                      const active = customHoursWorkdays.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => setCustomHoursWorkdays(prev => 
                            active ? prev.filter(v => v !== day.value) : [...prev, day.value].sort()
                          )}
                          className={cn(
                            "rounded-lg border px-2.5 py-1.5 text-xs font-black transition-colors",
                            active ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                          )}
                        >
                          {day.label.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!customHoursTargetValue) return;
                      const newSetting = {
                        id: `wh_${Date.now().toString(36)}`,
                        targetType: customHoursTargetType,
                        targetValue: customHoursTargetValue,
                        startTime: customHoursStartTime,
                        endTime: customHoursEndTime,
                        workdays: customHoursWorkdays,
                      };

                      updateAppSettings(settings => {
                        const currentList = settings.customWorkingHours || [];
                        const filteredList = currentList.filter(item => 
                          !(item.targetType === customHoursTargetType && item.targetValue === customHoursTargetValue)
                        );
                        return {
                          ...settings,
                          customWorkingHours: [...filteredList, newSetting],
                        };
                      });
                    }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 transition-colors shadow-sm"
                  >
                    <Plus className="h-3.5 w-3.5" /> Save Schedule
                  </button>
                </div>
              </div>

              {/* List Configured Schedules for Active Tab */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">
                  Configured {customHoursTargetType === 'position' ? 'Positions' : customHoursTargetType === 'role' ? 'Roles' : 'Employees'}
                </h4>
                {(() => {
                  const filteredWH = (appSettings.customWorkingHours || []).filter(item => item.targetType === customHoursTargetType);
                  if (filteredWH.length === 0) {
                    return <p className="text-xs text-slate-400 italic py-2">No schedules configured for this tab yet.</p>;
                  }
                  return (
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/20 overflow-hidden shadow-sm">
                      {filteredWH.map(schedule => {
                        let displayLabel = '';
                        if (schedule.targetType === 'employee') {
                          const emp = userList.find(u => u.id === schedule.targetValue);
                          displayLabel = emp ? emp.name : schedule.targetValue;
                        } else if (schedule.targetType === 'position') {
                          displayLabel = schedule.targetValue;
                        } else {
                          displayLabel = schedule.targetValue.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
                        }

                        const daysStr = schedule.workdays.map(d => WEEKDAYS.find(wd => wd.value === d)?.label).join(', ');

                        return (
                          <div key={schedule.id} className="flex items-center justify-between p-3">
                            <div>
                              <div className="text-xs font-bold text-slate-900">{displayLabel}</div>
                              <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                                Hours: {schedule.startTime} - {schedule.endTime} | Days: {daysStr || 'None'}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => updateAppSettings(settings => ({
                                ...settings,
                                customWorkingHours: (settings.customWorkingHours || []).filter(item => item.id !== schedule.id)
                              }))}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-rose-600 transition-all"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 bg-slate-50/50 p-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowCustomWorkingHoursModal(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
                            className="h-4.5 w-4.5 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500/30 transition-all cursor-pointer"
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
                            className="h-4.5 w-4.5 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500/30 transition-all cursor-pointer"
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

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-black text-slate-900">Reviewer & Daily Report Notifications</h3>
        <p className="mt-1 text-xs font-bold text-slate-500">Pick the responsible senior reviewers for comment fan-out, and configure the daily report auto-send.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Responsible Senior Reviewers</label>
            <UserMultiSelect
              users={userList.filter(user => user.id !== 'guest')}
              selectedIds={appSettings.seniorReviewerUserIds || []}
              onChange={ids => updateAppSettings(settings => ({ ...settings, seniorReviewerUserIds: ids }))}
              emptyText="Pick seniors"
            />
            <p className="mt-1 text-[10px] font-bold text-slate-400">They are notified when reviewers comment on a task, in addition to the assignee.</p>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Daily Report Auto-Send Time</label>
            <input
              type="time"
              value={appSettings.dailyReportAutoSendTime || '17:29'}
              onChange={event => updateAppSettings(settings => ({ ...settings, dailyReportAutoSendTime: event.target.value }))}
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-900"
            />
            <label className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-slate-600">
              <input
                type="checkbox"
                checked={appSettings.dailyReportAutoSendEnabled !== false}
                onChange={event => updateAppSettings(settings => ({ ...settings, dailyReportAutoSendEnabled: event.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
              />
              Auto-send daily reports at the time above
            </label>
          </div>
        </div>
        <div className="mt-4">
          <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Daily Report Receivers</label>
          <UserMultiSelect
            users={userList.filter(user => user.id !== 'guest')}
            selectedIds={appSettings.dailyReportReceiverUserIds || []}
            onChange={ids => updateAppSettings(settings => ({ ...settings, dailyReportReceiverUserIds: ids }))}
            emptyText="Pick receivers (defaults to leaders and admins)"
          />
          <p className="mt-1 text-[10px] font-bold text-slate-400">Leave empty to use the default: team leader, art director, marketing manager, admin, and leaderboard users.</p>
        </div>
      </section>
    </div>
  );
}
