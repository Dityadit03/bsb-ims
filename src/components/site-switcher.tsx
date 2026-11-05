'use client';
import { useActionState } from 'react';
import { switchSite, type ActionState } from '@/app/(app)/admin/site/actions';

// Hanya tampil untuk admin sistem dan HO: pindah site yang sedang dilihat.
export function SiteSwitcher({ sites, active }: { sites: { code: string; name: string }[]; active: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(switchSite, {});
  return (
    <form action={action} className="flex items-center gap-1">
      <label className="sr-only" htmlFor="site-switch">Pindah site</label>
      <select id="site-switch" name="code" defaultValue={active} disabled={pending}
        onChange={e => e.currentTarget.form?.requestSubmit()}
        className="max-w-40 rounded-xl border border-line bg-panel px-2 py-1.5 text-sm font-semibold">
        {sites.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
      </select>
      {state.error && <span role="alert" className="text-xs text-crit">{state.error}</span>}
    </form>
  );
}
