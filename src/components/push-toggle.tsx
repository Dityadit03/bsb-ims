'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { currentEndpoint, disablePush, enablePush, needsInstall, pushSupported } from '@/lib/push';

// Saklar pemberitahuan di Pengaturan. Aktif hanya bila perangkat ini sudah berlangganan dan preferensi akun menyala.
export function PushToggle() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const supported = pushSupported();
  const install = needsInstall();

  useEffect(() => {
    if (!supported) return;
    void (async () => {
      const [ep, st] = await Promise.all([currentEndpoint(), createClient().rpc('push_status')]);
      setOn(!!ep && (st.data as { push?: boolean } | null)?.push !== false && Notification.permission === 'granted');
    })();
  }, [supported]);

  const flip = async () => {
    setBusy(true); setMsg(null);
    try {
      if (on) { await disablePush(); setOn(false); }
      else { const r = await enablePush(); setOn(r.ok); if (!r.ok) setMsg(r.error ?? 'Gagal'); }
    } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line py-3">
      <span className="grid min-w-0">
        <span className="text-sm font-medium">Pemberitahuan di HP ini</span>
        <span className="text-xs text-muted">
          {install ? 'Di iPhone: ketuk Bagikan lalu "Tambahkan ke Layar Utama", buka dari ikon itu, baru aktifkan.'
            : !supported ? 'Peramban ini belum mendukung.' : 'Tugas persetujuan dan peringatan muncul walau aplikasi tertutup.'}
        </span>
        {msg && <span role="alert" className="text-xs text-crit">{msg}</span>}
      </span>
      <button type="button" role="switch" aria-checked={on} disabled={busy || !supported || install} onClick={flip}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-violet' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}
