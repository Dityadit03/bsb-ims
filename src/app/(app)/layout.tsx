import { Sidebar } from '@/components/sidebar';
import { getSession } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  return (
    <div className="lg:flex">
      <Sidebar permissions={[...s.permissions]} name={s.profile.full_name ?? s.profile.email} email={s.profile.email} />
      <main className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-8 lg:py-10">
        <div className="mx-auto grid max-w-6xl gap-8">{children}</div>
      </main>
    </div>
  );
}
