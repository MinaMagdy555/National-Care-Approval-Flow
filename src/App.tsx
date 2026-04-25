import React, { useState } from 'react';
import { AppProvider, useAppStore } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Dashboard } from './components/Dashboard';
import { TaskDetail } from './components/TaskDetail';
import { ReviewQueue } from './components/ReviewQueue';
import { NotificationsList } from './components/Notifications';
import { CreateTask } from './components/CreateTask';

const FULL_WORKSPACE_VIEWERS = ['user_1', 'user_2', 'user_3'];

function AppContent() {
  const [currentView, setView] = useState('dashboard');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { tasks, currentUser, environment } = useAppStore();

  const handleOpenTask = (id: string) => {
    setActiveTaskId(id);
    setIsSidebarOpen(false);
    setView('task_detail');
  };

  const handleBack = () => {
    setActiveTaskId(null);
    setView('dashboard');
  };

  const handleNavigate = (view: string) => {
    setActiveTaskId(null);
    setView(view);
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
        <TopBar onOpenSidebar={() => setIsSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto relative min-w-0">
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

