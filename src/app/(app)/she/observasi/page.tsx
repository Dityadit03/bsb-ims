import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { closeObservation, recordObservation } from '../actions';
import { ExportLinks } from '@/components/export-links';
import { FilterBar, Thumbs, exportParams, isDate, needle, photosFor, val } from '../filters';
import { AreaSelect, DeptSelect, Files, SheTabs, sheMasters, today, EmployeeDatalist, EmployeeInput } from '../fields';

export const metadata = { title: 'Observasi PTO' };

type Row = {
  id: string; obs_no: string; observed_on: string; activity: string; worker_name: string | null; result: string; status: string;
  unsafe_behaviour: string | null; coaching: string | null; observer_id: string;
  observer: { full_name: string | null } | null; area: { name: string } | null; dept: { code: string } | null;
};

export default async function ObservationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('observations')
    .select('id, obs_no, observed_on, activity, worker_name, result, status, unsafe_behaviour, coaching, observer_id, observer:observer_id(full_name), area:work_area_id(name), dept:department_id(code)', { count: 'exact' })
    .order('observed_on', { ascending: false }).order('obs_no', { ascending: false }).limit(300);
  const f = { cari: needle(val(sp, '', 'cari')), dept: val(sp, '', 'dept'), area: val(sp, '', 'area'), hasil: val(sp, '', 'hasil'), status: val(sp, '', 'status') || (sp.open ? 'open' : ''), dari: val(sp, '', 'dari'), sampai: val(sp, '', 'sampai') };
  if (f.cari) q = q.or(['obs_no', 'activity', 'worker_name', 'unsafe_behaviour', 'coaching'].map(c => `${c}.ilike.%${f.cari}%`).join(','));
  if (f.dept) q = q.eq('department_id', f.dept);
  if (f.area) q = q.eq('work_area_id', f.area);
  if (f.hasil === 'safe' || f.hasil === 'unsafe') q = q.eq('result', f.hasil);
  if (f.status === 'open' || f.status === 'closed') q = q.eq('status', f.status);
  if (isDate(f.dari)) q = q.gte('observed_on', f.dari);
  if (isDate(f.sampai)) q = q.lte('observed_on', f.sampai);
  const [{ data: rows, count }, { depts, areas }] = await Promise.all([q.returns<Row[]>(), sheMasters()]);
  const photos = await photosFor('observations', (rows ?? []).map(r => r.id));

  return (
    <>
      <PageHeader eyebrow="SMKP 5.1 · Planned Task Observation" title="Observasi PTO">
        <ExportLinks dataset="observasi" label="Unduh data" params={exportParams({
          cari: f.cari, dept: depts.find(d => d.id === f.dept)?.code, area: areas.find(a => a.id === f.area)?.name, hasil: f.hasil, status: f.status,
          dari: isDate(f.dari) && f.dari, sampai: isDate(f.sampai) && f.sampai })} />
      </PageHeader>
      <SheTabs active="/she/observasi" />
      {s.can('she.report') && (
        <Panel title="Catat observasi">
          <ActionForm action={recordObservation} label="Simpan observasi" primary hidden={{ idem: randomUUID() }} className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Tanggal<input type="date" name="date" required defaultValue={today()} max={today()} className={input} /></label>
              <DeptSelect depts={depts} value={s.profile.department_id} />
              <AreaSelect areas={areas} />
            </div>
            <label className="grid gap-1 text-sm">Pekerjaan / aktivitas yang diobservasi<input name="activity" required className={input} /></label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm sm:col-span-2">Nama pekerja yang diobservasi<input name="worker" className={input} /></label>
              <label className="grid gap-1 text-sm">Jumlah pekerja<input type="number" name="count" min={1} className={input} /></label>
            </div>
            <label className="grid gap-1 text-sm">Hasil
              <select name="result" className={input}><option value="safe">Aman</option><option value="unsafe">Ada perilaku tidak aman</option></select>
            </label>
            <label className="grid gap-1 text-sm">Perilaku tidak aman / catatan<textarea name="unsafe" rows={2} className={input} /></label>
            <label className="grid gap-1 text-sm">Coaching / tindakan yang diberikan<textarea name="coaching" rows={2} className={input} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <EmployeeInput name="credit" label="Atas nama (opsional)" hint="Untuk SAP: isi bila formulir ini milik pengawas lain" />
              <Files label="Foto" />
            </div>
            <EmployeeDatalist />
            <p className="text-xs text-muted">Observasi dihitung sebagai Act Observasi di SAP Anda. Perilaku tidak aman tanpa coaching tetap open.</p>
          </ActionForm>
        </Panel>
      )}
      <FilterBar action="/she/observasi" sp={sp} shown={rows?.length ?? 0} total={count ?? undefined} fields={[
        { name: 'cari', label: 'Cari nomor, aktivitas, pekerja', type: 'text', placeholder: 'Ketik kata kunci' },
        { name: 'dept', label: 'Departemen', type: 'select', options: depts.map(d => [d.id, d.code]) },
        { name: 'area', label: 'Lokasi', type: 'select', options: areas.map(a => [a.id, a.name]) },
        { name: 'hasil', label: 'Hasil', type: 'select', options: [['safe', 'Aman'], ['unsafe', 'Tidak aman']] },
        { name: 'status', label: 'Tindak lanjut', type: 'select', options: [['open', 'Perlu tindak lanjut'], ['closed', 'Selesai']] },
        { name: 'dari', label: 'Dari tanggal', type: 'date' },
        { name: 'sampai', label: 'Sampai tanggal', type: 'date' },
      ]} />
      {rows?.length ? (
        <Table head={['Nomor', 'Tanggal', 'Observer', 'Aktivitas', 'Lokasi', 'Foto', 'Hasil', 'Tindak lanjut']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs">{r.obs_no}</td>
              <td className="tabular whitespace-nowrap text-xs">{fmtDate(r.observed_on)}</td>
              <td className="text-xs">{r.observer?.full_name}<div className="text-muted">{r.dept?.code}</div></td>
              <td className="min-w-56">{r.activity}{r.worker_name && <div className="text-xs text-muted">{r.worker_name}</div>}
                {r.unsafe_behaviour && <div className="text-xs text-crit">{r.unsafe_behaviour}</div>}</td>
              <td className="text-xs">{r.area?.name}</td>
              <td><Thumbs items={photos.get(r.id)} /></td>
              <td>{r.result === 'safe' ? <Pill tone="ok">Aman</Pill> : <Pill tone="crit">Tidak aman</Pill>}</td>
              <td className="min-w-56 text-xs">
                {r.status === 'open' ? (r.observer_id === s.profile.id || s.can('she.followup')) ? (
                  <ActionForm action={closeObservation} label="Simpan coaching" hidden={{ id: r.id }}>
                    <input name="coaching" required className={input} placeholder="Coaching yang diberikan" />
                  </ActionForm>
                ) : <Pill tone="warn">Perlu tindak lanjut</Pill> : r.coaching ?? '–'}
              </td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Tidak ada observasi untuk saringan ini.</p>}
    </>
  );
}
