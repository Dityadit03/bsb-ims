import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { TRAINING_STATUS } from '@/lib/hrga';
import { createTraining } from '../actions';
import { Files } from '../../she/fields';
import { OtherCompetency } from './other-competency';
import { TRAINING_LEVEL } from '@/lib/hrga';
import { HrTabs } from '../tabs';
import { today, sheMasters } from '../../she/fields';

export const metadata = { title: 'Pelatihan' };

type Row = { id: string; title: string; held_on: string; hours: number; trainer: string; location: string | null; status: string;
  competencies: { code: string } | null; training_attendees: { count: number }[] };

export default async function PelatihanPage() {
  const s = await getSession();
  const supabase = await createClient();
  const { depts } = await sheMasters();
  const [{ data: rows }, { data: comps }] = await Promise.all([
    supabase.from('trainings').select('id, title, held_on, hours, trainer, location, status, competencies(code), training_attendees(count)')
      .order('held_on', { ascending: false }).limit(200).returns<Row[]>(),
    supabase.from('competencies').select('id, code, name').eq('active', true).order('code'),
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
      {(s.canIn('hr.manage', 'HRGA') || s.can('training.organize')) && (
        <Panel title="Adakan pelatihan internal" sub="Isi materi, narasumber, dan sasaran. Setelah disimpan, undangan langsung dikirim sebagai notifikasi ke karyawan sasaran, dan QR kehadiran dibuat otomatis.">
          <ActionForm action={createTraining} label="Simpan & kirim undangan" primary className="max-w-4xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm sm:col-span-2">Judul<input name="title" required className={input} placeholder="mis. Defensive driving internal" /></label>
              <OtherCompetency comps={comps ?? []} />
              <label className="grid gap-1 text-sm">Tanggal<input type="date" name="held_on" required defaultValue={today()} className={input} /></label>
              <label className="grid gap-1 text-sm">Jam mulai<input type="time" name="start" className={input} /></label>
              <label className="grid gap-1 text-sm">Durasi (jam)<input type="number" name="hours" required min={0.5} step="0.5" className={input} /></label>
              <label className="grid gap-1 text-sm sm:col-span-3">Lokasi<input name="location" className={input} placeholder="mis. Ruang training workshop" /></label>
              <label className="grid gap-1 text-sm sm:col-span-3">Materi / deskripsi<textarea name="description" rows={3} className={input} placeholder="Pokok bahasan, tujuan, yang perlu dibawa" /></label>
              <div className="sm:col-span-3"><Files label="Berkas materi (PDF / foto)" /></div>
              <label className="grid gap-1 text-sm">Narasumber<input name="speaker" required className={input} /></label>
              <label className="grid gap-1 text-sm">Instansi / jabatan<input name="speaker_org" className={input} /></label>
              <label className="grid gap-1 text-sm sm:col-span-3">Bio narasumber<textarea name="speaker_bio" rows={2} className={input} placeholder="Latar belakang, pengalaman, sertifikasi" /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <fieldset className="grid gap-1 text-sm"><legend className="mb-1">Departemen sasaran <span className="text-xs text-muted">(tanpa centang = semua)</span></legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">{depts.map(d => <label key={d.id} className="flex items-center gap-1.5"><input type="checkbox" name="dept" value={d.id} className="size-4" />{d.code}</label>)}</div></fieldset>
              <fieldset className="grid gap-1 text-sm"><legend className="mb-1">Level jabatan sasaran <span className="text-xs text-muted">(tanpa centang = semua)</span></legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">{Object.entries(TRAINING_LEVEL).map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="level" value={k} className="size-4" />{l}</label>)}</div></fieldset>
            </div>
            <p className="text-xs text-muted">Peserta yang dinyatakan lulus otomatis mendapat kompetensi yang dipilih saat pelatihan ditutup.</p>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
