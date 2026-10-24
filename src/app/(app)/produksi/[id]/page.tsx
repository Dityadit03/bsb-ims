import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/documents';
import { DELAY, REPORT_STATUS, ton } from '@/lib/production';
import { addDelay, removeDelay, removeTrip, reviewReport, saveTrip, submitReport } from '../actions';

type Report = { id: string; report_no: string; report_date: string; shift: number; status: string; department_id: string; note: string | null;
  supervisor_id: string; submitted_at: string | null; submitted_by: string | null; approved_at: string | null; return_note: string | null };
type Trip = { id: string; operator_name: string; trips: number; tonnage: number; hm_start: number | null; hm_end: number | null;
  units: { unit_no: string }; haul_routes: { code: string; distance_km: number } };
type Delay = { id: string; category: string; hours: number; note: string | null; units: { unit_no: string } | null };

export default async function ReportDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: r } = await supabase.from('production_reports').select('*').eq('id', id).maybeSingle<Report>();
  if (!r) notFound();
  const [{ data: sum }, { data: trips }, { data: delays }, { data: units }, { data: routes }, { data: fit }] = await Promise.all([
    supabase.from('production_summary').select('supervisor_name, trips, tonnage, ton_km, delay_hours').eq('id', id).single(),
    supabase.from('haul_trips').select('id, operator_name, trips, tonnage, hm_start, hm_end, units(unit_no), haul_routes(code, distance_km)')
      .eq('report_id', id).order('created_at').returns<Trip[]>(),
    supabase.from('production_delays').select('id, category, hours, note, units(unit_no)').eq('report_id', id).order('created_at').returns<Delay[]>(),
    supabase.from('units').select('id, unit_no, status').neq('status', 'retired').order('unit_no'),
    supabase.from('haul_routes').select('id, code, name').eq('active', true).order('code'),
    supabase.from('p2h_checks').select('unit_no').eq('check_date', r.report_date).eq('shift', r.shift).in('conclusion', ['fit', 'fit_with_notes']),
  ]);
  const fitSet = new Set((fit ?? []).map(p => p.unit_no));
  const edit = r.status === 'draft' && s.canIn('prod.report', 'PRD');
  const review = r.status === 'submitted' && s.canIn('prod.approve', 'PRD') && r.submitted_by !== s.profile.id;
  const h = { report: r.id };

  return (
    <>
      <PageHeader eyebrow={`Laporan produksi · ${r.report_date} · shift ${r.shift}`} title={r.report_no}>
        <Pill tone={REPORT_STATUS[r.status][0]}>{REPORT_STATUS[r.status][1]}</Pill>
      </PageHeader>
      {r.return_note && r.status === 'draft' && <p className="rounded border border-warn/40 bg-warn/10 p-3 text-sm">Dikembalikan: {r.return_note}</p>}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel title="Ritase & tonase">
            {trips?.length ? (
              <Table head={['Unit', 'Rute', 'Operator', 'Ritase', 'Tonase', 'HM', ...(edit ? [''] : [])]}>
                {trips.map(t => (
                  <tr key={t.id}>
                    <td className="font-mono text-xs">{t.units.unit_no}</td>
                    <td className="font-mono text-xs">{t.haul_routes.code}</td>
                    <td className="text-xs">{t.operator_name}</td>
                    <td className="tabular text-xs">{t.trips}</td>
                    <td className="tabular text-xs">{ton(t.tonnage)}</td>
                    <td className="tabular text-xs">{t.hm_start ?? '–'} → {t.hm_end ?? '–'}</td>
                    {edit && <td><ActionForm action={removeTrip} label="Hapus" hidden={{ ...h, id: t.id }} /></td>}
                  </tr>
                ))}
              </Table>
            ) : <p className="text-sm text-muted">Belum ada ritase.</p>}
            {edit && (
              <ActionForm action={saveTrip} label="Simpan ritase" primary hidden={h}>
                <div className="grid gap-3 sm:grid-cols-4">
                  <label className="grid gap-1 text-sm">Unit
                    <select name="unit" required className={input}>{(units ?? []).map(u => (
                      <option key={u.id} value={u.id}>{u.unit_no}{fitSet.has(u.unit_no) ? '' : ' · belum P2H layak'}</option>))}</select></label>
                  <label className="grid gap-1 text-sm">Rute
                    <select name="route" required className={input}>{(routes ?? []).map(x => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></label>
                  <label className="grid gap-1 text-sm">Operator<input name="operator" required className={input} /></label>
                  <label className="grid gap-1 text-sm">Ritase<input type="number" name="trips" required min={0} className={input} /></label>
                  <label className="grid gap-1 text-sm">Tonase<input type="number" name="tonnage" required min={0} step="0.01" className={input} /></label>
                  <label className="grid gap-1 text-sm">HM awal<input type="number" name="hm_start" min={0} step="0.1" className={input} /></label>
                  <label className="grid gap-1 text-sm">HM akhir<input type="number" name="hm_end" min={0} step="0.1" className={input} /></label>
                </div>
                <p className="text-xs text-muted">Unit wajib punya P2H layak pada tanggal dan shift ini. Unit + rute yang sama akan diperbarui.</p>
              </ActionForm>
            )}
          </Panel>
          <Panel title="Hambatan / delay">
            {delays?.length ? (
              <ul className="grid gap-1 text-sm">
                {delays.map(d => (
                  <li key={d.id} className="flex items-center justify-between gap-2 border-b border-line py-1">
                    <span>{DELAY[d.category]} · {d.hours} jam{d.units ? ` · ${d.units.unit_no}` : ''}{d.note ? ` · ${d.note}` : ''}</span>
                    {edit && <ActionForm action={removeDelay} label="Hapus" hidden={{ ...h, id: d.id }} />}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Tidak ada hambatan tercatat.</p>}
            {edit && (
              <ActionForm action={addDelay} label="Catat hambatan" hidden={h}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <select name="category" className={input} aria-label="Kategori">{Object.entries(DELAY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <input type="number" name="hours" required min={0.1} max={12} step="0.1" className={input} placeholder="Jam" />
                  <select name="unit" className={input} aria-label="Unit" defaultValue=""><option value="">Semua unit</option>
                    {(units ?? []).map(u => <option key={u.id} value={u.id}>{u.unit_no}</option>)}</select>
                </div>
                <input name="note" className={input} placeholder="Keterangan (wajib untuk Lainnya)" />
              </ActionForm>
            )}
          </Panel>
          {edit && <Panel title="Kirim"><ActionForm action={submitReport} label="Kirim untuk persetujuan" primary hidden={h} /></Panel>}
          {review && (
            <Panel title="Persetujuan">
              <ActionForm action={reviewReport} label="Setujui" primary hidden={{ ...h, decision: 'approve' }} />
              <ActionForm action={reviewReport} label="Kembalikan" hidden={{ ...h, decision: 'return' }}>
                <input name="note" required className={input} placeholder="Alasan pengembalian" />
              </ActionForm>
            </Panel>
          )}
        </div>
        <Panel title="Ringkasan">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
            <dt>Pengawas</dt><dd>{sum?.supervisor_name}</dd>
            <dt>Ritase</dt><dd className="tabular">{sum?.trips ?? 0}</dd>
            <dt>Tonase</dt><dd className="tabular">{ton(sum?.tonnage ?? 0)}</dd>
            <dt>Ton·km</dt><dd className="tabular">{ton(sum?.ton_km ?? 0)}</dd>
            <dt>Hambatan</dt><dd>{sum?.delay_hours ?? 0} jam</dd>
            <dt>Dikirim</dt><dd>{fmtDateTime(r.submitted_at)}</dd>
            <dt>Disetujui</dt><dd>{fmtDateTime(r.approved_at)}</dd>
          </dl>
          {r.note && <p className="text-sm">{r.note}</p>}
        </Panel>
      </div>
    </>
  );
}
