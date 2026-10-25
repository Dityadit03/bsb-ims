import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { PageHeader, Panel, Pill, Stat, Table } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { DOWNTIME, paTone, rp } from '@/lib/plant';
import { PlantTabs } from '../tabs';

export const metadata = { title: 'Keandalan & biaya unit' };

type Rel = { unit_id: string; unit_no: string; unit_type: string; failures_90d: number; downtime_hours_90d: number; pa_90d: number; mtbf_hours: number | null;
  mttr_hours: number | null; pm_compliance_pct: number | null; pm_opened_90d: number; ua_90d: number | null };
type Cost = { unit_id: string; total_cost_90d: number; parts_cost_90d: number; fuel_cost_90d: number; labor_cost_90d: number; hm_90d: number; cph: number | null; fuel_l_per_hm: number | null };
type Code = { code: string; wo_count: number; hours: number; unclassified: number };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f1 = (n: number | null) => (n == null ? '–' : n.toLocaleString('id-ID', { maximumFractionDigits: 1 }));

export default async function ReliabilityPage() {
  const supabase = await createClient();
  const [{ data: rel }, { data: cost }, { data: codes }] = await Promise.all([
    supabase.from('unit_reliability').select('*').order('unit_no').returns<Rel[]>(),
    supabase.from('unit_cost_summary').select('*').returns<Cost[]>(),
    supabase.from('downtime_by_code').select('*').order('hours', { ascending: false }).returns<Code[]>(),
  ]);
  const r = rel ?? [];
  const cm = new Map((cost ?? []).map(c => [c.unit_id, c]));
  const pa = avg(r.map(x => Number(x.pa_90d)));
  const mttr = avg(r.filter(x => x.mttr_hours != null).map(x => Number(x.mttr_hours)));
  const mtbf = avg(r.filter(x => x.mtbf_hours != null).map(x => Number(x.mtbf_hours)));
  const pm = avg(r.filter(x => x.pm_compliance_pct != null).map(x => Number(x.pm_compliance_pct)));
  const totalCost = (cost ?? []).reduce((t, c) => t + Number(c.total_cost_90d), 0);
  const unclassified = (codes ?? []).reduce((t, c) => t + Number(c.unclassified), 0);
  const maxH = Math.max(1, ...(codes ?? []).map(c => Number(c.hours)));

  return (
    <>
      <PageHeader eyebrow="SMKP 4.4 · Sarana & peralatan" title="Keandalan & biaya unit">
        <span className="flex gap-3"><ExportLinks dataset="keandalan" /><ExportLinks dataset="biaya_unit" /></span>
      </PageHeader>
      <PlantTabs active="/plant/keandalan" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="PA rata-rata 90 hari" value={pa == null ? '–' : `${f1(pa)}%`} tone={pa == null ? undefined : (paTone(pa) as 'ok' | 'warn' | 'crit')} note="Target kelas dunia 92–94%" />
        <Stat label="MTBF rata-rata" value={mtbf == null ? '–' : `${f1(mtbf)} jam`} note="Jam tersedia per kerusakan" />
        <Stat label="MTTR rata-rata" value={mttr == null ? '–' : `${f1(mttr)} jam`} note="Jam henti per kerusakan" />
        <Stat label="Kepatuhan PM" value={pm == null ? '–' : `${f1(pm)}%`} tone={pm == null ? undefined : pm >= 90 ? 'ok' : 'warn'} note="WO PM selesai / dibuka" />
        <Stat label="Biaya 90 hari" value={rp(totalCost)} note="Suku cadang + BBM + jam mekanik" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel title="Per unit, 90 hari terakhir" sub="MTBF/MTTR dihitung dari WO breakdown. UA dari HM awal-akhir pada ritase produksi. CPH = biaya / selisih HM.">
          {r.length ? (
            <Table head={['Unit', 'Rusak', 'MTBF', 'MTTR', 'PA', 'UA', 'PM', 'Biaya', 'CPH', 'BBM L/HM']}>
              {r.map(x => {
                const c = cm.get(x.unit_id);
                return (
                  <tr key={x.unit_id}>
                    <td className="font-mono text-xs"><Link href={`/plant/${x.unit_id}`} className="hover:text-accent">{x.unit_no}</Link></td>
                    <td className="tabular text-xs">{x.failures_90d}</td>
                    <td className="tabular text-xs">{f1(x.mtbf_hours)}</td>
                    <td className="tabular text-xs">{f1(x.mttr_hours)}</td>
                    <td><Pill tone={paTone(Number(x.pa_90d))}>{f1(Number(x.pa_90d))}%</Pill></td>
                    <td className="tabular text-xs">{x.ua_90d == null ? '–' : `${f1(Number(x.ua_90d))}%`}</td>
                    <td className="tabular text-xs">{x.pm_compliance_pct == null ? '–' : `${x.pm_compliance_pct}%`}</td>
                    <td className="tabular text-xs">{c ? rp(c.total_cost_90d) : '–'}</td>
                    <td className="tabular text-xs">{c?.cph == null ? '–' : rp(c.cph)}</td>
                    <td className="tabular text-xs">{f1(c?.fuel_l_per_hm ?? null)}</td>
                  </tr>
                );
              })}
            </Table>
          ) : <p className="text-sm text-muted">Belum ada unit.</p>}
        </Panel>
        <Panel title="Jam henti menurut kode downtime" sub="90 hari terakhir">
          {codes?.length ? (
            <ul className="grid gap-1.5">
              {codes.map(c => (
                <li key={c.code} className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-2 text-sm">
                  <span className="truncate">{DOWNTIME[c.code] ?? c.code}</span>
                  <span className="h-2.5 rounded-full bg-line/60"><span className="block h-full rounded-full bg-violet" style={{ width: `${(100 * Number(c.hours)) / maxH}%` }} /></span>
                  <span className="tabular text-right text-xs">{f1(Number(c.hours))} j</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Belum ada downtime tercatat.</p>}
          {unclassified > 0 && <p className="text-xs text-warn">{unclassified} WO belum diberi kode downtime. Isi di halaman WO agar analisis akar masalah akurat.</p>}
        </Panel>
      </div>
    </>
  );
}
