'use client';

import { useState } from 'react';
import { input } from '@/components/ui';

// Pilihan kompetensi; "Lainnya" membuka isian nama untuk training internal yang belum ada di daftar.
export function OtherCompetency({ comps }: { comps: { id: string; code: string; name: string }[] }) {
  const [v, setV] = useState('');
  return (
    <div className="grid gap-2 sm:col-span-1">
      <label className="grid gap-1 text-sm">Kompetensi yang diberikan
        <select name="competency" value={v} onChange={e => setV(e.target.value)} className={input}>
          <option value="">–</option>
          {comps.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          <option value="__other">Lainnya (tulis sendiri)</option>
        </select></label>
      {v === '__other' && <input name="competency_other" required className={input} placeholder="Nama kompetensi / topik training" aria-label="Nama kompetensi lainnya" />}
    </div>
  );
}
