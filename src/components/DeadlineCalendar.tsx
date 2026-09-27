import { WorkflowRoadmap } from './WorkflowRoadmap';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Clock, ExternalLink } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { getTaskDeadlineAt } from '../lib/deadlinePolicy';
import { canViewTask } from '../lib/taskPolicy';
import { getCurrentOwnerUserIds } from '../lib/workflowUtils';
import { getStatusInfo } from '../lib/taskUtils';
import { cn } from '../lib/utils';
import type { Task } from '../lib/types';

const CAIRO_TIME_ZONE = 'Africa/Cairo';

type DeadlineItem = {
  task: Task;
  deadlineAt: Date;
};

type CalendarMonth = {
  year: number;
  month: number;
};

function cairoDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value || 0);
  return { year: part('year'), month: part('month'), day: part('day') };
}

function dateKey(value: Date) {
  const parts = cairoDateParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function formatCairoDateTime(value: Date) {
  return new Intl.DateTimeFormat('en-EG', {
    timeZone: CAIRO_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

function formatMonth(month: CalendarMonth) {
  return new Intl.DateTimeFormat('en-EG', { month: 'long', year: 'numeric', timeZone: CAIRO_TIME_ZONE })
    .format(new Date(Date.UTC(month.year, month.month, 15, 12)));
}

function addMonths(month: CalendarMonth, amount: number): CalendarMonth {
  const date = new Date(Date.UTC(month.year, month.month + amount, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

function buildCalendarDays(month: CalendarMonth) {
  const firstDayOffset = new Date(Date.UTC(month.year, month.month, 1)).getUTCDay();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(month.year, month.month, 1 - firstDayOffset + index));
    return {
      key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
      day: date.getUTCDate(),
      inCurrentMonth: date.getUTCMonth() === month.month,
    };
  });
}

function DeadlineList({
  title,
  items,
  emptyText,
  tone,
  onOpenTask,
  getOwnerNames,
}: {
  title: string;
  items: DeadlineItem[];
  emptyText: string;
  tone: 'rose' | 'indigo';
  onOpenTask: (taskId: string) => void;
  getOwnerNames: (task: Task) => string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label={title}>
      <div className={cn(
        'flex items-center gap-2 border-b px-4 py-3',
        tone === 'rose' ? 'border-rose-100 bg-rose-50 text-rose-900' : 'border-indigo-100 bg-indigo-50 text-indigo-900',
      )}>
        {tone === 'rose' ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
        <h3 className="text-sm font-black">{title}</h3>
        <span className="ml-auto rounded-full bg-white/80 px-2 py-0.5 text-xs font-black">{items.length}</span>
      </div>
      <div className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
        {items.length === 0 && <p className="p-4 text-sm font-semibold text-slate-500">{emptyText}</p>}
        {items.map(({ task, deadlineAt }) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onOpenTask(task.id)}
            className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-slate-950">{task.name}</p>
                    <WorkflowRoadmap task={task} />
              <p className="mt-1 text-xs font-bold text-slate-600">{formatCairoDateTime(deadlineAt)}</p>
              <p className="mt-1 truncate text-[11px] font-semibold text-slate-400">{getOwnerNames(task)}</p>
            </div>
            <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

export function DeadlineCalendar({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const { tasks, currentUser, userList, users, environment, appSettings } = useAppStore();
  const [now, setNow] = useState(() => new Date());
  const [visibleMonth, setVisibleMonth] = useState<CalendarMonth>(() => {
    const today = cairoDateParts(new Date());
    return { year: today.year, month: today.month - 1 };
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const deadlineItems = useMemo(() => tasks
    .filter(task => task.environment === environment && canViewTask(task, currentUser, appSettings, userList, now))
    .map(task => {
      const deadlineAt = getTaskDeadlineAt(task);
      return deadlineAt ? { task, deadlineAt } : null;
    })
    .filter((item): item is DeadlineItem => Boolean(item))
    .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime()),
  [tasks, environment, currentUser, appSettings, userList, now]);

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const itemsByDate = useMemo(() => deadlineItems.reduce<Record<string, DeadlineItem[]>>((result, item) => {
    const key = dateKey(item.deadlineAt);
    result[key] = [...(result[key] || []), item];
    return result;
  }, {}), [deadlineItems]);
  const todayKey = dateKey(now);
  const overdue = deadlineItems.filter(item => item.deadlineAt.getTime() < now.getTime());
  const upcoming = deadlineItems.filter(item => item.deadlineAt.getTime() >= now.getTime());
  const monthItems = deadlineItems.filter(item => {
    const parts = cairoDateParts(item.deadlineAt);
    return parts.year === visibleMonth.year && parts.month === visibleMonth.month + 1;
  });

  const getOwnerNames = (task: Task) => {
    const names = getCurrentOwnerUserIds(task).map(userId => users[userId]?.name).filter(Boolean);
    return names.length > 0 ? `Current owner: ${names.join(', ')}` : 'No current owner';
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
            <CalendarClock className="h-7 w-7 text-indigo-600" aria-hidden="true" />
            Task Deadlines
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            General task deadlines you are allowed to see. Times use Africa/Cairo.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:self-auto">
          <button
            type="button"
            onClick={() => setVisibleMonth(month => addMonths(month, -1))}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="Show previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="min-w-40 text-center text-sm font-black text-slate-900" aria-live="polite">{formatMonth(visibleMonth)}</p>
          <button
            type="button"
            onClick={() => setVisibleMonth(month => addMonths(month, 1))}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="Show next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label={`${formatMonth(visibleMonth)} task deadlines`}>
          <div className="overflow-x-auto">
            <div className="min-w-[760px]" role="grid" aria-label={`${formatMonth(visibleMonth)} deadline calendar`}>
              <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50" role="row">
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => (
                  <div key={day} role="columnheader" className="px-2 py-3 text-center text-[10px] font-black uppercase tracking-wider text-slate-400">
                    {day.slice(0, 3)}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map(day => {
                  const dayItems = itemsByDate[day.key] || [];
                  return (
                    <div
                      key={day.key}
                      role="gridcell"
                      aria-label={`${day.key}, ${dayItems.length} deadline${dayItems.length === 1 ? '' : 's'}`}
                      className={cn(
                        'min-h-36 border-b border-r border-slate-100 p-2',
                        !day.inCurrentMonth && 'bg-slate-50/70',
                        day.key === todayKey && 'bg-indigo-50/60',
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-full text-xs font-black',
                          day.key === todayKey ? 'bg-indigo-600 text-white' : day.inCurrentMonth ? 'text-slate-700' : 'text-slate-400',
                        )}>{day.day}</span>
                        {dayItems.length > 0 && <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-black text-slate-500">{dayItems.length}</span>}
                      </div>
                      <div className="space-y-1">
                        {dayItems.slice(0, 3).map(({ task, deadlineAt }) => {
                          const status = getStatusInfo(task, currentUser.role, users);
                          const isOverdue = deadlineAt.getTime() < now.getTime();
                          return (
                            <button
                              key={task.id}
                              type="button"
                              onClick={() => onOpenTask(task.id)}
                              title={`${task.name} — ${formatCairoDateTime(deadlineAt)} — ${status.label}`}
                              className={cn(
                                'block w-full rounded-md border px-2 py-1.5 text-left text-[10px] font-black leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                                isOverdue
                                  ? 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
                                  : 'border-indigo-100 bg-indigo-50 text-indigo-800 hover:bg-indigo-100',
                              )}
                            >
                              <span className="block truncate">{task.name}</span>
                    <WorkflowRoadmap task={task} />
                              <span className="mt-0.5 block font-bold opacity-70">
                                {deadlineAt.toLocaleTimeString('en-EG', { timeZone: CAIRO_TIME_ZONE, hour: 'numeric', minute: '2-digit' })}
                              </span>
                            </button>
                          );
                        })}
                        {dayItems.length > 3 && <p className="px-1 text-[10px] font-black text-slate-400">+{dayItems.length - 3} more</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">
            {monthItems.length} deadline{monthItems.length === 1 ? '' : 's'} in {formatMonth(visibleMonth)}
          </div>
        </section>

        <div className="space-y-5">
          <DeadlineList
            title="Overdue"
            items={overdue}
            emptyText="No overdue deadlines in your view."
            tone="rose"
            onOpenTask={onOpenTask}
            getOwnerNames={getOwnerNames}
          />
          <DeadlineList
            title="Upcoming"
            items={upcoming}
            emptyText="No upcoming deadlines in your view."
            tone="indigo"
            onOpenTask={onOpenTask}
            getOwnerNames={getOwnerNames}
          />
        </div>
      </div>
    </div>
  );
}
