import { PageHeader, Panel, Pill, Stat } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { NAV } from '@/lib/modules';

export const metadata = { title: 'Ringkasan' };

export default async function HomePage() {
  const s = await getSession();
  const supabase = await createClient();
  const count = (q: PromiseLike<{ count: number | null }>) => q.then(r => r.count ?? 0);
  const [registrations, users, pending] = await Promise.all([
    count(supabase.from('registrations').select('*', { count: 'exact', head: true })),
    count(supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('status', 'active')),
    count(supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('status', 'pending')),
  ]);
  const first = (s.profile.full_name ?? s.profile.email).split(' ')[0];

  return (
    <>
      <PageHeader eyebrow="Site BDA" title={`Selamat datang, ${first}`} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="Nomor terbit" value={registrations} href="/admin/penomoran" note="Semua skema penomoran" />
        <Stat label="Pengguna aktif" value={users} />
        <Stat label="Menunggu aktivasi" value={pending} href={s.can('user.manage') ? '/admin/pengguna' : undefined} />
      </div>
      <Panel title="Status pembangunan modul">
        <ul className="grid gap-2 sm:grid-cols-2">
          {NAV.filter(g => g.code.startsWith('M')).map(g => (
            <li key={g.code} className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
              <span><span className="mr-2 font-mono text-xs text-muted">{g.code}</span>{g.label}</span>
              {g.ready ? <Pill tone="ok">Siap</Pill> : <Pill>Dijadwalkan</Pill>}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
