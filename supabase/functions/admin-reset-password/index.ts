// Edge Function: administrator mereset sandi akun login NIK.
// Kunci service-role HANYA ada di lingkungan fungsi ini (disediakan Supabase), tidak pernah di aplikasi Next.js.
// Izin diperiksa di database lewat public.password_reset_authorize memakai JWT pemanggil.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// tanpa karakter yang mudah tertukar (0/O, 1/l/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function tempPassword(n = 12) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, x => ALPHABET[x % ALPHABET.length]).join('');
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Belum masuk' }, 401);
  const { user_id } = await req.json().catch(() => ({}));
  if (!user_id || typeof user_id !== 'string') return json({ error: 'user_id wajib' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { error: denied } = await caller.rpc('password_reset_authorize', { p_user: user_id });
  if (denied) return json({ error: denied.message }, 403);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const password = tempPassword();
  const { data: cur } = await admin.auth.admin.getUserById(user_id);
  const { error } = await admin.auth.admin.updateUserById(user_id, {
    password, user_metadata: { ...(cur?.user?.user_metadata ?? {}), must_change_password: true },
  });
  if (error) return json({ error: 'Reset gagal' }, 500);
  return json({ password });
});
