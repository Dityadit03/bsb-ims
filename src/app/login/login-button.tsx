'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { btnPrimary } from '@/components/ui';

// Login akun email: Microsoft (email kantor HO) atau Google. Tidak memakai NIK. Akun baru tetap menunggu persetujuan administrator.
export function LoginButton({ next, site, microsoft }: { next?: string; site: string; microsoft: boolean }) {
  const [busy, setBusy] = useState<null | 'azure' | 'google'>(null);
  const [error, setError] = useState('');
  async function signIn(provider: 'azure' | 'google') {
    setBusy(provider); setError('');
    const redirectTo = `${location.origin}/auth/callback?site=${encodeURIComponent(site)}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
    const { error } = await createClient().auth.signInWithOAuth({
      provider, options: { redirectTo, ...(provider === 'azure' ? { scopes: 'email' } : { queryParams: { prompt: 'select_account' } }) },
    });
    if (error) { setBusy(null); setError(error.message); }
  }
  return (
    <div className="grid gap-3">
      {microsoft && (
        <button onClick={() => signIn('azure')} disabled={!!busy} className={`${btnPrimary} w-full gap-3 py-3 text-base`}>
          <svg aria-hidden viewBox="0 0 21 21" className="size-5"><path fill="#f25022" d="M1 1h9v9H1z" /><path fill="#7fba00" d="M11 1h9v9h-9z" /><path fill="#00a4ef" d="M1 11h9v9H1z" /><path fill="#ffb900" d="M11 11h9v9h-9z" /></svg>
          {busy === 'azure' ? 'Mengalihkan ke Microsoft…' : 'Masuk dengan Microsoft'}
        </button>
      )}
      <button onClick={() => signIn('google')} disabled={!!busy}
        className={microsoft ? 'inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-white/20 bg-white/5 py-3 text-base font-semibold hover:bg-white/10 disabled:opacity-50' : `${btnPrimary} w-full py-3 text-base`}>
        {busy === 'google' ? 'Mengalihkan ke Google…' : 'Masuk dengan Google'}
      </button>
      {error && <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm">{error}</p>}
    </div>
  );
}
