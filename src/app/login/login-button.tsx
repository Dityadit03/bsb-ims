'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { env } from '@/lib/env';
import { btnPrimary } from '@/components/ui';

export function LoginButton({ next, site, hd }: { next?: string; site: string; hd?: string }) {
  const [busy, setBusy] = useState(false);
  async function signIn(anyDomain = false) {
    setBusy(true);
    const redirectTo = `${location.origin}/auth/callback?site=${encodeURIComponent(site)}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
    const queryParams: Record<string, string> = { prompt: 'select_account' };
    if (!anyDomain && (hd || env.workspaceDomain)) queryParams.hd = hd || env.workspaceDomain;
    const { error } = await createClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams } });
    if (error) setBusy(false);
  }
  return (
    <div className="grid gap-2">
      <button onClick={() => signIn()} disabled={busy} className={`${btnPrimary} w-full py-3 text-base`}>
        {busy ? 'Mengalihkan ke Google…' : 'Masuk dengan Google'}
      </button>
      <button onClick={() => signIn(true)} disabled={busy} className="text-xs text-coal-ink/60 underline">Akun HO atau domain email lain</button>
    </div>
  );
}
