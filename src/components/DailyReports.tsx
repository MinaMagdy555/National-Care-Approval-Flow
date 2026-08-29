import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Eye, FileText, Send, XCircle } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { DailyReport, Task, User } from '../lib/types';
import { cn } from '../lib/utils';
import { getStatusInfo } from '../lib/taskUtils';
import { getCurrentOwnerUserIds } from '../lib/workflowUtils';
import { CustomSelect } from './CustomSelect';
import { ThemedDatePicker } from './ThemedDatePicker';

type ReportBucket = 'approved' | 'rejected' | 'waiting_review' | 'active' | 'not_started';
type ReportInspectorRole = 'team_leader' | 'manager' | 'marketing_manager' | 'art_director' | 'admin';

type ReportRow = {
  task: Task;
  startTime: string;
  endTime: string;
  durationMinutes: number | null;
};

const bucketStyles: Record<ReportBucket, { label: string; icon: React.ElementType; className: string }> = {
  approved: { label: 'Finished / Approved', icon: CheckCircle2, className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  rejected: { label: 'Finished / Returned', icon: XCircle, className: 'border-rose-200 bg-rose-50 text-rose-800' },
  waiting_review: { label: 'Finished / Waiting Review', icon: FileText, className: 'border-blue-200 bg-blue-50 text-blue-800' },
  active: { label: 'Active Work', icon: Clock, className: 'border-amber-200 bg-amber-50 text-amber-800' },
  not_started: { label: 'Not Started', icon: Clock, className: 'border-slate-200 bg-slate-50 text-slate-700' },
};

const bucketCountLabels: Record<ReportBucket, string> = {
  approved: 'Approved',
  rejected: 'Returned',
  waiting_review: 'Waiting Review',
  active: 'Active Work',
  not_started: 'Not Started',
};

const reportInspectorRoles = new Set<ReportInspectorRole>([
  'team_leader',
  'manager',
  'marketing_manager',
  'art_director',
  'admin',
]);

function todayValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function durationMinutesBetweenIso(start?: string | null, end?: string | null) {
  if (!start) return null;
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
}

function classifyTask(task: Task): ReportBucket {
  if (['approved', 'completed', 'approved_by_art_director'].includes(task.status)) return 'approved';
  if (['changes_requested_by_reviewer', 'changes_requested_by_art_director', 'changes_requested_by_content', 'rejected'].includes(task.status)) return 'rejected';
  if (task.activeWorkStartedAt && !task.activeWorkFinishedAt) return 'active';
  if (['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look', 'reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval', 'waiting_content_revision'].includes(task.status)) return 'waiting_review';
  return 'not_started';
}

function timeToMinutes(value?: string | null) {
  if (!value) return null;
  const [h, m] = value.split(':').map(part => Number(part));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function formatDurationFromMinutes(minutes: number | null) {
  if (minutes === null || minutes === undefined) return '-';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function deriveTeamName(user?: User | null) {
  const text = `${user?.jobTitle || ''} ${user?.role || ''} ${user?.name || ''}`.toLowerCase();
  if (text.includes('admin')) return 'Admin';
  if (text.includes('content') || text.includes('writer') || text.includes('caption') || text.includes('script')) return 'Content Team';
  if (text.includes('graphic') || text.includes('design') || text.includes('designer') || /\bart\b/.test(text)) return 'Design Team';
  if (text.includes('video') || text.includes('editor') || text.includes('montage') || text.includes('senior brand')) return 'Video Team';
  if (text.includes('leader') || text.includes('manager') || text.includes('marketing') || text.includes('reviewer') || text.includes('art_director')) return 'Leadership';
  return 'Other Team';
}

export function DailyReports({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const {
    currentUser,
    users,
    userList,
    tasks,
    environment,
    dailyReports,
    upsertDailyReport,
    upsertDailyReportEntry,
    sendDailyReport,
  } = useAppStore();

  const isLeadershipReporter = Boolean(currentUser.isAdmin) || reportInspectorRoles.has(currentUser.role as ReportInspectorRole);
  const isSeniorReporter = /\bsenior\b/i.test(currentUser.jobTitle || '');
  // Personal reports remain personal. The cross-team showcase is reserved for
  // leadership roles, rather than every senior contributor. A senior title
  // always keeps this screen private, even when that account has other admin access.
  const canInspectTeamReports = isLeadershipReporter && !isSeniorReporter;
  const [selectedDate, setSelectedDate] = useState(todayValue());
  const [showcaseDate, setShowcaseDate] = useState(todayValue());
  const [showcaseMemberId, setShowcaseMemberId] = useState('all');
  const [showcaseTeam, setShowcaseTeam] = useState('all');
  const [showcaseStatus, setShowcaseStatus] = useState<ReportBucket | 'all'>('all');
  const [showcaseSearch, setShowcaseSearch] = useState('');
  const [note, setNote] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const selectedUser = currentUser;
  const reportId = `${selectedDate}:${currentUser.id}`;
  const report = dailyReports.find(item => item.id === reportId) || null;

  useEffect(() => {
    setNote(report?.note || '');
    setSavedAt(report?.updatedAt || null);
    setRowError(null);
  }, [reportId, report?.id, report?.updatedAt]);

  const taskBelongsToUserOnDate = (task: Task, userId: string, date: string) => {
    if (task.environment !== environment) return false;
    const involvedIds = new Set([
      task.createdBy,
      ...task.handledBy,
      ...(task.contentRevisionAssigneeIds || []),
      ...(task.submittedOnBehalfOfIds || []),
      ...getCurrentOwnerUserIds(task),
    ]);
    if (!involvedIds.has(userId)) return false;
    const taskDate = task.assignmentDate || task.createdAt.slice(0, 10);
    const activeStartDate = task.activeWorkStartedAt?.slice(0, 10);
    const activeFinishDate = task.activeWorkFinishedAt?.slice(0, 10);
    return taskDate === date || activeStartDate === date || activeFinishDate === date;
  };

  const getReportTasksForUser = (userId: string, date: string) => tasks.filter(task => taskBelongsToUserOnDate(task, userId, date));

  const reportTasks = useMemo(() => (
    getReportTasksForUser(currentUser.id, selectedDate)
  ), [tasks, environment, currentUser.id, selectedDate]);

  const sortedReportTasks = useMemo(() => {
    const bucketOrder: Record<ReportBucket, number> = {
      active: 0,
      waiting_review: 1,
      not_started: 2,
      approved: 3,
      rejected: 4,
    };
    return [...reportTasks].sort((a, b) => bucketOrder[classifyTask(a)] - bucketOrder[classifyTask(b)] || a.name.localeCompare(b.name));
  }, [reportTasks]);

  const buckets = useMemo(() => {
    return reportTasks.reduce<Record<ReportBucket, Task[]>>((acc, task) => {
      acc[classifyTask(task)].push(task);
      return acc;
    }, { approved: [], rejected: [], waiting_review: [], active: [], not_started: [] });
  }, [reportTasks]);

  const effectiveEntryFor = (task: Task, sourceReport = report): ReportRow => {
    const manual = sourceReport?.entries.find(entry => entry.taskId === task.id);
    const startTime = manual?.startTime || task.activeWorkStartedAt?.slice(11, 16) || '';
    const endTime = manual?.endTime || task.activeWorkFinishedAt?.slice(11, 16) || '';
    const manualMinutes = manual?.durationMinutes;
    const derivedMinutes = (() => {
      if (manual?.startTime && manual?.endTime) {
        const s = timeToMinutes(manual.startTime);
        const e = timeToMinutes(manual.endTime);
        if (s !== null && e !== null && e > s) return e - s;
      }
      if (manual?.startTime) return null;
      if (task.activeWorkStartedAt) return durationMinutesBetweenIso(task.activeWorkStartedAt, task.activeWorkFinishedAt);
      return null;
    })();
    return { task, startTime, endTime, durationMinutes: manualMinutes ?? derivedMinutes };
  };

  const rowsForReport = (sourceReport: DailyReport) => {
    const rowsFromSavedEntries = sourceReport.entries
      .map(entry => {
        const task = tasks.find(item => item.id === entry.taskId);
        return task ? effectiveEntryFor(task, sourceReport) : null;
      })
      .filter(Boolean) as ReportRow[];

    if (rowsFromSavedEntries.length > 0) return rowsFromSavedEntries;
    return getReportTasksForUser(sourceReport.userId, sourceReport.date).map(task => effectiveEntryFor(task, sourceReport));
  };

  const saveReport = (send = false) => {
    const now = new Date().toISOString();
    const entries = sortedReportTasks.map(task => {
      const row = effectiveEntryFor(task);
      return {
        taskId: task.id,
        startTime: row.startTime || null,
        endTime: row.endTime || null,
        durationMinutes: row.durationMinutes,
      };
    });
    const updated = upsertDailyReport({ date: selectedDate, userId: currentUser.id, note, entries });
    setSavedAt(now);
    if (updated && send && !updated.sentAt) {
      sendDailyReport(updated.id);
    }
  };

  const handleStartChange = (taskId: string, value: string) => {
    setRowError(null);
    upsertDailyReportEntry(reportId, taskId, { startTime: value || null });
  };

  const handleEndChange = (taskId: string, value: string) => {
    setRowError(null);
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const effective = effectiveEntryFor(task);
    const startMinutes = timeToMinutes(effective.startTime);
    const endMinutes = timeToMinutes(value);
    if (startMinutes !== null && endMinutes !== null && endMinutes < startMinutes) {
      setRowError('End time must be after start time.');
      return;
    }
    upsertDailyReportEntry(reportId, taskId, { endTime: value || null });
  };

  const reportUsers = useMemo(() => userList.filter(user => user.id !== 'guest'), [userList]);
  const canInspectReportOwner = (owner: User) => {
    if (owner.id === currentUser.id) return true;
    if (canInspectTeamReports) return true;
    return false;
  };
  const inspectableReportUsers = useMemo(
    () => reportUsers.filter(canInspectReportOwner),
    [reportUsers, currentUser.id, currentUser.jobTitle, currentUser.role, currentUser.isAdmin],
  );
  const teamOptions = useMemo(() => {
    return Array.from(new Set(inspectableReportUsers.map(user => deriveTeamName(user)))).sort();
  }, [inspectableReportUsers]);

  const showcaseGroups = useMemo(() => {
    const search = showcaseSearch.trim().toLowerCase();
    const sentReports = dailyReports
      .filter(item => item.date === showcaseDate && item.sentAt)
      .filter(item => item.userId !== 'guest')
      .filter(item => showcaseMemberId === 'all' || item.userId === showcaseMemberId);

    const grouped = new Map<string, Array<{ report: DailyReport; user: User; rows: ReportRow[] }>>();

    sentReports.forEach(item => {
      const user = users[item.userId];
      if (!user) return;
      if (!canInspectReportOwner(user)) return;
      const team = deriveTeamName(user);
      if (showcaseTeam !== 'all' && team !== showcaseTeam) return;

      const filteredRows = rowsForReport(item).filter(row => {
        if (showcaseStatus !== 'all' && classifyTask(row.task) !== showcaseStatus) return false;
        if (search && !`${row.task.name} ${row.task.code}`.toLowerCase().includes(search)) return false;
        return true;
      });

      if (filteredRows.length === 0 && (showcaseStatus !== 'all' || search)) return;
      const next = grouped.get(team) || [];
      next.push({ report: item, user, rows: filteredRows });
      grouped.set(team, next);
    });

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([team, reports]) => ({
        team,
        reports: reports.sort((a, b) => a.user.name.localeCompare(b.user.name)),
      }));
  }, [dailyReports, showcaseDate, showcaseMemberId, showcaseTeam, showcaseStatus, showcaseSearch, users, tasks, environment, currentUser.id, currentUser.jobTitle, currentUser.role, currentUser.isAdmin]);

  const renderTaskRows = (rows: ReportRow[], viewer: User, readOnly = false) => (
    <div className="overflow-x-auto">
      <table className="min-w-[900px] w-full border-collapse text-left">
        <thead>
          <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <th className="p-3">Task</th>
            <th className="p-3 w-32">Start</th>
            <th className="p-3 w-32">End</th>
            <th className="p-3 w-32">Duration</th>
            <th className="p-3 w-52">Status</th>
            <th className="p-3 w-28 text-right">View</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="p-8 text-center text-sm font-bold text-slate-500">No tasks found for this day.</td>
            </tr>
          )}
          {rows.map(row => {
            const bucket = classifyTask(row.task);
            const meta = bucketStyles[bucket];
            const Icon = meta.icon;
            const statusInfo = getStatusInfo(row.task, viewer.role, users);
            return (
              <tr key={row.task.id} className="cursor-pointer transition-colors hover:bg-slate-50/60" onClick={() => onOpenTask(row.task.id)}>
                <td className="p-3 align-top">
                  <p className="text-sm font-black text-slate-900">{row.task.name}</p>
                  <p className="mt-0.5 text-[11px] font-bold text-slate-500">{row.task.code}</p>
                </td>
                <td className="p-3 align-top">
                  {readOnly ? (
                    <span className="text-xs font-bold text-slate-700">{row.startTime || '-'}</span>
                  ) : (
                    <input
                      type="time"
                      value={row.startTime}
                      onClick={event => event.stopPropagation()}
                      onChange={event => handleStartChange(row.task.id, event.target.value)}
                      className="h-8 w-full rounded-lg border border-slate-300 px-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                    />
                  )}
                </td>
                <td className="p-3 align-top">
                  {readOnly ? (
                    <span className="text-xs font-bold text-slate-700">{row.endTime || '-'}</span>
                  ) : (
                    <input
                      type="time"
                      value={row.endTime}
                      onClick={event => event.stopPropagation()}
                      onChange={event => handleEndChange(row.task.id, event.target.value)}
                      className="h-8 w-full rounded-lg border border-slate-300 px-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                    />
                  )}
                </td>
                <td className="p-3 align-top text-xs font-bold text-slate-700">
                  {formatDurationFromMinutes(row.durationMinutes)}
                </td>
                <td className="p-3 align-top">
                  <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide', meta.className)}>
                    <Icon className="h-3 w-3 shrink-0" /> <span className="whitespace-normal leading-tight">{meta.label}</span>
                  </span>
                  <p className="mt-1 text-[10px] font-bold text-slate-500">{statusInfo.label}</p>
                </td>
                <td className="p-3 align-top text-right">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenTask(row.task.id);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50"
                  >
                    <Eye className="h-3 w-3" /> View
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-slate-950">Daily Reports</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">Auto-filled from assigned work, review tasks, and active-work tracking.</p>
        </div>
        <div className="w-44">
          <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">Report date</label>
          <ThemedDatePicker value={selectedDate} onChange={setSelectedDate} />
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-950">{selectedUser.name}</h3>
            <p className="text-xs font-bold text-slate-500">{reportTasks.length} tasks found for this report day</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => saveReport(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-50">Save Edits</button>
            <button type="button" onClick={() => saveReport(true)} disabled={Boolean(report?.sentAt)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-50">
              <Send className="h-4 w-4" /> {report?.sentAt ? 'Sent' : 'Send Report'}
            </button>
          </div>
        </div>
        {savedAt && <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-emerald-700">Saved {new Date(savedAt).toLocaleString()}</p>}
        {report?.sentAt && (
          <p className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-blue-700">
            Report sent {new Date(report.sentAt).toLocaleString()}{report.autoSent ? ' (auto-sent)' : ''}. Edits will notify receivers.
          </p>
        )}
        {rowError && (
          <p className="mb-4 inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-rose-700">
            <AlertCircle className="h-3.5 w-3.5" /> {rowError}
          </p>
        )}
        {report && report.editHistory.length > 0 && (
          <details className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <summary className="cursor-pointer text-[11px] font-black uppercase tracking-wide">Edited since sent ({report.editHistory.length})</summary>
            <ul className="mt-2 space-y-1">
              {report.editHistory.map(version => (
                <li key={version.id}>
                  {new Date(version.editedAt).toLocaleString()} by {users[version.editedBy]?.name || version.editedBy}:
                  <ul className="ml-4 mt-1 list-disc">
                    {version.changedEntries.map((change, idx) => (
                      <li key={idx}>
                        {change.taskId} - {change.field}: {change.oldValue || 'unset'} {'->'} {change.newValue || 'unset'}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </details>
        )}
        {report?.sentAt && (
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Correction note after sending</label>
            <textarea value={note} onChange={event => setNote(event.target.value)} rows={4} placeholder="Explain what changed after the report was sent..." className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500" />
          </div>
        )}
      </section>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-black text-slate-900">Tasks for {selectedUser.name} on {selectedDate}</h3>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(bucketStyles) as ReportBucket[]).map(bucket => {
              const meta = bucketStyles[bucket];
              const Icon = meta.icon;
              return (
                <span key={bucket} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide', meta.className)}>
                  <Icon className="h-3 w-3" /> {bucketCountLabels[bucket]} {buckets[bucket].length}
                </span>
              );
            })}
          </div>
        </div>
        {renderTaskRows(sortedReportTasks.map(task => effectiveEntryFor(task)), currentUser)}
      </div>

      {canInspectTeamReports && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-slate-950">Leaderboard Report Showcase</h3>
              <p className="mt-1 text-xs font-bold text-slate-500">Inspect submitted reports without changing who owns or writes your personal daily report.</p>
            </div>
            <div className="grid w-full gap-3 md:grid-cols-5">
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">Date</label>
                <ThemedDatePicker value={showcaseDate} onChange={setShowcaseDate} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">Inspect member</label>
                <CustomSelect
                  value={showcaseMemberId}
                  onChange={setShowcaseMemberId}
                  options={[{ value: 'all', label: 'All Members' }, ...inspectableReportUsers.map(user => ({ value: user.id, label: user.name }))]}
                  buttonClassName="h-11 rounded-xl px-3 py-2 text-sm font-black"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">Team</label>
                <CustomSelect
                  value={showcaseTeam}
                  onChange={setShowcaseTeam}
                  options={[{ value: 'all', label: 'All Teams' }, ...teamOptions.map(team => ({ value: team, label: team }))]}
                  buttonClassName="h-11 rounded-xl px-3 py-2 text-sm font-black"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">Status</label>
                <CustomSelect
                  value={showcaseStatus}
                  onChange={value => setShowcaseStatus(value as ReportBucket | 'all')}
                  options={[{ value: 'all', label: 'All Statuses' }, ...(Object.keys(bucketStyles) as ReportBucket[]).map(bucket => ({ value: bucket, label: bucketStyles[bucket].label }))]}
                  buttonClassName="h-11 rounded-xl px-3 py-2 text-sm font-black"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">Task search</label>
                <input
                  value={showcaseSearch}
                  onChange={event => setShowcaseSearch(event.target.value)}
                  placeholder="Search task names..."
                  className="h-11 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {showcaseGroups.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-bold text-slate-500">
                No sent reports match these filters.
              </div>
            )}
            {showcaseGroups.map(group => (
              <div key={group.team} className="overflow-hidden rounded-xl border border-slate-200">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{showcaseDate}</p>
                  <h4 className="text-base font-black text-slate-950">{group.team}</h4>
                </div>
                <div className="divide-y divide-slate-200">
                  {group.reports.map(({ report: item, user, rows }) => (
                    <div key={item.id} className="p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h5 className="text-sm font-black text-slate-950">{user.name}</h5>
                          <p className="text-[11px] font-bold text-slate-500">
                            Sent {item.sentAt ? new Date(item.sentAt).toLocaleString() : '-'}{item.autoSent ? ' (auto-sent)' : ''}
                          </p>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
                          {rows.length} rows
                        </span>
                      </div>
                      {renderTaskRows(rows, user, true)}
                      {item.note && (
                        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Correction note</p>
                          <p className="mt-1 text-sm font-semibold text-slate-700">{item.note}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
