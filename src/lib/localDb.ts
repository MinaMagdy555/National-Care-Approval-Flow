import { Notification, Task } from './types';

const DB_NAME = 'national-care-approval-flow';
const DB_VERSION = 1;
const STORE_NAME = 'app_state';
const STATE_KEY = 'current';

export interface PersistedAppState {
  tasks: Task[];
  notifications: Notification[];
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

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  }));
}

export async function loadAppState(): Promise<PersistedAppState | null> {
  const state = await transact<PersistedAppState | undefined>('readonly', store => store.get(STATE_KEY));
  return state || null;
}

export async function saveAppState(state: PersistedAppState): Promise<void> {
  await transact<IDBValidKey>('readwrite', store => store.put(state, STATE_KEY));
}

export async function clearAppState(): Promise<void> {
  await transact<undefined>('readwrite', store => store.delete(STATE_KEY));
}
