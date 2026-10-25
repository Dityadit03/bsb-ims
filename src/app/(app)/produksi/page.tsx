import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Stat, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { REPORT_STATUS, ton } from '@/lib/production';
import { openReport } from './actions';
import { today } from '../she/fields';

export const metadata = { title: 'Produksi' };

type Row = { id: string; report_no: string; report_date: string; shift: number; status: string; supervisor_name: string;
  trips: number; tonnage: number; units: number; ton_km: number; delay_hours: number };
type Month = { tonnage_approved: number | null; tonnage_all: number; trips: number; reports: number; tonnage_target: number | null };

export default async function ProduksiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const now = today();
  const month = sp.bulan ?? now.slice(0, 7);
  const start = `${month}-01`;
  const [{ data: rows }, { data: m }, { data: target }] = await Promise.all([
    supabase.from('production_summary').select('*').gte('report_date', start).lt('report_date', nextMonth(start))
      .order('report_date', { ascending: false }).order('shift', { ascending: false }).returns<Row[]>(),
    supabase.from('production_month').select('*').eq('month', start).maybeSingle<Month>(),
    supabase.from('production_targets').select('tonnage_target').eq('month', start).maybeSingle(),
  ]);
  const goal = Number(target?.tonnage_target ?? 0);
  const done = Number(m?.tonnage_approved ?? 0);
  const waiting = (rows ?? []).filter(r => r.status === 'submitted').length;

  return (
    <>
      <PageHeader eyebrow="SMKP 4.3 · Pengelolaan operasional" title="Produksi hauling">
        <ExportLinks dataset="produksi" />
        {s.can('prod.manage') && <Link href="/produksi/master" className="text-sm text-accent hover:underline">Rute & target →</Link>}
      </PageHeader>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Tonase disetujui" value={ton(done)} note={goal ? `${((done / goal) * 100).toFixed(1)}% dari target ${ton(goal)}` : 'Target belum ditetapkan'} />
        <Stat label="Tonase semua laporan" value={ton(m?.tonnage_all ?? 0)} />
        <Stat label="Ritase" value={m?.trips ?? 0} />
        <Stat label="Menunggu persetujuan" value={waiting} />
      </div>
      {s.canIn('prod.report', 'PRD') && (
        <Panel title="Buka laporan shift">
          <ActionForm action={openReport} label="Buka laporan" primary className="max-w-xl">
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">Tanggal<input type="date" name="date" required max={now} defaultValue={now} className={input} /></label>
              <label className="grid gap-1 text-sm">Shift<select name="shift" className={input}><option value="1">Shift 1 (siang)</option><option value="2">Shift 2 (malam)</option></select></label>
            </div>
            <p className="text-xs text-muted">Bila laporan untuk tanggal dan shift itu sudah ada, laporan yang ada akan dibuka.</p>
          </ActionForm>
        </Panel>
      )}
      <form className="flex gap-2">
        <input type="month" name="bulan" defaultValue={month} className={`${input} !w-auto`} aria-label="Bulan" />
        <button className="text-sm text-accent">Tampilkan</button>
      </form>
      {rows?.length ? (
        <Table head={['Nomor', 'Tanggal', 'Shift', 'Pengawas', 'Unit', 'Ritase', 'Tonase', 'Ton·km', 'Hambatan', 'Status']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs"><Link href={`/produksi/${r.id}`} className="font-medium hover:text-accent">{r.report_no}</Link></td>
              <td className="whitespace-nowrap text-xs">{r.report_date}</td>
              <td className="text-xs">{r.shift}</td>
              <td className="text-xs">{r.supervisor_name}</td>
              <td className="tabular text-xs">{r.units}</td>
              <td className="tabular text-xs">{r.trips}</td>
              <td className="tabular text-xs">{ton(r.tonnage)}</td>
              <td className="tabular text-xs">{ton(r.ton_km)}</td>
              <td className="tabular text-xs">{r.delay_hours} jam</td>
              <td><Pill tone={REPORT_STATUS[r.status][0]}>{REPORT_STATUS[r.status][1]}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada laporan produksi bulan ini.</p>}
    </>
  );
}

function nextMonth(d: string) {
  const [y, m] = d.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
