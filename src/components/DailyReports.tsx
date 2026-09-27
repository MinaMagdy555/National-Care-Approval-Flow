import { WorkflowRoadmap } from './WorkflowRoadmap';
import { buildActualWorkEntries, cairoDate, mergeWorkReportEntries } from '../lib/dailyReportWork';
import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Eye, FileText, Send, XCircle } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { DailyReport, DailyReportEntry, Task, User } from '../lib/types';
import { cn } from '../lib/utils';
import { getStatusInfo } from '../lib/taskUtils';
import { CustomSelect } from './CustomSelect';
import { ThemedDatePicker } from './ThemedDatePicker';
import {
  canEditDailyReport,
  canViewDailyReport,
  getDailyReportReceiverIds,
  getReportTeamKeys,
  isReportExempt,
  isReportLeader,
  isSeniorReporter,
} from '../lib/reportPolicy';
import { canViewTask } from '../lib/taskPolicy';

type ReportBucket = 'approved' | 'rejected' | 'waiting_review' | 'active' | 'not_started' | 'recorded';

type ReportRow = {
  task: Task;
  startTime: string;
  endTime: string;
  durationMinutes: number | null;
};

const bucketStyles: Record<ReportBucket, { label: string; icon: React.ElementType; className: string }> = {
  recorded: { label: 'Work Recorded', icon: CheckCircle2, className: 'border-indigo-200 bg-indigo-50 text-indigo-800' },
  approved: { label: 'Finished / Approved', icon: CheckCircle2, className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  rejected: { label: 'Finished / Returned', icon: XCircle, className: 'border-rose-200 bg-rose-50 text-rose-800' },
  waiting_review: { label: 'Finished / Waiting Review', icon: FileText, className: 'border-blue-200 bg-blue-50 text-blue-800' },
  active: { label: 'Active Work', icon: Clock, className: 'border-amber-200 bg-amber-50 text-amber-800' },
  not_started: { label: 'Not Started', icon: Clock, className: 'border-slate-200 bg-slate-50 text-slate-700' },
};

const bucketCountLabels: Record<ReportBucket, string> = {
  recorded: 'Recorded',
  approved: 'Approved',
  rejected: 'Returned',
  waiting_review: 'Waiting Review',
  active: 'Active Work',
  not_started: 'Not Started',
};

function todayValue() { return cairoDate(); }

function classifyTask(task: Task): ReportBucket {
  const entry = (task as Task & { reportEntry?: DailyReportEntry }).reportEntry;
  if (entry?.source === 'manual') return 'recorded';
  if (entry?.workState === 'active') return 'active';
  if (['approved', 'completed', 'approved_by_art_director'].includes(task.status)) return 'approved';
  if (['changes_requested_by_reviewer', 'changes_requested_by_art_director', 'changes_requested_by_content', 'rejected'].includes(task.status)) return 'rejected';
  if (task.activeWorkStartedAt && !task.activeWorkFinishedAt) return 'active';
  if (['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look', 'reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval', 'waiting_content_revision'].includes(task.status)) return 'waiting_review';
  return entry?.workState === 'finished' ? 'recorded' : 'not_started';
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

function getTeamLabel(teamKey: string) {
  if (teamKey === 'other') return 'Other Team';
  return teamKey;
}

export function DailyReports({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const {
    currentUser,
    users,
    userList,
    appSettings,
    tasks,
    environment,
    dailyReports,
    upsertDailyReport,
    upsertDailyReportEntry,
    sendDailyReport,
  } = useAppStore();

  const currentUserIsSenior = isSeniorReporter(currentUser);
  const currentUserIsLeader = isReportLeader(currentUser);
  const currentUserIsExempt = isReportExempt(currentUser);
  const canInspectTeamReports = currentUserIsSenior || currentUserIsLeader;
  const [selectedDate, setSelectedDate] = useState(todayValue());
  const [showcaseDate, setShowcaseDate] = useState(todayValue());
  const [showcaseMemberId, setShowcaseMemberId] = useState('all');
  const [showcaseTeam, setShowcaseTeam] = useState('all');
  const [showcaseStatus, setShowcaseStatus] = useState<ReportBucket | 'all'>('all');
  const [showcaseSearch, setShowcaseSearch] = useState('');
  const [note, setNote] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [sideTitle, setSideTitle] = useState('');
  const [sideStart, setSideStart] = useState('');
  const [sideEnd, setSideEnd] = useState('');

  const selectedUser = currentUser;
  const reportId = `${selectedDate}:${currentUser.id}`;
  const report = dailyReports.find(item => item.id === reportId) || null;
  const reportUsers = useMemo(() => userList.filter(user => user.id !== 'guest'), [userList]);
  const canEditOwnReport = canEditDailyReport({ userId: currentUser.id }, currentUser, appSettings);
  const reportReceiverNames = getDailyReportReceiverIds({ userId: currentUser.id }, appSettings, reportUsers)
    .map(userId => users[userId]?.name)
    .filter((name): name is string => Boolean(name));

  useEffect(() => {
    setNote(report?.note || '');
    setSavedAt(report?.updatedAt || null);
    setRowError(null);
  }, [reportId, report?.id, report?.updatedAt]);

  const entriesFor = (userId: string, date: string, saved = dailyReports.find(item => item.id === `${date}:${userId}`)) =>
    mergeWorkReportEntries(buildActualWorkEntries(tasks, userId, date, appSettings, reportUsers), saved?.entries);
  const taskForEntry = (entry: DailyReportEntry): Task => ({
    ...(tasks.find(task => task.id === entry.taskId) || { id: entry.taskId, createdBy: currentUser.id, handledBy: [], versions: [], comments: [], environment: 'production', createdAt: '', updatedAt: '' }),
    name: entry.title || tasks.find(task => task.id === entry.taskId)?.name || 'Historical work',
    code: entry.taskCode || (entry.source === 'manual' ? 'Side work' : entry.taskId),
    status: entry.taskStatus || 'completed', reportEntry: entry,
  } as Task);
  const getReportTasksForUser = (userId: string, date: string) => entriesFor(userId, date).map(taskForEntry);

  const reportTasks = useMemo(() => (
    getReportTasksForUser(currentUser.id, selectedDate)
  ), [tasks, dailyReports, environment, currentUser.id, selectedDate, appSettings, reportUsers]);

  const sortedReportTasks = useMemo(() => {
    const bucketOrder: Record<ReportBucket, number> = {
      active: 0,
      recorded: 1,
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
    }, { approved: [], rejected: [], waiting_review: [], active: [], not_started: [], recorded: [] });
  }, [reportTasks]);

  const effectiveEntryFor = (task: Task, sourceReport = report): ReportRow => {
    const entry = (task as Task & { reportEntry?: DailyReportEntry }).reportEntry || sourceReport?.entries.find(entry => entry.taskId === task.id);
    return { task, startTime: entry?.startTime || '', endTime: entry?.endTime || '', durationMinutes: entry?.durationMinutes ?? null };
  };
  const rowsForReport = (sourceReport: DailyReport) => (sourceReport.sentAt ? sourceReport.entries : entriesFor(sourceReport.userId, sourceReport.date, sourceReport)).map(entry => effectiveEntryFor(taskForEntry(entry), sourceReport));
  const saveReport = (send = false) => {
    if (!canEditOwnReport) return;
    const entries = entriesFor(currentUser.id, selectedDate);
    if (send && !entries.length && !note.trim()) { setRowError('Add work or a report note before sending.'); return; }
    upsertDailyReport({ date: selectedDate, userId: currentUser.id, note, entries });
    setSavedAt(new Date().toISOString());
    if (send && !report?.sentAt) sendDailyReport(reportId);
  };
  const addSideWork = () => {
    if (!sideTitle.trim()) return;
    if (sideStart && sideEnd && sideEnd < sideStart) { setRowError('End time must be after start time.'); return; }
    const duration = sideStart && sideEnd ? timeToMinutes(sideEnd)! - timeToMinutes(sideStart)! : null;
    const entry: DailyReportEntry = { taskId: `manual:${crypto.randomUUID()}`, title: sideTitle.trim(), source: 'manual', taskStatus: 'completed', workState: 'finished', startTime: sideStart || null, endTime: sideEnd || null, durationMinutes: duration };
    upsertDailyReport({date:selectedDate,userId:currentUser.id,note,entries:[...entriesFor(currentUser.id,selectedDate),entry]});
    setSideTitle('');setSideStart('');setSideEnd('');setRowError(null);
  };

  const handleStartChange = (taskId: string, value: string) => {
    if (!canEditOwnReport) return;
    setRowError(null);
    upsertDailyReportEntry(reportId, taskId, { startTime: value || null });
  };

  const handleEndChange = (taskId: string, value: string) => {
    if (!canEditOwnReport) return;
    setRowError(null);
    const task = reportTasks.find(t => t.id === taskId);
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

  const visibleShowcaseReports = useMemo(() => dailyReports.filter(item => (
    item.date === showcaseDate &&
    Boolean(item.sentAt) &&
    item.userId !== 'guest' &&
    item.userId !== currentUser.id &&
    canViewDailyReport(item, currentUser, appSettings, reportUsers)
  )), [dailyReports, showcaseDate, currentUser, appSettings, reportUsers]);
  const inspectableReportUsers = useMemo(
    () => {
      const reportOwnerIds = new Set(visibleShowcaseReports.map(item => item.userId));
      return reportUsers.filter(user => reportOwnerIds.has(user.id));
    },
    [reportUsers, visibleShowcaseReports],
  );
  const teamOptions = useMemo(() => {
    return Array.from(new Set<string>(inspectableReportUsers.flatMap(user => getReportTeamKeys(user))))
      .sort()
      .map(teamKey => ({ value: teamKey, label: getTeamLabel(teamKey) }));
  }, [inspectableReportUsers]);

  useEffect(() => {
    if (showcaseMemberId !== 'all' && !inspectableReportUsers.some(user => user.id === showcaseMemberId)) {
      setShowcaseMemberId('all');
    }
    if (showcaseTeam !== 'all' && !teamOptions.some(option => option.value === showcaseTeam)) {
      setShowcaseTeam('all');
    }
  }, [inspectableReportUsers, showcaseMemberId, showcaseTeam, teamOptions]);

  const showcaseGroups = useMemo(() => {
    const search = showcaseSearch.trim().toLowerCase();
    const sentReports = visibleShowcaseReports
      .filter(item => showcaseMemberId === 'all' || item.userId === showcaseMemberId);

    const grouped = new Map<string, { label: string; reports: Array<{ report: DailyReport; user: User; rows: ReportRow[] }> }>();

    sentReports.forEach(item => {
      const user = users[item.userId];
      if (!user) return;
      const teamKeys = getReportTeamKeys(user);
      if (showcaseTeam !== 'all' && !teamKeys.includes(showcaseTeam)) return;

      const filteredRows = rowsForReport(item).filter(row => {
        if (showcaseStatus !== 'all' && classifyTask(row.task) !== showcaseStatus) return false;
        if (search && !`${row.task.name} ${row.task.code}`.toLowerCase().includes(search)) return false;
        return true;
      });

      if (filteredRows.length === 0 && (showcaseStatus !== 'all' || search)) return;
      const normalizedTeamKeys = teamKeys.length > 0 ? [...teamKeys].sort() : ['other'];
      const groupKey = normalizedTeamKeys.join('|');
      const group = grouped.get(groupKey) || {
        label: normalizedTeamKeys.map(getTeamLabel).join(' / '),
        reports: [],
      };
      group.reports.push({ report: item, user, rows: filteredRows });
      grouped.set(groupKey, group);
    });

    return Array.from(grouped.entries())
      .sort(([, a], [, b]) => a.label.localeCompare(b.label))
      .map(([team, group]) => ({
        team,
        label: group.label,
        reports: group.reports.sort((a, b) => a.user.name.localeCompare(b.user.name)),
      }));
  }, [visibleShowcaseReports, showcaseMemberId, showcaseTeam, showcaseStatus, showcaseSearch, users, tasks, environment]);

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
            const canOpenTask = tasks.some(task => task.id === row.task.id) && canViewTask(row.task, currentUser, appSettings, reportUsers);
            return (
              <tr
                key={row.task.id}
                className={cn(canOpenTask && 'cursor-pointer transition-colors hover:bg-slate-50/60')}
                onClick={canOpenTask ? () => onOpenTask(row.task.id) : undefined}
              >
                <td className="p-3 align-top">
                  <p className="text-sm font-black text-slate-900">{row.task.name}</p>
                  <p className="mt-0.5 text-[11px] font-bold text-slate-500">{row.task.code}</p>
                  {tasks.find(task => task.id === row.task.id) && <WorkflowRoadmap task={tasks.find(task => task.id === row.task.id)!} />}
                </td>
                <td className="p-3 align-top">
                  {readOnly ? (
                    <span className="text-xs font-bold text-slate-700">{row.startTime || '-'}</span>
                  ) : (
                    <input
                      type="time"
                      aria-label={`Start time for ${row.task.name}`}
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
                      type={row.endTime === '24:00' ? 'text' : 'time'}
                      aria-label={`End time for ${row.task.name}`}
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
                  {canOpenTask ? <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenTask(row.task.id);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50"
                  >
                    <Eye className="h-3 w-3" /> View
                  </button> : (
                    <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Historical record</span>
                  )}
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
          <p className="mt-1 text-sm font-semibold text-slate-500">Recorded work and manual side work. Times use Africa/Cairo. Review reminder at 17:15; automatic submission at 17:29 on working days.</p>
        </div>
        {!currentUserIsExempt && <div className="w-44">
          <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">Report date</label>
          <ThemedDatePicker value={selectedDate} onChange={setSelectedDate} />
        </div>}
      </div>

      {currentUserIsExempt ? (
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-indigo-900 shadow-sm">
          <h3 className="text-lg font-black">Daily report submission is not required for your role.</h3>
          <p className="mt-1 text-sm font-semibold text-indigo-700">Use the submitted reports below to review the teams that report to you.</p>
        </section>
      ) : <>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-950">{selectedUser.name}</h3>
            <p className="text-xs font-bold text-slate-500">{reportTasks.length} tasks found for this report day</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-400">
              {reportReceiverNames.length > 0 ? `Reports go to ${reportReceiverNames.join(', ')}.` : 'No reporting recipient is currently assigned.'}
            </p>
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
        {(
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Report note / correction</label>
            <textarea value={note} onChange={event => setNote(event.target.value)} rows={4} placeholder="Add context or explain a correction..." className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500" />
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-black">Add side work</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <input aria-label="Side work description" value={sideTitle} onChange={event=>setSideTitle(event.target.value)} placeholder="Meeting, research, or other work" className="min-w-0 rounded-lg border p-2 text-sm" />
          <input aria-label="Side work start time" type="time" value={sideStart} onChange={event=>setSideStart(event.target.value)} className="min-w-0 rounded-lg border p-2 text-sm" />
          <input aria-label="Side work end time" type="time" value={sideEnd} onChange={event=>setSideEnd(event.target.value)} className="min-w-0 rounded-lg border p-2 text-sm" />
          <button onClick={addSideWork} disabled={!sideTitle.trim()} className="rounded-lg bg-indigo-600 p-2 text-sm font-bold text-white disabled:opacity-40">Add Side Work</button>
        </div>
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
      </>}

      {canInspectTeamReports && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-slate-950">{currentUserIsSenior ? 'Team Report Showcase' : 'Leadership Report Showcase'}</h3>
              <p className="mt-1 text-xs font-bold text-slate-500">
                {currentUserIsSenior
                  ? 'Inspect submitted reports from the members assigned to you.'
                  : 'Inspect submitted reports available to your leadership role.'}
              </p>
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
                  options={[{ value: 'all', label: 'All Teams' }, ...teamOptions]}
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
                  <h4 className="text-base font-black text-slate-950">{group.label}</h4>
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
