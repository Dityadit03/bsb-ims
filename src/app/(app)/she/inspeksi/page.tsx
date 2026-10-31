import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, btnGhost, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { RISK } from '@/lib/compliance';
import { fmtDate } from '@/lib/documents';
import { INSPECTION_TYPE, OPEN_CLOSED } from '@/lib/she';
import { recordInspection } from '../actions';
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
  let fq = supabase.from('she_finding_register').select('*').eq('status', 'open').order('due_date').limit(200);
  if (sp.terlambat) fq = fq.eq('is_overdue', true);
  const [{ data: findings }, { data: recent }, { depts, areas }] = await Promise.all([
    fq.returns<Finding[]>(),
    supabase.from('inspections').select('id, inspection_no, inspected_on, inspection_type, object, inspector:inspector_id(full_name), findings:inspection_findings(status)')
      .order('inspected_on', { ascending: false }).order('inspection_no', { ascending: false }).limit(50).returns<Insp[]>(),
    sheMasters(),
  ]);

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
      <Panel title="Temuan open" action={<Link href={sp.terlambat ? '/she/inspeksi' : '/she/inspeksi?terlambat=1'} className={btnGhost}>{sp.terlambat ? 'Semua open' : 'Lewat due date'}</Link>}>
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
                <td><Pill tone={f.is_overdue ? 'crit' : OPEN_CLOSED[f.status][0]}>{f.is_overdue ? 'Terlambat' : 'Open'}</Pill></td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Tidak ada temuan open.</p>}
      </Panel>
      <Panel title="Inspeksi terakhir">
        {recent?.length ? (
          <Table head={['Nomor', 'Tanggal', 'Jenis', 'Objek', 'Inspektor', 'Hasil']}>
            {recent.map(r => {
              const open = r.findings.filter(f => f.status === 'open').length;
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap font-mono text-xs"><Link href={`/she/inspeksi/${r.id}`} className="font-medium hover:text-accent">{r.inspection_no}</Link></td>
                  <td className="tabular whitespace-nowrap text-xs">{fmtDate(r.inspected_on)}</td>
                  <td className="text-xs">{INSPECTION_TYPE[r.inspection_type]}</td>
                  <td>{r.object}</td>
                  <td className="text-xs">{r.inspector?.full_name}</td>
                  <td>{!r.findings.length ? <Pill tone="ok">Sesuai</Pill> : open ? <Pill tone="warn">{open} temuan open</Pill> : <Pill tone="muted">{r.findings.length} temuan closed</Pill>}</td>
                </tr>
              );
            })}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada inspeksi.</p>}
      </Panel>
    </>
  );
}
