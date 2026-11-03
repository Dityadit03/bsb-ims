'use client';
import { useState } from 'react';
import { input } from '@/components/ui';

export const OTHER = '__other';

// Pilihan unit terdaftar, atau "Lainnya" untuk pengisian di luar unit terdaftar (wajib persetujuan PJO).
export function UnitOrOther({ units, label = 'Unit' }: { units: { id: string; unit_no: string; current_hm: number }[]; label?: string }) {
  const [v, setV] = useState('');
  return (
    <>
      <label className="grid gap-1 text-xs">{label}
        <select name="unit" required className={input} value={v} onChange={e => setV(e.target.value)}>
          <option value="">Pilih unit…</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.unit_no} · HM {u.current_hm}</option>)}
          <option value={OTHER}>Lainnya (di luar unit terdaftar)…</option>
        </select>
      </label>
      {v === OTHER && (
        <div className="grid gap-2 rounded-md border border-warn/40 bg-warn/5 p-2">
          <p className="text-xs text-muted">Pengisian di luar unit terdaftar <strong>harus disetujui PJO</strong>. Stok baru berkurang setelah disetujui.</p>
          <input name="recipient" required className={input} placeholder="Penerima: nama pihak / kendaraan / alat" />
          <input name="purpose" required className={input} placeholder="Keperluan" />
        </div>
      )}
    </>
  );
}
