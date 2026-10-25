import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { ExportLinks } from '@/components/export-links';
import { PageHeader, Panel, Pill, Stat, Table } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { COURSE_STATUS } from '@/lib/hrga';
import { HrTabs } from '../tabs';
import { createCourse } from './actions';
import { CourseFields, type CourseRow } from './parts';

export const metadata = { title: 'E-learning' };

export default async function ElearningPage() {
  const session = await getSession();
  const canAuthor = session.canIn('hr.manage', 'HRGA') || session.can('lms.manage');
  const supabase = await createClient();
  const [{ data: courses }, { data: departments }, { data: competencies }] = await Promise.all([
    supabase.from('course_register').select('*').order('status').order('code').returns<CourseRow[]>(),
    supabase.from('departments').select('id, code, name').order('code'),
    supabase.from('competencies').select('id, code, name').eq('active', true).order('code'),
  ]);
  const cs = courses ?? [];
  const pub = cs.filter(c => c.status === 'published');
  const sum = (k: 'assigned' | 'completed' | 'overdue') => cs.reduce((a, c) => a + c[k], 0);

  return (
    <>
      <PageHeader eyebrow="HRGA" title="E-learning"><ExportLinks dataset="elearning" /></PageHeader>
      <HrTabs active="/hrga/elearning" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Kursus terbit" value={pub.length} note={`${cs.length - pub.length} draf / arsip`} />
        <Stat label="Penugasan" value={sum('assigned')} />
        <Stat label="Lulus" value={sum('completed')} note={sum('assigned') ? `${Math.round((100 * sum('completed')) / sum('assigned'))}% dari penugasan` : undefined} tone="ok" />
        <Stat label="Lewat tenggat" value={sum('overdue')} tone={sum('overdue') ? 'crit' : 'ok'} />
      </div>
      <Panel title="Kursus" sub="Lulus kuis menerbitkan sertifikat bernomor LMS dan, bila diatur, langsung tercatat sebagai kompetensi karyawan.">
        {cs.length ? (
          <Table head={['Kursus', 'Pemilik', 'Kompetensi', 'Materi', 'Peserta', 'Status']}>
            {cs.map(c => (
              <tr key={c.id}>
                <td>
                  <Link href={c.can_manage ? `/hrga/elearning/${c.id}` : `/belajar/${c.id}`} className="grid hover:text-accent">
                    <span className="text-sm font-semibold">{c.title}</span>
                    <span className="font-mono text-xs text-muted">{c.code} · lulus ≥ {c.pass_score}{c.open_enroll ? ' · terbuka' : ''}</span>
                  </Link>
                </td>
                <td className="text-sm">{c.department_code}</td>
                <td className="text-sm">{c.competency_code ?? '–'}</td>
                <td className="tabular text-sm">{c.materials}</td>
                <td className="tabular text-sm">{c.completed}/{c.assigned}{c.overdue > 0 && <span className="ml-1 text-crit">· {c.overdue} telat</span>}</td>
                <td><Pill tone={COURSE_STATUS[c.status][0]}>{COURSE_STATUS[c.status][1]}</Pill></td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada kursus.</p>}
      </Panel>
      {canAuthor && (
        <Panel title="Kursus baru" sub="Setelah disimpan, tambahkan materi dan soal kuis lalu terbitkan.">
          <ActionForm action={createCourse} label="Buat kursus" primary className="md:grid-cols-4 md:items-end">
            <CourseFields departments={departments ?? []} competencies={competencies ?? []} />
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
