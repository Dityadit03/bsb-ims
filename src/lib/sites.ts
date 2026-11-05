import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

export type LoginSite = { code: string; name: string; hd: string };

// Daftar site untuk halaman login, dibaca dari database (hanya kode, nama, domain email). Site baru ditambah admin sistem di /admin/site.
export async function loginSites(): Promise<LoginSite[]> {
  const fallback: LoginSite[] = [{ code: 'BDA', name: 'Site BDA', hd: env.workspaceDomain }];
  try {
    const { data, error } = await createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false } }).rpc('login_sites');
    if (error || !data?.length) return fallback;
    return (data as { code: string; name: string; email_domain: string | null }[]).map(s => ({ code: s.code, name: s.name, hd: s.email_domain || env.workspaceDomain }));
  } catch { return fallback; }
}
