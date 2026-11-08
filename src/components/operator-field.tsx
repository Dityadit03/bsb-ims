'use client';
import { useState } from 'react';
import { input } from '@/components/ui';

export type OperatorInfo = { name: string; issues: string[] };

/** Isian nama operator dengan saran nama karyawan. Bila operator punya SIMPER/MCU kedaluwarsa atau tidak layak, muncul peringatan (tidak memblokir). */
export function OperatorField({ people }: { people: OperatorInfo[] }) {
  const [v, setV] = useState('');
  const hit = people.find(p => p.name.toLowerCase() === v.trim().toLowerCase());
  return (
    <label className="grid gap-1 text-sm">Operator
      <input name="operator" required list="operator-list" value={v} onChange={e => setV(e.target.value)} className={input} autoComplete="off" />
      <datalist id="operator-list">{people.map(p => <option key={p.name} value={p.name} />)}</datalist>
      {hit?.issues.length ? <span className="text-xs text-warn">⚠ {hit.issues.join('; ')}. Hubungi HRGA sebelum unit dioperasikan.</span> : null}
    </label>
  );
}
