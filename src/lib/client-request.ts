import { createClient } from '@/lib/supabase/server';

// Kiriman dari perangkat membawa `cid` (UUID). Kiriman yang sama dua kali (antrean offline, sinyal putus-sambung) hanya diproses sekali.
// Bila pemrosesan gagal, penanda dilepas sehingga percobaan berikutnya boleh jalan.
export async function once<T>(cid: string | null, fn: () => Promise<T>): Promise<T | 'duplicate'> {
  if (!cid) return fn();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('client_request_claim', { p_id: cid });
  if (error) throw new Error(error.message);
  if (data === false) return 'duplicate';
  try { return await fn(); } catch (e) {
    await supabase.rpc('client_request_release', { p_id: cid });
    throw e;
  }
}
