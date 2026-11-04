import 'server-only';
import { createClient } from '@/lib/supabase/server';

// Setelah login: bila pengguna memilih site yang bukan site akunnya, keluarkan dan kembalikan ke halaman login dengan petunjuk.
// Mengembalikan kode site akun bila tidak cocok, atau null bila cocok / tidak ada pilihan.
export async function siteMismatch(requested: string | null | undefined): Promise<string | null> {
  const want = (requested ?? '').toUpperCase();
  if (!want) return null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase.from('profiles').select('sites(code)').eq('id', auth.user.id).maybeSingle<{ sites: { code: string } | null }>();
  const actual = data?.sites?.code;
  if (!actual || actual === want) return null;
  await supabase.auth.signOut();
  return actual;
}
