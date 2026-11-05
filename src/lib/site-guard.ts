import 'server-only';
import { createClient } from '@/lib/supabase/server';

// Setelah login: karyawan hanya boleh masuk ke site akunnya. Admin sistem dan HO boleh memilih site mana pun (konteks dipindah).
// Mengembalikan kode site akun bila ditolak (akun sudah dikeluarkan), atau null bila boleh.
export async function siteMismatch(requested: string | null | undefined): Promise<string | null> {
  const want = (requested ?? '').toUpperCase();
  if (!want) return null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: info } = await supabase.rpc('my_site_info').maybeSingle<{ active_code: string; home_code: string; can_roam: boolean }>();
  if (!info) return null;
  if (info.can_roam) {
    if (info.active_code !== want) await supabase.rpc('site_switch', { p_code: want });
    return null;
  }
  if (info.home_code === want) return null;
  await supabase.auth.signOut();
  return info.home_code;
}
