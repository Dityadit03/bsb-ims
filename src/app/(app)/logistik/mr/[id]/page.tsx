import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { MR_STATUS, qty, rp } from '@/lib/logistics';
import { cancelMr, issueGoods, reviewMr } from '../../actions';

type Mr = { id: string; mr_no: string; status: string; purpose: string; need_date: string | null; total_value: number; created_at: string;
  department_code: string; requested_by: string; requester_name: string; wo_id: string | null; wo_no: string | null;
  reviewed_at: string | null; reviewer_name: string | null; review_note: string | null };
type Line = { id: string; qty: number; qty_issued: number; note: string | null; materials: { code: string; name: string; uom: string; stock_qty: number } };

export default async function MrDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: r } = await supabase.from('mr_register').select('*').eq('id', id).maybeSingle<Mr>();
  if (!r) notFound();
  const [{ data: lines }, { data: moves }] = await Promise.all([
    supabase.from('material_request_lines').select('id, qty, qty_issued, note, materials(code, name, uom, stock_qty)').eq('mr_id', id).returns<Line[]>(),
    supabase.from('stock_ledger').select('id, movement_no, moved_at, material_code, qty, moved_by_name').eq('mr_id', id).order('moved_at'),
  ]);
  const mine = r.requested_by === s.profile.id;
  const review = r.status === 'submitted' && !mine && (s.can('log.approve') || s.can('log.approve_high'));
  const issue = ['approved', 'partial'].includes(r.status) && s.canIn('log.warehouse', 'LOG');
  const cancel = ['submitted', 'approved'].includes(r.status) && (mine || s.canIn('log.manage', 'LOG'));

  return (
    <>
      <PageHeader eyebrow={`Material request · ${r.department_code}`} title={r.mr_no}>
        <Pill tone={MR_STATUS[r.status][0]}>{MR_STATUS[r.status][1]}</Pill>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel title={r.purpose}>
            <Table head={['Barang', 'Diminta', 'Dikeluarkan', 'Stok gudang', 'Catatan']}>
              {(lines ?? []).map(l => (
                <tr key={l.id}>
                  <td className="text-sm"><span className="font-mono text-xs">{l.materials.code}</span> · {l.materials.name}</td>
                  <td className="tabular text-xs">{qty(l.qty)} {l.materials.uom}</td>
                  <td className="tabular text-xs">{qty(l.qty_issued)}</td>
                  <td className="tabular text-xs">{qty(l.materials.stock_qty)}</td>
                  <td className="text-xs">{l.note ?? '–'}</td>
                </tr>
              ))}
            </Table>
            {r.review_note && <p className="text-sm text-muted">Catatan: {r.review_note}</p>}
          </Panel>
          {review && (
            <Panel title="Persetujuan">
              <ActionForm action={reviewMr} label="Setujui" primary hidden={{ id: r.id, decision: 'approve' }} />
              <ActionForm action={reviewMr} label="Tolak" hidden={{ id: r.id, decision: 'reject' }}>
                <input name="note" required className={input} placeholder="Alasan penolakan" />
              </ActionForm>
            </Panel>
          )}
          {issue && (
            <Panel title="Keluarkan barang (GI)">
              <ActionForm action={issueGoods} label="Keluarkan" primary hidden={{ id: r.id, idem: randomUUID() }}>
                {(lines ?? []).filter(l => Number(l.qty_issued) < Number(l.qty)).map(l => (
                  <label key={l.id} className="grid grid-cols-[2fr_1fr] items-center gap-2 text-sm">
                    <span>{l.materials.code} · sisa {qty(Number(l.qty) - Number(l.qty_issued))} {l.materials.uom}</span>
                    <input type="hidden" name="line" value={l.id} />
                    <input type="number" name={`qty_${l.id}`} min={0} max={Number(l.qty) - Number(l.qty_issued)} step="0.01"
                      defaultValue={Math.min(Number(l.qty) - Number(l.qty_issued), Number(l.materials.stock_qty))} className={input} />
                  </label>
                ))}
                <input name="note" className={input} placeholder="Diterima oleh / catatan" />
              </ActionForm>
            </Panel>
          )}
          {moves?.length ? (
            <Panel title="Riwayat pengeluaran">
              <ul className="grid gap-1 text-sm">{moves.map(m => <li key={m.id} className="flex justify-between gap-2 border-b border-line py-1">
                <span className="font-mono text-xs">{m.movement_no} · {m.material_code} · {qty(Math.abs(Number(m.qty)))}</span>
                <span className="text-xs text-muted">{fmtDateTime(m.moved_at)} · {m.moved_by_name}</span></li>)}</ul>
            </Panel>
          ) : null}
          {cancel && (
            <Panel title="Batalkan">
              <ActionForm action={cancelMr} label="Batalkan MR" hidden={{ id: r.id }}>
                <input name="reason" required className={input} placeholder="Alasan pembatalan" />
              </ActionForm>
            </Panel>
          )}
        </div>
        <Panel title="Rincian">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
            <dt>Peminta</dt><dd>{r.requester_name}<span className="block text-xs text-muted">{fmtDateTime(r.created_at)}</span></dd>
            <dt>Dibutuhkan</dt><dd>{fmtDate(r.need_date)}</dd>
            <dt>Work order</dt><dd>{r.wo_id ? <Link href={`/plant/wo/${r.wo_id}`} className="font-mono text-accent">{r.wo_no}</Link> : '–'}</dd>
            <dt>Nilai</dt><dd className="tabular">{rp(r.total_value)}</dd>
            <dt>Diperiksa</dt><dd>{r.reviewer_name ?? '–'}{r.reviewed_at && <span className="block text-xs text-muted">{fmtDateTime(r.reviewed_at)}</span>}</dd>
          </dl>
        </Panel>
      </div>
    </>
  );
}
