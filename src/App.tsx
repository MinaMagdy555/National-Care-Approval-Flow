import React, { useEffect, useRef, useState } from 'react';
import { AppProvider, useAppStore } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { TaskDetail } from './components/TaskDetail';
import { ReviewQueue } from './components/ReviewQueue';
import { NotificationsList } from './components/Notifications';
import { CreateTask } from './components/CreateTask';
import { isDueThisWeek, isDueToday } from './lib/deadlineUtils';
import { Menu } from 'lucide-react';

const FULL_WORKSPACE_VIEWERS = ['user_1', 'user_2', 'user_3'];

type AppRoute = {
  view: string;
  taskId: string | null;
};

function getRouteFromUrl(): AppRoute {
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get('view') || 'dashboard',
    taskId: params.get('task') || null,
  };
}

function writeRouteToUrl(route: AppRoute, mode: 'push' | 'replace' = 'push') {
  const params = new URLSearchParams();
  if (route.view !== 'dashboard' || route.taskId) params.set('view', route.view);
  if (route.taskId) params.set('task', route.taskId);

  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](route, '', nextUrl);
}

function playNotificationSound() {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  const audioContext = new AudioContextClass();
  const gain = audioContext.createGain();
  const firstTone = audioContext.createOscillator();
  const secondTone = audioContext.createOscillator();

  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.45);

  firstTone.frequency.value = 740;
  secondTone.frequency.value = 980;
  firstTone.type = 'sine';
  secondTone.type = 'sine';

  firstTone.connect(gain);
  secondTone.connect(gain);
  gain.connect(audioContext.destination);

  firstTone.start();
  firstTone.stop(audioContext.currentTime + 0.18);
  secondTone.start(audioContext.currentTime + 0.2);
  secondTone.stop(audioContext.currentTime + 0.45);
  window.setTimeout(() => audioContext.close(), 700);
}

function AppContent() {
  const initialRoute = getRouteFromUrl();
  const [currentView, setView] = useState(initialRoute.view);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(initialRoute.taskId);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const {
    tasks,
    currentUser,
    environment,
    notifications,
    persistenceMode,
    persistenceError,
    localMigrationCount,
    isMigratingLocalData,
    migrateLocalDataToSupabase,
    dismissLocalMigration,
  } = useAppStore();
  const initialUnreadCountRef = useRef<number | null>(null);

  useEffect(() => {
    writeRouteToUrl({ view: currentView, taskId: activeTaskId }, 'replace');
    const handlePopState = () => {
      const route = getRouteFromUrl();
      setView(route.view);
      setActiveTaskId(route.taskId);
      setIsSidebarOpen(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const unreadCount = notifications.filter(notification => notification.userId === currentUser.id && !notification.read).length;
    if (initialUnreadCountRef.current === null) {
      initialUnreadCountRef.current = unreadCount;
      return;
    }

    if (unreadCount > initialUnreadCountRef.current && (document.hidden || !document.hasFocus())) {
      playNotificationSound();
    }

    initialUnreadCountRef.current = unreadCount;
  }, [notifications, currentUser.id]);

  const navigateTo = (route: AppRoute, mode: 'push' | 'replace' = 'push') => {
    setView(route.view);
    setActiveTaskId(route.taskId);
    writeRouteToUrl(route, mode);
  };

  const handleOpenTask = (id: string) => {
    navigateTo({ view: 'task_detail', taskId: id });
    setIsSidebarOpen(false);
  };

  const handleBack = () => {
    navigateTo({ view: 'dashboard', taskId: null });
  };

  const handleNavigate = (view: string) => {
    navigateTo({ view, taskId: null });
    setIsSidebarOpen(false);
  };

  const canViewFullWorkspace = FULL_WORKSPACE_VIEWERS.includes(currentUser.id);
  const envTasks = tasks.filter(t => t.environment === environment);
  const visibleEnvTasks = canViewFullWorkspace ? envTasks : envTasks.filter(t => t.createdBy === currentUser.id);

  const renderContent = () => {
    if (activeTaskId) {
      return <TaskDetail taskId={activeTaskId} onBack={handleBack} />;
    }

    switch (currentView) {
      case 'dashboard':
        return <Dashboard onOpenTask={handleOpenTask} onNavigate={handleNavigate} />;
      case 'notifications':
        return <NotificationsList onOpenTask={handleOpenTask} />;
      case 'create_task':
        return <CreateTask />;
      case 'review_queue': {
        const needsFullReview = visibleEnvTasks.filter(t => ['submitted', 'waiting_reviewer_full_review'].includes(t.status));
        return <ReviewQueue onOpenTask={handleOpenTask} tasks={needsFullReview} title="Needs Full Review" />;
      }
      case 'quick_look_queue': {
        const needsQuickLook = visibleEnvTasks.filter(t => t.status === 'waiting_reviewer_quick_look');
        return <ReviewQueue onOpenTask={handleOpenTask} tasks={needsQuickLook} title="Needs Quick Look" />;
      }
      case 'ad_queue': {
        const needsAd = visibleEnvTasks.filter(t => ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status) || (t.reviewMode === 'direct_to_ad' && t.status === 'sent_to_art_director'));
        return <ReviewQueue onOpenTask={handleOpenTask} tasks={needsAd} title="Needs Marwa Action" />;
      }
      case 'due_today': {
        const dueToday = visibleEnvTasks.filter(isDueToday);
        return <ReviewQueue onOpenTask={handleOpenTask} tasks={dueToday} title="Due Today" />;
      }
      case 'due_this_week': {
        const dueThisWeek = visibleEnvTasks.filter(isDueThisWeek);
        return <ReviewQueue onOpenTask={handleOpenTask} tasks={dueThisWeek} title="Due This Week" />;
      }
      case 'waiting_for_mina': {
        const waitingForMina = visibleEnvTasks.filter(t => ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'].includes(t.status));
        return <ReviewQueue onOpenTask={handleOpenTask} tasks={waitingForMina} title="Waiting for Mina" />;
      }
      case 'waiting_for_marwa': {
        const waitingForMarwa = visibleEnvTasks.filter(t => ['reviewer_approved', 'sent_to_art_director', 'waiting_art_director_approval'].includes(t.status));
        return <ReviewQueue onOpenTask={handleOpenTask} tasks={waitingForMarwa} title="Waiting for Marwa" />;
      }
      case 'approved_by_me': {
        const approved = visibleEnvTasks.filter(t => t.status === 'approved_by_art_director');
        return <ReviewQueue onOpenTask={handleOpenTask} tasks={approved} title="Approved Tasks" />;
      }
      case 'rejected_reopened': {
        const rejected = currentUser.role === 'art_director'
          ? visibleEnvTasks.filter(t => t.status === 'changes_requested_by_art_director')
          : visibleEnvTasks.filter(t => ['changes_requested_by_reviewer', 'changes_requested_by_art_director'].includes(t.status));
        return <ReviewQueue onOpenTask={handleOpenTask} tasks={rejected} title="Rejected / Returned" />;
      }
      case 'all_tasks': {
        let visibleTasks = visibleEnvTasks;
        if (currentUser.role === 'art_director') {
          // exclude tasks that haven't reached AD yet
          visibleTasks = visibleEnvTasks.filter(t => !['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look', 'changes_requested_by_reviewer', 'reviewer_approved'].includes(t.status) || t.reviewMode === 'direct_to_ad');
        }
        return <ReviewQueue onOpenTask={handleOpenTask} tasks={visibleTasks} title="All Tasks" />;
      }
      case 'my_tasks': {
        const myTasks = visibleEnvTasks.filter(t => t.createdBy === currentUser.id);
        return <ReviewQueue onOpenTask={handleOpenTask} tasks={myTasks} title="My Tasks" />;
      }
      default:
        return (
          <div className="p-8 flex items-center justify-center h-full">
            <div className="text-center bg-white p-12 rounded-2xl border border-slate-200 shadow-sm max-w-sm w-full mx-auto">
              <h2 className="text-xl font-black text-slate-800 mb-2">Coming Soon</h2>
              <p className="text-sm font-medium text-slate-500">This section is not implemented in the current version.</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="flex min-h-[100dvh] w-full bg-[#f8fafc] text-slate-900 font-sans md:overflow-hidden">
      <Sidebar
        currentView={activeTaskId ? 'task_detail' : currentView}
        setView={handleNavigate}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      <div className="flex min-h-[100dvh] flex-1 flex-col min-w-0 md:pl-64">
        <main className="flex-1 overflow-y-auto relative min-w-0">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="fixed left-4 top-4 z-20 inline-flex rounded-lg border border-slate-200 bg-white p-2 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 md:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          {persistenceMode === 'supabase' && persistenceError && (
            <div className="mx-4 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 sm:mx-6 lg:mx-8">
              Shared data error: {persistenceError}
            </div>
          )}
          {persistenceMode === 'supabase' && !persistenceError && localMigrationCount > 0 && (
            <div className="mx-4 mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 sm:mx-6 lg:mx-8 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-sm font-bold">
                {localMigrationCount} local-only item{localMigrationCount === 1 ? '' : 's'} found on this browser.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={migrateLocalDataToSupabase}
                  disabled={isMigratingLocalData}
                  className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-black uppercase tracking-wide text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
                >
                  {isMigratingLocalData ? 'Uploading...' : 'Move to Shared Data'}
                </button>
                <button
                  type="button"
                  onClick={dismissLocalMigration}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-wide text-amber-800 transition-colors hover:bg-amber-100"
                >
                  Not Now
                </button>
              </div>
            </div>
          )}
          {renderContent()}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

