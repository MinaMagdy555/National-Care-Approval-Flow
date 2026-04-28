import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Role, Environment, Task, TaskStatus, Priority, TaskType, Notification, TaskComment, TaskVersion } from './types';
import { initialUsers, initialTasks } from './mockData';
import { clearAppState, loadAppState, saveAppState } from './localDb';
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
const REVIEWER_WAITING_STATUSES: TaskStatus[] = ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'];

function normalizeMinaCreatedTask(task: Task): Task {
  if (task.createdBy !== MINA_ID || !REVIEWER_WAITING_STATUSES.includes(task.status)) {
    return task;
  }

  return {
    ...task,
    handledBy: Array.from(new Set([...task.handledBy, MARWA_ID])),
    reviewMode: 'direct_to_ad',
    status: 'sent_to_art_director',
    currentOwnerRole: 'art_director',
    currentOwnerUserId: null,
  };
}

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

    return normalizeMinaCreatedTask({
      ...task,
      versions,
      thumbnailUrl: thumbnailFile?.url || task.thumbnailUrl,
    });
  });
}

interface AppState {
  currentUser: User;
  environment: Environment;
  tasks: Task[];
  users: Record<string, User>;
  notifications: Notification[];
  persistenceMode: 'supabase' | 'local';
  persistenceError: string | null;
  localMigrationCount: number;
  isMigratingLocalData: boolean;
}

interface AppContextType extends AppState {
  setCurrentUser: (user: User) => void;
  setEnvironment: (env: Environment) => void;
  updateTaskStatus: (taskId: string, newStatus: TaskStatus, newOwnerRole: Role | null) => void;
  updateTaskPriority: (taskId: string, priority: Priority, deadline: string | null) => void;
  addTaskComment: (taskId: string, comment: Omit<TaskComment, 'id' | 'createdAt'>) => void;
  addTaskVersion: (taskId: string, version: TaskVersion) => void;
  addTask: (task: Task) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void;
  markNotificationAsRead: (id: string) => void;
  migrateLocalDataToSupabase: () => Promise<void>;
  dismissLocalMigration: () => void;
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
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [localMigrationState, setLocalMigrationState] = useState<{ tasks: Task[]; notifications: Notification[] } | null>(null);
  const [isMigratingLocalData, setIsMigratingLocalData] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadState = isSupabaseConfigured
      ? Promise.all([fetchSupabaseTasks(), fetchSupabaseNotifications(), loadAppState()]).then(([loadedTasks, loadedNotifications, localState]) => {
          if (localState) {
            const supabaseTaskIds = new Set(loadedTasks.map(task => task.id));
            const supabaseNotificationIds = new Set(loadedNotifications.map(notification => notification.id));
            const localOnlyTasks = localState.tasks.filter(task => !supabaseTaskIds.has(task.id));
            const localOnlyNotifications = localState.notifications.filter(notification => !supabaseNotificationIds.has(notification.id));

            if (localOnlyTasks.length > 0 || localOnlyNotifications.length > 0) {
              setLocalMigrationState({
                tasks: reviveTaskFiles(localOnlyTasks),
                notifications: localOnlyNotifications,
              });
            }
          }

          return {
            tasks: loadedTasks,
            notifications: loadedNotifications,
          };
        })
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
        setPersistenceError(error instanceof Error ? error.message : 'Failed to load persisted app state.');
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

    saveState
      .then(() => {
        setPersistenceError(null);
      })
      .catch(error => {
        console.error('Failed to save app state', error);
        setPersistenceError(error instanceof Error ? error.message : 'Failed to save app state.');
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

  const migrateLocalDataToSupabase = async () => {
    if (!isSupabaseConfigured || !localMigrationState || isMigratingLocalData) return;

    setIsMigratingLocalData(true);
    setPersistenceError(null);

    try {
      await Promise.all([
        ...localMigrationState.tasks.map(task => upsertSupabaseTask(task)),
        upsertSupabaseNotifications(localMigrationState.notifications),
      ]);

      setTasks(prev => {
        const existingIds = new Set(prev.map(task => task.id));
        return [...localMigrationState.tasks.filter(task => !existingIds.has(task.id)), ...prev];
      });
      setNotifications(prev => {
        const existingIds = new Set(prev.map(notification => notification.id));
        return [...localMigrationState.notifications.filter(notification => !existingIds.has(notification.id)), ...prev];
      });
      setLocalMigrationState(null);
      await clearAppState();
    } catch (error) {
      console.error('Failed to migrate local data to Supabase', error);
      setPersistenceError(error instanceof Error ? error.message : 'Failed to migrate local data.');
    } finally {
      setIsMigratingLocalData(false);
    }
  };

  const dismissLocalMigration = () => {
    setLocalMigrationState(null);
  };

  const updateTaskStatus = (taskId: string, newStatus: TaskStatus, newOwnerRole: Role | null) => {
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
      const task = tasks[taskIndex];
      if (newStatus === 'approved_by_art_director' && task.status !== newStatus) {
        addNotifications([DINA_ID, MINA_ID, task.createdBy], taskId, `Marwa approved "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_reviewer' && task.status !== newStatus) {
        addNotifications([MARWA_ID, DINA_ID, task.createdBy], taskId, `Mina requested changes on "${task.name}".`);
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
    setTasks(prev => [normalizeMinaCreatedTask(task), ...prev]);
  };

  const addTaskVersion = (taskId: string, version: TaskVersion) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const sendToMarwa = task.createdBy === MINA_ID || task.status === 'changes_requested_by_art_director' || task.reviewMode === 'direct_to_ad';
    const nextStatus: TaskStatus = sendToMarwa
      ? 'sent_to_art_director'
      : task.reviewMode === 'quick_look'
        ? 'waiting_reviewer_quick_look'
        : 'waiting_reviewer_full_review';
    const nextOwnerRole: Role = sendToMarwa ? 'art_director' : 'reviewer';
    const nextHandlerId = sendToMarwa ? MARWA_ID : MINA_ID;
    const creatorName = usersObj[task.createdBy]?.name || 'Someone';
    const recipients = (sendToMarwa ? [MARWA_ID, DINA_ID, MINA_ID] : [MINA_ID, DINA_ID]).filter(userId => userId !== task.createdBy);

    addNotifications(recipients, taskId, `${creatorName} uploaded V${version.versionNumber} for "${task.name}".`);

    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;

      const thumbnailFile = version.files?.find(file => file.type.startsWith('image/'));

      return {
        ...t,
        versions: [version, ...t.versions],
        handledBy: Array.from(new Set([...t.handledBy, version.submittedBy, nextHandlerId])),
        status: nextStatus,
        currentOwnerRole: nextOwnerRole,
        currentOwnerUserId: null,
        thumbnailUrl: thumbnailFile?.url || '',
        updatedAt: new Date().toISOString(),
      };
    }));
  };

  const addTaskComment = (taskId: string, comment: Omit<TaskComment, 'id' | 'createdAt'>) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;

      const newComment: TaskComment = {
        ...comment,
        id: Math.random().toString(36).substring(7),
        createdAt: new Date().toISOString(),
      };

      return {
        ...task,
        comments: [...(task.comments || []), newComment],
        updatedAt: new Date().toISOString(),
      };
    }));
  };

  return (
    <AppContext.Provider value={{
      currentUser,
      environment,
      tasks,
      users: usersObj,
      notifications,
      persistenceMode: isSupabaseConfigured ? 'supabase' : 'local',
      persistenceError,
      localMigrationCount: (localMigrationState?.tasks.length || 0) + (localMigrationState?.notifications.length || 0),
      isMigratingLocalData,
      setCurrentUser,
      setEnvironment,
      updateTaskStatus,
      updateTaskPriority,
      addTaskComment,
      addTaskVersion,
      addTask,
      addNotification,
      markNotificationAsRead,
      migrateLocalDataToSupabase,
      dismissLocalMigration,
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
