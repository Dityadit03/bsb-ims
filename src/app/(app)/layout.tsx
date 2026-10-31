import { OfflineSync } from '@/components/offline-sync';
import { Sidebar } from '@/components/sidebar';
import { getAlerts } from '@/lib/alerts';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  const supabase = await createClient();
  const [{ items, total }, { data: roles }, { data: dept }] = await Promise.all([
    getAlerts(),
    supabase.from('user_roles').select('role_code, roles(name)').eq('user_id', s.profile.id)
      .or(`valid_until.is.null,valid_until.gte.${new Date().toISOString().slice(0, 10)}`)
      .returns<{ role_code: string; roles: { name: string } | null }[]>(),
    s.profile.department_id
      ? supabase.from('departments').select('name').eq('id', s.profile.department_id).maybeSingle()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);
  const codes = (roles ?? []).map(r => r.role_code);
  const role = codes.includes('SYS_ADMIN') ? 'Admin' : roles?.[0]?.roles?.name ?? 'Pengguna';
  return (
    <>
      <Sidebar permissions={[...s.permissions]} name={s.profile.full_name ?? s.profile.email} email={s.profile.email}
        role={role} unit={dept?.name ?? 'Semua departemen'} alerts={items} alertTotal={total} />
      <OfflineSync userId={s.profile.id} />
      <main className="min-w-0 px-4 pb-24 pt-6 sm:px-8 lg:pb-12 lg:pt-10">
        <div className="mx-auto grid max-w-7xl gap-6 [&>*]:min-w-0">{children}</div>
      </main>
    </>
  );
}
