import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { PageHeader, Pill, Table, input } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/documents';
import { qty, rp } from '@/lib/logistics';
import { LogTabs } from '../tabs';

export const metadata = { title: 'Pengeluaran gudang ke plant' };

type Row = { id: string; movement_no: string | null; moved_at: string; issue_date: string; mr_id: string; mr_no: string; department_code: string;
  material_code: string; material_name: string; uom: string; qty: number; value: number; unit_no: string | null; wo_no: string | null;
  requester_name: string; issued_by_name: string; received: boolean; received_by_name: string | null; received_at: string | null };

export default async function PengeluaranPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('stock_issue_report').select('*').order('moved_at', { ascending: false }).limit(500);
  if (sp.dari) q = q.gte('issue_date', sp.dari);
  if (sp.sampai) q = q.lte('issue_date', sp.sampai);
  if (sp.unit) q = q.ilike('unit_no', sp.unit);
  if (sp.status === 'belum') q = q.eq('received', false);
  if (sp.status === 'sudah') q = q.eq('received', true);
  const { data: rows } = await q.returns<Row[]>();
  const total = (rows ?? []).reduce((t, r) => t + Number(r.value), 0);
  const pending = (rows ?? []).filter(r => !r.received).length;

  return (
    <>
      <PageHeader eyebrow="Logistik" title="Pengeluaran gudang ke plant"><ExportLinks dataset="pengeluaran" /></PageHeader>
      <LogTabs active="/logistik/pengeluaran" />
      <form className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted">Dari<input type="date" name="dari" defaultValue={sp.dari ?? ''} className={`${input} !w-auto`} /></label>
        <label className="grid gap-1 text-xs text-muted">Sampai<input type="date" name="sampai" defaultValue={sp.sampai ?? ''} className={`${input} !w-auto`} /></label>
        <input name="unit" defaultValue={sp.unit ?? ''} className={`${input} w-32 uppercase`} placeholder="No. unit" />
        <select name="status" defaultValue={sp.status ?? ''} className={`${input} !w-auto`} aria-label="Penerimaan">
          <option value="">Semua</option><option value="belum">Belum dikonfirmasi</option><option value="sudah">Sudah diterima</option>
        </select>
        <button className="text-sm text-accent">Saring</button>
      </form>
      <p className="text-sm text-muted">{rows?.length ?? 0} pengeluaran · nilai {rp(total)} · {pending} menunggu konfirmasi penerimaan</p>
      {rows?.length ? (
        <Table head={['Waktu', 'GI / MR', 'Barang', 'Jumlah', 'Nilai', 'Unit / WO', 'Penerimaan']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs">{fmtDateTime(r.moved_at)}<div className="text-muted">{r.issued_by_name}</div></td>
              <td className="whitespace-nowrap font-mono text-xs">{r.movement_no ?? '–'}
                <div><Link href={`/logistik/mr/${r.mr_id}`} className="text-accent">{r.mr_no}</Link> · {r.department_code}</div></td>
              <td className="text-sm"><span className="font-mono text-xs">{r.material_code}</span> · {r.material_name}</td>
              <td className="tabular text-xs">{qty(r.qty)} {r.uom}</td>
              <td className="tabular text-xs">{rp(r.value)}</td>
              <td className="font-mono text-xs">{r.unit_no ?? '–'}{r.wo_no && <div className="text-muted">{r.wo_no}</div>}</td>
              <td className="text-xs">{r.received ? <><Pill tone="ok">Diterima</Pill><div className="mt-1 text-muted">{r.received_by_name} · {fmtDateTime(r.received_at)}</div></>
                : <><Pill tone="warn">Belum</Pill><div className="mt-1 text-muted">Peminta: {r.requester_name}</div></>}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada pengeluaran untuk saringan ini.</p>}
    </>
  );
}
