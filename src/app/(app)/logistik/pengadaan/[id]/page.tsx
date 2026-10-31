import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { GRADE, PO_STATUS, PR_SOURCE, PR_STATUS, qty, rp } from '@/lib/logistics';
import { DocScans } from '@/components/doc-scans';
import { approvePo, cancelPrRequest, createPo, decidePr, decidePrDept, receivePo, saveQuote, selectQuote } from '../../actions';

type Pr = { id: string; pr_no: string; status: string; purpose: string; need_date: string | null; created_at: string; mr_id: string | null;
  mr_no: string | null; requested_by: string; requester_name: string; decided_at: string | null; decision_note: string | null; source: string; department_id: string | null;
  department_code: string | null; dept_decided_at: string | null; dept_decision_note: string | null; est_total: number };
type Line = { id: string; qty: number; note: string | null; item_name: string | null; uom: string | null; est_price: number | null; materials: { code: string; name: string; uom: string; stock_qty: number } | null };
type Quote = { id: string; pr_line_id: string; supplier_id: string; unit_price: number; lead_days: number | null; note: string | null; selected: boolean };
type Sup = { id: string; code: string; name: string; grade: string | null; active: boolean };
type Po = { id: string; po_no: string; status: string; supplier_name: string; total_value: number; expected_date: string | null; created_by: string;
  creator_name: string; created_at: string; approved_at: string | null; note: string | null };
type PoLine = { id: string; po_id: string; qty: number; qty_received: number; unit_price: number; item_name: string | null; uom: string | null; materials: { code: string; name: string; uom: string } | null };
const nameOf = (x: { item_name: string | null; materials: { code: string; name: string } | null }) => x.materials ? `${x.materials.code} · ${x.materials.name}` : x.item_name;
const uomOf = (x: { uom: string | null; materials: { uom: string } | null }) => x.materials?.uom ?? x.uom ?? '';

export default async function PrDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: pr } = await supabase.from('pr_register').select('*').eq('id', id).maybeSingle<Pr>();
  if (!pr) notFound();
  const [{ data: lines }, { data: sups }, { data: pos }] = await Promise.all([
    supabase.from('purchase_requisition_lines').select('id, qty, note, item_name, uom, est_price, materials(code, name, uom, stock_qty)').eq('pr_id', id).returns<Line[]>(),
    supabase.from('supplier_score').select('id, code, name, grade, active').order('name').returns<Sup[]>(),
    supabase.from('po_register').select('*').eq('pr_id', id).order('po_no').returns<Po[]>(),
  ]);
  const lineIds = (lines ?? []).map(l => l.id);
  const poIds = (pos ?? []).map(p => p.id);
  const [{ data: quotes }, { data: poLines }] = await Promise.all([
    lineIds.length ? supabase.from('supplier_quotes').select('*').in('pr_line_id', lineIds).order('unit_price').returns<Quote[]>() : Promise.resolve({ data: [] as Quote[] }),
    poIds.length ? supabase.from('purchase_order_lines').select('id, po_id, qty, qty_received, unit_price, item_name, uom, materials(code, name, uom)').in('po_id', poIds).returns<PoLine[]>()
      : Promise.resolve({ data: [] as PoLine[] }),
  ]);
  const sup = new Map((sups ?? []).map(x => [x.id, x]));
  const quotesOf = (line: string) => (quotes ?? []).filter(q => q.pr_line_id === line);
  const buyer = s.canIn('log.purchase', 'LOG');
  const direct = pr.source === 'dept_direct';
  const deptDecide = pr.status === 'dept_review' && pr.requested_by !== s.profile.id && !!pr.department_code && s.canIn('log.approve', pr.department_code);
  const cancellable = direct && pr.requested_by === s.profile.id && ['dept_review', 'submitted'].includes(pr.status);
  const decide = pr.status === 'submitted' && pr.requested_by !== s.profile.id && s.canIn('log.approve', 'LOG');
  const quoting = pr.status === 'approved' && buyer;
  const ready = (lines ?? []).every(l => quotesOf(l.id).some(q => q.selected));
  const selectedTotal = (quotes ?? []).filter(q => q.selected)
    .reduce((t, q) => t + Number(q.unit_price) * Number((lines ?? []).find(l => l.id === q.pr_line_id)?.qty ?? 0), 0);

  return (
    <>
      <PageHeader eyebrow="Purchase requisition" title={pr.pr_no}>
        <Pill tone={PR_STATUS[pr.status][0]}>{PR_STATUS[pr.status][1]}</Pill>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          {deptDecide && (
            <Panel title={`Persetujuan departemen ${pr.department_code}`} sub="Pembelian langsung dari luar. Setelah Anda setujui, PR diperiksa Logistik.">
              <div className="grid gap-3 sm:grid-cols-2">
                <ActionForm action={decidePrDept} label="Setujui" primary hidden={{ pr: pr.id, decision: 'approve' }}>
                  <input name="note" className={input} placeholder="Catatan (opsional)" aria-label="Catatan persetujuan" />
                </ActionForm>
                <ActionForm action={decidePrDept} label="Tolak" hidden={{ pr: pr.id, decision: 'reject' }}>
                  <input name="note" required className={input} placeholder="Alasan penolakan" aria-label="Alasan penolakan" />
                </ActionForm>
              </div>
            </Panel>
          )}
          {decide && (
            <Panel title="Persetujuan PR">
              <div className="grid gap-3 sm:grid-cols-2">
                <ActionForm action={decidePr} label="Setujui PR" primary hidden={{ pr: pr.id, decision: 'approve' }}>
                  <input name="note" className={input} placeholder="Catatan (opsional)" />
                </ActionForm>
                <ActionForm action={decidePr} label="Tolak" hidden={{ pr: pr.id, decision: 'reject' }}>
                  <input name="note" required className={input} placeholder="Alasan penolakan" />
                </ActionForm>
              </div>
            </Panel>
          )}
          {(lines ?? []).map(l => {
            const qs = quotesOf(l.id);
            const best = qs.length ? Math.min(...qs.map(q => Number(q.unit_price))) : null;
            return (
              <Panel key={l.id} title={nameOf(l) ?? ''}
                action={<span className="tabular text-sm text-muted">{qty(l.qty)} {uomOf(l)}{l.materials ? ` · stok ${qty(l.materials.stock_qty)}` : l.est_price != null ? ` · perkiraan ${rp(l.est_price)}` : ''}</span>}>
                {l.note && <p className="text-sm text-muted">{l.note}</p>}
                {qs.length ? (
                  <Table head={['Supplier', 'Harga satuan', 'Total', 'Waktu kirim', '']}>
                    {qs.map(q => {
                      const x = sup.get(q.supplier_id);
                      return (
                        <tr key={q.id} className={q.selected ? 'bg-accent-soft/40' : ''}>
                          <td className="text-sm">{x?.name}{x?.grade && <> <Pill tone={GRADE[x.grade]}>{x.grade}</Pill></>}
                            {q.note && <div className="text-xs text-muted">{q.note}</div>}</td>
                          <td className="tabular text-xs">{rp(q.unit_price)}{Number(q.unit_price) === best && qs.length > 1 && <span className="ml-1 text-ok">termurah</span>}</td>
                          <td className="tabular text-xs">{rp(Number(q.unit_price) * Number(l.qty))}</td>
                          <td className="text-xs">{q.lead_days == null ? '–' : `${q.lead_days} hari`}</td>
                          <td>{q.selected ? <Pill tone="ok">Dipilih</Pill>
                            : quoting && <ActionForm action={selectQuote} label="Pilih" hidden={{ pr: pr.id, quote: q.id }} />}</td>
                        </tr>
                      );
                    })}
                  </Table>
                ) : <p className="text-sm text-muted">{pr.status === 'submitted' ? 'Penawaran dicatat setelah PR disetujui.' : 'Belum ada penawaran.'}</p>}
                {quoting && (
                  <ActionForm action={saveQuote} label="Simpan penawaran" hidden={{ pr: pr.id, line: l.id }}>
                    <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_2fr]">
                      <select name="supplier" required className={input} aria-label="Supplier" defaultValue="">
                        <option value="">Pilih supplier</option>
                        {(sups ?? []).filter(x => x.active).map(x => <option key={x.id} value={x.id}>{x.name}{x.grade ? ` (${x.grade})` : ''}</option>)}
                      </select>
                      <input type="number" name="price" required min={0} step="1" className={input} placeholder="Harga satuan (Rp)" />
                      <input type="number" name="lead" min={0} className={input} placeholder="Kirim (hari)" />
                      <input name="note" className={input} placeholder="Merek / part pengganti / catatan" />
                    </div>
                  </ActionForm>
                )}
              </Panel>
            );
          })}
          {quoting && (
            <Panel title="Buat PO">
              <ActionForm action={createPo} label="Buat PO dari supplier terpilih" primary hidden={{ pr: pr.id }}>
                <p className="text-sm text-muted">Satu PO dibuat untuk setiap supplier terpilih · total {rp(selectedTotal)}.
                  {!ready && <span className="text-crit"> Masih ada barang tanpa supplier terpilih.</span>}</p>
                <label className="grid max-w-xs gap-1 text-sm">Estimasi barang tiba<input type="date" name="expected" className={input} /></label>
              </ActionForm>
            </Panel>
          )}
          {(pos ?? []).map(o => {
            const ls = (poLines ?? []).filter(x => x.po_id === o.id);
            const approve = o.status === 'awaiting_approval' && o.created_by !== s.profile.id && s.canIn('log.approve_high', 'LOG');
            const receive = ['issued', 'partial'].includes(o.status) && s.canIn('log.warehouse', 'LOG');
            return (
              <Panel key={o.id} title={`${o.po_no} · ${o.supplier_name}`} action={<Pill tone={PO_STATUS[o.status][0]}>{PO_STATUS[o.status][1]}</Pill>}>
                <Table head={['Barang', 'Dipesan', 'Diterima', 'Harga', 'Total']}>
                  {ls.map(x => (
                    <tr key={x.id}>
                      <td className="text-sm">{nameOf(x)}</td>
                      <td className="tabular text-xs">{qty(x.qty)} {uomOf(x)}</td>
                      <td className="tabular text-xs">{qty(x.qty_received)}</td>
                      <td className="tabular text-xs">{rp(x.unit_price)}</td>
                      <td className="tabular text-xs">{rp(Number(x.qty) * Number(x.unit_price))}</td>
                    </tr>
                  ))}
                </Table>
                <p className="text-xs text-muted">Nilai {rp(o.total_value)} · dibuat {o.creator_name}, {fmtDateTime(o.created_at)} · estimasi tiba {fmtDate(o.expected_date)}</p>
                {approve && (
                  <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                    <ActionForm action={approvePo} label="Setujui PO" primary hidden={{ pr: pr.id, po: o.id, decision: 'approve' }} />
                    <ActionForm action={approvePo} label="Batalkan PO" hidden={{ pr: pr.id, po: o.id, decision: 'reject' }}>
                      <input name="note" required className={input} placeholder="Alasan" />
                    </ActionForm>
                  </div>
                )}
                {receive && (
                  <ActionForm action={receivePo} label="Terima barang (GR)" primary hidden={{ pr: pr.id, po: o.id, idem: randomUUID() }} className="border-t border-line pt-3">
                    {ls.filter(x => Number(x.qty_received) < Number(x.qty)).map(x => (
                      <label key={x.id} className="grid grid-cols-[2fr_1fr] items-center gap-2 text-sm">
                        <span>{nameOf(x)} · sisa {qty(Number(x.qty) - Number(x.qty_received))} {uomOf(x)}{!x.materials && <span className="block text-xs text-muted">Non-stok: tidak menambah stok gudang</span>}</span>
                        <input type="hidden" name="line" value={x.id} />
                        <input type="number" name={`qty_${x.id}`} min={0} max={Number(x.qty) - Number(x.qty_received)} step="0.01"
                          defaultValue={Number(x.qty) - Number(x.qty_received)} className={input} />
                      </label>
                    ))}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input name="doc_ref" required className={input} placeholder="No. surat jalan / DO" />
                      <input name="note" className={input} placeholder="Catatan" />
                    </div>
                  </ActionForm>
                )}
                <div className="border-t border-line pt-3"><div className="mb-2 text-xs text-muted">Formulir PO fisik</div>
                  <Link href={`/cetak/po/${o.id}`} target="_blank" className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent">Cetak formulir PO</Link>
                  <div className="h-2" />
                  <DocScans table="purchase_orders" id={o.id} path={`/logistik/pengadaan/${pr.id}`} canUpload={buyer} /></div>
              </Panel>
            );
          })}
        </div>
        <Panel title="Rincian">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
            <dt>Keperluan</dt><dd>{pr.purpose}</dd>
            <dt>Pembuat</dt><dd>{pr.requester_name}<span className="block text-xs text-muted">{fmtDateTime(pr.created_at)}</span></dd>
            <dt>Asal</dt><dd><Pill tone={PR_SOURCE[pr.source][0]}>{PR_SOURCE[pr.source][1]}</Pill>{direct && <span className="block text-xs text-muted">Dept {pr.department_code} · barang tidak masuk stok</span>}</dd>
            {direct && <><dt>Setuju dept</dt><dd>{pr.dept_decided_at ? fmtDateTime(pr.dept_decided_at) : '–'}{pr.dept_decision_note && <span className="block text-xs text-muted">{pr.dept_decision_note}</span>}</dd>
              <dt>Perkiraan nilai</dt><dd className="tabular">{Number(pr.est_total) > 0 ? rp(pr.est_total) : '–'}</dd></>}
            <dt>Dari MR</dt><dd>{pr.mr_id ? <Link href={`/logistik/mr/${pr.mr_id}`} className="font-mono text-accent">{pr.mr_no}</Link> : '–'}</dd>
            <dt>Dibutuhkan</dt><dd>{fmtDate(pr.need_date)}</dd>
            <dt>Keputusan</dt><dd>{pr.decided_at ? fmtDateTime(pr.decided_at) : '–'}{pr.decision_note && <span className="block text-xs text-muted">{pr.decision_note}</span>}</dd>
          </dl>
          {cancellable && (
            <ActionForm action={cancelPrRequest} label="Batalkan permintaan" hidden={{ pr: pr.id }} confirm="Batalkan permintaan pembelian ini?" className="border-t border-line pt-3">
              <input name="reason" required className={input} placeholder="Alasan pembatalan" aria-label="Alasan pembatalan" />
            </ActionForm>
          )}
          <div className="border-t border-line pt-3"><div className="mb-2 text-xs text-muted">Formulir PR fisik</div>
            <Link href={`/cetak/pr/${pr.id}`} target="_blank" className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent">Cetak formulir PR</Link>
            <div className="h-2" />
            <DocScans table="purchase_requisitions" id={pr.id} path={`/logistik/pengadaan/${pr.id}`} canUpload={buyer} /></div>
        </Panel>
      </div>
    </>
  );
}
