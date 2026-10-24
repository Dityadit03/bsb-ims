import Link from 'next/link';
import { AreaChart, GroupedBars } from '@/components/charts';
import { Panel, Stat, btnGhost, btnPrimary } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Ringkasan' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const num = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
type Tone = 'crit' | 'warn' | 'accent';
type Todo = { tone: Tone; title: string; sub: string; href: string };
type Cert = { employee_id: string; competency_id: string; competency_code: string; category: string; valid_until: string | null; validity: string };
type Sap = { week_start: string; week_no: number; on_leave: boolean; obs_target: number; obs_act: number; insp_target: number; insp_act: number; hazard_target: number; hazard_act: number };

// Jam & tanggal site (WITA)
function siteNow() {
  const d = new Date(Date.now() + 8 * 3600000);
  return { hour: d.getUTCHours(), iso: d.toISOString().slice(0, 10), year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

export default async function HomePage() {
  const s = await getSession();
  const supabase = await createClient();
  const now = siteNow();
  const yearStart = `${now.year}-01-01`;
  const count = (q: PromiseLike<{ count: number | null }>) => q.then(r => r.count ?? 0);
  const head = { count: 'exact' as const, head: true };

  const [emps, incidents, certs, spip, hazardOpen, hazardLate, capaLate, mrWait, poWait, lowStock, tasks, prod, sap] = await Promise.all([
    supabase.from('employee_register').select('department_code, required, compliant').eq('status', 'active').limit(5000),
    supabase.from('incident_register').select('classification, occurred_at').gte('occurred_at', yearStart).limit(5000),
    supabase.from('employee_competency_view').select('employee_id, competency_id, competency_code, category, valid_until, validity')
      .neq('validity', 'revoked').limit(20000).returns<Cert[]>(),
    supabase.from('commissioning_register').select('validity').in('validity', ['expired', 'expiring']).limit(5000),
    count(supabase.from('she_hazard_register').select('*', head).eq('status', 'open')),
    count(supabase.from('she_hazard_register').select('*', head).eq('is_overdue', true)),
    count(supabase.from('capa_register').select('*', head).eq('is_overdue', true)),
    count(supabase.from('mr_register').select('*', head).in('status', ['submitted', 'pending'])),
    count(supabase.from('po_register').select('*', head).eq('status', 'awaiting_approval')),
    count(supabase.from('material_stock').select('*', head).eq('low_stock', true)),
    supabase.rpc('my_tasks').then(r => (r.data as unknown[] | null)?.length ?? 0),
    supabase.from('production_month').select('month, tonnage_approved, tonnage_all').gte('month', yearStart).order('month'),
    supabase.from('sap_weekly').select('week_start, week_no, on_leave, obs_target, obs_act, insp_target, insp_act, hazard_target, hazard_act')
      .lte('week_start', new Date(Date.now() + 8 * 3600000 - 7 * 86400000).toISOString().slice(0, 10)).order('week_start', { ascending: false }).limit(1500).returns<Sap[]>(),
  ]);

  // ---------------------------------------------------------------- angka
  const empRows = emps.data ?? [];
  const depts = new Set(empRows.map(e => e.department_code)).size;
  const req = empRows.reduce((t, e) => t + Number(e.required ?? 0), 0);
  const ok = empRows.reduce((t, e) => t + Number(e.compliant ?? 0), 0);
  const inc = incidents.data ?? [];
  const lti = inc.filter(i => ['lti', 'fatality'].includes(i.classification)).length;
  const nearmiss = inc.filter(i => i.classification === 'nearmiss').length;
  // sertifikat terbaru per karyawan & kompetensi
  const latest = new Map<string, Cert>();
  for (const c of certs.data ?? []) {
    const k = `${c.employee_id}:${c.competency_id}`, p = latest.get(k);
    if (!p || (c.valid_until ?? '9999') > (p.valid_until ?? '9999')) latest.set(k, c);
  }
  const certCount = (pred: (c: Cert) => boolean, v: string) => [...latest.values()].filter(c => pred(c) && c.validity === v).length;
  const isMcu = (c: Cert) => c.category === 'medical';
  const isSimper = (c: Cert) => c.category === 'authorization';
  const isOther = (c: Cert) => !isMcu(c) && !isSimper(c);
  const mcuExp = certCount(isMcu, 'expired'), mcuSoon = certCount(isMcu, 'expiring');
  const simExp = certCount(isSimper, 'expired'), simSoon = certCount(isSimper, 'expiring');
  const othExp = certCount(isOther, 'expired');
  const spipExp = (spip.data ?? []).filter(r => r.validity === 'expired').length;
  const spipSoon = (spip.data ?? []).filter(r => r.validity === 'expiring').length;

  const todos = ([
    [mcuExp, 'crit', 'MCU expired', 'Masa berlaku habis', '/hrga/kompetensi'],
    [mcuSoon, 'warn', 'MCU segera expired', '≤ 30 hari lagi', '/hrga/kompetensi'],
    [simExp, 'crit', 'SIMPER expired', 'Izin mengoperasikan unit habis', '/hrga/kompetensi'],
    [simSoon, 'warn', 'SIMPER segera expired', '≤ 30 hari lagi', '/hrga/kompetensi'],
    [othExp, 'crit', 'Sertifikat lain expired', 'Kompetensi & pelatihan', '/hrga/kompetensi'],
    [spipExp, 'crit', 'Komisioning SPIP expired', 'Unit / alat perlu uji ulang', '/plant/spip'],
    [spipSoon, 'warn', 'Komisioning SPIP segera expired', '≤ 30 hari lagi', '/plant/spip'],
    [hazardLate, 'crit', 'Hazard lewat batas waktu', 'Belum ditutup PIC', '/she/hazard'],
    [capaLate, 'crit', 'Action plan terlambat', 'Lewat tanggal target', '/capa'],
    [tasks, 'accent', 'Tugas menunggu Anda', 'Persetujuan & review', '/tugas'],
    [mrWait, 'warn', 'MR menunggu persetujuan', 'Material request', '/logistik/mr'],
    [poWait, 'warn', 'PO menunggu approval', 'Di atas batas nilai', '/logistik/pengadaan'],
    [lowStock, 'warn', 'Stok di bawah minimum', 'Perlu PR isi ulang', '/logistik?rendah=1'],
  ] as [number, Tone, string, string, string][])
    .filter(([n]) => n > 0)
    .map(([n, tone, title, sub, href]): Todo & { n: number } => ({ n, tone, title: `${num.format(n)} ${title}`, sub, href }));

  // ---------------------------------------------------------------- grafik
  const months = MONTHS.slice(0, now.month + 1);
  const prodBy = new Map((prod.data ?? []).map(p => [Number(String(p.month).slice(5, 7)) - 1, Number(p.tonnage_approved ?? p.tonnage_all ?? 0)]));
  const prodData = months.map((m, i) => ({ label: m, value: prodBy.get(i) ?? (i <= now.month ? 0 : null) }));
  const prodYtd = [...prodBy.values()].reduce((t, v) => t + v, 0);
  const perMonth = (pred: (c: string) => boolean) => months.map((_, i) => inc.filter(x => pred(x.classification) && Number(x.occurred_at.slice(5, 7)) - 1 === i).length);
  const weeks = new Map<string, { no: number; sum: number; n: number }>();
  for (const r of sap.data ?? []) {
    if (r.on_leave) continue;
    const a = (act: number, plan: number) => (Number(plan) > 0 ? Math.min(Number(act) / Number(plan), 1) : 1);
    const w = weeks.get(r.week_start) ?? { no: r.week_no, sum: 0, n: 0 };
    w.sum += (a(r.obs_act, r.obs_target) + a(r.insp_act, r.insp_target) + a(r.hazard_act, r.hazard_target)) / 3;
    w.n += 1;
    weeks.set(r.week_start, w);
  }
  const sapData = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12)
    .map(([, w]) => ({ label: `W${w.no}`, value: Math.round((w.sum / w.n) * 100) }));

  const first = (s.profile.full_name ?? s.profile.email).split(' ')[0];
  const greet = now.hour < 11 ? 'pagi' : now.hour < 15 ? 'siang' : now.hour < 18 ? 'sore' : 'malam';
  const date = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar' });
  const open = (href: string) => <Link href={href} className="shrink-0 text-xs font-semibold text-violet underline underline-offset-2">Buka →</Link>;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1.5">
          <span className="font-mono text-xs uppercase tracking-wider text-muted">{date}</span>
          <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">Selamat {greet}, {first}</h1>
          <p className="text-sm text-muted">Ringkasan keselamatan, kompetensi, plant dan logistik site PT BDA.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/she" className={btnGhost}>Isi formulir harian</Link>
          <Link href="/data/impor" className={btnPrimary}>Upload data</Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Karyawan aktif" value={num.format(empRows.length)} note={`${depts} departemen`} href="/hrga" />
        <Stat label="LTI" value={lti} tone={lti ? 'crit' : 'ok'} note={`${nearmiss} nearmiss · ${inc.length} insiden YTD`} href="/she/insiden" />
        <Stat label="Hazard terbuka" value={hazardOpen} tone={hazardLate ? 'warn' : undefined} note={`${hazardLate} lewat batas waktu`} href="/she/hazard" />
        <Stat label="SIMPER expired" value={simExp} tone={simExp ? 'crit' : undefined} note={`${simSoon} segera ≤30 hari`} href="/hrga/kompetensi" />
        <Stat label="MCU expired" value={mcuExp} tone={mcuExp ? 'crit' : undefined} note={`${mcuSoon} segera ≤30 hari`} href="/hrga/kompetensi" />
        <Stat label="Kompetensi wajib" value={req ? `${Math.round((ok / req) * 100)}%` : '–'} tone={req && ok / req < 0.8 ? 'warn' : undefined}
          note={`${num.format(ok)} dari ${num.format(req)} terpenuhi`} href="/hrga/kompetensi" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel title={`Produksi hauling bulanan ${now.year}`} sub={`Total ${num.format(prodYtd)} ton YTD · laporan disetujui`} action={open('/produksi')}>
          <AreaChart data={prodData} label="Tonase per bulan" />
        </Panel>
        <Panel title="Perlu tindakan" sub={todos.length ? `${todos.length} hal menunggu tindak lanjut` : 'Tidak ada yang tertunda'} action={open('/tugas')}>
          <ul className="-mr-2 grid max-h-80 gap-2 overflow-y-auto pr-2">
            {todos.map(t => (
              <li key={t.title}>
                <Link href={t.href} className="flex items-start gap-3 rounded-xl border border-line px-3 py-2.5 transition-colors hover:border-violet/50">
                  <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${t.tone === 'crit' ? 'bg-crit' : t.tone === 'warn' ? 'bg-orange' : 'bg-violet'}`} />
                  <span className="grid">
                    <span className="text-sm font-semibold">{t.title}</span>
                    <span className="text-xs text-muted">{t.sub}</span>
                  </span>
                </Link>
              </li>
            ))}
            {!todos.length && <li className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-muted">Semua beres 👍</li>}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Nearmiss & insiden per bulan" sub={`Indikator lagging · LTI ${lti} sepanjang ${now.year}`} action={open('/she/insiden')}>
          <GroupedBars label="Nearmiss dan insiden per bulan" labels={months} series={[
            { name: 'Nearmiss', color: 'var(--color-orange)', values: perMonth(c => c === 'nearmiss') },
            { name: 'Insiden', color: 'var(--color-violet)', values: perMonth(c => c !== 'nearmiss') },
          ]} />
        </Panel>
        <Panel title="Capaian SAP mingguan" sub="Indikator leading · rata-rata capaian observasi, inspeksi & hazard (minggu yang sudah selesai)" action={open('/she/sap')}>
          {sapData.length
            ? <AreaChart data={sapData} color="var(--color-ok)" suffix="%" max={100} height={220} label="Capaian SAP per minggu" />
            : <p className="py-10 text-center text-sm text-muted">Belum ada data SAP.</p>}
        </Panel>
      </div>
    </>
  );
}
