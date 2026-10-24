import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  status: 'pending' | 'active' | 'suspended' | 'exited';
  department_id: string | null;
};

export type Session = {
  profile: Profile;
  permissions: Set<string>;
  can: (perm: string) => boolean;
};

// Satu kali per request: profil + izin efektif. Izin dipakai UI untuk menampilkan menu;
// pengecekan sebenarnya tetap dilakukan database lewat RLS dan fungsi RPC.
export const getSession = cache(async (): Promise<Session> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, status, department_id')
    .eq('id', auth.user.id)
    .single<Profile>();
  if (!profile || profile.status !== 'active') redirect('/menunggu');

  const { data: perms } = await supabase.rpc('my_permissions');
  const permissions = new Set<string>((perms ?? []).map((p: { permission_code: string }) => p.permission_code));
  return { profile, permissions, can: perm => permissions.has(perm) };
});

export async function requirePermission(perm: string) {
  const session = await getSession();
  if (!session.can(perm)) redirect('/?ditolak=' + encodeURIComponent(perm));
  return session;
}
