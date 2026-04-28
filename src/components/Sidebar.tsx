import React, { useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';
import { LayoutDashboard, CheckSquare, Clock, FileText, Bell, ChevronDown, ChevronRight, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { userRoleLabels } from '../lib/mockData';

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
}: {
  currentView: string;
  setView: (v: string) => void;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { currentUser, notifications } = useAppStore();
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

  const unreadCount = notifications ? notifications.filter(n => n.userId === currentUser.id && !n.read).length : 0;

  useEffect(() => {
    if (
      currentView === 'all_tasks' ||
      currentView === 'my_tasks' ||
      currentView === 'review_queue' ||
      currentView === 'quick_look_queue' ||
      currentView === 'ad_queue' ||
      currentView === 'due_today' ||
      currentView === 'due_this_week' ||
      currentView === 'waiting_for_mina' ||
      currentView === 'waiting_for_marwa' ||
      currentView === 'approved_by_me' ||
      currentView === 'rejected_reopened'
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
    const commonTop = [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'notifications', label: `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}`, icon: Bell },
    ];

    switch (currentUser.role) {
      case 'team_member':
        return [
          ...commonTop,
          { id: 'create_task', label: 'Create Task', icon: CheckSquare },
          {
            id: 'task_center', label: 'All Tasks', icon: FileText,
            children: [
              { id: 'my_tasks', label: 'My Tasks', icon: FileText },
              { id: 'waiting_for_mina', label: 'Waiting for Mina', icon: Clock },
              { id: 'waiting_for_marwa', label: 'Waiting for Marwa', icon: FileText },
              { id: 'rejected_reopened', label: 'Rejected', icon: Clock },
              { id: 'approved_by_me', label: 'Approved', icon: CheckSquare },
            ]
          }
        ];
      case 'reviewer':
        return [
          ...commonTop,
          { id: 'create_task', label: 'Create Task', icon: CheckSquare },
          {
            id: 'task_center', label: 'All Tasks', icon: FileText,
            children: [
              { id: 'all_tasks', label: 'All Tasks', icon: FileText },
              { id: 'review_queue', label: 'Needs Full Review', icon: Clock },
              { id: 'quick_look_queue', label: 'Needs Quick Look', icon: Clock },
              { id: 'ad_queue', label: 'Needs Marwa Action', icon: FileText },
              { id: 'approved_by_me', label: 'Approved', icon: CheckSquare },
              { id: 'rejected_reopened', label: 'Rejected', icon: FileText },
            ]
          }
        ];
      case 'art_director':
        return [
          ...commonTop,
          {
            id: 'task_center', label: 'All Tasks', icon: FileText,
            children: [
              { id: 'all_tasks', label: 'All Tasks', icon: FileText },
              { id: 'ad_queue', label: 'Needs Your Action', icon: Clock },
              { id: 'approved_by_me', label: 'Approved', icon: CheckSquare },
              { id: 'rejected_reopened', label: 'Rejected', icon: FileText },
            ]
          }
        ];
      case 'team_leader':
        return [
          ...commonTop,
          {
            id: 'task_center', label: 'All Tasks', icon: FileText,
            children: [
              { id: 'all_tasks', label: 'All Tasks', icon: FileText },
              { id: 'waiting_for_mina', label: 'Waiting for Mina', icon: Clock },
              { id: 'waiting_for_marwa', label: 'Waiting for Marwa', icon: FileText },
              { id: 'rejected_reopened', label: 'Rejected', icon: FileText },
              { id: 'approved_by_me', label: 'Approved', icon: CheckSquare },
            ]
          }
        ];
      case 'admin':
        return [];
      default:
        return [];
    }
  };

  const menu = getMenuForRole();
  const taskViews = new Set([
    'all_tasks',
    'my_tasks',
    'review_queue',
    'quick_look_queue',
    'ad_queue',
    'due_today',
    'due_this_week',
    'waiting_for_mina',
    'waiting_for_marwa',
    'approved_by_me',
    'rejected_reopened'
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
    return (
      <button
        key={item.id}
        onClick={() => handleNavigate(item.id)}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors",
          isActive 
            ? "bg-white/10 text-white border border-white/10 shadow-sm" 
            : "text-slate-400 hover:bg-white/5 hover:text-white"
        )}
        style={{ paddingLeft: `${16 + depth * 12}px` }}
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
        
        <div className="p-5 md:p-6 border-t border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-200 border-2 border-white/20 overflow-hidden flex items-center justify-center text-indigo-900 font-bold uppercase shrink-0">
              {currentUser.avatar ? <img src={currentUser.avatar} alt="avatar" className="w-full h-full object-cover" /> : currentUser.name.charAt(0)}
            </div>
            <div className="text-left flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{currentUser.name}</p>
              <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{currentUser.jobTitle || userRoleLabels[currentUser.role]}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
