import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { GA_CATEGORY, GA_STATUS } from '@/lib/hrga';
import { cancelGa, createGa, processGa } from '../actions';
import { HrTabs } from '../tabs';

export const metadata = { title: 'Permintaan GA' };

type Row = { id: string; request_no: string; category: string; description: string; location: string | null; needed_by: string | null; status: string;
  resolution: string | null; created_at: string; requested_by: string; requester_name: string; department_code: string | null; handler_name: string | null };

export default async function GaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('ga_register').select('*').order('created_at', { ascending: false }).limit(300);
  if (!sp.semua) q = q.in('status', ['open', 'in_progress']);
  const { data: rows } = await q.returns<Row[]>();
  const handler = s.canIn('ga.handle', 'HRGA');

  return (
    <>
      <PageHeader eyebrow="General Affairs" title="Permintaan GA" />
      <HrTabs active="/hrga/ga" />
      <form className="flex gap-2">
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="semua" value="1" defaultChecked={!!sp.semua} /> Tampilkan yang sudah selesai</label>
        <button className="text-sm text-accent">Saring</button>
      </form>
      {rows?.length ? (
        <Table head={['Nomor', 'Kategori', 'Permintaan', 'Peminta', 'Dibutuhkan', 'Status', ...(handler ? ['Proses'] : [])]}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs">{r.request_no}<div className="text-muted">{fmtDateTime(r.created_at)}</div></td>
              <td className="text-xs">{GA_CATEGORY[r.category]}</td>
              <td className="min-w-56 text-sm">{r.description}{r.location && <div className="text-xs text-muted">{r.location}</div>}
                {r.resolution && <div className="text-xs text-muted">→ {r.resolution}{r.handler_name ? ` (${r.handler_name})` : ''}</div>}</td>
              <td className="text-xs">{r.requester_name}{r.department_code ? ` · ${r.department_code}` : ''}</td>
              <td className="text-xs">{fmtDate(r.needed_by)}</td>
              <td><Pill tone={GA_STATUS[r.status][0]}>{GA_STATUS[r.status][1]}</Pill>
                {r.status === 'open' && r.requested_by === s.profile.id && <ActionForm action={cancelGa} label="Batalkan" hidden={{ id: r.id }} />}</td>
              {handler && <td className="min-w-48">{['open', 'in_progress'].includes(r.status) && (
                <div className="grid gap-1">
                  {r.status === 'open' && <ActionForm action={processGa} label="Proses" hidden={{ id: r.id, action: 'start' }} />}
                  <ActionForm action={processGa} label="Selesai" hidden={{ id: r.id, action: 'done' }}><input name="note" required className={input} placeholder="Tindakan" /></ActionForm>
                  <details><summary className="cursor-pointer text-xs text-muted">Tolak</summary>
                    <ActionForm action={processGa} label="Tolak" hidden={{ id: r.id, action: 'reject' }}><input name="note" required className={input} placeholder="Alasan" /></ActionForm></details>
                </div>)}</td>}
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Tidak ada permintaan.</p>}
      <Panel title="Ajukan permintaan">
        <ActionForm action={createGa} label="Kirim permintaan" primary hidden={{ idem: randomUUID() }} className="max-w-3xl">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm">Kategori<select name="category" className={input}>{Object.entries(GA_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="grid gap-1 text-sm">Lokasi<input name="location" className={input} placeholder="mis. Mess B-12" /></label>
            <label className="grid gap-1 text-sm">Dibutuhkan tanggal<input type="date" name="needed_by" className={input} /></label>
          </div>
          <label className="grid gap-1 text-sm">Uraian<textarea name="description" required rows={2} className={input} /></label>
        </ActionForm>
      </Panel>
    </>
  );
}
