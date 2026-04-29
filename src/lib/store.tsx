import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Role, Environment, Task, TaskStatus, Priority, TaskType, Notification, TaskComment, TaskVersion, UploadedTaskFile } from './types';
import { initialUsers, initialTasks } from './mockData';
import { clearAppState, loadAppState, saveAppState } from './localDb';
import { shouldAutoArchiveTask } from './archiveUtils';
import { DINA_ID, MARWA_ID, MINA_ID, sanitizeHandledBy } from './handlerUtils';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import {
  fetchSupabaseNotifications,
  fetchSupabaseTasks,
  uploadTaskFiles,
  upsertSupabaseNotifications,
  upsertSupabaseTask,
} from './supabaseDb';
import { addLowResPreviewsToFiles } from './previewUtils';

const REVIEWER_WAITING_STATUSES: TaskStatus[] = ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look'];
const CURRENT_USER_STORAGE_KEY = 'national-care-current-user-id';
const REGISTERED_USERS_STORAGE_KEY = 'national-care-registered-users';
const REGISTERED_PASSWORDS_STORAGE_KEY = 'national-care-registered-passwords';
const SHARED_DATA_CHANNEL = 'approval-flow-shared-data';
const SHARED_DATA_EVENT = 'state-change';
const SHARED_DATA_POLL_INTERVAL_MS = 2500;
const PROFILE_PASSWORDS: Record<string, string> = {
  user_1: '1',
  user_3: '2',
  user_2: '3',
  user_4: '4',
  user_5: '5',
  user_6: '6',
};

type StoredUser = User & { password?: string };

type SharedDataPayload =
  | { type: 'task_upsert'; task: Task }
  | { type: 'notification_upsert'; notification: Notification };

type SharedDataMessage = SharedDataPayload & { originClientId: string };

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

function createClientId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function normalizeMinaCreatedTask(task: Task): Task {
  if (task.createdBy !== MINA_ID || !REVIEWER_WAITING_STATUSES.includes(task.status)) {
    return task;
  }

  return {
    ...task,
    handledBy: sanitizeHandledBy(task.handledBy),
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
    handledBy: sanitizeHandledBy(Array.isArray(task.handledBy) ? task.handledBy : [task.createdBy || MINA_ID]),
    status: task.status || 'submitted',
    currentOwnerRole: task.currentOwnerRole ?? null,
    currentOwnerUserId: task.currentOwnerUserId ?? null,
    priority: task.priority || 'not_set',
    deadlineText: task.deadlineText ?? null,
    versions,
    comments: Array.isArray(task.comments) ? task.comments : [],
    thumbnailUrl: task.thumbnailUrl || '',
    thumbnailStoragePath: task.thumbnailStoragePath,
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
    const thumbnailFile = versions[0]?.files?.find(file => file.previewUrl && file.previewStoragePath);

    return normalizeMinaCreatedTask({
      ...task,
      versions,
      thumbnailUrl: thumbnailFile?.previewUrl || task.thumbnailUrl,
      thumbnailStoragePath: thumbnailFile?.previewStoragePath || task.thumbnailStoragePath,
    });
  }) as Task[];
}

function sortTasksByUpdate(tasks: Task[]) {
  return [...tasks].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function sortNotificationsByCreatedAt(notifications: Notification[]) {
  return [...notifications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function taskSyncKey(task: Task) {
  const previewKey = task.versions
    .flatMap(version => version.files || [])
    .map(file => file.previewStoragePath || '')
    .join('|');
  const commentImageKey = (task.comments || [])
    .flatMap(comment => comment.sections)
    .map(section => section.imageStoragePath || '')
    .join('|');

  return `${task.id}:${task.updatedAt}:${task.status}:${task.archivedAt || ''}:${task.thumbnailStoragePath || ''}:${previewKey}:${commentImageKey}`;
}

function notificationSyncKey(notification: Notification) {
  return `${notification.id}:${notification.read ? 'read' : 'unread'}:${notification.message}:${notification.createdAt}`;
}

function mergeTaskIntoState(currentTasks: Task[], incomingTask: Task) {
  let changed = false;
  const nextTasks = currentTasks.map(task => {
    if (task.id !== incomingTask.id) return task;
    if (new Date(task.updatedAt).getTime() > new Date(incomingTask.updatedAt).getTime()) return task;
    if (taskSyncKey(task) === taskSyncKey(incomingTask)) return task;
    changed = true;
    return incomingTask;
  });

  if (!currentTasks.some(task => task.id === incomingTask.id)) {
    changed = true;
    nextTasks.unshift(incomingTask);
  }

  return changed ? sortTasksByUpdate(nextTasks) : currentTasks;
}

function mergeTasksIntoState(currentTasks: Task[], incomingTasks: Task[]) {
  return incomingTasks.reduce(mergeTaskIntoState, currentTasks);
}

function mergeNotificationIntoState(currentNotifications: Notification[], incomingNotification: Notification) {
  let changed = false;
  const nextNotifications = currentNotifications.map(notification => {
    if (notification.id !== incomingNotification.id) return notification;
    if (notification.read && !incomingNotification.read) return notification;
    if (notificationSyncKey(notification) === notificationSyncKey(incomingNotification)) return notification;
    changed = true;
    return incomingNotification;
  });

  if (!currentNotifications.some(notification => notification.id === incomingNotification.id)) {
    changed = true;
    nextNotifications.unshift(incomingNotification);
  }

  return changed ? sortNotificationsByCreatedAt(nextNotifications) : currentNotifications;
}

function mergeNotificationsIntoState(currentNotifications: Notification[], incomingNotifications: Notification[]) {
  return incomingNotifications.reduce(mergeNotificationIntoState, currentNotifications);
}

async function uploadMigratedTaskFiles(task: Task): Promise<Task> {
  const versions = await Promise.all(task.versions.map(async version => {
    if (!version.files || version.files.length === 0) return version;

    const uploadedFiles = await uploadTaskFiles(task.id, version.files);
    const previewedFiles = await addLowResPreviewsToFiles(task.id, uploadedFiles, version.files);

    return {
      ...version,
      files: previewedFiles,
      fileUrl: previewedFiles[0]?.url || version.fileUrl,
    };
  }));
  const newestPreviewFile = versions[0]?.files?.find(file => file.previewUrl && file.previewStoragePath);

  return {
    ...task,
    versions,
    thumbnailUrl: newestPreviewFile?.previewUrl || task.thumbnailUrl,
    thumbnailStoragePath: newestPreviewFile?.previewStoragePath || task.thumbnailStoragePath,
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
  updateTaskMediaPreviews: (taskId: string, updates: { versions: TaskVersion[]; comments?: TaskComment[]; thumbnailUrl: string; thumbnailStoragePath?: string }) => void;
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
  const clientIdRef = useRef(createClientId());
  const sharedDataChannelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const isSharedDataChannelReadyRef = useRef(false);
  const pendingTaskBroadcastIdsRef = useRef<Set<string>>(new Set());
  const pendingNotificationBroadcastIdsRef = useRef<Set<string>>(new Set());
  const queuedSharedDataMessagesRef = useRef<SharedDataMessage[]>([]);
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

  const sendSharedDataMessage = (message: SharedDataPayload) => {
    if (!isSupabaseConfigured || !supabase) return;

    const sharedMessage = {
      ...message,
      originClientId: clientIdRef.current,
    } as SharedDataMessage;

    if (!isSharedDataChannelReadyRef.current || !sharedDataChannelRef.current) {
      queuedSharedDataMessagesRef.current.push(sharedMessage);
      return;
    }

    void sharedDataChannelRef.current
      .send({
        type: 'broadcast',
        event: SHARED_DATA_EVENT,
        payload: sharedMessage,
      })
      .catch(error => {
        console.error('Failed to broadcast shared data change', error);
      });
  };

  const flushQueuedSharedDataMessages = () => {
    if (!isSharedDataChannelReadyRef.current || !sharedDataChannelRef.current) return;

    const queuedMessages = queuedSharedDataMessagesRef.current.splice(0);
    queuedMessages.forEach(message => {
      void sharedDataChannelRef.current
        ?.send({
          type: 'broadcast',
          event: SHARED_DATA_EVENT,
          payload: message,
        })
        .catch(error => {
          console.error('Failed to broadcast queued shared data change', error);
        });
    });
  };

  const queueTaskBroadcast = (taskId: string) => {
    pendingTaskBroadcastIdsRef.current.add(taskId);
  };

  const queueNotificationBroadcast = (notificationId: string) => {
    pendingNotificationBroadcastIdsRef.current.add(notificationId);
  };

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

    const pendingTaskIds = Array.from(pendingTaskBroadcastIdsRef.current);
    const pendingNotificationIds = Array.from(pendingNotificationBroadcastIdsRef.current);
    pendingTaskBroadcastIdsRef.current.clear();
    pendingNotificationBroadcastIdsRef.current.clear();

    pendingTaskIds.forEach(taskId => {
      const task = tasks.find(item => item.id === taskId);
      if (task) sendSharedDataMessage({ type: 'task_upsert', task });
    });
    pendingNotificationIds.forEach(notificationId => {
      const notification = notifications.find(item => item.id === notificationId);
      if (notification) sendSharedDataMessage({ type: 'notification_upsert', notification });
    });

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
      .channel(SHARED_DATA_CHANNEL, {
        config: {
          broadcast: { ack: true, self: false },
        },
      })
      .on('broadcast', { event: SHARED_DATA_EVENT }, payload => {
        const message = payload.payload as SharedDataMessage | undefined;
        if (!message || message.originClientId === clientIdRef.current) return;

        if (message.type === 'task_upsert') {
          const revivedTask = reviveTaskFiles([message.task])[0];
          if (revivedTask) {
            setTasks(prev => mergeTaskIntoState(prev, revivedTask));
          }
          return;
        }

        if (message.type === 'notification_upsert') {
          setNotifications(prev => mergeNotificationIntoState(prev, message.notification));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_tasks' }, payload => {
        const row = payload.new as { payload?: Task } | null;
        const task = row?.payload;
        if (!task) return;

        setTasks(prev => {
          const revivedTask = reviveTaskFiles([task])[0];
          return revivedTask ? mergeTaskIntoState(prev, revivedTask) : prev;
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_notifications' }, payload => {
        const row = payload.new as { payload?: Notification } | null;
        const notification = row?.payload;
        if (!notification) return;

        setNotifications(prev => mergeNotificationIntoState(prev, notification));
      })
      .subscribe(status => {
        isSharedDataChannelReadyRef.current = status === 'SUBSCRIBED';
        if (status === 'SUBSCRIBED') {
          flushQueuedSharedDataMessages();
        }
      });

    sharedDataChannelRef.current = channel;

    return () => {
      isSharedDataChannelReadyRef.current = false;
      sharedDataChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let isMounted = true;
    let isPolling = false;

    const syncLatestSharedData = async () => {
      if (!hasLoadedPersistedState.current || isPolling) return;

      isPolling = true;
      try {
        const [latestTasks, latestNotifications] = await Promise.all([
          fetchSupabaseTasks(),
          fetchSupabaseNotifications(),
        ]);

        if (!isMounted) return;

        setTasks(prev => mergeTasksIntoState(prev, reviveTaskFiles(latestTasks)));
        setNotifications(prev => mergeNotificationsIntoState(prev, latestNotifications.filter(notification => notification?.id)));
        setPersistenceError(null);
      } catch (error) {
        console.error('Failed to sync latest shared data', error);
        if (isMounted) {
          setPersistenceError(error instanceof Error ? error.message : 'Failed to sync latest shared data.');
        }
      } finally {
        isPolling = false;
      }
    };

    const intervalId = window.setInterval(syncLatestSharedData, SHARED_DATA_POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void syncLatestSharedData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const addNotification = (notif: Omit<Notification, 'id' | 'createdAt' | 'read'>) => {
    const notification: Notification = {
      ...notif,
      id: Math.random().toString(36).substring(7),
      createdAt: new Date().toISOString(),
      read: false
    };

    queueNotificationBroadcast(notification.id);
    setNotifications(prev => [notification, ...prev]);
  };

  const addNotifications = (userIds: string[], taskId: string, message: string) => {
    Array.from(new Set(userIds)).forEach(userId => {
      addNotification({ userId, taskId, message });
    });
  };

  const markNotificationAsRead = (id: string) => {
    const notification = notifications.find(item => item.id === id);
    if (!notification || notification.read) return;

    queueNotificationBroadcast(id);
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
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(task => task.id === taskId
      ? { ...task, archivedAt: new Date().toISOString(), archivedReason: reason, updatedAt: new Date().toISOString() }
      : task
    ));
  };

  const unarchiveTask = (taskId: string) => {
    queueTaskBroadcast(taskId);
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
        addNotifications([MARWA_ID, DINA_ID, MINA_ID, task.createdBy, ...task.handledBy], taskId, `Marwa approved "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_reviewer' && task.status !== newStatus) {
        addNotifications([MARWA_ID, DINA_ID, task.createdBy], taskId, `Mina requested changes on "${task.name}".`);
      } else if (newStatus === 'changes_requested_by_art_director' && task.status !== newStatus) {
        addNotifications([DINA_ID, MINA_ID, task.createdBy], taskId, `Marwa rejected "${task.name}" and requested changes.`);
      } else if ((newStatus === 'reviewer_approved' || newStatus === 'sent_to_art_director') && task.status !== newStatus) {
        addNotifications([MARWA_ID, DINA_ID], taskId, `Mina sent "${task.name}" to Marwa for approval.`);
      }
    }

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, status: newStatus, currentOwnerRole: newOwnerRole, updatedAt: new Date().toISOString() };
      }
      return t;
    }));
  };

  const updateTaskPriority = (taskId: string, priority: Priority, deadline: string | null) => {
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, priority, deadlineText: deadline, updatedAt: new Date().toISOString() };
      }
      return t;
    }));
  };

  const addTask = (task: Task) => {
    const normalizedTask = normalizeMinaCreatedTask(task);
    queueTaskBroadcast(normalizedTask.id);
    setTasks(prev => [normalizedTask, ...prev]);
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
    const creatorName = usersObj[task.createdBy]?.name || 'Someone';
    const recipients = (sendToMarwa ? [MARWA_ID, DINA_ID, MINA_ID] : [MINA_ID, DINA_ID]).filter(userId => userId !== task.createdBy);

    addNotifications(recipients, taskId, `${creatorName} uploaded V${version.versionNumber} for "${task.name}".`);

    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;

      const thumbnailFile = version.files?.find(file => file.type.startsWith('image/'));
      const previewFile = version.files?.find(file => file.previewUrl && file.previewStoragePath);

      return {
        ...t,
        versions: [version, ...t.versions],
        handledBy: sanitizeHandledBy([...t.handledBy, version.submittedBy]),
        status: nextStatus,
        currentOwnerRole: nextOwnerRole,
        currentOwnerUserId: null,
        thumbnailUrl: previewFile?.previewUrl || thumbnailFile?.previewUrl || '',
        thumbnailStoragePath: previewFile?.previewStoragePath || thumbnailFile?.previewStoragePath,
        updatedAt: new Date().toISOString(),
      };
    }));
  };

  const replaceTaskVersionFiles = (taskId: string, versionId: string, files: UploadedTaskFile[]) => {
    queueTaskBroadcast(taskId);
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
      const thumbnailFile = versions[0]?.files?.find(file => file.previewUrl && file.previewStoragePath);

      return {
        ...task,
        versions,
        thumbnailUrl: thumbnailFile?.previewUrl || task.thumbnailUrl,
        thumbnailStoragePath: thumbnailFile?.previewStoragePath || task.thumbnailStoragePath,
        updatedAt: new Date().toISOString(),
      };
    }));
  };

  const updateTaskMediaPreviews = (taskId: string, updates: { versions: TaskVersion[]; comments?: TaskComment[]; thumbnailUrl: string; thumbnailStoragePath?: string }) => {
    queueTaskBroadcast(taskId);
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      const incomingVersionsById = new Map(updates.versions.map(version => [version.id, version]));
      const versions = task.versions.map(version => incomingVersionsById.get(version.id) || version);
      const incomingCommentsById = new Map((updates.comments || []).map(comment => [comment.id, comment]));
      const comments = updates.comments
        ? (task.comments || []).map(comment => incomingCommentsById.get(comment.id) || comment)
        : task.comments;
      const latestPreviewFile = versions[0]?.files?.find(file => file.previewUrl && file.previewStoragePath);
      const updateMatchesLatestVersion = task.versions[0]?.id === updates.versions[0]?.id;

      return {
        ...task,
        versions,
        comments,
        thumbnailUrl: latestPreviewFile?.previewUrl || (updateMatchesLatestVersion ? updates.thumbnailUrl : task.thumbnailUrl),
        thumbnailStoragePath: latestPreviewFile?.previewStoragePath || (updateMatchesLatestVersion ? updates.thumbnailStoragePath : task.thumbnailStoragePath),
      };
    }));
  };

  const addTaskComment = (taskId: string, comment: Omit<TaskComment, 'id' | 'createdAt'>) => {
    queueTaskBroadcast(taskId);
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
      updateTaskMediaPreviews,
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
