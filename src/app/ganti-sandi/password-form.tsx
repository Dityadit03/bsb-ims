'use client';
import { useActionState } from 'react';
import { btnPrimary, input } from '@/components/ui';
import { changePassword } from './actions';

export function PasswordForm({ forced }: { nrp: string; forced: boolean }) {
  const [state, action, pending] = useActionState(changePassword, {});
  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1 text-sm">Sandi baru
        <input name="password" type="password" required minLength={10} autoComplete="new-password" className={input} />
      </label>
      <label className="grid gap-1 text-sm">Ulangi sandi baru
        <input name="confirm" type="password" required autoComplete="new-password" className={input} />
      </label>
      <button className={`${btnPrimary} py-3`} disabled={pending}>{pending ? 'Menyimpan…' : 'Simpan sandi'}</button>
      {state.error && <p role="alert" className="text-sm text-crit">{state.error}</p>}
      <p className="text-xs text-muted">Minimal 10 karakter, bukan angka saja, dan tidak memuat NIK.{!forced && ' '}</p>
    </form>
  );
}
