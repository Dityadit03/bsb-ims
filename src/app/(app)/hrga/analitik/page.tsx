import { AreaChart, GroupedBars } from '@/components/charts';
import { PageHeader, Panel, Stat, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { GRADE, rp } from '@/lib/hrga';
import { HrTabs } from '../tabs';

export const metadata = { title: 'Analitik HR' };

type Month = { month: string; headcount: number; joins: number; exits: number; turnover_pct: number | null; present: number; late: number; absent: number;
  absent_pct: number | null; late_pct: number | null; overtime_hours: number; leave_days: number };
type Band = { band: string; n: number };
type Analytics = {
  generated_on: string; monthly: Month[];
  departments: { department: string; headcount: number; permanent: number; contract: number; subcon: number; ready: number; avg_tenure_years: number | null; exits_12m: number }[];
  tenure: Band[]; age: Band[]; contracts: { expired: number; expiring: number; active: number; permanent: number };
  recruitment: { open_requisitions: number; open_headcount: number; overdue: number; avg_days_to_fill: number | null; filled_period: number; funnel: Record<string, number>; local_pct: number | null };
  performance: { cycle: string | null; grades: Record<string, number>; avg_score: number | null; participants: number };
  learning: { assigned: number; completed: number; overdue: number; avg_best_score: number | null; competency_pct: number | null };
  cost: { period: string; employer_cost: number; net: number; overtime_hours: number; headcount: number }[] | null;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const mlabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;
const FUNNEL: [string, string][] = [['screening', 'Seleksi berkas'], ['psikotes', 'Psikotes'], ['interview', 'Wawancara'], ['mcu', 'MCU'], ['offering', 'Penawaran'], ['hired', 'Diterima'], ['rejected', 'Tidak lolos']];

export default async function AnalitikPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const supabase = await createClient();
  const months = [6, 12, 24].includes(Number(sp.bln)) ? Number(sp.bln) : 12;
  const [{ data: depts }, res] = await Promise.all([
    supabase.from('departments').select('id, code').order('code'),
    supabase.rpc('hr_analytics', { p_months: months, p_dept: sp.dept || null }),
  ]);
  const filter = (
    <form className="flex flex-wrap gap-2">
      <select aria-label="Periode" name="bln" defaultValue={String(months)} className={`${input} max-w-36`}>{[6, 12, 24].map(n => <option key={n} value={n}>{n} bulan</option>)}</select>
      <select aria-label="Departemen" name="dept" defaultValue={sp.dept ?? ''} className={`${input} max-w-36`}><option value="">Semua dept</option>{(depts ?? []).map(d => <option key={d.id} value={d.id}>{d.code}</option>)}</select>
      <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Terapkan</button>
    </form>
  );
  if (res.error) {
    return (<><PageHeader eyebrow="HRGA" title="Analitik HR" /><HrTabs active="/hrga/analitik" />
      <Panel><p className="text-sm text-muted">{session.canIn('hr.manage', 'HRGA') ? res.error.message : 'Analitik HR hanya untuk HRGA.'}</p></Panel></>);
  }
  const a = res.data as Analytics;
  const last = a.monthly.at(-1)!;
  const sumExit = a.monthly.reduce((n, m) => n + m.exits, 0), sumJoin = a.monthly.reduce((n, m) => n + m.joins, 0);
  const avgHc = a.monthly.reduce((n, m) => n + m.headcount, 0) / Math.max(1, a.monthly.length);
  const turnover = avgHc ? (100 * sumExit) / avgHc : 0;
  const ready = a.departments.reduce((n, d) => n + d.ready, 0);
  const hcTotal = a.departments.reduce((n, d) => n + d.headcount, 0);
  const lab = a.monthly.map(m => mlabel(m.month));
  const f = a.recruitment.funnel;
  const g = a.performance.grades;
  const gTotal = Object.values(g).reduce((n, v) => n + v, 0);

  return (
    <>
      <PageHeader eyebrow="HRGA" title="Analitik HR">{filter}</PageHeader>
      <HrTabs active="/hrga/analitik" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Karyawan aktif" value={last.headcount} note={`${sumJoin} masuk · ${sumExit} keluar (${months} bln)`} />
        <Stat label="Turnover" value={`${turnover.toFixed(1)}%`} note={`${months} bulan terakhir`} tone={turnover > 15 ? 'crit' : turnover > 8 ? 'warn' : 'ok'} />
        <Stat label="Absen (alpa)" value={last.absent_pct == null ? '–' : `${last.absent_pct}%`} note="bulan berjalan" tone={(last.absent_pct ?? 0) > 3 ? 'warn' : 'ok'} />
        <Stat label="Siap bekerja" value={`${hcTotal ? Math.round((100 * ready) / hcTotal) : 0}%`} note={`${ready} dari ${hcTotal}`} tone={ready === hcTotal ? 'ok' : 'warn'} />
        <Stat label="Kontrak bermasalah" value={a.contracts.expired + a.contracts.expiring} note={`${a.contracts.expired} habis · ${a.contracts.expiring} segera`} tone={a.contracts.expired ? 'crit' : a.contracts.expiring ? 'warn' : 'ok'} href="/hrga/kesiapan" />
        <Stat label="Lowongan terbuka" value={a.recruitment.open_headcount} note={`${a.recruitment.open_requisitions} FPTK`} href="/hrga/rekrutmen" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Jumlah karyawan" sub="Akhir tiap bulan"><AreaChart label="Jumlah karyawan" data={a.monthly.map((m, i) => ({ label: lab[i], value: m.headcount }))} /></Panel>
        <Panel title="Karyawan masuk dan keluar">
          <GroupedBars label="Masuk dan keluar" labels={lab} series={[
            { name: 'Masuk', color: 'var(--color-ok)', values: a.monthly.map(m => m.joins) },
            { name: 'Keluar', color: 'var(--color-crit)', values: a.monthly.map(m => m.exits) }]} />
        </Panel>
        <Panel title="Ketidakhadiran" sub="% hari terjadwal tanpa keterangan (alpa) dan % terlambat dari hari hadir">
          <GroupedBars label="Alpa dan terlambat (%)" labels={lab} series={[
            { name: 'Alpa %', color: 'var(--color-crit)', values: a.monthly.map(m => m.absent_pct ?? 0) },
            { name: 'Terlambat %', color: 'var(--color-warn)', values: a.monthly.map(m => m.late_pct ?? 0) }]} />
        </Panel>
        <Panel title="Jam lembur disetujui"><AreaChart label="Jam lembur" suffix=" jam" color="var(--color-violet)" data={a.monthly.map((m, i) => ({ label: lab[i], value: Number(m.overtime_hours) }))} /></Panel>
      </div>

      <Panel title="Per departemen" sub="Karyawan aktif saat ini">
        <Table head={['Dept', 'Karyawan', 'Tetap', 'Kontrak', 'Subkon', 'Siap kerja', 'Masa kerja rata-rata', 'Keluar 12 bln']}>
          {a.departments.map(d => (
            <tr key={d.department}>
              <td className="font-mono text-xs font-semibold">{d.department}</td>
              <td className="tabular text-sm">{d.headcount}</td><td className="tabular text-sm">{d.permanent}</td><td className="tabular text-sm">{d.contract}</td><td className="tabular text-sm">{d.subcon}</td>
              <td className="tabular text-sm">{d.ready}/{d.headcount} <span className="text-muted">({d.headcount ? Math.round((100 * d.ready) / d.headcount) : 0}%)</span></td>
              <td className="tabular text-sm">{d.avg_tenure_years ?? '–'} th</td><td className="tabular text-sm">{d.exits_12m}</td>
            </tr>
          ))}
        </Table>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Komposisi masa kerja dan usia">
          <div className="grid gap-4 sm:grid-cols-2">
            {[['Masa kerja', a.tenure], ['Usia', a.age]].map(([title, bands]) => {
              const bs = bands as Band[], mx = Math.max(1, ...bs.map(b => b.n));
              return (
                <ul key={title as string} className="grid content-start gap-1.5">
                  <li className="text-xs font-semibold text-muted">{title as string}</li>
                  {bs.map(b => (
                    <li key={b.band} className="grid grid-cols-[5rem_1fr_2rem] items-center gap-2 text-sm">
                      <span>{b.band}</span>
                      <span className="h-2.5 rounded-full bg-line/60"><span className="block h-full rounded-full bg-violet" style={{ width: `${(100 * b.n) / mx}%` }} /></span>
                      <span className="tabular text-right">{b.n}</span>
                    </li>
                  ))}
                </ul>
              );
            })}
          </div>
        </Panel>
        <Panel title="Rekrutmen" sub={`${months} bulan terakhir`}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm [&_dd]:tabular [&_dd]:text-right [&_dt]:text-muted">
            <dt>FPTK terisi</dt><dd>{a.recruitment.filled_period}</dd>
            <dt>Rata-rata hari sampai terisi</dt><dd>{a.recruitment.avg_days_to_fill ?? '–'}</dd>
            <dt>FPTK lewat tanggal dibutuhkan</dt><dd className={a.recruitment.overdue ? 'text-crit' : ''}>{a.recruitment.overdue}</dd>
            <dt>Diterima dari tenaga lokal</dt><dd>{a.recruitment.local_pct == null ? '–' : `${a.recruitment.local_pct}%`}</dd>
          </dl>
          <ul className="grid gap-1.5">
            {FUNNEL.map(([k, label]) => {
              const mx = Math.max(1, ...FUNNEL.map(([x]) => f[x] ?? 0));
              return (
                <li key={k} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-sm">
                  <span>{label}</span>
                  <span className="h-2.5 rounded-full bg-line/60"><span className={`block h-full rounded-full ${k === 'rejected' ? 'bg-crit' : 'bg-violet'}`} style={{ width: `${(100 * (f[k] ?? 0)) / mx}%` }} /></span>
                  <span className="tabular text-right">{f[k] ?? 0}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Kinerja" sub={a.performance.cycle ? `${a.performance.cycle} · ${a.performance.participants} peserta · rata-rata ${a.performance.avg_score ?? '–'}` : 'Belum ada siklus yang ditutup'}>
          {gTotal ? (
            <ul className="grid gap-1.5">
              {Object.entries(GRADE).map(([k, v]) => (
                <li key={k} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-2 text-sm">
                  <span>{k} · {v[1]}</span>
                  <span className="h-2.5 rounded-full bg-line/60"><span className="block h-full rounded-full bg-violet" style={{ width: `${(100 * (g[k] ?? 0)) / Math.max(1, ...Object.values(g))}%` }} /></span>
                  <span className="tabular text-right">{g[k] ?? 0}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Sebaran predikat muncul setelah siklus penilaian ditutup.</p>}
        </Panel>
        <Panel title="Pelatihan dan kompetensi">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm [&_dd]:tabular [&_dd]:text-right [&_dt]:text-muted">
            <dt>Kepatuhan kompetensi wajib</dt><dd>{a.learning.competency_pct == null ? '–' : `${a.learning.competency_pct}%`}</dd>
            <dt>Penugasan e-learning</dt><dd>{a.learning.assigned}</dd>
            <dt>Lulus</dt><dd>{a.learning.completed}{a.learning.assigned ? ` (${Math.round((100 * a.learning.completed) / a.learning.assigned)}%)` : ''}</dd>
            <dt>Lewat tenggat</dt><dd className={a.learning.overdue ? 'text-crit' : ''}>{a.learning.overdue}</dd>
            <dt>Nilai terbaik rata-rata</dt><dd>{a.learning.avg_best_score ?? '–'}</dd>
          </dl>
        </Panel>
      </div>

      {a.cost && (
        <Panel title="Biaya tenaga kerja" sub="Dari proses gaji yang sudah terbit (bukan uji paralel): bruto + BPJS perusahaan">
          {a.cost.length ? (
            <Table head={['Periode', 'Karyawan', 'Biaya perusahaan', 'Gaji bersih', 'Jam lembur', 'Biaya per karyawan']}>
              {a.cost.map(c => (
                <tr key={c.period}>
                  <td className="font-mono text-xs">{c.period}</td><td className="tabular text-sm">{c.headcount}</td>
                  <td className="tabular text-sm">{rp(c.employer_cost)}</td><td className="tabular text-sm">{rp(c.net)}</td>
                  <td className="tabular text-sm">{c.overtime_hours}</td><td className="tabular text-sm">{c.headcount ? rp(Math.round(c.employer_cost / c.headcount)) : '–'}</td>
                </tr>
              ))}
            </Table>
          ) : <p className="text-sm text-muted">Belum ada proses gaji yang terbit.</p>}
        </Panel>
      )}
    </>
  );
}
