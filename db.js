// IndexedDB storage for recordings. Shared by offscreen, popup and recordings pages
// (all run on the same chrome-extension:// origin).

const DB_NAME = 'text-recorder';
const STORE = 'recordings';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const saveRecording = (rec) => tx('readwrite', (s) => s.put(rec));
export const getRecording = (id) => tx('readonly', (s) => s.get(id));
export const deleteRecording = (id) => tx('readwrite', (s) => s.delete(id));

export async function listRecordings() {
  const all = await tx('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateRecording(id, patch) {
  const rec = await getRecording(id);
  if (!rec) throw new Error('Recording not found');
  Object.assign(rec, patch);
  await saveRecording(rec);
  return rec;
}
