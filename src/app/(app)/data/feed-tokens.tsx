'use client';
import { useActionState, useEffect, useState } from 'react';
import { btnGhost, btnPrimary, input } from '@/components/ui';
import { createFeedToken, type TokenState } from './actions';

export function CopyButton({ text, label = 'Salin' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={`${btnGhost} px-2.5 py-1 text-xs`}
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
      {done ? 'Tersalin ✓' : label}
    </button>
  );
}

// Token dibuat per spreadsheet dan hanya tampil sekali; rumus IMPORTDATA langsung siap disalin.
export function FeedTokens({ feeds }: { feeds: { key: string; label: string; group: string }[] }) {
  const [state, run, pending] = useActionState<TokenState, FormData>(createFeedToken, {});
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const formula = (key: string) => `=IMPORTDATA("${origin}/api/feed/${state.token}/${key}")`;
  return (
    <div className="grid gap-3">
      <form action={run} className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">Nama spreadsheet tujuan
          <input name="label" required className={input} placeholder="mis. Laporan mingguan HSE" /></label>
        <button className={btnPrimary} disabled={pending}>{pending ? 'Membuat…' : 'Buat link Google Sheets'}</button>
        {state.error && <span role="alert" className="text-sm text-crit">{state.error}</span>}
      </form>
      {state.token && (
        <div className="grid gap-2 rounded-xl border border-accent/40 bg-accent-soft/40 p-3">
          <p className="text-sm"><b>Link untuk &quot;{state.label}&quot; siap.</b> Salin rumus ke sel A1 di Google Sheets; data diperbarui otomatis
            (± setiap jam). Rumus ini hanya ditampilkan sekali, simpan di spreadsheet Anda.</p>
          <ul className="grid gap-1.5">
            {feeds.map(d => (
              <li key={d.key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-44 shrink-0">{d.label} <span className="text-xs text-muted">· {d.group}</span></span>
                <code className="min-w-0 flex-1 truncate rounded bg-panel px-2 py-1 font-mono text-xs">{formula(d.key)}</code>
                <CopyButton text={formula(d.key)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
