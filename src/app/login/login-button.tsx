'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { env } from '@/lib/env';
import { btnPrimary } from '@/components/ui';

export function LoginButton({ next }: { next?: string }) {
  const [busy, setBusy] = useState(false);
  async function signIn() {
    setBusy(true);
    const redirectTo = `${location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`;
    const queryParams: Record<string, string> = { prompt: 'select_account' };
    if (env.workspaceDomain) queryParams.hd = env.workspaceDomain;
    const { error } = await createClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams } });
    if (error) setBusy(false);
  }
  return (
    <button onClick={signIn} disabled={busy} className={`${btnPrimary} w-full py-3 text-base`}>
      {busy ? 'Mengalihkan ke Google…' : 'Masuk dengan Google'}
    </button>
  );
}
