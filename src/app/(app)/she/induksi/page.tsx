import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input, paginate, Pager } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { INDUCTION_TYPE } from '@/lib/she';
import { recordInduction } from '../portal-actions';
import { DeptSelect, EmployeeDatalist, EmployeeInput, Files, SheTabs, sheMasters, today } from '../fields';

export const metadata = { title: 'Induksi' };

type Row = {
  id: string; held_on: string; induction_type: string; participant_name: string; company: string | null; position_note: string | null;
  presenter: string; score: number | null; result: string; employee_competency_id: string | null; dept: { code: string } | null;
};

export default async function InductionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data }, { depts }] = await Promise.all([
    supabase.from('inductions').select('id, held_on, induction_type, participant_name, company, position_note, presenter, score, result, employee_competency_id, dept:department_id(code)')
      .order('held_on', { ascending: false }).limit(1000).returns<Row[]>(),
    sheMasters(),
  ]);
  const pg = paginate(data ?? [], sp.hal);

  return (
    <>
      <PageHeader eyebrow="SMKP 3.5 · Induksi & reinduksi" title="Induksi" />
      <SheTabs active="/she/induksi" />
      {s.canIn('she.induction', 'HSE') && (
        <Panel title="Catat induksi">
          <ActionForm action={recordInduction} label="Simpan induksi" primary className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Tanggal<input type="date" name="date" required defaultValue={today()} max={today()} className={input} /></label>
              <label className="grid gap-1 text-sm">Jenis
                <select name="type" className={input}>{Object.entries(INDUCTION_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <EmployeeInput label="Karyawan" hint="Kosongkan untuk tamu" />
              <label className="grid gap-1 text-sm">Nama tamu<input name="name" className={input} /></label>
              <label className="grid gap-1 text-sm">Perusahaan<input name="company" className={input} /></label>
              <DeptSelect depts={depts} label="Departemen tujuan" />
              <label className="grid gap-1 text-sm">Pemateri<input name="presenter" required className={input} /></label>
              <label className="grid gap-1 text-sm">Nilai<input type="number" name="score" min={0} max={100} className={input} /></label>
              <label className="grid gap-1 text-sm">Hasil
                <select name="result" className={input}><option value="pass">Lulus</option><option value="fail">Tidak lulus</option></select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">Catatan<input name="note" className={input} /></label>
              <Files label="Daftar hadir / foto" />
            </div>
            <EmployeeDatalist />
          </ActionForm>
          <p className="text-xs text-muted">Induksi karyawan yang lulus otomatis memperbarui kompetensi INDUKSI di matriks kompetensi HRGA.</p>
        </Panel>
      )}
      {pg.rows.length ? (
        <Table head={['Tanggal', 'Peserta', 'Jenis', 'Dept', 'Pemateri', 'Nilai', 'Hasil']}>
          {pg.rows.map(r => (
            <tr key={r.id}>
              <td className="tabular whitespace-nowrap text-xs">{fmtDate(r.held_on)}</td>
              <td className="min-w-48">{r.participant_name}<div className="text-xs text-muted">{r.company}</div></td>
              <td className="text-xs">{INDUCTION_TYPE[r.induction_type]}</td>
              <td className="font-mono text-xs">{r.dept?.code}</td>
              <td className="text-xs">{r.presenter}</td>
              <td className="tabular text-xs">{r.score ?? '–'}</td>
              <td><Pill tone={r.result === 'pass' ? 'ok' : 'crit'}>{r.result === 'pass' ? 'Lulus' : 'Tidak lulus'}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada catatan induksi.</p>}
      <Pager {...pg} params={{}} />
    </>
  );
}
