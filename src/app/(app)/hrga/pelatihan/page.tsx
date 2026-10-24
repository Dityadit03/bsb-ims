import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { TRAINING_STATUS } from '@/lib/hrga';
import { saveTraining } from '../actions';
import { HrTabs } from '../tabs';
import { today } from '../../she/fields';

export const metadata = { title: 'Pelatihan' };

type Row = { id: string; title: string; held_on: string; hours: number; trainer: string; location: string | null; status: string;
  competencies: { code: string } | null; training_attendees: { count: number }[] };

export default async function PelatihanPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: rows }, { data: comps }, { data: emps }] = await Promise.all([
    supabase.from('trainings').select('id, title, held_on, hours, trainer, location, status, competencies(code), training_attendees(count)')
      .order('held_on', { ascending: false }).limit(200).returns<Row[]>(),
    supabase.from('competencies').select('id, code, name').eq('active', true).order('code'),
    supabase.from('employees').select('id, nrp, full_name').eq('status', 'active').order('full_name'),
  ]);

  return (
    <>
      <PageHeader eyebrow="SMKP 3.5 · Pendidikan & pelatihan" title="Pelatihan & induksi" />
      <HrTabs active="/hrga/pelatihan" />
      {rows?.length ? (
        <Table head={['Tanggal', 'Judul', 'Kompetensi', 'Pemateri', 'Jam', 'Peserta', 'Status']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs">{fmtDate(r.held_on)}</td>
              <td className="text-sm"><Link href={`/hrga/pelatihan/${r.id}`} className="font-medium hover:text-accent">{r.title}</Link>
                {r.location && <div className="text-xs text-muted">{r.location}</div>}</td>
              <td className="font-mono text-xs">{r.competencies?.code ?? '–'}</td>
              <td className="text-xs">{r.trainer}</td>
              <td className="tabular text-xs">{r.hours}</td>
              <td className="tabular text-xs">{r.training_attendees[0]?.count ?? 0}</td>
              <td><Pill tone={TRAINING_STATUS[r.status][0]}>{TRAINING_STATUS[r.status][1]}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada pelatihan.</p>}
      {s.canIn('hr.manage', 'HRGA') && (
        <Panel title="Jadwalkan pelatihan / induksi">
          <ActionForm action={saveTraining} label="Simpan" primary className="max-w-4xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm sm:col-span-2">Judul<input name="title" required className={input} placeholder="mis. Induksi karyawan baru" /></label>
              <label className="grid gap-1 text-sm">Kompetensi yang diberikan
                <select name="competency" className={input} defaultValue=""><option value="">–</option>{(comps ?? []).map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
              <label className="grid gap-1 text-sm">Tanggal<input type="date" name="held_on" required defaultValue={today()} className={input} /></label>
              <label className="grid gap-1 text-sm">Durasi (jam)<input type="number" name="hours" required min={0.5} step="0.5" className={input} /></label>
              <label className="grid gap-1 text-sm">Pemateri<input name="trainer" required className={input} /></label>
              <label className="grid gap-1 text-sm">Lokasi<input name="location" className={input} /></label>
            </div>
            <label className="grid gap-1 text-sm">Peserta (tahan Ctrl / ⌘ untuk memilih banyak)
              <select name="employees" multiple size={8} className={input}>{(emps ?? []).map(e => <option key={e.id} value={e.id}>{e.nrp} · {e.full_name}</option>)}</select></label>
            <p className="text-xs text-muted">Peserta yang dinyatakan lulus otomatis mendapat kompetensi yang dipilih saat pelatihan ditutup.</p>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
