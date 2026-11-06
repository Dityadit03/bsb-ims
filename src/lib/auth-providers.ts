import 'server-only';
import { env } from '@/lib/env';

// Penyedia login yang sudah dinyalakan di Supabase (Authentication > Providers). Endpoint ini publik; hasilnya disimpan semenit.
export async function microsoftEnabled(): Promise<boolean> {
  try {
    const r = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseAnonKey }, next: { revalidate: 60 }, signal: AbortSignal.timeout(2500) });
    if (!r.ok) return false;
    const j = (await r.json()) as { external?: Record<string, boolean> };
    return j.external?.azure === true;
  } catch { return false; }
}
