import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/documents';
import { PRIORITY, UNIT_STATUS, WO_STATUS, WO_TYPE, paTone } from '@/lib/plant';
import { CONCLUSION, UNIT_TYPE } from '@/lib/she';
import { createWo, savePmPlan, setUnitStatus } from '../actions';

type Unit = {
  id: string; unit_no: string; unit_type: string; brand: string | null; model: string | null; serial_no: string | null; year: number | null;
  ownership: string; vendor: string | null; status: string; current_hm: number; hm_updated_at: string | null; note: string | null; department_id: string;
};

export default async function UnitDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: u } = await supabase.from('units').select('*').eq('id', id).maybeSingle<Unit>();
  if (!u) notFound();
  const [{ data: wos }, { data: plans }, { data: pa }, { data: p2h }, { data: tyres }] = await Promise.all([
    supabase.from('work_order_register').select('id, wo_no, wo_type, priority, description, status, reported_at, downtime_hours').eq('unit_id', id)
      .order('reported_at', { ascending: false }).limit(30),
    supabase.from('pm_plans').select('id, task, interval_hm, last_service_hm, last_service_at').eq('unit_id', id).eq('active', true).order('task'),
    supabase.from('unit_availability').select('pa_30d, breakdown_hours_30d').eq('unit_id', id).maybeSingle(),
    supabase.from('p2h_checks').select('id, p2h_no, check_date, shift, conclusion, hour_meter').eq('unit_no', u.unit_no)
      .order('check_date', { ascending: false }).limit(10),
    supabase.from('tyre_status').select('tyre_id, tyre_no, position, last_rtd_mm, usable_pct, alert, brand').eq('unit_id', id).eq('status', 'installed').order('position')
      .returns<{ tyre_id: string; tyre_no: string; position: string; last_rtd_mm: number | null; usable_pct: number | null; alert: string | null; brand: string | null }[]>(),
  ]);
  const manage = s.can('plant.manage');

  return (
    <>
      <PageHeader eyebrow={`Unit · ${UNIT_TYPE[u.unit_type]}`} title={u.unit_no}>
        <div className="flex gap-2">{pa && <Pill tone={paTone(Number(pa.pa_30d))}>PA {pa.pa_30d}%</Pill>}<Pill tone={UNIT_STATUS[u.status][0]}>{UNIT_STATUS[u.status][1]}</Pill></div>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel title="Work order">
            {wos?.length ? (
              <Table head={['Nomor', 'Jenis', 'Uraian', 'Prioritas', 'Downtime', 'Status']}>
                {wos.map(w => (
                  <tr key={w.id}>
                    <td className="whitespace-nowrap font-mono text-xs"><Link href={`/plant/wo/${w.id}`} className="hover:text-accent">{w.wo_no}</Link>
                      <div className="text-muted">{fmtDateTime(w.reported_at)}</div></td>
                    <td className="text-xs">{WO_TYPE[w.wo_type]}</td>
                    <td className="min-w-56 text-sm">{w.description}</td>
                    <td><Pill tone={PRIORITY[w.priority][0]}>{PRIORITY[w.priority][1]}</Pill></td>
                    <td className="tabular text-xs">{w.downtime_hours} jam</td>
                    <td><Pill tone={WO_STATUS[w.status][0]}>{WO_STATUS[w.status][1]}</Pill></td>
                  </tr>
                ))}
              </Table>
            ) : <p className="text-sm text-muted">Belum ada work order.</p>}
          </Panel>
          {tyres && tyres.length > 0 && (
            <Panel title="Ban terpasang" sub="Warna menurut sisa alur: hijau baik, oranye segera ganti, merah di batas buang.">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {tyres.map(t => (
                  <Link key={t.tyre_id} href={`/plant/ban?status=installed`} className={`rounded-xl border p-2 text-center text-sm ${
                    t.alert === 'replace' ? 'border-crit/50 bg-crit/10' : t.alert === 'soon' ? 'border-warn/50 bg-warn/10' : 'border-line bg-panel'}`}>
                    <div className="font-mono text-base font-bold">{t.position}</div>
                    <div className="tabular text-xs">{t.last_rtd_mm ?? '–'} mm</div>
                    <div className="truncate text-[11px] text-muted">{t.tyre_no}</div>
                  </Link>
                ))}
              </div>
            </Panel>
          )}
          {u.status !== 'retired' && s.can('plant.report') && (
            <Panel title={manage ? 'Buat work order' : 'Laporkan kerusakan'}>
              <ActionForm action={createWo} label="Buat WO" primary hidden={{ unit: u.id, idem: randomUUID(), ...(manage ? {} : { type: 'breakdown' }) }}>
                <div className="grid gap-3 sm:grid-cols-3">
                  {manage && <label className="grid gap-1 text-sm">Jenis
                    <select name="type" className={input}>{Object.entries(WO_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
                  <label className="grid gap-1 text-sm">Prioritas
                    <select name="priority" className={input} defaultValue="medium">{Object.entries(PRIORITY).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
                  <label className="grid gap-1 text-sm">HM saat ini<input type="number" name="hm" min={u.current_hm} step="0.1" className={input} /></label>
                  {manage && plans?.length ? <label className="grid gap-1 text-sm">Rencana PM (untuk WO PM)
                    <select name="pm_plan" className={input} defaultValue=""><option value="">–</option>{plans.map(p => <option key={p.id} value={p.id}>{p.task}</option>)}</select></label> : null}
                </div>
                <label className="grid gap-1 text-sm">Uraian kerusakan / pekerjaan<textarea name="description" required rows={2} className={input} /></label>
                <p className="text-xs text-muted">WO breakdown langsung membuat unit berstatus breakdown sampai WO selesai.</p>
              </ActionForm>
            </Panel>
          )}
          <Panel title="P2H terakhir">
            {p2h?.length ? (
              <ul className="grid gap-1 text-sm">
                {p2h.map(p => <li key={p.id} className="flex items-center justify-between gap-2"><span className="font-mono text-xs">{p.p2h_no} · shift {p.shift} · HM {p.hour_meter ?? '–'}</span>
                  <Pill tone={CONCLUSION[p.conclusion][0]}>{CONCLUSION[p.conclusion][1]}</Pill></li>)}
              </ul>
            ) : <p className="text-sm text-muted">Belum ada P2H untuk unit ini.</p>}
          </Panel>
        </div>
        <div className="grid content-start gap-4">
          <Panel title="Rincian">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
              <dt>HM / KM</dt><dd className="tabular">{Number(u.current_hm).toLocaleString('id-ID')}{u.hm_updated_at && <span className="block text-xs text-muted">{fmtDateTime(u.hm_updated_at)}</span>}</dd>
              <dt>Merek / model</dt><dd>{[u.brand, u.model].filter(Boolean).join(' ') || '–'}</dd>
              <dt>Tahun</dt><dd>{u.year ?? '–'}</dd>
              <dt>No. seri</dt><dd>{u.serial_no ?? '–'}</dd>
              <dt>Kepemilikan</dt><dd>{u.ownership === 'rental' ? `Rental · ${u.vendor}` : 'Milik'}</dd>
              <dt>Breakdown 30 hari</dt><dd>{pa?.breakdown_hours_30d ?? 0} jam</dd>
            </dl>
            {u.note && <p className="text-sm">{u.note}</p>}
          </Panel>
          <Panel title="Servis berkala (PM)">
            {plans?.length ? (
              <ul className="grid gap-2 text-sm">
                {plans.map(p => {
                  const next = Number(p.last_service_hm) + Number(p.interval_hm);
                  const left = next - Number(u.current_hm);
                  return <li key={p.id} className="border-b border-line pb-2 last:border-0"><b>{p.task}</b> · tiap {p.interval_hm} HM
                    <div className={`text-xs ${left <= 0 ? 'font-medium text-crit' : left <= 0.1 * Number(p.interval_hm) ? 'text-warn' : 'text-muted'}`}>
                      Berikutnya di HM {next.toLocaleString('id-ID')} ({left <= 0 ? `lewat ${Math.abs(left)}` : `sisa ${left}`} HM)</div></li>;
                })}
              </ul>
            ) : <p className="text-sm text-muted">Belum ada rencana PM.</p>}
            {manage && (
              <ActionForm action={savePmPlan} label="Simpan rencana PM" hidden={{ unit: u.id }}>
                <input name="task" required className={input} placeholder="mis. Servis 250 jam" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" name="interval" required min={1} className={input} placeholder="Interval HM" />
                  <input type="number" name="last" min={0} className={input} placeholder="HM servis terakhir" />
                </div>
              </ActionForm>
            )}
          </Panel>
          {manage && (
            <Panel title="Status unit">
              <ActionForm action={setUnitStatus} label="Ubah status" hidden={{ id: u.id }}>
                <select name="status" className={input} defaultValue={u.status === 'breakdown' ? 'ready' : u.status}>
                  <option value="ready">Siap</option><option value="standby">Standby</option><option value="retired">Tidak aktif</option>
                </select>
                <input name="note" className={input} placeholder="Catatan" />
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
