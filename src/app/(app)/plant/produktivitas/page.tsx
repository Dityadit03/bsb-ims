import Link from 'next/link';
import { PageHeader, Pill, Stat, Table } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { PlantTabs } from '../tabs';

export const metadata = { title: 'Produktivitas unit' };

type Row = { unit_id: string; unit_no: string; unit_type: string; shifts: number; trips: number; tonnage: number; hm_worked: number; ton_per_hm: number | null;
  delay_hours: number; fuel_liters: number; l_per_ton: number | null };

const n0 = (n: number | string) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 0 });
const n1 = (n: number | string | null) => (n == null ? '–' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: 1 }));

export default async function ProductivityPage() {
  const supabase = await createClient();
  const { data } = await supabase.from('unit_productivity').select('*').returns<Row[]>();
  const all = (data ?? []).filter(r => r.unit_type === 'DT' || r.trips > 0);
  const active = all.filter(r => r.trips > 0).sort((a, b) => Number(b.tonnage) - Number(a.tonnage));
  const idle = all.filter(r => r.trips === 0);
  const tons = active.reduce((t, r) => t + Number(r.tonnage), 0);
  const hm = active.reduce((t, r) => t + Number(r.hm_worked), 0);
  const fuel = active.reduce((t, r) => t + Number(r.fuel_liters), 0);
  const withTph = active.filter(r => r.ton_per_hm != null).map(r => Number(r.ton_per_hm));
  const median = withTph.length ? [...withTph].sort((a, b) => a - b)[Math.floor(withTph.length / 2)] : null;

  return (
    <>
      <PageHeader eyebrow="SMKP 4.4 · Sarana & peralatan" title="Produktivitas unit" />
      <PlantTabs active="/plant/produktivitas" />
      <p className="-mt-2 text-sm text-muted">30 hari terakhir dari laporan produksi yang sudah dikirim atau disetujui. Unit berproduksi rendah dibanding unit sejenis patut dicek kondisi, operator, atau rute.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tonase 30 hari" value={`${n0(tons)} t`} />
        <Stat label="Unit berproduksi" value={active.length} note={idle.length ? `${idle.length} unit tanpa trip` : undefined} tone={idle.length ? 'warn' : undefined} />
        <Stat label="Ton per HM (median)" value={n1(median)} />
        <Stat label="Solar per ton" value={tons > 0 && fuel > 0 ? `${(fuel / tons).toFixed(2)} L` : '–'} note={hm ? `${n0(hm)} HM kerja` : undefined} />
      </div>
      {active.length ? (
        <Table head={['Unit', 'Shift', 'Trip', 'Tonase', 'HM kerja', 'Ton / HM', 'Solar (L)', 'L / ton', 'Tertunda (jam)']}>
          {active.map(r => {
            const low = median != null && r.ton_per_hm != null && Number(r.ton_per_hm) < median * 0.8;
            return (
              <tr key={r.unit_id}>
                <td className="font-mono text-xs"><Link href={`/plant/${r.unit_id}`} className="font-medium hover:text-accent">{r.unit_no}</Link></td>
                <td className="tabular text-xs">{r.shifts}</td>
                <td className="tabular text-xs">{n0(r.trips)}</td>
                <td className="tabular text-xs">{n0(r.tonnage)} t</td>
                <td className="tabular text-xs">{n1(r.hm_worked)}</td>
                <td className="tabular text-xs">{r.ton_per_hm != null ? (low ? <Pill tone="warn">{n1(r.ton_per_hm)}</Pill> : n1(r.ton_per_hm)) : '–'}</td>
                <td className="tabular text-xs">{r.fuel_liters ? n0(r.fuel_liters) : '–'}</td>
                <td className="tabular text-xs">{r.l_per_ton ?? '–'}</td>
                <td className="tabular text-xs">{Number(r.delay_hours) ? n1(r.delay_hours) : '–'}</td>
              </tr>
            );
          })}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada laporan produksi yang dikirim untuk 30 hari terakhir.</p>}
      {idle.length > 0 && (
        <p className="text-sm text-muted">Dump truck tanpa trip 30 hari: {idle.map(r => r.unit_no).join(', ')}.</p>
      )}
    </>
  );
}
