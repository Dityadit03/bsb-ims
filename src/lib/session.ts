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
  canIn: (perm: string, deptCode: string) => boolean;
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

  const [{ data: perms }, { data: depts }] = await Promise.all([
    supabase.rpc('my_permissions'),
    supabase.from('departments').select('id, code'),
  ]);
  const rows = (perms ?? []) as { permission_code: string; department_id: string | null }[];
  const permissions = new Set<string>(rows.map(p => p.permission_code));
  const deptCode = new Map((depts ?? []).map(d => [d.id as string, d.code as string]));
  // Izin yang berlaku di departemen tertentu (peran tanpa departemen berlaku di semua departemen)
  const canIn = (perm: string, code: string) =>
    rows.some(p => p.permission_code === perm && (p.department_id == null || deptCode.get(p.department_id) === code));
  return { profile, permissions, can: perm => permissions.has(perm), canIn };
});

export async function requirePermission(perm: string) {
  const session = await getSession();
  if (!session.can(perm)) redirect('/?ditolak=' + encodeURIComponent(perm));
  return session;
}
