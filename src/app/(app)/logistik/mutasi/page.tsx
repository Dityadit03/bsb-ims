import Link from 'next/link';
import { PageHeader, Pill, Table, input } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/documents';
import { MOVE, qty, rp } from '@/lib/logistics';
import { LogTabs } from '../tabs';

export const metadata = { title: 'Mutasi stok' };

type Row = { id: string; movement_no: string | null; movement_type: string; moved_at: string; material_code: string; material_name: string; uom: string;
  qty: number; value: number; supplier_name: string | null; doc_ref: string | null; mr_id: string | null; mr_no: string | null;
  wo_id: string | null; wo_no: string | null; unit_no: string | null; hour_meter: number | null; note: string | null; moved_by_name: string };

export default async function MutasiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('stock_ledger').select('*').order('moved_at', { ascending: false }).limit(300);
  if (sp.jenis) q = q.eq('movement_type', sp.jenis);
  if (sp.unit) q = q.ilike('unit_no', sp.unit);
  const { data: rows } = await q.returns<Row[]>();

  return (
    <>
      <PageHeader eyebrow="Logistik" title="Mutasi stok" />
      <LogTabs active="/logistik/mutasi" />
      <form className="flex flex-wrap gap-2">
        <select name="jenis" defaultValue={sp.jenis ?? ''} className={`${input} !w-auto`} aria-label="Jenis">
          <option value="">Semua mutasi</option>{Object.entries(MOVE).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input name="unit" defaultValue={sp.unit ?? ''} className={`${input} w-32 uppercase`} placeholder="No. unit" />
        <button className="text-sm text-accent">Saring</button>
      </form>
      {rows?.length ? (
        <Table head={['Waktu', 'Nomor', 'Jenis', 'Barang', 'Jumlah', 'Nilai', 'Referensi', 'Oleh']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs">{fmtDateTime(r.moved_at)}</td>
              <td className="whitespace-nowrap font-mono text-xs">{r.movement_no ?? '–'}</td>
              <td><Pill tone={MOVE[r.movement_type][0]}>{MOVE[r.movement_type][1]}</Pill></td>
              <td className="text-sm"><span className="font-mono text-xs">{r.material_code}</span> · {r.material_name}</td>
              <td className="tabular text-xs">{Number(r.qty) > 0 ? '+' : ''}{qty(r.qty)} {r.uom}</td>
              <td className="tabular text-xs">{rp(r.value)}</td>
              <td className="text-xs">
                {r.supplier_name && <div>{r.supplier_name} · {r.doc_ref}</div>}
                {r.mr_id && <Link href={`/logistik/mr/${r.mr_id}`} className="font-mono hover:text-accent">{r.mr_no}</Link>}
                {r.wo_id && <> · <Link href={`/plant/wo/${r.wo_id}`} className="font-mono hover:text-accent">{r.wo_no}</Link></>}
                {r.unit_no && <div className="font-mono">{r.unit_no}{r.hour_meter != null && ` · HM ${r.hour_meter}`}</div>}
                {r.note && <div className="text-muted">{r.note}</div>}
              </td>
              <td className="text-xs">{r.moved_by_name}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada mutasi stok.</p>}
    </>
  );
}
