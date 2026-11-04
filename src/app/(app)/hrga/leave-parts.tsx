'use client';

import { useState } from 'react';
import { input } from '@/components/ui';

type T = { code: string; name: string; max_days: number | null; requires_attachment: boolean };
type P = { on: boolean; start: string; end: string };

// Daftar centang jenis cuti: tiap jenis yang dicentang punya rentang tanggal sendiri. Hasilnya dikirim sebagai JSON `parts`.
export function LeaveParts({ types, today }: { types: T[]; today: string }) {
  const [p, setP] = useState<Record<string, P>>(() => Object.fromEntries(types.map((t, i) => [t.code, { on: i === 0, start: today, end: today }])));
  const set = (c: string, v: Partial<P>) => setP(s => ({ ...s, [c]: { ...s[c], ...v } }));
  const parts = types.filter(t => p[t.code].on).map(t => ({ type: t.code, start: p[t.code].start, end: p[t.code].end || p[t.code].start }));
  return (
    <fieldset className="grid gap-2 md:col-span-2">
      <legend className="mb-1 text-sm">Jenis cuti <span className="text-xs text-muted">(boleh pilih lebih dari satu, tiap jenis punya tanggal sendiri)</span></legend>
      <input type="hidden" name="parts" value={JSON.stringify(parts)} />
      {types.map(t => {
        const s = p[t.code];
        return (
          <div key={t.code} className={`grid gap-2 rounded-lg border px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-center ${s.on ? 'border-accent/50' : 'border-line'}`}>
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={s.on} onChange={e => set(t.code, { on: e.target.checked })} className="size-4" />
              <span>{t.name}{t.max_days ? <span className="text-xs text-muted"> · maks {t.max_days} hari</span> : null}{t.requires_attachment ? <span className="text-xs text-muted"> · wajib lampiran</span> : null}</span>
            </label>
            {s.on && (
              <div className="grid grid-cols-2 gap-2">
                <input type="date" aria-label={`Mulai ${t.name}`} required value={s.start} onChange={e => set(t.code, { start: e.target.value, end: s.end < e.target.value ? e.target.value : s.end })} className={input} />
                <input type="date" aria-label={`Sampai ${t.name}`} required min={s.start} value={s.end} onChange={e => set(t.code, { end: e.target.value })} className={input} />
              </div>
            )}
          </div>
        );
      })}
      {parts.length === 0 && <p className="text-xs text-crit">Centang minimal satu jenis cuti.</p>}
    </fieldset>
  );
}
