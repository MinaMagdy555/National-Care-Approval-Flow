import React, { useState } from 'react';
import { useAppStore } from '../lib/store';
import { LayoutDashboard, CheckSquare, Clock, FileText, Inbox, Users, Settings, Bell, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { userRoleLabels } from '../lib/mockData';

type MenuItem = {
  id: string;
  label: string;
  icon: any;
  children?: MenuItem[];
};

export function Sidebar({ currentView, setView }: { currentView: string; setView: (v: string) => void }) {
  const { currentUser, notifications } = useAppStore();
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['all_tasks']);

  const unreadCount = notifications ? notifications.filter(n => !n.read).length : 0;

  const toggleGroup = (id: string, isParentNav: boolean = false) => {
    if (isParentNav) {
      if (!expandedGroups.includes(id)) {
         setExpandedGroups(prev => [...prev, id]);
      }
      setView(id);
    } else {
      setExpandedGroups(prev => 
        prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
      );
    }
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
            id: 'my_tasks', label: 'All Tasks', icon: FileText,
            children: [
              { id: 'my_tasks_sub', label: 'My Tasks', icon: FileText },
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
            id: 'all_tasks', label: 'All Tasks', icon: FileText,
            children: [
              { id: 'review_queue', label: 'Needs Your Action', icon: Clock },
              { id: 'ad_queue', label: 'Needs AD Action', icon: FileText },
              { id: 'approved_by_me', label: 'Approved', icon: CheckSquare },
              { id: 'rejected_reopened', label: 'Rejected', icon: FileText },
            ]
          }
        ];
      case 'art_director':
        return [
          ...commonTop,
          {
            id: 'all_tasks', label: 'All Tasks', icon: FileText,
            children: [
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
            id: 'all_tasks', label: 'All Tasks', icon: FileText,
            children: [
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

  const renderMenuItem = (item: MenuItem, depth = 0) => {
    if (item.children) {
      const isExpanded = expandedGroups.includes(item.id);
      const isParentActive = currentView === item.id;
      return (
        <div key={item.id} className="space-y-1">
          <button
            onClick={() => toggleGroup(item.id, true)}
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
            <div className="space-y-1">
              {item.children.map(child => renderMenuItem(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const isActive = item.id === currentView || (currentView === 'my_tasks' && item.id === 'my_tasks_sub');
    return (
      <button
        key={item.id}
        onClick={() => setView(item.id === 'my_tasks_sub' ? 'my_tasks' : item.id)}
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
    <aside className="w-64 bg-[#0f172a] text-white flex flex-col h-screen fixed left-0 top-0 z-20">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-lg text-white">N</div>
        <div className="flex flex-col">
          <span className="font-extrabold tracking-tight text-xl leading-none">National Care</span>
          <span className="font-light text-[10px] text-slate-400 mt-1 uppercase tracking-widest">Approval Flow</span>
        </div>
      </div>
      <nav className="flex-1 px-4 space-y-1 overflow-y-auto pt-2">
        {menu.map(item => renderMenuItem(item))}
      </nav>
      
      <div className="p-6 border-t border-white/10">
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
  );
}
