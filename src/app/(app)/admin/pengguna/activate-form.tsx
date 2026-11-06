'use client';
import { useActionState, useState } from 'react';
import { btnPrimary, input } from '@/components/ui';
import { activateNikByPosition, activateNikUser, activateUser, activateUserByPosition } from './actions';

export function ActivateForm({ userId, roles, departments, label = 'Aktifkan', nik = false }: {
  nik?: boolean;
  userId: string; label?: string; roles: { code: string; name: string }[]; departments: { id: string; code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(nik ? activateNikUser : activateUser, {});
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="user" value={userId} />
      <label className="grid gap-1 text-sm">Peran
        <select id={`role-${userId}`} name="role" className={input} defaultValue="STAFF" required>
          {roles.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Lingkup departemen
        <select id={`dept-${userId}`} name="department" className={input} defaultValue="">
          <option value="">Semua departemen</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Dasar penunjukan
        <input id={`basis-${userId}`} name="basis" className={input} placeholder="mis. SK No. 012/BSB/2026" />
      </label>
      <button className={btnPrimary} disabled={pending}>{label}</button>
      {state.error && <p className="text-sm text-crit sm:col-span-4">{state.error}</p>}
    </form>
  );
}

export type PositionOption = { id: string; name: string; level: string; group: string };
export type AccessInfo = Record<string, { role: string; scope: string }>;

// Pilih JABATAN; peran dan lingkup departemen diturunkan otomatis dari jabatan (lihat ringkasan "Akses yang diberikan").
export function PositionForm({ userId, positions, access, nik = false, defaultPosition, label = 'Aktifkan' }: {
  userId: string; positions: PositionOption[]; access: AccessInfo; nik?: boolean; defaultPosition?: string | null; label?: string;
}) {
  const [state, action, pending] = useActionState(nik ? activateNikByPosition : activateUserByPosition, {});
  const [pos, setPos] = useState(defaultPosition ?? '');
  const groups = [...new Set(positions.map(p => p.group))];
  const a = access[pos];
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
      <input type="hidden" name="user" value={userId} />
      <label className="grid gap-1 text-sm">Jabatan
        <select id={`pos-${userId}`} name="position" required className={input} value={pos} onChange={e => setPos(e.target.value)}>
          <option value="" disabled>Pilih jabatan…</option>
          {groups.map(g => (
            <optgroup key={g} label={g}>
              {positions.filter(p => p.group === g).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Dasar penunjukan
        <input id={`pbasis-${userId}`} name="basis" className={input} placeholder="opsional, mis. SK No. 012/BSB/2026" />
      </label>
      <button className={btnPrimary} disabled={pending || !pos}>{label}</button>
      <p className="text-xs text-muted sm:col-span-3">
        {a ? <>Akses yang diberikan: <b className="text-ink">{a.role}</b>, lingkup <b className="text-ink">{a.scope}</b>.</> : 'Pilih jabatan untuk melihat akses yang akan diberikan.'}
      </p>
      {state.error && <p className="text-sm text-crit sm:col-span-3">{state.error}</p>}
    </form>
  );
}
