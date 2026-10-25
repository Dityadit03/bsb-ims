'use client';
// Antrean kiriman offline di IndexedDB perangkat. Isi form (termasuk foto) disimpan apa adanya lalu dikirim ulang
// lewat server action yang sama saat sinyal kembali. Setiap kiriman membawa `cid` unik sehingga kirim ganda tidak menggandakan data.

export type QueueKind = 'p2h' | 'hazard' | 'absen';
export type QueueItem = {
  id: string; uid: string; kind: QueueKind; label: string; createdAt: number;
  fields: [string, string | File][]; tries: number; error?: string;
};

// Pemilik antrean = pengguna yang sedang masuk (diisi OfflineSync). Antrean orang lain tidak pernah dikirim dengan sesi ini.
export const setUid = (uid: string) => { try { localStorage.setItem('bsb-uid', uid); } catch { /* abaikan */ } };
const getUid = () => { try { return localStorage.getItem('bsb-uid') ?? ''; } catch { return ''; } };

const DB = 'bsb-queue', STORE = 'items';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((res, rej) => {
      const t = db.transaction(STORE, mode);
      const rq = fn(t.objectStore(STORE));
      t.oncomplete = () => res(rq.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  } finally { db.close(); }
}

const changed = () => window.dispatchEvent(new Event('bsb-queue-changed'));

export function formToFields(fd: FormData): [string, string | File][] {
  const out: [string, string | File][] = [];
  fd.forEach((v, k) => { if (!(v instanceof File) || v.size > 0) out.push([k, v]); });
  return out;
}

export function fieldsToForm(fields: QueueItem['fields']): FormData {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  return fd;
}

export async function enqueue(kind: QueueKind, label: string, fields: QueueItem['fields']): Promise<void> {
  const cid = String(fields.find(([k]) => k === 'cid')?.[1] ?? crypto.randomUUID());
  await tx('readwrite', s => s.put({ id: cid, uid: getUid(), kind, label, createdAt: Date.now(), fields, tries: 0 } satisfies QueueItem));
  changed();
}

export async function listQueue(): Promise<QueueItem[]> {
  try { const uid = getUid();
    return ((await tx('readonly', s => s.getAll())) as QueueItem[]).filter(i => i.uid === uid).sort((a, b) => a.createdAt - b.createdAt); } catch { return []; }
}

export async function updateItem(item: QueueItem): Promise<void> { await tx('readwrite', s => s.put(item)); changed(); }
export async function removeItem(id: string): Promise<void> { await tx('readwrite', s => s.delete(id)); changed(); }
export const queueSupported = () => typeof indexedDB !== 'undefined';
