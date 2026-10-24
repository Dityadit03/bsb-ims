import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { MR_STATUS, STAGE, qty, rp } from '@/lib/logistics';
import { cancelMr, decideMr, issueGoods, prFromMr } from '../../actions';

type Mr = { id: string; mr_no: string; status: string; purpose: string; need_date: string | null; total_value: number; created_at: string;
  department_code: string; requested_by: string; requester_name: string; wo_id: string | null; wo_no: string | null;
  reviewed_at: string | null; reviewer_name: string | null; review_note: string | null };
type Line = { mr_line_id: string; material_code: string; material_name: string; uom: string; qty: number; qty_approved: number | null;
  qty_issued: number; qty_open: number; stock_qty: number; stage: string; pr_id: string | null; pr_no: string | null; po_no: string | null; supplier_name: string | null };

export default async function MrDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: r } = await supabase.from('mr_register').select('*').eq('id', id).maybeSingle<Mr>();
  if (!r) notFound();
  const [{ data: lines }, { data: notes }, { data: moves }] = await Promise.all([
    supabase.from('mr_tracking').select('*').eq('mr_id', id).order('material_code').returns<Line[]>(),
    supabase.from('material_request_lines').select('id, note').eq('mr_id', id),
    supabase.from('stock_ledger').select('id, movement_no, moved_at, material_code, qty, moved_by_name').eq('mr_id', id).order('moved_at'),
  ]);
  const mine = r.requested_by === s.profile.id;
  const note = new Map((notes ?? []).map(n => [n.id as string, n.note as string | null]));
  const review = ['submitted', 'pending'].includes(r.status) && !mine && (s.can('log.approve') || s.can('log.approve_high'));
  const open = ['approved', 'partial'].includes(r.status);
  const issue = open && s.canIn('log.warehouse', 'LOG');
  const short = open && s.canIn('log.purchase', 'LOG') && (lines ?? []).some(l => l.stage === 'short');
  const prs = [...new Map((lines ?? []).filter(l => l.pr_id).map(l => [l.pr_id!, l.pr_no!])).entries()];
  const cancel = ['submitted', 'approved'].includes(r.status) && (mine || s.canIn('log.manage', 'LOG'));

  return (
    <>
      <PageHeader eyebrow={`Material request · ${r.department_code}`} title={r.mr_no}>
        <Pill tone={MR_STATUS[r.status][0]}>{MR_STATUS[r.status][1]}</Pill>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel title={r.purpose}>
            <Table head={['Barang', 'Diminta', 'Disetujui', 'Keluar', 'Stok', 'Posisi']}>
              {(lines ?? []).map(l => (
                <tr key={l.mr_line_id}>
                  <td className="text-sm"><span className="font-mono text-xs">{l.material_code}</span> · {l.material_name}
                    {note.get(l.mr_line_id) && <div className="text-xs text-muted">{note.get(l.mr_line_id)}</div>}</td>
                  <td className="tabular text-xs">{qty(l.qty)} {l.uom}</td>
                  <td className="tabular text-xs">{l.qty_approved == null ? '–' : qty(l.qty_approved)}</td>
                  <td className="tabular text-xs">{qty(l.qty_issued)}</td>
                  <td className="tabular text-xs">{qty(l.stock_qty)}</td>
                  <td className="text-xs"><Pill tone={STAGE[l.stage][0]}>{STAGE[l.stage][1]}</Pill>
                    {(l.po_no || l.pr_no) && <div className="mt-1 font-mono text-muted">{l.po_no ? `${l.po_no} · ${l.supplier_name}` : l.pr_no}</div>}</td>
                </tr>
              ))}
            </Table>
            {r.review_note && <p className="text-sm text-muted">Catatan: {r.review_note}</p>}
          </Panel>
          {review && (
            <Panel title="Persetujuan">
              <ActionForm action={decideMr} label="Setujui" primary hidden={{ id: r.id, decision: 'approve' }}>
                <p className="text-xs text-muted">Jumlah bisa dikurangi; isi 0 untuk menolak satu baris.</p>
                {(lines ?? []).map(l => (
                  <label key={l.mr_line_id} className="grid grid-cols-[2fr_1fr] items-center gap-2 text-sm">
                    <span>{l.material_code} · diminta {qty(l.qty)} {l.uom}</span>
                    <input type="hidden" name="line" value={l.mr_line_id} />
                    <input type="number" name={`qty_${l.mr_line_id}`} min={0} max={Number(l.qty)} step="0.01" defaultValue={Number(l.qty)} className={input} />
                  </label>
                ))}
                <input name="note" className={input} placeholder="Catatan (opsional)" />
              </ActionForm>
              <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                <ActionForm action={decideMr} label="Pending" hidden={{ id: r.id, decision: 'pending' }}>
                  <input name="note" required className={input} placeholder="Yang perlu dilengkapi peminta" />
                </ActionForm>
                <ActionForm action={decideMr} label="Tolak" hidden={{ id: r.id, decision: 'reject' }}>
                  <input name="note" required className={input} placeholder="Alasan penolakan" />
                </ActionForm>
              </div>
            </Panel>
          )}
          {short && (
            <Panel title="Stok kurang">
              <ActionForm action={prFromMr} label="Buat PR dari kekurangan" primary hidden={{ id: r.id, idem: randomUUID() }}>
                <p className="text-sm text-muted">Jumlah yang dibeli dihitung otomatis: sisa disetujui dikurangi stok gudang dan PR yang sudah berjalan.</p>
              </ActionForm>
            </Panel>
          )}
          {issue && (
            <Panel title="Keluarkan barang (GI)">
              <ActionForm action={issueGoods} label="Keluarkan" primary hidden={{ id: r.id, idem: randomUUID() }}>
                {(lines ?? []).filter(l => Number(l.qty_open) > 0).map(l => (
                  <label key={l.mr_line_id} className="grid grid-cols-[2fr_1fr] items-center gap-2 text-sm">
                    <span>{l.material_code} · sisa {qty(l.qty_open)} {l.uom}</span>
                    <input type="hidden" name="line" value={l.mr_line_id} />
                    <input type="number" name={`qty_${l.mr_line_id}`} min={0} max={Number(l.qty_open)} step="0.01"
                      defaultValue={Math.max(0, Math.min(Number(l.qty_open), Number(l.stock_qty)))} className={input} />
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
            <dt>Pembelian</dt><dd>{prs.length ? prs.map(([pid, no]) => <Link key={pid} href={`/logistik/pengadaan/${pid}`} className="block font-mono text-accent">{no}</Link>) : '–'}</dd>
            <dt>Diperiksa</dt><dd>{r.reviewer_name ?? '–'}{r.reviewed_at && <span className="block text-xs text-muted">{fmtDateTime(r.reviewed_at)}</span>}</dd>
          </dl>
        </Panel>
      </div>
    </>
  );
}
