import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { TRAINING_STATUS } from '@/lib/hrga';
import { addAttendees, completeTraining } from '../../actions';
import { HrTabs } from '../../tabs';

type T = { id: string; title: string; held_on: string; hours: number; trainer: string; location: string | null; status: string;
  competencies: { code: string; name: string } | null };
type A = { id: string; employee_id: string; passed: boolean | null; score: number | null; employees: { nrp: string; full_name: string } };

export default async function TrainingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: t } = await supabase.from('trainings').select('id, title, held_on, hours, trainer, location, status, competencies(code, name)')
    .eq('id', id).maybeSingle<T>();
  if (!t) notFound();
  const [{ data: att }, { data: emps }] = await Promise.all([
    supabase.from('training_attendees').select('id, employee_id, passed, score, employees(nrp, full_name)').eq('training_id', id).returns<A[]>(),
    supabase.from('employees').select('id, nrp, full_name').eq('status', 'active').order('full_name'),
  ]);
  const open = t.status === 'planned' && s.canIn('hr.manage', 'HRGA');
  const inList = new Set((att ?? []).map(a => a.employee_id));

  return (
    <>
      <PageHeader eyebrow={`Pelatihan · ${fmtDate(t.held_on)} · ${t.hours} jam · ${t.trainer}`} title={t.title}>
        <Pill tone={TRAINING_STATUS[t.status][0]}>{TRAINING_STATUS[t.status][1]}</Pill>
      </PageHeader>
      <HrTabs active="/hrga/pelatihan" />
      {t.competencies && <p className="text-sm text-muted">Peserta lulus mendapat kompetensi <b className="font-mono">{t.competencies.code}</b> · {t.competencies.name}</p>}
      <Panel title={`Peserta (${att?.length ?? 0})`}>
        {open && att?.length ? (
          <ActionForm action={completeTraining} label="Tutup pelatihan & simpan hasil" confirm="Tutup pelatihan dan simpan hasil? Tidak bisa dibuka lagi." primary hidden={{ training: t.id }}>
            {att.map(a => (
              <div key={a.id} className="grid grid-cols-[2fr_1fr_1fr] items-center gap-2 text-sm">
                <input type="hidden" name="employee" value={a.employee_id} />
                <span><span className="font-mono text-xs">{a.employees.nrp}</span> · {a.employees.full_name}</span>
                <select name={`passed_${a.employee_id}`} className={input} aria-label="Hasil"><option value="true">Lulus</option><option value="false">Tidak lulus</option></select>
                <input type="number" name={`score_${a.employee_id}`} min={0} max={100} className={input} placeholder="Nilai" />
              </div>
            ))}
          </ActionForm>
        ) : att?.length ? (
          <Table head={['NRP', 'Nama', 'Hasil', 'Nilai']}>
            {att.map(a => (
              <tr key={a.id}>
                <td className="font-mono text-xs">{a.employees.nrp}</td>
                <td className="text-sm"><Link href={`/hrga/${a.employee_id}`} className="hover:text-accent">{a.employees.full_name}</Link></td>
                <td>{a.passed == null ? '–' : <Pill tone={a.passed ? 'ok' : 'crit'}>{a.passed ? 'Lulus' : 'Tidak lulus'}</Pill>}</td>
                <td className="tabular text-xs">{a.score ?? '–'}</td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada peserta.</p>}
      </Panel>
      {open && (
        <Panel title="Tambah peserta">
          <ActionForm action={addAttendees} label="Tambahkan" hidden={{ training: t.id }}>
            <select name="employees" multiple size={8} className={input} aria-label="Karyawan">
              {(emps ?? []).filter(e => !inList.has(e.id)).map(e => <option key={e.id} value={e.id}>{e.nrp} · {e.full_name}</option>)}</select>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
