import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

export type AlertTone = 'crit' | 'warn' | 'accent';
export type Alert = { n: number; tone: AlertTone; title: string; sub: string; href: string };
type Cert = { employee_id: string; competency_id: string; category: string; valid_until: string | null; validity: string };

// Hal yang perlu ditindaklanjuti, dipakai lonceng peringatan, menu samping dan beranda (sekali per request).
export const getAlerts = cache(async () => {
  const supabase = await createClient();
  const head = { count: 'exact' as const, head: true };
  const count = (q: PromiseLike<{ count: number | null }>) => q.then(r => r.count ?? 0);
  const [certs, spip, hazardOpen, hazardLate, capaLate, mrWait, poWait, lowStock, tasks, unread] = await Promise.all([
    supabase.from('employee_competency_view').select('employee_id, competency_id, category, valid_until, validity')
      .neq('validity', 'revoked').limit(20000).returns<Cert[]>(),
    supabase.from('commissioning_register').select('validity').in('validity', ['expired', 'expiring']).limit(5000),
    count(supabase.from('she_hazard_register').select('*', head).eq('status', 'open')),
    count(supabase.from('she_hazard_register').select('*', head).eq('is_overdue', true)),
    count(supabase.from('capa_register').select('*', head).eq('is_overdue', true)),
    count(supabase.from('mr_register').select('*', head).in('status', ['submitted', 'pending'])),
    count(supabase.from('po_register').select('*', head).eq('status', 'awaiting_approval')),
    count(supabase.from('material_stock').select('*', head).eq('low_stock', true)),
    supabase.rpc('my_tasks').then(r => (r.data as unknown[] | null)?.length ?? 0),
    count(supabase.from('notifications').select('*', head).is('read_at', null)),
  ]);
  // sertifikat terbaru per karyawan & kompetensi
  const latest = new Map<string, Cert>();
  for (const c of certs.data ?? []) {
    const k = `${c.employee_id}:${c.competency_id}`, p = latest.get(k);
    if (!p || (c.valid_until ?? '9999') > (p.valid_until ?? '9999')) latest.set(k, c);
  }
  const cert = (cat: (c: string) => boolean, v: string) => [...latest.values()].filter(c => cat(c.category) && c.validity === v).length;
  const mcu = (c: string) => c === 'medical', simper = (c: string) => c === 'authorization', other = (c: string) => !mcu(c) && !simper(c);
  const c = {
    mcuExp: cert(mcu, 'expired'), mcuSoon: cert(mcu, 'expiring'), simExp: cert(simper, 'expired'), simSoon: cert(simper, 'expiring'),
    othExp: cert(other, 'expired'), spipExp: (spip.data ?? []).filter(r => r.validity === 'expired').length,
    spipSoon: (spip.data ?? []).filter(r => r.validity === 'expiring').length, hazardOpen, hazardLate, capaLate, mrWait, poWait, lowStock, tasks, unread,
  };
  const items = ([
    [c.unread, 'accent', 'notifikasi baru', 'Belum dibaca', '/tugas'],
    [c.tasks, 'accent', 'tugas menunggu Anda', 'Persetujuan & review', '/tugas'],
    [c.mcuExp, 'crit', 'MCU expired', 'Masa berlaku habis', '/hrga/kompetensi'],
    [c.mcuSoon, 'warn', 'MCU segera expired', '≤ 30 hari lagi', '/hrga/kompetensi'],
    [c.simExp, 'crit', 'SIMPER expired', 'Izin mengoperasikan unit habis', '/hrga/kompetensi'],
    [c.simSoon, 'warn', 'SIMPER segera expired', '≤ 30 hari lagi', '/hrga/kompetensi'],
    [c.othExp, 'crit', 'sertifikat lain expired', 'Kompetensi & pelatihan', '/hrga/kompetensi'],
    [c.spipExp, 'crit', 'SPIP expired', 'Unit / alat perlu komisioning ulang', '/plant/spip'],
    [c.spipSoon, 'warn', 'SPIP segera expired', '≤ 30 hari lagi', '/plant/spip'],
    [c.hazardLate, 'crit', 'hazard lewat batas waktu', 'Belum ditutup PIC', '/she/hazard'],
    [c.capaLate, 'crit', 'action plan terlambat', 'Lewat tanggal target', '/capa'],
    [c.mrWait, 'warn', 'MR menunggu persetujuan', 'Material request', '/logistik/mr'],
    [c.poWait, 'warn', 'PO menunggu approval', 'Di atas batas nilai', '/logistik/pengadaan'],
    [c.lowStock, 'warn', 'barang di bawah stok minimum', 'Perlu PR isi ulang', '/logistik?rendah=1'],
  ] as [number, AlertTone, string, string, string][])
    .filter(([n]) => n > 0)
    .map(([n, tone, title, sub, href]): Alert => ({ n, tone, title: `${n.toLocaleString('id-ID')} ${title}`, sub, href }));
  return { counts: c, items, total: items.reduce((t, a) => t + a.n, 0) };
});
