import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { RISK } from '@/lib/compliance';
import { fmtDate } from '@/lib/documents';
import { INSPECTION_TYPE, OPEN_CLOSED } from '@/lib/she';
import { recordInspection } from '../actions';
import { FilterBar, Thumbs, isDate, needle, photosFor, val } from '../filters';
import { AreaSelect, DeptSelect, Files, SheTabs, sheMasters, today, EmployeeDatalist, EmployeeInput } from '../fields';

export const metadata = { title: 'Inspeksi' };

type Finding = {
  id: string; inspection_id: string; inspection_no: string; inspected_on: string; object: string; seq: number; description: string;
  risk_level: string; pic_department_code: string; due_date: string; status: string; is_overdue: boolean;
};
type Insp = { id: string; inspection_no: string; inspected_on: string; inspection_type: string; object: string;
  inspector: { full_name: string | null } | null; findings: { status: string }[] };

export default async function InspectionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  // Dua daftar, dua bilah saring: temuan (awalan t_) dan inspeksi terakhir (awalan i_)
  const t = { cari: needle(val(sp, 't_', 'cari')), risiko: val(sp, 't_', 'risiko'), pic: val(sp, 't_', 'pic'), dari: val(sp, 't_', 'dari'), sampai: val(sp, 't_', 'sampai') };
  const i = { cari: needle(val(sp, 'i_', 'cari')), jenis: val(sp, 'i_', 'jenis'), hasil: val(sp, 'i_', 'hasil'), dari: val(sp, 'i_', 'dari'), sampai: val(sp, 'i_', 'sampai') };
  let fq = supabase.from('she_finding_register').select('*', { count: 'exact' }).eq('status', 'open').order('due_date').limit(200);
  if (sp.t_terlambat || sp.terlambat) fq = fq.eq('is_overdue', true);
  if (t.cari) fq = fq.or(['inspection_no', 'object', 'description'].map(c => `${c}.ilike.%${t.cari}%`).join(','));
  if (t.risiko) fq = fq.eq('risk_level', t.risiko);
  if (t.pic) fq = fq.eq('pic_department_code', t.pic);
  if (isDate(t.dari)) fq = fq.gte('inspected_on', t.dari);
  if (isDate(t.sampai)) fq = fq.lte('inspected_on', t.sampai);
  let iq = supabase.from('inspections').select('id, inspection_no, inspected_on, inspection_type, object, inspector:inspector_id(full_name), findings:inspection_findings(status)', { count: 'exact' })
    .order('inspected_on', { ascending: false }).order('inspection_no', { ascending: false }).limit(50);
  if (i.cari) iq = iq.or(['inspection_no', 'object', 'note'].map(c => `${c}.ilike.%${i.cari}%`).join(','));
  if (i.jenis) iq = iq.eq('inspection_type', i.jenis);
  if (isDate(i.dari)) iq = iq.gte('inspected_on', i.dari);
  if (isDate(i.sampai)) iq = iq.lte('inspected_on', i.sampai);
  const [{ data: findings, count: fCount }, { data: recentAll, count: iCount }, { depts, areas }] = await Promise.all([fq.returns<Finding[]>(), iq.returns<Insp[]>(), sheMasters()]);
  // Hasil dihitung dari temuan, jadi disaring setelah data diambil
  const recent = (recentAll ?? []).filter(r => !i.hasil || (i.hasil === 'sesuai' ? !r.findings.length : i.hasil === 'open' ? r.findings.some(f => f.status === 'open') : r.findings.length > 0 && !r.findings.some(f => f.status === 'open')));
  const photos = await photosFor('inspections', recent.map(r => r.id));

  return (
    <>
      <PageHeader eyebrow="SMKP 5.2 · Inspeksi keselamatan" title="Inspeksi" />
      <SheTabs active="/she/inspeksi" />
      {s.can('she.report') && (
        <Panel title="Catat inspeksi">
          <ActionForm action={recordInspection} label="Simpan inspeksi" primary hidden={{ idem: randomUUID() }}>
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="grid gap-1 text-sm">Tanggal<input type="date" name="date" required defaultValue={today()} max={today()} className={input} /></label>
              <DeptSelect label="Departemen inspektor" depts={depts} value={s.profile.department_id} />
              <label className="grid gap-1 text-sm">Jenis inspeksi
                <select name="type" className={input}>{Object.entries(INSPECTION_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <AreaSelect areas={areas} />
            </div>
            <label className="grid gap-1 text-sm">Objek / unit yang diinspeksi<input name="object" required className={input} /></label>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Temuan (kosongkan jika semua sesuai)</legend>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="grid gap-2 rounded border border-line p-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
                  <input name={`f${i}_desc`} className={input} placeholder={`Temuan ${i + 1}`} aria-label={`Temuan ${i + 1}`} />
                  <select name={`f${i}_risk`} className={input} defaultValue="medium" aria-label="Risiko">
                    {Object.entries(RISK).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <select name={`f${i}_pic`} className={input} defaultValue="" aria-label="Departemen PIC">
                    <option value="">PIC</option>{depts.map(d => <option key={d.id} value={d.id}>{d.code}</option>)}
                  </select>
                  <input type="date" name={`f${i}_due`} min={today()} className={input} aria-label="Due date" />
                </div>
              ))}
            </fieldset>
            <label className="grid gap-1 text-sm">Catatan<textarea name="note" rows={2} className={input} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <EmployeeInput name="credit" label="Atas nama (opsional)" hint="Untuk SAP: isi bila formulir ini milik pengawas lain" />
              <Files label="Foto / checklist" />
            </div>
            <EmployeeDatalist />
          </ActionForm>
        </Panel>
      )}
      <Panel title="Temuan open">
        <FilterBar action="/she/inspeksi" prefix="t_" sp={sp} shown={findings?.length ?? 0} total={fCount ?? undefined} fields={[
          { name: 'cari', label: 'Cari nomor, objek, temuan', type: 'text', placeholder: 'Ketik kata kunci' },
          { name: 'risiko', label: 'Risiko', type: 'select', options: Object.entries(RISK).map(([k, [, l]]) => [k, l]) },
          { name: 'pic', label: 'PIC', type: 'select', options: depts.map(d => [d.code, d.code]) },
          { name: 'dari', label: 'Dari tanggal', type: 'date' },
          { name: 'sampai', label: 'Sampai tanggal', type: 'date' },
          { name: 'terlambat', label: 'Lewat due date', type: 'check' },
        ]} />
        {findings?.length ? (
          <Table head={['Inspeksi', 'Temuan', 'Risiko', 'PIC', 'Due date', 'Status']}>
            {findings.map(f => (
              <tr key={f.id}>
                <td className="whitespace-nowrap font-mono text-xs"><Link href={`/she/inspeksi/${f.inspection_id}`} className="hover:text-accent">{f.inspection_no}-{f.seq}</Link>
                  <div className="text-muted">{f.object}</div></td>
                <td className="min-w-64">{f.description}</td>
                <td><Pill tone={RISK[f.risk_level][0]}>{RISK[f.risk_level][1]}</Pill></td>
                <td className="font-mono text-xs">{f.pic_department_code}</td>
                <td className={`tabular whitespace-nowrap text-xs ${f.is_overdue ? 'font-medium text-crit' : ''}`}>{fmtDate(f.due_date)}</td>
                <td><Pill tone={f.is_overdue ? 'crit' : OPEN_CLOSED[f.status][0]}>{f.is_overdue ? 'Terlambat' : 'Terbuka'}</Pill></td>
              </tr>
            ))}
          </Table>
        ) : <p className="mt-3 text-sm text-muted">Tidak ada temuan open untuk saringan ini.</p>}
      </Panel>
      <Panel title="Inspeksi terakhir">
        <FilterBar action="/she/inspeksi" prefix="i_" sp={sp} shown={recent.length} total={iCount ?? undefined} fields={[
          { name: 'cari', label: 'Cari nomor atau objek', type: 'text', placeholder: 'Ketik kata kunci' },
          { name: 'jenis', label: 'Jenis', type: 'select', options: Object.entries(INSPECTION_TYPE) },
          { name: 'hasil', label: 'Hasil', type: 'select', options: [['sesuai', 'Sesuai'], ['open', 'Ada temuan open'], ['closed', 'Temuan closed']] },
          { name: 'dari', label: 'Dari tanggal', type: 'date' },
          { name: 'sampai', label: 'Sampai tanggal', type: 'date' },
        ]} />
        {recent.length ? (
          <Table head={['Nomor', 'Tanggal', 'Jenis', 'Objek', 'Inspektor', 'Foto', 'Hasil']}>
            {recent.map(r => {
              const open = r.findings.filter(f => f.status === 'open').length;
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap font-mono text-xs"><Link href={`/she/inspeksi/${r.id}`} className="font-medium hover:text-accent">{r.inspection_no}</Link></td>
                  <td className="tabular whitespace-nowrap text-xs">{fmtDate(r.inspected_on)}</td>
                  <td className="text-xs">{INSPECTION_TYPE[r.inspection_type]}</td>
                  <td>{r.object}</td>
                  <td className="text-xs">{r.inspector?.full_name}</td>
                  <td><Thumbs items={photos.get(r.id)} /></td>
                  <td>{!r.findings.length ? <Pill tone="ok">Sesuai</Pill> : open ? <Pill tone="warn">{open} temuan open</Pill> : <Pill tone="muted">{r.findings.length} temuan closed</Pill>}</td>
                </tr>
              );
            })}
          </Table>
        ) : <p className="mt-3 text-sm text-muted">Tidak ada inspeksi untuk saringan ini.</p>}
      </Panel>
    </>
  );
}
