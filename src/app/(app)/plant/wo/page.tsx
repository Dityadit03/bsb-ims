import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/documents';
import { PRIORITY, WO_STATUS, WO_TYPE } from '@/lib/plant';

export const metadata = { title: 'Work order' };

type Row = {
  id: string; wo_no: string; unit_id: string; unit_no: string; wo_type: string; priority: string; description: string; status: string;
  reported_at: string; downtime_hours: number; mechanic_name: string | null; reporter_name: string | null;
};
type Pm = { id: string; unit_id: string; unit_no: string; task: string; current_hm: number; next_due_hm: number; remaining_hm: number; overdue: boolean; wo_open: boolean };

export default async function WoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('work_order_register').select('*').order('reported_at', { ascending: false }).limit(300);
  if (sp.status) q = q.eq('status', sp.status); else if (!sp.semua) q = q.eq('is_open', true);
  if (sp.jenis) q = q.eq('wo_type', sp.jenis);
  const [{ data: rows }, { data: pm }] = await Promise.all([
    q.returns<Row[]>(),
    supabase.from('pm_due').select('id, unit_id, unit_no, task, current_hm, next_due_hm, remaining_hm, overdue, wo_open').order('remaining_hm').returns<Pm[]>(),
  ]);

  return (
    <>
      <PageHeader eyebrow="Plant · Maintenance" title="Work order">
        <ExportLinks dataset="wo" />
        <Link href="/plant" className="text-sm text-accent hover:underline">← Register unit</Link>
      </PageHeader>
      {pm?.length ? (
        <Panel title="Servis berkala jatuh tempo">
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {pm.map(p => (
              <li key={p.id} className="flex items-center justify-between gap-2 border-b border-line py-1">
                <span><Link href={`/plant/${p.unit_id}`} className="font-mono text-xs hover:text-accent">{p.unit_no}</Link> · {p.task}</span>
                <span className={`text-xs ${p.overdue ? 'font-medium text-crit' : 'text-warn'}`}>
                  {p.wo_open ? 'WO dibuat' : p.overdue ? `lewat ${Math.abs(p.remaining_hm)} HM` : `sisa ${p.remaining_hm} HM`}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <form className="flex flex-wrap gap-2">
        <select name="status" defaultValue={sp.status ?? ''} className={`${input} w-auto`} aria-label="Status">
          <option value="">Terbuka</option>{Object.entries(WO_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="jenis" defaultValue={sp.jenis ?? ''} className={`${input} w-auto`} aria-label="Jenis">
          <option value="">Semua jenis</option>{Object.entries(WO_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="text-sm text-accent">Saring</button>
      </form>
      {rows?.length ? (
        <Table head={['Nomor', 'Unit', 'Jenis', 'Uraian', 'Prioritas', 'Mekanik', 'Downtime', 'Status']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs"><Link href={`/plant/wo/${r.id}`} className="font-medium hover:text-accent">{r.wo_no}</Link>
                <div className="text-muted">{fmtDateTime(r.reported_at)}</div></td>
              <td className="font-mono text-xs"><Link href={`/plant/${r.unit_id}`} className="hover:text-accent">{r.unit_no}</Link></td>
              <td className="text-xs">{WO_TYPE[r.wo_type]}</td>
              <td className="min-w-56"><Link href={`/plant/wo/${r.id}`} className="hover:text-accent">{r.description}</Link></td>
              <td><Pill tone={PRIORITY[r.priority][0]}>{PRIORITY[r.priority][1]}</Pill></td>
              <td className="text-xs">{r.mechanic_name ?? '–'}</td>
              <td className="tabular text-xs">{r.downtime_hours} jam</td>
              <td><Pill tone={WO_STATUS[r.status][0]}>{WO_STATUS[r.status][1]}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Tidak ada work order untuk saringan ini.</p>}
    </>
  );
}
