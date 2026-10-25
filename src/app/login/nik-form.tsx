'use client';
import { useActionState, useState } from 'react';
import Script from 'next/script';
import { btnPrimary } from '@/components/ui';
import { loginNik, registerNik } from './nik-actions';

const field = 'w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-base text-coal-ink placeholder:text-coal-ink/40 focus:border-white/60 focus:outline-none';
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// Login karyawan: NIK + sandi. Pendaftaran perlu persetujuan administrator sebelum bisa dipakai.
export function NikForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<'masuk' | 'daftar'>('masuk');
  const [login, loginAction, loginPending] = useActionState(loginNik, {});
  const [reg, regAction, regPending] = useActionState(registerNik, {});
  const state = mode === 'masuk' ? login : reg;
  const pending = loginPending || regPending;

  return (
    <div className="grid gap-3">
      {SITE_KEY && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/10 p-1 text-sm font-semibold">
        {(['masuk', 'daftar'] as const).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`rounded-lg py-2 ${mode === m ? 'bg-white text-coal' : 'text-coal-ink/70'}`}>{m === 'masuk' ? 'Masuk' : 'Daftar akun'}</button>
        ))}
      </div>
      <form action={mode === 'masuk' ? loginAction : regAction} className="grid gap-3" autoComplete="on">
        <input type="hidden" name="next" value={next ?? ''} />
        <label className="grid gap-1 text-sm">NIK
          <input name="nrp" required autoCapitalize="characters" autoComplete="username" inputMode="text" placeholder="BSB-0123" className={`${field} uppercase`} />
        </label>
        {mode === 'daftar' && (
          <>
            <label className="grid gap-1 text-sm">Nama lengkap
              <input name="name" required autoComplete="name" className={field} />
            </label>
            <label className="grid gap-1 text-sm">Tanggal lahir
              <input name="birth" type="date" required autoComplete="bday" className={field} />
            </label>
          </>
        )}
        <label className="grid gap-1 text-sm">Sandi
          <input name="password" type="password" required minLength={mode === 'daftar' ? 10 : undefined}
            autoComplete={mode === 'masuk' ? 'current-password' : 'new-password'} className={field} />
        </label>
        {mode === 'daftar' && (
          <label className="grid gap-1 text-sm">Ulangi sandi
            <input name="confirm" type="password" required autoComplete="new-password" className={field} />
          </label>
        )}
        {SITE_KEY && <div className="cf-turnstile" data-sitekey={SITE_KEY} data-theme="dark" />}
        <button disabled={pending} className={`${btnPrimary} w-full py-3 text-base`}>
          {pending ? 'Memproses…' : mode === 'masuk' ? 'Masuk dengan NIK' : 'Kirim pendaftaran'}
        </button>
        {state.error && <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm">{state.error}</p>}
        {mode === 'daftar' && (
          <p className="text-xs text-coal-ink/60">
            Sandi minimal 10 karakter. Setelah mendaftar, administrator mencocokkan NIK dan tanggal lahir Anda dengan data karyawan sebelum akun diaktifkan.
          </p>
        )}
      </form>
    </div>
  );
}
