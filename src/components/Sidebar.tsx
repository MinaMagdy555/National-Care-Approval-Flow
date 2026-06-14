import React, { useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';
import {
  Archive,
  Bell,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  ClipboardList,
  Clock,
  FilePenLine,
  FileText,
  LayoutDashboard,
  LogIn,
  LogOut,
  Send,
  BriefcaseBusiness,
  Settings,
  Upload,
  UsersRound,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { userRoleLabels } from '../lib/mockData';
import { getTaskTypeConfigs } from '../lib/appSettings';
import { isLeaderboardUser } from '../lib/workAssignmentUtils';

type MenuItem = {
  id: string;
  label: string;
  icon: React.ElementType;
  children?: MenuItem[];
};

export function Sidebar({
  currentView,
  setView,
  isOpen,
  onClose,
  showUserManagement,
  showSettings,
}: {
  currentView: string;
  setView: (v: string) => void;
  isOpen: boolean;
  onClose: () => void;
  showUserManagement: boolean;
  showSettings: boolean;
}) {
  const { currentUser, notifications, logout, authStatus, appSettings } = useAppStore();
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const isSignedIn = authStatus === 'approved';

  const canSeeCreatorCards = React.useMemo(() => {
    return (
      appSettings.workAssignmentCreatorIds.includes(currentUser.id) ||
      appSettings.settingsManagerUserIds.includes(currentUser.id) ||
      appSettings.contributorAssignerIds.includes(currentUser.id) ||
      ['reviewer', 'art_director', 'admin', 'team_leader', 'marketing_manager', 'manager'].includes(currentUser.role)
    );
  }, [currentUser, appSettings]);

  const unreadCount = notifications ? notifications.filter(n => n.userId === currentUser.id && !n.read).length : 0;
  const canManageUsers = Boolean(currentUser.isAdmin) || currentUser.role === 'admin';

  useEffect(() => {
    if (
      currentView === 'all_tasks' ||
      currentView === 'campaign_scheduler' ||
      currentView === 'assigned_work' ||
      currentView === 'assigned_tasks' ||
      currentView === 'my_tasks' ||
      currentView === 'review_queue' ||
      currentView === 'quick_look_queue' ||
      currentView === 'ad_queue' ||
      currentView === 'due_today' ||
      currentView === 'due_this_week' ||
      currentView === 'waiting_for_mina' ||
      currentView === 'waiting_for_marwa' ||
      currentView === 'approved_by_me' ||
      currentView === 'rejected_reopened' ||
      currentView === 'archived_tasks'
    ) {
      setExpandedGroups(prev => (prev.includes('task_center') ? prev : [...prev, 'task_center']));
    }
  }, [currentView]);

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  const handleNavigate = (view: string) => {
    setView(view);
    onClose();
  };

  const getMenuForRole = (): MenuItem[] => {
    const configs = getTaskTypeConfigs(appSettings);
    const isFirstRev = (appSettings.firstReviewerUserIds || []).includes(currentUser.id) ||
      configs.some(c => c.fullReviewerUserIds?.includes(currentUser.id) || c.quickLookUserIds?.includes(currentUser.id)) ||
      currentUser.role === 'team_leader';
    const isFinalRev = (appSettings.finalReviewerUserIds || []).includes(currentUser.id) ||
      configs.some(c => c.finalReviewerUserIds?.includes(currentUser.id));
    const isLoaderOrMina = isFirstRev || isFinalRev || (appSettings.viewAllWorkloadUserIds || []).includes(currentUser.id);

    const commonTop = [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      ...(isLoaderOrMina ? [{ id: 'performance', label: 'Team Performance', icon: UsersRound }] : []),
      { id: 'campaign_scheduler', label: 'Campaign Scheduler', icon: CalendarClock },
      ...(isLeaderboardUser(currentUser.id) ? [{ id: 'assigned_work', label: 'Assigned Work', icon: BriefcaseBusiness }] : []),
      { id: 'notifications', label: `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}`, icon: Bell },
    ];
    const adminItems = canManageUsers && showUserManagement ? [{ id: 'users', label: 'Users & Roles', icon: UsersRound }] : [];
    const settingsItems = showSettings ? [{ id: 'settings', label: 'Tool Settings', icon: Settings }] : [];

    const taskCenterChildren: MenuItem[] = [];

    const isContentCreator = currentUser.jobTitle === 'Content Creator' || (currentUser.role === 'team_member' && currentUser.jobTitle === 'Content Creator');
    const isHighboard = isFirstRev || isFinalRev || currentUser.role !== 'team_member' || isLeaderboardUser(currentUser.id);

    const isDina = currentUser.id === 'user_3' || currentUser.name.toLowerCase().includes('dina') || currentUser.email?.toLowerCase().includes('dina.');
    const showMyTasks = !(appSettings.neverHandlerIds || []).includes(currentUser.id) &&
      (!isFirstRev && !isFinalRev || isDina);

    if (showMyTasks) {
      taskCenterChildren.push({ id: 'my_tasks', label: 'My Tasks', icon: UserRoundCheck });
    }

    if (isContentCreator || isHighboard) {
      taskCenterChildren.push({ id: 'content_revision_queue', label: 'Waiting for Content Rev.', icon: FileText });
    }

    if (isFirstRev || isFinalRev) {
      taskCenterChildren.push({ id: 'all_tasks', label: 'All Tasks', icon: ClipboardList });
    }

    if (isFirstRev) {
      taskCenterChildren.push({ id: 'review_queue', label: 'Waiting for First Rev.', icon: FilePenLine });
      taskCenterChildren.push({ id: 'quick_look_queue', label: 'Needs Quick Look', icon: FileText });
    }

    if (isFinalRev) {
      if (!isFirstRev) {
        taskCenterChildren.push({ id: 'waiting_for_mina', label: 'Waiting for First Rev.', icon: Clock });
      }
      taskCenterChildren.push({ id: 'ad_queue', label: 'Waiting for Final Rev.', icon: FilePenLine });
    }

    taskCenterChildren.push({ id: 'assigned_tasks', label: 'Assigned Tasks', icon: BriefcaseBusiness });

    if (!isFirstRev && !isFinalRev && !isContentCreator) {
      taskCenterChildren.push({ id: 'waiting_for_mina', label: 'Waiting for First Rev.', icon: Clock });
      taskCenterChildren.push({ id: 'waiting_for_marwa', label: 'Waiting for Final Rev.', icon: Send });
    }

    taskCenterChildren.push({ id: 'approved_by_me', label: 'Approved', icon: Check });
    taskCenterChildren.push({ id: 'rejected_reopened', label: 'Rejected', icon: CircleX });
    taskCenterChildren.push({ id: 'archived_tasks', label: 'Archived', icon: Archive });

    const showUploadTask = !isFirstRev && !isFinalRev;

    return [
      ...commonTop,
      ...adminItems,
      ...settingsItems,
      ...(showUploadTask ? [{ id: 'create_task', label: 'Upload Task', icon: Upload }] : []),
      {
        id: 'task_center',
        label: 'All Tasks',
        icon: ClipboardList,
        children: taskCenterChildren
      }
    ];
  };

  const menu = getMenuForRole();
  const taskViews = new Set([
    'all_tasks',
    'campaign_scheduler',
    'assigned_work',
    'assigned_tasks',
    'my_tasks',
    'content_revision_queue',
    'review_queue',
    'quick_look_queue',
    'ad_queue',
    'due_today',
    'due_this_week',
    'waiting_for_mina',
    'waiting_for_marwa',
    'approved_by_me',
    'rejected_reopened',
    'archived_tasks',
    'users'
    ,'settings'
  ]);

  const renderMenuItem = (item: MenuItem, depth = 0) => {
    if (item.children) {
      const isExpanded = expandedGroups.includes(item.id);
      const isParentActive = item.children.some(child => taskViews.has(child.id) && child.id === currentView);
      return (
        <div key={item.id} className="space-y-1">
          <button
            onClick={() => toggleGroup(item.id)}
            className={cn(
              "w-full flex items-center justify-between px-4 py-3 text-sm font-medium rounded-lg transition-colors",
              isParentActive 
                ? "bg-white/10 text-white border border-white/10 shadow-sm" 
                : "text-slate-400 hover:bg-white/5 hover:text-white"
            )}
            style={{ paddingLeft: `${16 + depth * 12}px` }}
          >
            <div className="flex items-center gap-3">
              <item.icon className={cn("w-4 h-4 opacity-70", isParentActive && "text-indigo-400 opacity-100")} />
              {item.label}
            </div>
            {isExpanded ? <ChevronDown className="w-4 h-4 opacity-70" /> : <ChevronRight className="w-4 h-4 opacity-70" />}
          </button>
          
          {isExpanded && (
            <div className="space-y-1 pt-1">
              {item.children.map(child => renderMenuItem(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const isActive = item.id === currentView;
    const isChild = depth > 0;
    return (
      <button
        key={item.id}
        onClick={() => handleNavigate(item.id)}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors",
          isChild && "text-xs font-semibold whitespace-nowrap",
          isActive 
            ? "bg-white/10 text-white border border-white/10 shadow-sm" 
            : "text-slate-400 hover:bg-white/5 hover:text-white"
        )}
        style={{ paddingLeft: `${16 + depth * 8}px` }}
      >
        <item.icon className={cn("w-4 h-4 opacity-70", isActive && "text-indigo-400 opacity-100")} />
        {item.label}
      </button>
    );
  };

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-30 bg-slate-950/45 backdrop-blur-sm transition-opacity md:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-[100dvh] w-72 max-w-[88vw] flex-col bg-[#0f172a] text-white shadow-2xl transition-transform md:w-64 md:max-w-none md:shadow-none",
          isOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0"
        )}
      >
        <div className="flex items-center justify-between p-5 md:p-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-lg text-white shrink-0">N</div>
            <div className="flex flex-col min-w-0">
              <span className="font-extrabold tracking-tight text-lg md:text-xl leading-none truncate">National Care</span>
              <span className="font-light text-[10px] text-slate-400 mt-1 uppercase tracking-widest">Approval Flow</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white md:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto pt-2 pb-4">
          {menu.map(item => renderMenuItem(item))}
        </nav>
        
        <div className="space-y-3 border-t border-white/10 p-5 md:p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-200 border-2 border-white/20 overflow-hidden flex items-center justify-center text-indigo-900 font-bold uppercase shrink-0">
              {currentUser.avatar ? <img src={currentUser.avatar} alt="avatar" className="w-full h-full object-cover" /> : currentUser.name.charAt(0)}
            </div>
            <div className="text-left flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{currentUser.name}</p>
              <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{currentUser.jobTitle || userRoleLabels[currentUser.role]}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => {
                if (isSignedIn) {
                  void logout();
                } else {
                  handleNavigate('sign_in');
                }
                onClose();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-white transition-colors hover:bg-white/10"
            >
              {isSignedIn ? <LogOut className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
              {isSignedIn ? 'Leave Account' : 'Sign In'}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
