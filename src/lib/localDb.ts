import { applyMemberDeletions, mergeMemberDeletions } from './memberIdentity';
import { findMemberDeletionBlockers } from './memberDeletion';
import { mergeAppSettings } from './appSettings';
import type { DeletedMember, User } from './types';
import { AppSettings, DailyReport, Notification, Task } from './types';
import { filterResetNotifications, NotificationResetRecord, planNotificationReset } from './notificationReset';

const DB_NAME = 'national-care-approval-flow';
const DB_VERSION = 1;
const STORE_NAME = 'app_state';
const STATE_KEY = 'current';
const DELETED_MEMBERS_KEY = 'deleted-members';
const NOTIFICATION_RESET_KEY = 'notification-reset';

export interface PersistedAppState {
  tasks: Task[];
  notifications: Notification[];
  settings?: AppSettings;
  dailyReports?: DailyReport[];
  notificationReset?: NotificationResetRecord;
}

let localNotificationReset: NotificationResetRecord | undefined;
export function filterLocallyResetNotifications(notices: Notification[]) {
  return filterResetNotifications(notices, localNotificationReset);
}

async function loadAndResetNotifications(): Promise<PersistedAppState | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(STATE_KEY);
    const resetRequest = store.get(NOTIFICATION_RESET_KEY);
    let state: PersistedAppState | undefined;
    let reset: NotificationResetRecord | undefined;
    resetRequest.onsuccess = () => {
      state = request.result;
      reset = resetRequest.result;
      if (!state) return;
      const plan = planNotificationReset(state.notifications || [], state.settings || {}, reset || state.notificationReset);
      const changed = state.settings?.notificationResetVersion !== 3 || plan.notifications.length !== (state.notifications || []).length
        || JSON.stringify(state.notificationReset) !== JSON.stringify(plan.reset) || !reset;
      state = { ...state, notifications: plan.notifications, notificationReset: plan.reset,
        settings: { ...state.settings, notificationResetVersion: 3 } as AppSettings };
      reset = plan.reset;
      if (changed) { store.put(state, STATE_KEY); store.put(reset, NOTIFICATION_RESET_KEY); }
    };
    transaction.oncomplete = () => { localNotificationReset = reset; db.close(); resolve(state); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Notification cleanup could not be saved.')); };
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = action(store);

    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error("Local transaction was aborted.")); };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  }));
}

export async function loadAppState(): Promise<PersistedAppState | null> {
  const [state, deleted] = await Promise.all([
    loadAndResetNotifications(),
    transact<DeletedMember[] | undefined>('readonly', store => store.get(DELETED_MEMBERS_KEY)),
  ]);
  if (!state) return deleted?.length ? { tasks: [], notifications: [], settings: mergeAppSettings({ deletedMembers: deleted }) } : null;
  return { ...state, settings: applyMemberDeletions(state.settings || {}, deleted || []) as AppSettings };
}

export async function saveAppState(state: PersistedAppState, options?: { expectedState: PersistedAppState | null }): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const currentRequest = store.get(STATE_KEY);
    const deletedRequest = store.get(DELETED_MEMBERS_KEY);
    const resetRequest = store.get(NOTIFICATION_RESET_KEY);
    let failure: Error | undefined;
    let completedReset: NotificationResetRecord | undefined;
    resetRequest.onsuccess = () => {
      try {
        const current = currentRequest.result as PersistedAppState | undefined;
        const deleted = mergeMemberDeletions(deletedRequest.result, current?.settings?.deletedMembers, state.settings?.deletedMembers);
        const canonicalCurrent = current ? { ...current, settings: applyMemberDeletions(current.settings || {}, deletedRequest.result || []) } : null;
        if (options && JSON.stringify(canonicalCurrent) !== JSON.stringify(options.expectedState)) throw new Error('The local workspace changed. Refresh and try removing the member again.');
        const identities = deleted.map(record => ({ ...record, role: record.role || 'team_member' })) as User[];
        const settings = mergeAppSettings(state.settings);
        const blockers = findMemberDeletionBlockers(state.tasks, deleted, settings, [...(settings.manualUsers || []), ...identities]);
        if (blockers.length) throw new Error('A removed member still has unfinished assigned work. Refresh and reassign those steps first.');
        const baseline = current || { ...state, notifications: [] };
        const plan = planNotificationReset(baseline.notifications || [], baseline.settings || {}, resetRequest.result || baseline.notificationReset);
        const incoming = (state.settings?.notificationResetVersion || 0) < 3 && current?.notificationReset
          ? [...new Map([...current.notifications, ...state.notifications].map(notice => [notice.id, notice])).values()]
          : state.notifications;
        const notifications = filterResetNotifications(incoming, plan.reset);
        store.put({ ...state, notifications, notificationReset: plan.reset,
          settings: applyMemberDeletions({ ...state.settings, notificationResetVersion: 3 }, deleted) }, STATE_KEY);
        completedReset = plan.reset;
        store.put(plan.reset, NOTIFICATION_RESET_KEY);
        store.put(deleted, DELETED_MEMBERS_KEY);
      } catch (error) {
        failure = error instanceof Error ? error : new Error('Could not save local membership changes.');
        transaction.abort();
      }
    };
    transaction.oncomplete = () => { localNotificationReset = completedReset; db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(failure || transaction.error || new Error('Local save failed.')); };
  });
}

export async function clearAppState(): Promise<void> {
  // Clearing cached tasks must not restore memberships removed in this browser.
  await transact<undefined>('readwrite', store => store.delete(STATE_KEY));
}
