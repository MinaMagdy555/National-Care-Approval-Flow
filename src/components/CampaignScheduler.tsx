import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, ChevronLeft, ChevronRight, Clock, Trash2, ExternalLink } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { Task } from '../lib/types';
import { canManageWorkflow, canUserAccessTask, parsePublishDate } from '../lib/workflowUtils';
import { isTaskArchived } from '../lib/archiveUtils';
import { cn } from '../lib/utils';
import { ThemedDatePicker } from './ThemedDatePicker';
import { ThemedTimePicker } from './ThemedTimePicker';
import { CustomSelect } from './CustomSelect';
import { MINA_ID, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID } from '../lib/appSettings';

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
  formatBudget,
}: {
  title: string;
  icon: React.ElementType;
  items: ScheduledCampaign[];
  emptyText: string;
  tone: 'rose' | 'emerald' | 'slate';
  onOpenTask: (id: string) => void;
  onMarkPublished: (id: string) => void;
  canMarkPublished: boolean;
  formatBudget: (amount: number, currency?: string | null) => string;
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
              <span className="mt-1 block text-xs font-bold text-slate-500">
                {formatDateTime(publishDate)} {task.platform ? `• ${task.platform}` : ''}
              </span>
              {task.taskType === 'media_buying' && task.budgetAmount && (
                <span className="mt-1 inline-flex items-center rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-black text-indigo-700">
                  Budget: {formatBudget(task.budgetAmount, task.budgetCurrency)}
                </span>
              )}
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

const CURRENCY_RATES = {
  USD: 1,
  EGP: 48,
  KD: 0.31
};

export function CampaignScheduler({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { tasks, currentUser, environment, markCampaignPublished, appSettings, updateAppSettings, submitScheduledCampaign, editScheduledCampaign, deleteTask } = useAppStore();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const todayKey = dateKey(new Date());
  const canMarkPublished = canManageWorkflow(currentUser);

  // Modal State
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [dateText, setDateText] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'campaign' | 'media_buying'>('campaign');
  const [platform, setPlatform] = useState('Instagram');
  const [time, setTime] = useState('09:00');
  const [notes, setNotes] = useState('');
  const [budget, setBudget] = useState('');
  const [budgetCurrency, setBudgetCurrency] = useState('USD');

  const isLeaderboardOrMina = useMemo(() => {
    const leaderboardIds = [MINA_ID, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID];
    return leaderboardIds.includes(currentUser.id) ||
      currentUser.name.includes('Mina') ||
      currentUser.name.includes('Dina') ||
      currentUser.name.includes('Marwa') ||
      currentUser.name.includes('Sobeeh') ||
      currentUser.name.includes('Fawzy') ||
      currentUser.email === 'minamagdy5555@gmail.com';
  }, [currentUser]);

  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const twoMonthsFromToday = useMemo(() => {
    const d = new Date(startOfToday);
    d.setMonth(d.getMonth() + 2);
    return d;
  }, [startOfToday]);

  const platforms = appSettings?.campaignPlatforms || ['Instagram', 'LinkedIn', 'TikTok', 'Snapchat'];

  const formatBudget = (amount: number, currency?: string | null) => {
    const cur = currency || 'USD';
    if (cur === 'USD') return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (cur === 'EGP') return `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP`;
    if (cur === 'KD') return `${amount.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} KD`;
    return `${amount} ${cur}`;
  };

  const handleCurrencyChange = (newCurrency: string) => {
    const prevCurrency = budgetCurrency;
    setBudgetCurrency(newCurrency);
    
    const val = parseFloat(budget);
    if (!isNaN(val) && val > 0) {
      const prevRate = CURRENCY_RATES[prevCurrency as keyof typeof CURRENCY_RATES] || 1;
      const newRate = CURRENCY_RATES[newCurrency as keyof typeof CURRENCY_RATES] || 1;
      const converted = (val / prevRate) * newRate;
      const decimals = newCurrency === 'KD' ? 3 : 2;
      setBudget(String(Math.round(converted * Math.pow(10, decimals)) / Math.pow(10, decimals)));
    }
  };

  const handleAddPlatform = () => {
    const newPlatform = prompt('Enter new platform name:');
    if (!newPlatform || !newPlatform.trim()) return;
    const trimmed = newPlatform.trim();
    if (platforms.some(p => p.toLowerCase() === trimmed.toLowerCase())) {
      alert('Platform already exists.');
      return;
    }
    updateAppSettings(settings => ({
      ...settings,
      campaignPlatforms: [...(settings.campaignPlatforms || ['Instagram', 'LinkedIn', 'TikTok', 'Snapchat']), trimmed]
    }));
    setPlatform(trimmed);
  };

  const handleCellClick = (day: Date) => {
    if (!isLeaderboardOrMina) return;
    const dTime = day.getTime();
    if (dTime < startOfToday.getTime() || dTime > twoMonthsFromToday.getTime()) {
      return;
    }
    const year = day.getFullYear();
    const month = String(day.getMonth() + 1).padStart(2, '0');
    const date = String(day.getDate()).padStart(2, '0');

    setSelectedDay(day);
    setDateText(`${year}-${month}-${date}`);
    setScheduleModalOpen(true);
    setIsEditMode(false);
    setEditingTaskId(null);
    setName('');
    setType('campaign');
    if (platforms.length > 0) setPlatform(platforms[0]);
    setTime('09:00');
    setNotes('');
    setBudget('');
    setBudgetCurrency('USD');
  };

  const handleEditClick = (task: Task) => {
    if (!isLeaderboardOrMina) return;
    
    const publishDate = parsePublishDate(task.scheduledPublishAt);
    if (!publishDate) return;
    
    const year = publishDate.getFullYear();
    const month = String(publishDate.getMonth() + 1).padStart(2, '0');
    const date = String(publishDate.getDate()).padStart(2, '0');
    const hours = String(publishDate.getHours()).padStart(2, '0');
    const minutes = String(publishDate.getMinutes()).padStart(2, '0');
    
    setSelectedDay(publishDate);
    setDateText(`${year}-${month}-${date}`);
    setIsEditMode(true);
    setEditingTaskId(task.id);
    setName(task.name);
    setType((task.taskType as 'campaign' | 'media_buying') || 'campaign');
    setPlatform(task.platform || (platforms.length > 0 ? platforms[0] : 'Instagram'));
    setTime(`${hours}:${minutes}`);
    setNotes(task.publishNote || task.description || '');
    setBudget(task.budgetAmount ? String(task.budgetAmount) : '');
    setBudgetCurrency(task.budgetCurrency || 'USD');
    setScheduleModalOpen(true);
  };

  const handleDeleteClick = () => {
    if (isEditMode && editingTaskId) {
      if (confirm('Are you sure you want to delete this scheduled event?')) {
        deleteTask(editingTaskId);
        setScheduleModalOpen(false);
      }
    }
  };

  const handleScheduleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (name.trim().length < 3) {
      alert("Please enter a descriptive event name (minimum 3 characters).");
      return;
    }

    let parsedBudget: number | null = null;
    if (type === 'media_buying') {
      parsedBudget = parseFloat(budget);
      if (isNaN(parsedBudget) || parsedBudget <= 0) {
        alert("Please enter a budget amount greater than 0.");
        return;
      }
    }

    if (!dateText || !time) {
      alert("Please select date and time.");
      return;
    }

    const [hours, minutes] = time.split(':').map(Number);
    const dateParts = dateText.split('-').map(Number);
    const scheduledDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], hours, minutes, 0, 0);

    const startOfTodayVal = new Date();
    startOfTodayVal.setHours(0, 0, 0, 0);
    
    const twoMonthsFromTodayVal = new Date();
    twoMonthsFromTodayVal.setMonth(twoMonthsFromTodayVal.getMonth() + 2);
    twoMonthsFromTodayVal.setHours(23, 59, 59, 999);

    let shouldValidateDate = !isEditMode;
    if (isEditMode && editingTaskId) {
      const originalTask = tasks.find(t => t.id === editingTaskId);
      if (originalTask) {
        const originalDate = new Date(originalTask.scheduledPublishAt);
        if (originalDate.toDateString() !== scheduledDate.toDateString()) {
          shouldValidateDate = true;
        }
      }
    }

    if (shouldValidateDate) {
      if (scheduledDate.getTime() < startOfTodayVal.getTime()) {
        alert("You cannot schedule an event in the past. Please select today or a future date.");
        return;
      }
      if (scheduledDate.getTime() > twoMonthsFromTodayVal.getTime()) {
        alert("You cannot schedule an event more than 2 months away.");
        return;
      }
    }

    const payload = {
      name: name.trim(),
      taskType: type,
      scheduledPublishAt: scheduledDate.toISOString(),
      publishNote: notes.trim() || null,
      platform: type === 'campaign' ? platform : null,
      budgetAmount: type === 'media_buying' ? parsedBudget : null,
      budgetCurrency: type === 'media_buying' ? budgetCurrency : null,
    };

    if (isEditMode && editingTaskId) {
      editScheduledCampaign(editingTaskId, payload);
    } else {
      submitScheduledCampaign(payload);
    }

    setScheduleModalOpen(false);
  };

  const scheduledCampaigns = useMemo(() => {
    return tasks
      .filter(task => task.environment === environment && (task.taskType === 'campaign' || task.taskType === 'media_buying') && !isTaskArchived(task) && canUserAccessTask(task, currentUser))
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

              const dTime = day.getTime();
              const isClickable = isLeaderboardOrMina && dTime >= startOfToday.getTime() && dTime <= twoMonthsFromToday.getTime();

              return (
                <div
                  key={key}
                  onClick={() => isClickable && handleCellClick(day)}
                  className={cn(
                    "min-h-32 border-b border-r border-slate-100 p-2 transition-all",
                    !isCurrentMonth && "bg-slate-50/70 text-slate-400",
                    isToday && "bg-indigo-50/60",
                    isClickable && "cursor-pointer hover:bg-slate-50/50 hover:ring-1 hover:ring-indigo-500/20"
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
                    {dayItems.slice(0, 3).map(({ task, publishDate }) => {
                      const isUpcomingWithinWeek = !task.publishedAt && publishDate.getTime() >= now && (publishDate.getTime() - now) <= 7 * 24 * 60 * 60 * 1000;
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isLeaderboardOrMina) {
                              handleEditClick(task);
                            } else {
                              onOpenTask(task.id);
                            }
                          }}
                          className={cn(
                            "block w-full rounded-md p-1.5 text-left text-[10px] font-black transition-all border whitespace-normal break-words leading-tight hover:shadow-sm",
                            task.publishedAt 
                              ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                              : publishDate.getTime() < now 
                                ? "bg-rose-50 text-rose-700 border-rose-100" 
                                : isUpcomingWithinWeek 
                                  ? "bg-amber-100 text-amber-800 border-amber-300 animate-pulse" 
                                  : "bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100"
                          )}
                          title={`${task.name} ${task.publishNote || ''}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-black/5 pb-0.5 mb-1 opacity-85 text-[9px] font-bold">
                            <span>{publishDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                            {task.platform && <span className="font-extrabold uppercase text-[7.5px] bg-black/5 px-1 rounded">{task.platform}</span>}
                          </div>
                          <div className="font-bold text-slate-800 leading-snug">{task.name}</div>
                          {task.taskType === 'media_buying' && task.budgetAmount && (
                            <div className="text-[8.5px] text-slate-500 font-extrabold mt-0.5">
                              Budget: {formatBudget(task.budgetAmount, task.budgetCurrency)}
                            </div>
                          )}
                        </button>
                      );
                    })}
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
            onOpenTask={(id) => {
              const t = tasks.find(x => x.id === id);
              if (t && isLeaderboardOrMina) {
                handleEditClick(t);
              } else {
                onOpenTask(id);
              }
            }}
            onMarkPublished={markCampaignPublished}
            canMarkPublished={canMarkPublished}
            formatBudget={formatBudget}
          />
          <CampaignList
            title="Upcoming"
            icon={Clock}
            items={upcoming}
            emptyText="No upcoming scheduled campaigns."
            tone="slate"
            onOpenTask={(id) => {
              const t = tasks.find(x => x.id === id);
              if (t && isLeaderboardOrMina) {
                handleEditClick(t);
              } else {
                onOpenTask(id);
              }
            }}
            onMarkPublished={markCampaignPublished}
            canMarkPublished={canMarkPublished}
            formatBudget={formatBudget}
          />
          <CampaignList
            title="Published"
            icon={Check}
            items={published}
            emptyText="No campaigns marked as published yet."
            tone="emerald"
            onOpenTask={(id) => {
              const t = tasks.find(x => x.id === id);
              if (t && isLeaderboardOrMina) {
                handleEditClick(t);
              } else {
                onOpenTask(id);
              }
            }}
            onMarkPublished={markCampaignPublished}
            canMarkPublished={canMarkPublished}
            formatBudget={formatBudget}
          />
        </div>
      </div>

      {/* Schedule Modal */}
      {scheduleModalOpen && selectedDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-black text-slate-900 mb-4">
              {isEditMode ? 'Edit Scheduled Event' : `Schedule Event for ${selectedDay.toLocaleDateString([], { dateStyle: 'medium' })}`}
            </h3>
            <form onSubmit={handleScheduleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">Event Type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setType('campaign')}
                    className={cn(
                      "flex-1 rounded-xl py-2 text-xs font-black uppercase tracking-wider border transition-colors",
                      type === 'campaign' ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    Campaign
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('media_buying')}
                    className={cn(
                      "flex-1 rounded-xl py-2 text-xs font-black uppercase tracking-wider border transition-colors",
                      type === 'media_buying' ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    Media Buying
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">Name / Title *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-sm outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 h-[38px]"
                />
              </div>

              {type === 'campaign' ? (
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400 font-black">Platform *</label>
                  <div className="flex gap-2 items-center">
                    <div className="flex-1">
                      <CustomSelect
                        value={platform}
                        onChange={setPlatform}
                        options={platforms.map(p => ({ value: p, label: p }))}
                        buttonClassName="rounded-xl border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 focus:border-indigo-600 h-[38px]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddPlatform}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 h-[38px] shrink-0"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-[1fr,120px] gap-2">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400 font-black">Budget (Required) *</label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      placeholder="e.g. 500"
                      value={budget}
                      onChange={e => setBudget(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-sm outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 h-[38px]"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400 font-black">Currency</label>
                    <CustomSelect
                      value={budgetCurrency}
                      onChange={handleCurrencyChange}
                      options={[
                        { value: 'USD', label: 'USD ($)' },
                        { value: 'EGP', label: 'EGP (E£)' },
                        { value: 'KD', label: 'KD (د.ك)' },
                      ]}
                      buttonClassName="rounded-xl border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 focus:border-indigo-600 h-[38px]"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400 font-black">Publish Date *</label>
                <ThemedDatePicker
                  value={dateText}
                  onChange={setDateText}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400 font-black">Publish Time *</label>
                <ThemedTimePicker
                  value={time}
                  onChange={setTime}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400 font-black font-black">Notes / Details</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-sm outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10"
                />
              </div>

              <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-slate-900 py-2.5 text-sm font-black text-white hover:bg-black transition-colors"
                >
                  {isEditMode ? 'Save Changes' : 'Schedule Event'}
                </button>
                {isEditMode && (
                  <button
                    type="button"
                    onClick={handleDeleteClick}
                    className="rounded-xl bg-rose-600 hover:bg-rose-700 py-2.5 px-4 text-sm font-black text-white transition-colors flex items-center justify-center gap-1.5 shrink-0"
                    title="Delete event entirely"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(false)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
