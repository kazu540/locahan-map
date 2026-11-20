// iPhone内の保存場所（IndexedDB）を扱う部分
// spots  : 記録した場所（1件ずつ）
// photos : 写真（段階3で使います）
// meta   : タグ一覧などの設定（段階3以降で使います）

const DB_NAME = 'locahan';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('この端末ではデータを保存できません'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('spots')) {
        const s = db.createObjectStore('spots', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const p = db.createObjectStore('photos', { keyPath: 'id' });
        p.createIndex('spotId', 'spotId');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    const r = fn(store);
    if (r) r.onsuccess = () => { result = r.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function getAllSpots() {
  const list = (await run('spots', 'readonly', (s) => s.getAll())) || [];
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getSpot(id) {
  return run('spots', 'readonly', (s) => s.get(id));
}

export function putSpot(spot) {
  return run('spots', 'readwrite', (s) => s.put(spot));
}

export function deleteSpot(id) {
  return run('spots', 'readwrite', (s) => s.delete(id));
}

// Safariにデータを消されにくくするお願い（許可されない場合もあります）
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch (e) { /* 対応していない端末では何もしない */ }
}

/* ---------- 写真 ---------- */
export function putPhoto(photo) {
  return run('photos', 'readwrite', (s) => s.put(photo));
}

export function getPhoto(id) {
  return run('photos', 'readonly', (s) => s.get(id));
}

export function deletePhoto(id) {
  return run('photos', 'readwrite', (s) => s.delete(id));
}

// 記録と、その写真をまとめて削除
export async function deleteSpotWithPhotos(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['spots', 'photos'], 'readwrite');
    tx.objectStore('spots').delete(id);
    const idx = tx.objectStore('photos').index('spotId');
    const req = idx.openKeyCursor(IDBKeyRange.only(id));
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) { tx.objectStore('photos').delete(cur.primaryKey); cur.continue(); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- 設定（タグ一覧など） ---------- */
export async function getMeta(key, fallback) {
  const row = await run('meta', 'readonly', (s) => s.get(key));
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  return run('meta', 'readwrite', (s) => s.put({ key, value }));
}
