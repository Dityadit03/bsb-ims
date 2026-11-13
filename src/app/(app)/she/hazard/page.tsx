import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { randomUUID } from 'node:crypto';
import { OfflineForm } from '@/components/offline-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { RISK } from '@/lib/compliance';
import { fmtDate } from '@/lib/documents';
import { HAZARD_TYPE, OPEN_CLOSED } from '@/lib/she';
import { reportHazard } from '../actions';
import { FilterBar, Thumbs, isDate, needle, photosFor, val } from '../filters';
import { AreaSelect, DeptSelect, Files, RiskSelect, SheTabs, sheMasters, today, EmployeeDatalist, EmployeeInput } from '../fields';

export const metadata = { title: 'Hazard report' };

type Row = {
  id: string; hazard_no: string; reported_on: string; hazard_type: string; description: string; risk_level: string; status: string;
  due_date: string; is_overdue: boolean; work_area_name: string | null; location_note: string | null; pic_department_code: string; reporter_name: string | null;
};

export default async function HazardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('she_hazard_register').select('*', { count: 'exact' }).order('reported_on', { ascending: false }).limit(300);
  const f = { cari: needle(val(sp, '', 'cari')), status: val(sp, '', 'status'), jenis: val(sp, '', 'jenis'), risiko: val(sp, '', 'risiko'), pic: val(sp, '', 'pic'), area: val(sp, '', 'area'), dari: val(sp, '', 'dari'), sampai: val(sp, '', 'sampai') };
  // Bawaan: hanya yang terbuka; pilih "Semua status" untuk melihat seluruhnya
  const st = f.status || (sp.semua ? 'semua' : 'open');
  if (st !== 'semua') q = q.eq('status', st);
  if (f.cari) q = q.or(['hazard_no', 'description', 'reporter_name', 'location_note', 'work_area_name'].map(c => `${c}.ilike.%${f.cari}%`).join(','));
  if (f.jenis) q = q.eq('hazard_type', f.jenis);
  if (f.risiko) q = q.eq('risk_level', f.risiko);
  if (f.pic) q = q.eq('pic_department_code', f.pic);
  if (f.area) q = q.eq('work_area_name', f.area);
  if (isDate(f.dari)) q = q.gte('reported_on', f.dari);
  if (isDate(f.sampai)) q = q.lte('reported_on', f.sampai);
  if (sp.terlambat) q = q.eq('is_overdue', true);
  const [{ data: rows, count }, { depts, areas }] = await Promise.all([q.returns<Row[]>(), sheMasters()]);
  const photos = await photosFor('hazard_reports', (rows ?? []).map(r => r.id));

  return (
    <>
      <PageHeader eyebrow="SMKP 2.2 · Identifikasi bahaya" title="Hazard report"><ExportLinks dataset="hazard" /></PageHeader>
      <SheTabs active="/she/hazard" />
      {s.can('she.report') && (
        <Panel title="Laporkan bahaya">
          <OfflineForm action={reportHazard} kind="hazard" queueTitle="Hazard" queueField="type" draftKey="hazard" label="Kirim hazard report" hidden={{ idem: randomUUID() }} className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Tanggal<input type="date" name="date" required defaultValue={today()} max={today()} className={input} /></label>
              <DeptSelect label="Departemen pelapor" depts={depts} value={s.profile.department_id} />
              <label className="grid gap-1 text-sm">Jenis
                <select name="type" className={input}>{Object.entries(HAZARD_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <AreaSelect areas={areas} />
              <label className="grid gap-1 text-sm sm:col-span-2">Detail lokasi<input name="location" className={input} placeholder="mis. KM 12 arah port" /></label>
            </div>
            <label className="grid gap-1 text-sm">Temuan<textarea name="description" required rows={3} className={input} /></label>
            <label className="grid gap-1 text-sm">Rekomendasi perbaikan<textarea name="recommendation" rows={2} className={input} /></label>
            <div className="grid gap-3 sm:grid-cols-3">
              <RiskSelect />
              <DeptSelect name="pic_department" label="Departemen PIC" depts={depts} />
              <label className="grid gap-1 text-sm">Due date perbaikan<input type="date" name="due" required min={today()} className={input} /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <EmployeeInput name="credit" label="Atas nama (opsional)" hint="Untuk SAP: isi bila formulir ini milik pengawas lain" />
              <Files label="Foto temuan" />
            </div>
            <EmployeeDatalist />
          </OfflineForm>
        </Panel>
      )}
      <FilterBar action="/she/hazard" sp={sp} shown={rows?.length ?? 0} total={count ?? undefined} fields={[
        { name: 'cari', label: 'Cari nomor, temuan, pelapor', type: 'text', placeholder: 'Ketik kata kunci' },
        { name: 'status', label: 'Status', type: 'select', options: [['open', 'Terbuka'], ['closed', 'Ditutup'], ['cancelled', 'Dibatalkan'], ['semua', 'Semua status']] },
        { name: 'jenis', label: 'Jenis', type: 'select', options: Object.entries(HAZARD_TYPE) },
        { name: 'risiko', label: 'Risiko', type: 'select', options: Object.entries(RISK).map(([k, [, l]]) => [k, l]) },
        { name: 'pic', label: 'PIC', type: 'select', options: depts.map(d => [d.code, d.code]) },
        { name: 'area', label: 'Lokasi', type: 'select', options: areas.map(a => [a.name, a.name]) },
        { name: 'dari', label: 'Dari tanggal', type: 'date' },
        { name: 'sampai', label: 'Sampai tanggal', type: 'date' },
        { name: 'terlambat', label: 'Lewat due date', type: 'check' },
      ]} />
      {rows?.length ? (
        <Table head={['Nomor', 'Tanggal', 'Jenis', 'Temuan', 'Lokasi', 'Foto', 'Risiko', 'PIC', 'Due date', 'Status']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs"><Link href={`/she/hazard/${r.id}`} className="font-medium hover:text-accent">{r.hazard_no}</Link></td>
              <td className="tabular whitespace-nowrap text-xs">{fmtDate(r.reported_on)}</td>
              <td className="font-mono text-xs">{r.hazard_type}</td>
              <td className="min-w-64"><Link href={`/she/hazard/${r.id}`} className="hover:text-accent">{r.description}</Link>
                <div className="text-xs text-muted">{r.reporter_name}</div></td>
              <td className="text-xs">{r.work_area_name}{r.location_note ? ` · ${r.location_note}` : ''}</td>
              <td><Thumbs items={photos.get(r.id)} /></td>
              <td><Pill tone={RISK[r.risk_level][0]}>{RISK[r.risk_level][1]}</Pill></td>
              <td className="font-mono text-xs">{r.pic_department_code}</td>
              <td className={`tabular whitespace-nowrap text-xs ${r.is_overdue ? 'font-medium text-crit' : ''}`}>{fmtDate(r.due_date)}</td>
              <td><Pill tone={r.is_overdue ? 'crit' : OPEN_CLOSED[r.status][0]}>{r.is_overdue ? 'Terlambat' : OPEN_CLOSED[r.status][1]}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Tidak ada hazard report untuk saringan ini.</p>}
    </>
  );
}
