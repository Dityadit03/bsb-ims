'use client';
import { useCallback, useEffect, useState } from 'react';
import { listQueue, removeItem, setUid, type QueueItem } from '@/lib/offline/queue';
import { MAX_TRIES, flushQueue } from '@/lib/offline/replay';

// Penanda kiriman tertunda + pengirim otomatis. Dipasang sekali di layout aplikasi.
export function OfflineSync({ userId }: { userId: string }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setItems(await listQueue()), []);
  const send = useCallback(async () => { setBusy(true); try { await flushQueue(); } finally { setBusy(false); await refresh(); } }, [refresh]);

  useEffect(() => {
    setUid(userId);
    setOnline(navigator.onLine);
    void refresh().then(() => send());
    const on = () => { setOnline(true); void send(); };
    const off = () => setOnline(false);
    const poll = setInterval(() => { if (navigator.onLine) void send(); }, 30000);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    window.addEventListener('bsb-queue-changed', refresh);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => {
      clearInterval(poll);
      window.removeEventListener('online', on); window.removeEventListener('offline', off);
      window.removeEventListener('bsb-queue-changed', refresh);
    };
  }, [userId, refresh, send]);

  if (online && !items.length) return null;
  return (
    <div className="fixed bottom-20 right-3 z-40 max-w-[calc(100vw-1.5rem)] lg:bottom-4">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className={`ml-auto flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold text-white shadow-lg ${online ? 'bg-violet' : 'bg-warn'}`}>
        <span aria-hidden className={`h-2 w-2 rounded-full bg-white ${busy ? 'animate-pulse' : ''}`} />
        {!online ? 'Offline' : busy ? 'Mengirim…' : 'Menunggu kirim'}{items.length > 0 && ` (${items.length})`}
      </button>
      {open && (
        <div className="mt-2 w-80 max-w-full rounded-xl border border-line bg-panel p-3 text-sm shadow-xl">
          <p className="text-xs text-muted">
            {online ? 'Data di bawah tersimpan di ponsel ini dan dikirim otomatis.' : 'Tidak ada sinyal. Isian tetap aman di ponsel dan dikirim begitu sinyal kembali.'}
          </p>
          <ul className="mt-2 grid gap-2">
            {items.length === 0 && <li className="text-xs text-muted">Antrean kosong.</li>}
            {items.map(i => (
              <li key={i.id} className="rounded-lg border border-line p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{i.label}</span>
                  <span className="shrink-0 text-xs text-muted">{new Date(i.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {i.error && <p className="mt-1 text-xs text-crit">{i.tries >= MAX_TRIES ? 'Ditolak server' : 'Gagal, dicoba lagi'}: {i.error}</p>}
                {i.error && i.tries >= MAX_TRIES && (
                  <button onClick={() => removeItem(i.id)} className="mt-1 text-xs text-crit underline">Hapus dari antrean</button>
                )}
              </li>
            ))}
          </ul>
          {online && items.some(i => !i.error || i.tries < MAX_TRIES) && (
            <button onClick={send} disabled={busy} className="mt-3 w-full rounded-lg bg-violet py-2 text-sm font-semibold text-white disabled:opacity-50">Kirim sekarang</button>
          )}
        </div>
      )}
    </div>
  );
}
