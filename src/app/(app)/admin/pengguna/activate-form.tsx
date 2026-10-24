'use client';
import { useActionState } from 'react';
import { btnPrimary, input } from '@/components/ui';
import { activateUser } from './actions';

export function ActivateForm({ userId, roles, departments, label = 'Aktifkan' }: {
  userId: string; label?: string; roles: { code: string; name: string }[]; departments: { id: string; code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(activateUser, {});
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
