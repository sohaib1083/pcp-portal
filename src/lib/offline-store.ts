// Browser-side store for work done without a connection (the inspection checklist on a tablet).
// IndexedDB, not localStorage: it holds photos as files and survives a closed tab. Client code only.

const DB_NAME = "pcp-offline";
const STORE = "drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Returns undefined when nothing is stored, or when the browser blocks storage (private window). */
export async function loadDraft<T>(key: string): Promise<T | undefined> {
  try {
    return await run<T | undefined>("readonly", (s) => s.get(key));
  } catch {
    return undefined;
  }
}

export async function saveDraft<T>(key: string, value: T): Promise<boolean> {
  try {
    await run("readwrite", (s) => s.put(value, key));
    return true;
  } catch {
    return false;
  }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(key));
  } catch {
    // nothing stored, or storage blocked: either way there is nothing to clear
  }
}
