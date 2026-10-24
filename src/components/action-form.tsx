'use client';
import { useActionState } from 'react';
import { btnGhost, btnPrimary } from '@/components/ui';

type State = { error?: string; ok?: string };

// Formulir kecil untuk satu aksi server: menampilkan pesan hasil di tempat.
export function ActionForm({ action, label, children, primary = false, hidden = {}, className = '' }: {
  action: (s: State, f: FormData) => Promise<State>;
  label: string;
  children?: React.ReactNode;
  primary?: boolean;
  hidden?: Record<string, string>;
  className?: string;
}) {
  const [state, run, pending] = useActionState(action, {});
  return (
    <form action={run} className={`grid gap-2 ${className}`}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className={primary ? btnPrimary : btnGhost} disabled={pending}>{pending ? 'Memproses…' : label}</button>
        {state.error && <span role="alert" className="text-sm text-crit">{state.error}</span>}
        {state.ok && <span className="text-sm text-ok">{state.ok}</span>}
      </div>
    </form>
  );
}
