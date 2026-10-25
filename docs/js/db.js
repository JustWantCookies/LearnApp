// IndexedDB schema and promise helpers. Migrations only ever add; user stores are never deleted.

const DB_NAME = 'learnapp';
const DB_VERSION = 1;

export const CONTENT_STORES = ['books', 'chapters', 'media', 'items'];
export const PROGRESS_STORES = ['reviews', 'log', 'reading', 'settings', 'seen'];

const migrations = [
  // v1
  (db) => {
    db.createObjectStore('books', { keyPath: 'id' });
    const chapters = db.createObjectStore('chapters', { keyPath: 'key' });
    chapters.createIndex('bookId', 'bookId');
    db.createObjectStore('media'); // out-of-line keys: `${bookId}/${chapterId}/${path}`
    const items = db.createObjectStore('items', { keyPath: 'id' });
    items.createIndex('chapterKey', 'chapterKey');
    items.createIndex('sectionKey', 'sectionKey');
    db.createObjectStore('reviews', { keyPath: 'itemId' });
    const log = db.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
    log.createIndex('itemId', 'itemId');
    log.createIndex('ts', 'ts');
    db.createObjectStore('reading', { keyPath: 'bookId' });
    db.createObjectStore('settings');
    db.createObjectStore('seen', { keyPath: 'key' });
  },
];

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (let v = e.oldVersion; v < DB_VERSION; v++) migrations[v](db, req.transaction);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(Object.assign(new Error('blocked'), {
      userMessage: 'Close other tabs of this app, then reload.',
    }));
  });
  return dbPromise;
}

export function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

// Runs fn(stores) inside one transaction. fn must only await IndexedDB requests.
export async function withTx(storeNames, mode, fn) {
  const db = await openDB();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const tx = db.transaction(names, mode);
  const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
  const done = txDone(tx);
  let result;
  try {
    result = await fn(stores, tx);
  } catch (err) {
    try { tx.abort(); } catch { /* already finished */ }
    await done.catch(() => {});
    throw err;
  }
  await done;
  return result;
}

export const get = (store, key) => withTx(store, 'readonly', (s) => reqP(s[store].get(key)));
export const getAll = (store) => withTx(store, 'readonly', (s) => reqP(s[store].getAll()));
export const put = (store, value, key) => withTx(store, 'readwrite', (s) => reqP(key === undefined ? s[store].put(value) : s[store].put(value, key)));
export const del = (store, key) => withTx(store, 'readwrite', (s) => reqP(s[store].delete(key)));
export const getAllByIndex = (store, index, value) =>
  withTx(store, 'readonly', (s) => reqP(s[store].index(index).getAll(value)));

export async function getSetting(key, fallback) {
  const v = await get('settings', key);
  return v === undefined ? fallback : v;
}

export const setSetting = (key, value) => put('settings', value, key);

// Keys of a store that start with prefix (string keys only).
export function prefixRange(prefix) {
  return IDBKeyRange.bound(prefix, prefix + '￿');
}
