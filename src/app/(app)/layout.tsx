import { Sidebar } from '@/components/sidebar';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  const supabase = await createClient();
  const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).is('read_at', null);
  const settings = s.can('user.manage') ? '/admin/pengguna' : s.can('numbering.configure') ? '/admin/penomoran' : null;
  return (
    <>
      <Sidebar permissions={[...s.permissions]} name={s.profile.full_name ?? s.profile.email} email={s.profile.email} unread={count ?? 0} settings={settings} />
      <main className="min-w-0 px-4 pb-24 pt-6 sm:px-8 lg:pb-12 lg:pt-10">
        <div className="mx-auto grid max-w-7xl gap-6">{children}</div>
      </main>
    </>
  );
}
