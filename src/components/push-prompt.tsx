'use client';
import { useEffect, useState } from 'react';
import { enablePush, needsInstall, pushSupported } from '@/lib/push';
import { btnGhost, btnPrimary } from './ui';

const KEY = 'bsb-push-prompt';
const LATER = 7 * 864e5;

// Ajakan sekali-sekali di Beranda agar pemberitahuan di HP dinyalakan (sebelumnya hanya ada di Pengaturan, sehingga tak ada yang memakainya).
export function PushPrompt() {
  const [mode, setMode] = useState<'ask' | 'install' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    try { if (Date.now() - Number(localStorage.getItem(KEY) ?? 0) < LATER) return; } catch { /* abaikan */ }
    if (needsInstall()) setMode('install');
    else if (pushSupported() && Notification.permission === 'default') setMode('ask');
  }, []);

  const later = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* abaikan */ } setMode(null); };
  const enable = async () => {
    setBusy(true); setMsg(null);
    const r = await enablePush();
    setBusy(false);
    if (r.ok) setMode(null); else setMsg(r.error ?? 'Gagal menyalakan pemberitahuan');
  };

  if (!mode) return null;
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-violet/40 bg-violet/5 p-4" aria-label="Pemberitahuan">
      <div className="grid min-w-0 flex-1 gap-1">
        <strong className="text-sm">Nyalakan pemberitahuan di HP ini</strong>
        <span className="text-sm text-muted">
          {mode === 'install'
            ? 'Di iPhone: ketuk tombol Bagikan lalu "Tambahkan ke Layar Utama", buka aplikasi dari ikon itu, lalu nyalakan di sini.'
            : 'Tugas persetujuan, temuan untuk Anda, dan tenggat muncul di HP walau aplikasi tertutup.'}
        </span>
        {msg && <span role="alert" className="text-sm text-crit">{msg}</span>}
      </div>
      <div className="flex gap-2">
        {mode === 'ask' && <button type="button" onClick={enable} disabled={busy} className={btnPrimary}>{busy ? 'Menyalakan…' : 'Nyalakan'}</button>}
        <button type="button" onClick={later} className={btnGhost}>Nanti</button>
      </div>
    </section>
  );
}
