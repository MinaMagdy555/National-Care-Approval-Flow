import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { Task } from '../lib/types';
import { canManageWorkflow, canUserAccessTask, parsePublishDate } from '../lib/workflowUtils';
import { isTaskArchived } from '../lib/archiveUtils';
import { cn } from '../lib/utils';

type ScheduledCampaign = {
  task: Task;
  publishDate: Date;
};

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function buildCalendarDays(month: Date) {
  const firstDay = startOfMonth(month);
  const cursor = new Date(firstDay);
  cursor.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + index);
    return day;
  });
}

function formatDateTime(date: Date) {
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function CampaignList({
  title,
  icon: Icon,
  items,
  emptyText,
  tone,
  onOpenTask,
  onMarkPublished,
  canMarkPublished,
}: {
  title: string;
  icon: React.ElementType;
  items: ScheduledCampaign[];
  emptyText: string;
  tone: 'rose' | 'emerald' | 'slate';
  onOpenTask: (id: string) => void;
  onMarkPublished: (id: string) => void;
  canMarkPublished: boolean;
}) {
  const toneClass = tone === 'rose'
    ? 'border-rose-200 bg-rose-50 text-rose-900'
    : tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : 'border-slate-200 bg-white text-slate-900';

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className={cn("flex items-center gap-2 border-b px-4 py-3", toneClass)}>
        <Icon className="h-4 w-4" />
        <h3 className="text-sm font-black">{title}</h3>
        <span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 text-xs font-black">{items.length}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {items.length === 0 && (
          <p className="p-4 text-sm font-semibold text-slate-500">{emptyText}</p>
        )}
        {items.map(({ task, publishDate }) => (
          <div
            key={task.id}
            className="flex w-full flex-col gap-3 p-4 text-left transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
          >
            <button type="button" onClick={() => onOpenTask(task.id)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-black text-slate-900">{task.name}</span>
              <span className="mt-1 block text-xs font-bold text-slate-500">{formatDateTime(publishDate)}</span>
              {task.publishNote && <span className="mt-1 block text-xs font-semibold text-slate-500">{task.publishNote}</span>}
            </button>
            {task.publishedAt ? (
              <span className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-emerald-700">
                <Check className="h-3.5 w-3.5" />
                Published
              </span>
            ) : canMarkPublished ? (
              <button
                type="button"
                onClick={() => onMarkPublished(task.id)}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                <Check className="h-3.5 w-3.5" />
                Mark Published
              </button>
            ) : (
              <span className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-slate-500">
                View Only
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function CampaignScheduler({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { tasks, currentUser, environment, markCampaignPublished } = useAppStore();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const todayKey = dateKey(new Date());
  const canMarkPublished = canManageWorkflow(currentUser);

  const scheduledCampaigns = useMemo(() => {
    return tasks
      .filter(task => task.environment === environment && task.taskType === 'campaign' && !isTaskArchived(task) && canUserAccessTask(task, currentUser))
      .map(task => {
        const publishDate = parsePublishDate(task.scheduledPublishAt);
        return publishDate ? { task, publishDate } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a!.publishDate.getTime() - b!.publishDate.getTime()) as ScheduledCampaign[];
  }, [tasks, environment, currentUser.id, currentUser.role]);

  const now = Date.now();
  const overdue = scheduledCampaigns.filter(item => !item.task.publishedAt && item.publishDate.getTime() < now);
  const upcoming = scheduledCampaigns.filter(item => !item.task.publishedAt && item.publishDate.getTime() >= now).slice(0, 8);
  const published = scheduledCampaigns.filter(item => item.task.publishedAt).slice(-6).reverse();
  const calendarDays = buildCalendarDays(visibleMonth);
  const itemsByDate = scheduledCampaigns.reduce((acc, item) => {
    const key = dateKey(item.publishDate);
    acc[key] = [...(acc[key] || []), item];
    return acc;
  }, {} as Record<string, ScheduledCampaign[]>);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
            <CalendarClock className="h-7 w-7 text-indigo-600" />
            Campaign Scheduler
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">Plan publish dates, watch upcoming launches, and mark campaigns as published.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setVisibleMonth(month => addMonths(month, -1))}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-40 text-center text-sm font-black text-slate-900">
            {visibleMonth.toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </span>
          <button
            type="button"
            onClick={() => setVisibleMonth(month => addMonths(month, 1))}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[10px] font-black uppercase tracking-wider text-slate-400">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="px-2 py-3">{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarDays.map(day => {
              const key = dateKey(day);
              const dayItems = itemsByDate[key] || [];
              const isCurrentMonth = day.getMonth() === visibleMonth.getMonth();
              const isToday = key === todayKey;

              return (
                <div
                  key={key}
                  className={cn(
                    "min-h-32 border-b border-r border-slate-100 p-2",
                    !isCurrentMonth && "bg-slate-50/70 text-slate-400",
                    isToday && "bg-indigo-50/60"
                  )}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-xs font-black",
                      isToday ? "bg-indigo-600 text-white" : "text-slate-700"
                    )}>
                      {day.getDate()}
                    </span>
                    {dayItems.length > 0 && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{dayItems.length}</span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {dayItems.slice(0, 3).map(({ task, publishDate }) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onOpenTask(task.id)}
                        className={cn(
                          "block w-full truncate rounded-md px-2 py-1 text-left text-[11px] font-black transition-colors",
                          task.publishedAt ? "bg-emerald-50 text-emerald-700" : publishDate.getTime() < now ? "bg-rose-50 text-rose-700" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                        )}
                        title={task.name}
                      >
                        {publishDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} {task.name}
                      </button>
                    ))}
                    {dayItems.length > 3 && (
                      <div className="px-2 text-[10px] font-bold text-slate-400">+{dayItems.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="space-y-4">
          <CampaignList
            title="Overdue"
            icon={AlertTriangle}
            items={overdue}
            emptyText="No overdue campaign publishes."
            tone="rose"
            onOpenTask={onOpenTask}
            onMarkPublished={markCampaignPublished}
            canMarkPublished={canMarkPublished}
          />
          <CampaignList
            title="Upcoming"
            icon={Clock}
            items={upcoming}
            emptyText="No upcoming scheduled campaigns."
            tone="slate"
            onOpenTask={onOpenTask}
            onMarkPublished={markCampaignPublished}
            canMarkPublished={canMarkPublished}
          />
          <CampaignList
            title="Published"
            icon={Check}
            items={published}
            emptyText="No campaigns marked as published yet."
            tone="emerald"
            onOpenTask={onOpenTask}
            onMarkPublished={markCampaignPublished}
            canMarkPublished={canMarkPublished}
          />
        </div>
      </div>
    </div>
  );
}
