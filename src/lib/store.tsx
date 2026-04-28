import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Role, Environment, Task, TaskStatus, Priority, TaskType, Notification, TaskComment, TaskVersion, UploadedTaskFile } from './types';
import { initialUsers, initialTasks } from './mockData';
import { clearAppState, loadAppState, saveAppState } from './localDb';
import { shouldAutoArchiveTask } from './archiveUtils';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import {
  fetchSupabaseNotifications,
  fetchSupabaseTasks,
  uploadTaskFiles,
  upsertSupabaseNotifications,
  upsertSupabaseTask,
} from './supabaseDb';

const MINA_ID = 'user_1';
const MARWA_ID = 'user_2';
const DINA_ID = 'user_3';
const REVIEWER_WAITING_STATUSES: TaskStatus[] = ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'];
const CURRENT_USER_STORAGE_KEY = 'national-care-current-user-id';
const REGISTERED_USERS_STORAGE_KEY = 'national-care-registered-users';
const REGISTERED_PASSWORDS_STORAGE_KEY = 'national-care-registered-passwords';
const PROFILE_PASSWORDS: Record<string, string> = {
  user_1: '1',
  user_3: '2',
  user_2: '3',
  user_4: '4',
  user_5: '5',
  user_6: '6',
};

type StoredUser = User & { password?: string };

function getStoredUsers(): StoredUser[] {
  if (typeof window === 'undefined') return [];

  try {
    const users = JSON.parse(window.localStorage.getItem(REGISTERED_USERS_STORAGE_KEY) || '[]') as unknown;
    return Array.isArray(users) ? users.filter(user => user && typeof user === 'object' && 'id' in user && 'name' in user) as StoredUser[] : [];
  } catch {
    return [];
  }
}

function getStoredPasswords(): Record<string, string> {
  if (typeof window === 'undefined') return {};

  try {
    const passwords = JSON.parse(window.localStorage.getItem(REGISTERED_PASSWORDS_STORAGE_KEY) || '{}') as unknown;
    return passwords && typeof passwords === 'object' && !Array.isArray(passwords) ? passwords as Record<string, string> : {};
  } catch {
    return {};
  }
}

function saveRegisteredProfiles(users: User[], passwords: Record<string, string>) {
  window.localStorage.setItem(REGISTERED_USERS_STORAGE_KEY, JSON.stringify(users));
  window.localStorage.setItem(REGISTERED_PASSWORDS_STORAGE_KEY, JSON.stringify(passwords));
}

function getAllInitialUsers() {
  return [...initialUsers, ...getStoredUsers().map(({ password, ...user }) => user)];
}

function getInitialCurrentUser() {
  const storedUserId = typeof window !== 'undefined' ? window.localStorage.getItem(CURRENT_USER_STORAGE_KEY) : null;
  const users = getAllInitialUsers();
  return users.find(user => user.id === storedUserId) || users.find(u => u.role === 'reviewer') || users[0];
}

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

function coerceTask(task: Partial<Task> & { id?: string }): Task | null {
  if (!task || !task.id) return null;

  const now = new Date().toISOString();
  const versions = Array.isArray(task.versions) ? task.versions : [];

  return {
    id: task.id,
    code: task.code || `TSK-${task.id}`,
    name: task.name || 'Untitled task',
    taskType: task.taskType || 'others',
    reviewMode: task.reviewMode || 'full_review',
    environment: task.environment || 'production',
    createdBy: task.createdBy || MINA_ID,
    handledBy: Array.isArray(task.handledBy) ? task.handledBy : [task.createdBy || MINA_ID],
    status: task.status || 'submitted',
    currentOwnerRole: task.currentOwnerRole ?? null,
    currentOwnerUserId: task.currentOwnerUserId ?? null,
    priority: task.priority || 'not_set',
    deadlineText: task.deadlineText ?? null,
    versions,
    comments: Array.isArray(task.comments) ? task.comments : [],
    thumbnailUrl: task.thumbnailUrl || '',
    archivedAt: task.archivedAt ?? null,
    archivedReason: task.archivedReason ?? null,
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || task.createdAt || now,
  };
}

function reviveTaskFiles(tasks: Task[]): Task[] {
  return tasks.map(task => coerceTask(task)).filter(Boolean).map(task => {
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
  }) as Task[];
}

async function uploadMigratedTaskFiles(task: Task): Promise<Task> {
  const versions = await Promise.all(task.versions.map(async version => {
    if (!version.files || version.files.length === 0) return version;

    const uploadedFiles = await uploadTaskFiles(task.id, version.files);

    return {
      ...version,
      files: uploadedFiles,
      fileUrl: uploadedFiles[0]?.url || version.fileUrl,
    };
  }));
  const newestImageFile = versions[0]?.files?.find(file => file.type.startsWith('image/'));

  return {
    ...task,
    versions,
    thumbnailUrl: newestImageFile?.url || task.thumbnailUrl,
  };
}

interface AppState {
  currentUser: User;
  environment: Environment;
  tasks: Task[];
  users: Record<string, User>;
  userList: User[];
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
  replaceTaskVersionFiles: (taskId: string, versionId: string, files: UploadedTaskFile[]) => void;
  addTask: (task: Task) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void;
  markNotificationAsRead: (id: string) => void;
  loginWithPassword: (userId: string, password: string) => boolean;
  logout: () => void;
  registerProfile: (name: string, password: string, role: Role) => boolean;
  deleteCurrentProfile: () => boolean;
  archiveTask: (taskId: string, reason?: string) => void;
  unarchiveTask: (taskId: string) => void;
  migrateLocalDataToSupabase: () => Promise<void>;
  dismissLocalMigration: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const hasLoadedPersistedState = useRef(false);
  const [userList, setUserList] = useState<User[]>(getAllInitialUsers);
  const usersObj = userList.reduce((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {} as Record<string, User>);

  const [currentUserState, setCurrentUserState] = useState<User>(getInitialCurrentUser);
  const [environment, setEnvironment] = useState<Environment>('production');
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [localMigrationState, setLocalMigrationState] = useState<{ tasks: Task[]; notifications: Notification[] } | null>(null);
  const [isMigratingLocalData, setIsMigratingLocalData] = useState(false);
  const currentUser = currentUserState;

  const setCurrentUser = (user: User) => {
    setCurrentUserState(user);
    window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, user.id);
  };

  useEffect(() => {
    if (!hasLoadedPersistedState.current || !isSupabaseConfigured) return;

    const autoArchiveTasks = tasks.filter(task => shouldAutoArchiveTask(task));
    if (autoArchiveTasks.length === 0) return;

    setTasks(prev => prev.map(task => (
      autoArchiveTasks.some(item => item.id === task.id)
        ? {
            ...task,
            archivedAt: new Date().toISOString(),
            archivedReason: 'Auto archived after 3 months of inactivity',
            updatedAt: new Date().toISOString(),
          }
        : task
    )));
  }, [tasks]);

  useEffect(() => {
    let isMounted = true;

    const loadState = isSupabaseConfigured
      ? Promise.all([fetchSupabaseTasks(), fetchSupabaseNotifications(), loadAppState()]).then(([loadedTasks, loadedNotifications, localState]) => {
          if (localState) {
            const localTasks = Array.isArray(localState.tasks) ? reviveTaskFiles(localState.tasks) : [];
            const localNotifications = Array.isArray(localState.notifications) ? localState.notifications : [];
            const supabaseTaskIds = new Set(loadedTasks.map(task => task.id));
            const supabaseNotificationIds = new Set(loadedNotifications.map(notification => notification.id));
            const localOnlyTasks = localTasks.filter(task => !supabaseTaskIds.has(task.id));
            const localOnlyNotifications = localNotifications.filter(notification => notification?.id && !supabaseNotificationIds.has(notification.id));

            if (localOnlyTasks.length > 0 || localOnlyNotifications.length > 0) {
              setLocalMigrationState({
                tasks: localOnlyTasks,
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
          setTasks(reviveTaskFiles(Array.isArray(state.tasks) ? state.tasks : []));
          setNotifications(Array.isArray(state.notifications) ? state.notifications.filter(notification => notification?.id) : []);
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

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    const channel = supabase
      .channel('approval-flow-shared-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_tasks' }, payload => {
        const row = payload.new as { payload?: Task } | null;
        const task = row?.payload;
        if (!task) return;

        setTasks(prev => {
          const exists = prev.some(item => item.id === task.id);
          const revivedTask = reviveTaskFiles([task])[0];
          if (exists && prev.some(item => item.id === task.id && item.updatedAt === task.updatedAt)) return prev;
          return exists
            ? prev.map(item => item.id === task.id ? revivedTask : item)
            : [revivedTask, ...prev];
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_notifications' }, payload => {
        const row = payload.new as { payload?: Notification } | null;
        const notification = row?.payload;
        if (!notification) return;

        setNotifications(prev => {
          const exists = prev.some(item => item.id === notification.id);
          if (exists && prev.some(item => item.id === notification.id && item.read === notification.read)) return prev;
          return exists
            ? prev.map(item => item.id === notification.id ? notification : item)
            : [notification, ...prev];
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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

  const loginWithPassword = (userId: string, password: string) => {
    const storedPasswords = getStoredPasswords();
    if ((PROFILE_PASSWORDS[userId] || storedPasswords[userId]) !== password.trim()) return false;

    const user = userList.find(item => item.id === userId);
    if (!user) return false;

    setCurrentUser(user);
    return true;
  };

  const logout = () => {
    window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    setCurrentUserState(userList.find(u => u.role === 'reviewer') || userList[0]);
  };

  const registerProfile = (name: string, password: string, role: Role) => {
    const trimmedName = name.trim();
    const trimmedPassword = password.trim();
    if (!trimmedName || !trimmedPassword) return false;

    const newUser: User = {
      id: `custom_${Date.now()}`,
      name: trimmedName,
      role,
      jobTitle: role === 'team_member' ? 'Team Member' : role.replaceAll('_', ' '),
    };
    const nextUserList = [...userList, newUser];
    const nextPasswords = { ...getStoredPasswords(), [newUser.id]: trimmedPassword };

    setUserList(nextUserList);
    saveRegisteredProfiles(nextUserList.filter(user => user.id.startsWith('custom_')), nextPasswords);
    setCurrentUser(newUser);
    return true;
  };

  const deleteCurrentProfile = () => {
    if (!currentUser.id.startsWith('custom_')) return false;

    const nextUserList = userList.filter(user => user.id !== currentUser.id);
    const nextPasswords = getStoredPasswords();
    delete nextPasswords[currentUser.id];

    setUserList(nextUserList);
    saveRegisteredProfiles(nextUserList.filter(user => user.id.startsWith('custom_')), nextPasswords);
    window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    setCurrentUserState(nextUserList.find(u => u.role === 'reviewer') || nextUserList[0]);
    return true;
  };

  const archiveTask = (taskId: string, reason = 'Archived manually') => {
    setTasks(prev => prev.map(task => task.id === taskId
      ? { ...task, archivedAt: new Date().toISOString(), archivedReason: reason, updatedAt: new Date().toISOString() }
      : task
    ));
  };

  const unarchiveTask = (taskId: string) => {
    setTasks(prev => prev.map(task => task.id === taskId
      ? { ...task, archivedAt: null, archivedReason: null, updatedAt: new Date().toISOString() }
      : task
    ));
  };

  const migrateLocalDataToSupabase = async () => {
    if (!isSupabaseConfigured || !localMigrationState || isMigratingLocalData) return;

    setIsMigratingLocalData(true);
    setPersistenceError(null);

    try {
      const uploadedTasks = await Promise.all(localMigrationState.tasks.map(uploadMigratedTaskFiles));

      await Promise.all([
        ...uploadedTasks.map(task => upsertSupabaseTask(task)),
        upsertSupabaseNotifications(localMigrationState.notifications),
      ]);

      setTasks(prev => {
        const existingIds = new Set(prev.map(task => task.id));
        return [...uploadedTasks.filter(task => !existingIds.has(task.id)), ...prev];
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

  const replaceTaskVersionFiles = (taskId: string, versionId: string, files: UploadedTaskFile[]) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;

      const versions = task.versions.map(version => (
        version.id === versionId
          ? {
              ...version,
              files,
              fileUrl: files[0]?.url || version.fileUrl,
            }
          : version
      ));
      const thumbnailFile = versions[0]?.files?.find(file => file.type.startsWith('image/'));

      return {
        ...task,
        versions,
        thumbnailUrl: thumbnailFile?.url || task.thumbnailUrl,
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
      userList,
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
      replaceTaskVersionFiles,
      addTask,
      addNotification,
      markNotificationAsRead,
      loginWithPassword,
      logout,
      registerProfile,
      deleteCurrentProfile,
      archiveTask,
      unarchiveTask,
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
