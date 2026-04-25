import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Role, Environment, Task, TaskStatus, Priority, TaskType, Notification } from './types';
import { initialUsers, initialTasks } from './mockData';
import { loadAppState, saveAppState } from './localDb';
import { isSupabaseConfigured } from './supabaseClient';
import {
  fetchSupabaseNotifications,
  fetchSupabaseTasks,
  upsertSupabaseNotifications,
  upsertSupabaseTask,
} from './supabaseDb';

const MINA_ID = 'user_1';
const MARWA_ID = 'user_2';
const DINA_ID = 'user_3';

function reviveTaskFiles(tasks: Task[]): Task[] {
  return tasks.map(task => {
    const versions = task.versions.map(version => {
      const files = version.files?.map(file => ({
        ...file,
        url: file.blob ? URL.createObjectURL(file.blob) : file.url,
      }));

      return {
        ...version,
        files,
        fileUrl: files?.[0]?.url || version.fileUrl,
      };
    });
    const thumbnailFile = versions[0]?.files?.find(file => file.type.startsWith('image/'));

    return {
      ...task,
      versions,
      thumbnailUrl: thumbnailFile?.url || task.thumbnailUrl,
    };
  });
}

interface AppState {
  currentUser: User;
  environment: Environment;
  tasks: Task[];
  users: Record<string, User>;
  notifications: Notification[];
}

interface AppContextType extends AppState {
  setCurrentUser: (user: User) => void;
  setEnvironment: (env: Environment) => void;
  updateTaskStatus: (taskId: string, newStatus: TaskStatus, newOwnerRole: Role | null) => void;
  updateTaskPriority: (taskId: string, priority: Priority, deadline: string | null) => void;
  addTask: (task: Task) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void;
  markNotificationAsRead: (id: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const hasLoadedPersistedState = useRef(false);
  const usersObj = initialUsers.reduce((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {} as Record<string, User>);

  const [currentUser, setCurrentUser] = useState<User>(initialUsers.find(u => u.role === 'reviewer') || initialUsers[0]);
  const [environment, setEnvironment] = useState<Environment>('production');
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    let isMounted = true;

    const loadState = isSupabaseConfigured
      ? Promise.all([fetchSupabaseTasks(), fetchSupabaseNotifications()]).then(([loadedTasks, loadedNotifications]) => ({
          tasks: loadedTasks,
          notifications: loadedNotifications,
        }))
      : loadAppState();

    loadState
      .then(state => {
        if (!isMounted) return;
        if (state) {
          setTasks(reviveTaskFiles(state.tasks));
          setNotifications(state.notifications);
        }
      })
      .catch(error => {
        console.error('Failed to load persisted app state', error);
      })
      .finally(() => {
        if (isMounted) hasLoadedPersistedState.current = true;
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistedState.current) return;

    const saveState = isSupabaseConfigured
      ? Promise.all([
          ...tasks.map(task => upsertSupabaseTask(task)),
          upsertSupabaseNotifications(notifications),
        ])
      : saveAppState({ tasks, notifications });

    saveState.catch(error => {
      console.error('Failed to save app state', error);
    });
  }, [tasks, notifications]);

  const addNotification = (notif: Omit<Notification, 'id' | 'createdAt' | 'read'>) => {
    setNotifications(prev => [{
      ...notif,
      id: Math.random().toString(36).substring(7),
      createdAt: new Date().toISOString(),
      read: false
    }, ...prev]);
  };

  const addNotifications = (userIds: string[], taskId: string, message: string) => {
    Array.from(new Set(userIds)).forEach(userId => {
      addNotification({ userId, taskId, message });
    });
  };

  const markNotificationAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const updateTaskStatus = (taskId: string, newStatus: TaskStatus, newOwnerRole: Role | null) => {
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
      const task = tasks[taskIndex];
      if (newStatus === 'approved_by_art_director' && task.status !== newStatus) {
        addNotifications([DINA_ID, MINA_ID, task.createdBy], taskId, `Marwa approved "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_reviewer' && task.status !== newStatus) {
        addNotifications([MARWA_ID, DINA_ID], taskId, `Mina requested changes on "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_art_director' && task.status !== newStatus) {
        addNotifications([DINA_ID, MINA_ID, task.createdBy], taskId, `Marwa rejected "${task.name}" and requested changes.`);
      } else if ((newStatus === 'reviewer_approved' || newStatus === 'sent_to_art_director') && task.status !== newStatus) {
        addNotifications([MARWA_ID, DINA_ID], taskId, `Mina sent "${task.name}" to Marwa for approval.`);
      }
    }

    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, status: newStatus, currentOwnerRole: newOwnerRole, updatedAt: new Date().toISOString() };
      }
      return t;
    }));
  };

  const updateTaskPriority = (taskId: string, priority: Priority, deadline: string | null) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, priority, deadlineText: deadline, updatedAt: new Date().toISOString() };
      }
      return t;
    }));
  };

  const addTask = (task: Task) => {
    setTasks(prev => [task, ...prev]);
  };

  return (
    <AppContext.Provider value={{
      currentUser,
      environment,
      tasks,
      users: usersObj,
      notifications,
      setCurrentUser,
      setEnvironment,
      updateTaskStatus,
      updateTaskPriority,
      addTask,
      addNotification,
      markNotificationAsRead,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppStore() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppStore must be used within AppProvider');
  return ctx;
}
