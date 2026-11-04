import Link from 'next/link';
import Image from 'next/image';
import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { TRAINING_STATUS } from '@/lib/hrga';
import { addAttendees, completeTraining, setTrainingQr } from '../../actions';
import { AttachmentList } from '../../../she/fields';
import { TRAINING_LEVEL } from '@/lib/hrga';
import { HrTabs } from '../../tabs';

type T = { id: string; title: string; held_on: string; hours: number; trainer: string; location: string | null; status: string;
  competencies: { code: string; name: string } | null; description: string | null; start_time: string | null; speaker_org: string | null; speaker_bio: string | null;
  target_departments: string[]; target_levels: string[]; qr_token: string; qr_open: boolean; created_by: string };
type A = { id: string; employee_id: string; passed: boolean | null; score: number | null; source: string; checked_in_at: string | null; employees: { nrp: string; full_name: string } };

export default async function TrainingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: t } = await supabase.from('trainings').select('id, title, held_on, hours, trainer, location, status, competencies(code, name), description, start_time, speaker_org, speaker_bio, target_departments, target_levels, qr_token, qr_open, created_by')
    .eq('id', id).maybeSingle<T>();
  if (!t) notFound();
  const [{ data: att }, { data: emps }] = await Promise.all([
    supabase.from('training_attendees').select('id, employee_id, passed, score, source, checked_in_at, employees(nrp, full_name)').eq('training_id', id).returns<A[]>(),
    supabase.from('employees').select('id, nrp, full_name').eq('status', 'active').order('full_name'),
  ]);
  const manager = s.canIn('hr.manage', 'HRGA') || t.created_by === s.profile.id;
  const open = t.status === 'planned' && manager;
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const scanUrl = `${origin}/pelatihan/ikut/${t.qr_token}`;
  const qr = manager ? await QRCode.toDataURL(scanUrl, { margin: 1, width: 360, errorCorrectionLevel: 'M' }) : null;
  const { data: dd } = await supabase.from('departments').select('id, code').returns<{ id: string; code: string }[]>();
  const targetDepts = t.target_departments.length ? t.target_departments.map(id => dd?.find(d => d.id === id)?.code ?? '?').join(', ') : 'Semua departemen';
  const targetLevels = t.target_levels.length ? t.target_levels.map(l => TRAINING_LEVEL[l] ?? l).join(', ') : 'Semua level';
  const inList = new Set((att ?? []).map(a => a.employee_id));

  return (
    <>
      <PageHeader eyebrow={`Pelatihan · ${fmtDate(t.held_on)} · ${t.hours} jam · ${t.trainer}`} title={t.title}>
        <Pill tone={TRAINING_STATUS[t.status][0]}>{TRAINING_STATUS[t.status][1]}</Pill>
      </PageHeader>
      <HrTabs active="/hrga/pelatihan" />
      {t.competencies && <p className="text-sm text-muted">Peserta lulus mendapat kompetensi <b className="font-mono">{t.competencies.code}</b> · {t.competencies.name}</p>}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel title="Rincian">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
            <dt>Waktu</dt><dd>{fmtDate(t.held_on)}{t.start_time ? ` · ${t.start_time.slice(0, 5)}` : ''} · {t.hours} jam</dd>
            <dt>Lokasi</dt><dd>{t.location ?? '–'}</dd>
            <dt>Sasaran</dt><dd>{targetDepts} · {targetLevels}</dd>
            <dt>Narasumber</dt><dd>{t.trainer}{t.speaker_org ? ` · ${t.speaker_org}` : ''}{t.speaker_bio && <span className="block whitespace-pre-line text-xs text-muted">{t.speaker_bio}</span>}</dd>
            {t.description && <><dt>Materi</dt><dd className="whitespace-pre-line">{t.description}</dd></>}
          </dl>
          <AttachmentList table="trainings" ids={[t.id]} />
        </Panel>
        {qr && (
          <Panel title="QR kehadiran" sub="Tampilkan di layar atau cetak. Peserta memindai dengan HP, masuk, lalu menekan Hadir. Hanya berlaku pada hari pelatihan.">
            <Image src={qr} alt="QR kehadiran" width={180} height={180} unoptimized className="mx-auto rounded-lg border border-line bg-white p-1" />
            <p className="break-all text-center font-mono text-[11px] text-muted">{scanUrl}</p>
            {t.status === 'planned' && manager && (
              <ActionForm action={setTrainingQr} label={t.qr_open ? 'Tutup kehadiran QR' : 'Buka kehadiran QR'} hidden={{ training: t.id, open: t.qr_open ? '0' : '1' }} />
            )}
            {!t.qr_open && <p className="text-xs text-warn">Kehadiran QR sedang ditutup.</p>}
          </Panel>
        )}
      </div>
      <Panel title={`Peserta (${att?.length ?? 0})`}>
        {open && att?.length ? (
          <ActionForm action={completeTraining} label="Tutup pelatihan & simpan hasil" confirm="Tutup pelatihan dan simpan hasil? Tidak bisa dibuka lagi." primary hidden={{ training: t.id }}>
            {att.map(a => (
              <div key={a.id} className="grid grid-cols-[2fr_1fr_1fr] items-center gap-2 text-sm">
                <input type="hidden" name="employee" value={a.employee_id} />
                <span><span className="font-mono text-xs">{a.employees.nrp}</span> · {a.employees.full_name}{a.source === 'qr' && <span className="ml-1 text-xs text-muted">(QR)</span>}</span>
                <select name={`passed_${a.employee_id}`} className={input} aria-label="Hasil"><option value="true">Lulus</option><option value="false">Tidak lulus</option></select>
                <input type="number" name={`score_${a.employee_id}`} min={0} max={100} className={input} placeholder="Nilai" />
              </div>
            ))}
          </ActionForm>
        ) : att?.length ? (
          <Table head={['NRP', 'Nama', 'Hadir', 'Hasil', 'Nilai']}>
            {att.map(a => (
              <tr key={a.id}>
                <td className="font-mono text-xs">{a.employees.nrp}</td>
                <td className="text-sm"><Link href={`/hrga/${a.employee_id}`} className="hover:text-accent">{a.employees.full_name}</Link></td>
                <td className="text-xs">{a.checked_in_at ? `QR ${fmtDateTime(a.checked_in_at)}` : a.source === 'qr' ? 'QR' : 'Dicatat HRGA'}</td>
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
