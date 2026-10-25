'use client';
import { useActionState } from 'react';
import { btnGhost, input } from '@/components/ui';
import { rejectNikUser, resetPassword } from './actions';

export function RejectForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(rejectNikUser, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="user" value={userId} />
      <input name="reason" required placeholder="Alasan menolak" className={`${input} max-w-60`} aria-label="Alasan menolak" />
      <button className={btnGhost} disabled={pending}>Tolak</button>
      {state.error && <span className="text-sm text-crit">{state.error}</span>}
    </form>
  );
}

// Sandi sementara tampil sekali di layar administrator; disampaikan langsung ke karyawan yang bersangkutan.
export function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(resetPassword, {});
  return (
    <form action={action} className="grid gap-1" onSubmit={e => { if (!confirm('Reset sandi akun ini? Sandi lama langsung tidak berlaku.')) e.preventDefault(); }}>
      <input type="hidden" name="user" value={userId} />
      <button className="text-left text-xs text-accent underline" disabled={pending}>{pending ? 'Mereset…' : 'Reset sandi'}</button>
      {state.password && (
        <p className="rounded-md bg-warn/10 px-2 py-1 text-xs">
          Sandi sementara: <b className="select-all font-mono text-sm">{state.password}</b>
          <span className="block text-muted">Sampaikan langsung. Karyawan wajib menggantinya saat masuk. Tidak ditampilkan lagi.</span>
        </p>
      )}
      {state.error && <span className="text-xs text-crit">{state.error}</span>}
    </form>
  );
}
