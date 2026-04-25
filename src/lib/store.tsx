import React, { createContext, useContext, useState, ReactNode } from 'react';
import { User, Role, Environment, Task, TaskStatus, Priority, TaskType, Notification } from './types';
import { initialUsers, initialTasks } from './mockData';

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
  const usersObj = initialUsers.reduce((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {} as Record<string, User>);

  const [currentUser, setCurrentUser] = useState<User>(initialUsers.find(u => u.role === 'reviewer') || initialUsers[0]);
  const [environment, setEnvironment] = useState<Environment>('production');
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = (notif: Omit<Notification, 'id' | 'createdAt' | 'read'>) => {
    setNotifications(prev => [{
      ...notif,
      id: Math.random().toString(36).substring(7),
      createdAt: new Date().toISOString(),
      read: false
    }, ...prev]);
  };

  const markNotificationAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const updateTaskStatus = (taskId: string, newStatus: TaskStatus, newOwnerRole: Role | null) => {
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
      const task = tasks[taskIndex];
      if (newStatus === 'approved_by_art_director' && task.status !== newStatus) {
        addNotification({ userId: task.createdBy, taskId, message: `Your task "${task.name}" was approved by Marwa!` });
      } else if (newStatus === 'changes_requested_by_reviewer' && task.status !== newStatus) {
        addNotification({ userId: task.createdBy, taskId, message: `Reviewer requested changes on your task "${task.name}".` });
      } else if (newStatus === 'changes_requested_by_art_director' && task.status !== newStatus) {
        addNotification({ userId: task.createdBy, taskId, message: `Marwa requested changes on your task "${task.name}".` });
      } else if ((newStatus === 'reviewer_approved' || newStatus === 'sent_to_art_director') && task.status !== newStatus) {
        // notify Marwa
        const ad = Object.values(usersObj).find(u => u.role === 'art_director');
        if (ad) addNotification({ userId: ad.id, taskId, message: `Task "${task.name}" needs your approval.` });
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
