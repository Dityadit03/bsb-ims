import Link from 'next/link';
import { PageHeader, Panel, Stat } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Ringkasan' };

export default async function HomePage() {
  const s = await getSession();
  const supabase = await createClient();
  const count = (q: PromiseLike<{ count: number | null }>) => q.then(r => r.count ?? 0);
  const [tasks, unread, capa, pending] = await Promise.all([
    supabase.rpc('my_tasks').then(r => (r.data as unknown[] | null)?.length ?? 0),
    count(supabase.from('notifications').select('*', { count: 'exact', head: true }).is('read_at', null)),
    count(supabase.from('corrective_actions').select('*', { count: 'exact', head: true }).eq('pic_id', s.profile.id).in('status', ['open', 'in_progress'])),
    s.can('user.manage') ? count(supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('status', 'pending')) : Promise.resolve(0),
  ]);
  const actions = QUICK.filter(a => !a.perm || s.can(a.perm));
  const first = (s.profile.full_name ?? s.profile.email).split(' ')[0];

  return (
    <>
      <PageHeader eyebrow="Site BDA" title={`Selamat datang, ${first}`} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Tugas menunggu saya" value={tasks} href="/tugas" />
        <Stat label="Notifikasi belum dibaca" value={unread} href="/tugas" />
        <Stat label="Action plan saya" value={capa} href="/capa" note="Open / sedang dikerjakan" />
        {s.can('user.manage') && <Stat label="Menunggu aktivasi" value={pending} href="/admin/pengguna" />}
      </div>
      <Panel title="Aksi cepat">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {actions.map(a => (
            <Link key={a.href} href={a.href} className="grid gap-0.5 rounded-md border border-line p-3 hover:border-accent">
              <span className="font-medium">{a.label}</span>
              <span className="text-xs text-muted">{a.note}</span>
            </Link>
          ))}
        </div>
      </Panel>
    </>
  );
}

const QUICK: { href: string; label: string; note: string; perm?: string }[] = [
  { href: '/she/p2h', label: 'Isi P2H', note: 'Pemeriksaan unit sebelum operasi', perm: 'she.report' },
  { href: '/she/ftw', label: 'Fit to work', note: 'Kesiapan kerja hari ini', perm: 'she.report' },
  { href: '/she/hazard', label: 'Lapor hazard', note: 'Kondisi / tindakan tidak aman', perm: 'she.report' },
  { href: '/she/insiden', label: 'Lapor insiden', note: 'Kecelakaan, near miss', perm: 'she.report' },
  { href: '/plant/wo', label: 'Work order', note: 'Kerusakan & perbaikan unit' },
  { href: '/produksi', label: 'Laporan produksi', note: 'Ritase dan hambatan shift' },
  { href: '/logistik/mr', label: 'Material request', note: 'Minta barang / suku cadang' },
  { href: '/dokumen', label: 'Cari dokumen', note: 'SOP, IK, formulir berlaku' },
];
