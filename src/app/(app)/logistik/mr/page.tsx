import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/documents';
import { MR_STATUS, rp } from '@/lib/logistics';
import { createMr } from '../actions';
import { LogTabs } from '../tabs';
import { DeptSelect, sheMasters } from '../../she/fields';

export const metadata = { title: 'Material request' };

type Row = { id: string; mr_no: string; status: string; purpose: string; total_value: number; created_at: string; department_code: string;
  requester_name: string; wo_id: string | null; wo_no: string | null; lines: number };

export default async function MrPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('mr_register').select('*').order('created_at', { ascending: false }).limit(300);
  if (sp.status) q = q.eq('status', sp.status); else if (!sp.semua) q = q.eq('is_open', true);
  const [{ data: rows }, { depts }, { data: materials }, { data: wos }] = await Promise.all([
    q.returns<Row[]>(), sheMasters(),
    supabase.from('material_stock').select('id, code, name, uom, stock_qty').eq('active', true).order('code'),
    supabase.from('work_order_register').select('id, wo_no, unit_no, description').eq('is_open', true).order('reported_at', { ascending: false }),
  ]);

  return (
    <>
      <PageHeader eyebrow="Logistik" title="Material request" />
      <LogTabs active="/logistik/mr" />
      <form className="flex flex-wrap gap-2">
        <select name="status" defaultValue={sp.status ?? ''} className={`${input} w-auto`} aria-label="Status">
          <option value="">Masih berjalan</option>{Object.entries(MR_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="text-sm text-accent">Saring</button>
      </form>
      {rows?.length ? (
        <Table head={['Nomor', 'Dept', 'Keperluan', 'WO', 'Peminta', 'Nilai', 'Status']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs"><Link href={`/logistik/mr/${r.id}`} className="font-medium hover:text-accent">{r.mr_no}</Link>
                <div className="text-muted">{fmtDateTime(r.created_at)}</div></td>
              <td className="text-xs">{r.department_code}</td>
              <td className="min-w-56 text-sm"><Link href={`/logistik/mr/${r.id}`} className="hover:text-accent">{r.purpose}</Link><div className="text-xs text-muted">{r.lines} barang</div></td>
              <td className="font-mono text-xs">{r.wo_id ? <Link href={`/plant/wo/${r.wo_id}`} className="hover:text-accent">{r.wo_no}</Link> : '–'}</td>
              <td className="text-xs">{r.requester_name}</td>
              <td className="tabular text-xs">{rp(r.total_value)}</td>
              <td><Pill tone={MR_STATUS[r.status][0]}>{MR_STATUS[r.status][1]}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Tidak ada material request untuk saringan ini.</p>}
      {s.can('log.request') && (
        <Panel title="Buat material request">
          <ActionForm action={createMr} label="Kirim MR" primary hidden={{ idem: randomUUID() }} className="max-w-4xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <DeptSelect depts={depts} value={s.profile.department_id} />
              <label className="grid gap-1 text-sm">Work order (wajib untuk suku cadang & ban)
                <select name="wo" className={input} defaultValue={sp.wo ?? ''}><option value="">–</option>
                  {(wos ?? []).map(w => <option key={w.id} value={w.id}>{w.wo_no} · {w.unit_no}</option>)}</select></label>
              <label className="grid gap-1 text-sm">Dibutuhkan tanggal<input type="date" name="need_date" className={input} /></label>
            </div>
            <label className="grid gap-1 text-sm">Keperluan<input name="purpose" required className={input} /></label>
            <div className="grid gap-2">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr]">
                  <select name={`material_${i}`} className={input} aria-label={`Barang ${i}`} defaultValue="" required={i === 1}>
                    <option value="">{i === 1 ? 'Pilih barang' : '– (opsional)'}</option>
                    {(materials ?? []).map(m => <option key={m.id} value={m.id}>{m.code} · {m.name} (stok {m.stock_qty} {m.uom})</option>)}
                  </select>
                  <input type="number" name={`qty_${i}`} min={0.01} step="0.01" className={input} placeholder="Jumlah" required={i === 1} />
                  <input name={`note_${i}`} className={input} placeholder="Catatan" />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">MR disetujui atasan departemen. Nilai di atas batas wajib disetujui Dept Head / PJO.</p>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
