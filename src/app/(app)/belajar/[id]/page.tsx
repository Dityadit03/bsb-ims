import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { MATERIAL_KIND } from '@/lib/hrga';
import { materialDone } from '../../hrga/elearning/actions';
import type { CourseRow } from '../../hrga/elearning/parts';
import { Quiz, type QuizData } from './quiz';

export const metadata = { title: 'Kursus' };

type Material = { id: string; title: string; kind: string; body: string | null; url: string | null; attachment_id: string | null };

export default async function LearnPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: c } = await supabase.from('course_register').select('*').eq('id', id).maybeSingle<CourseRow>();
  if (!c || (c.status !== 'published' && !c.can_manage)) notFound();
  const [{ data: mats }, { data: prog }, { data: attempts }] = await Promise.all([
    supabase.from('course_materials').select('id, title, kind, body, url, attachment_id').eq('course_id', id).order('sort_order').returns<Material[]>(),
    supabase.from('course_progress').select('material_id'),
    supabase.from('course_attempts').select('id, submitted_at, score, passed, cert_no, correct, question_ids').eq('course_id', id).not('submitted_at', 'is', null).order('submitted_at', { ascending: false }),
  ]);
  const done = new Set((prog ?? []).map(p => p.material_id));
  const allDone = (mats ?? []).every(m => done.has(m.id));
  const passed = (attempts ?? []).find(a => a.passed);
  let quiz: QuizData | null = null;
  let quizError: string | null = null;
  if (sp.kuis === '1' && c.status === 'published' && allDone) {
    const { data, error } = await supabase.rpc('course_start', { p_course: id });
    if (error) quizError = error.message; else quiz = data as QuizData;
  }

  return (
    <>
      <PageHeader eyebrow={`E-learning · ${c.code}`} title={c.title}>
        <span className="flex gap-3 text-sm">
          {c.can_manage && <Link href={`/hrga/elearning/${id}`} className="text-muted hover:text-accent">Kelola kursus</Link>}
          <Link href="/belajar" className="text-muted hover:text-accent">← Semua kursus</Link>
        </span>
      </PageHeader>
      <Panel>
        {c.description && <p className="text-sm">{c.description}</p>}
        <p className="text-sm text-muted">
          Lulus dengan nilai ≥ {c.pass_score}{c.question_count ? ` · ${c.question_count} soal acak` : ''}{c.max_attempts ? ` · maksimal ${c.max_attempts} percobaan` : ''}
          {c.duration_minutes ? ` · ${c.duration_minutes} menit` : ''}{c.my_due_on ? ` · tenggat ${fmtDate(c.my_due_on)}` : ''}
          {c.competency_name ? ` · lulus mencatat kompetensi ${c.competency_name}` : ''}
        </p>
        {passed && <p className="rounded-lg bg-ok/10 p-3 text-sm text-ok">Lulus dengan nilai {passed.score}. Sertifikat <span className="font-mono">{passed.cert_no}</span> sudah tercatat di profil Anda.</p>}
      </Panel>
      {!!mats?.length && (
        <Panel title={`Materi (${(mats ?? []).filter(m => done.has(m.id)).length}/${mats.length} selesai)`}>
          <ol className="grid gap-2">
            {mats.map((m, i) => (
              <li key={m.id} className="grid gap-2 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{i + 1}. {m.title} <span className="font-normal text-muted">· {MATERIAL_KIND[m.kind]}</span></span>
                  {done.has(m.id) ? <Pill tone="ok">Selesai</Pill> : <ActionForm action={materialDone} label="Tandai selesai" hidden={{ course: id, material: m.id }} />}
                </div>
                {m.body && <p className="whitespace-pre-line text-sm">{m.body}</p>}
                {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="text-sm text-violet hover:underline">Buka tautan ↗</a>}
                {m.attachment_id && <a href={`/api/lampiran/${m.attachment_id}`} target="_blank" className="text-sm text-violet hover:underline">Buka berkas ↗</a>}
              </li>
            ))}
          </ol>
        </Panel>
      )}
      <Panel title="Kuis" sub={allDone ? undefined : 'Selesaikan semua materi untuk membuka kuis.'}>
        {quiz ? <Quiz course={id} quiz={quiz} /> : (
          <>
            {quizError && <p role="alert" className="text-sm text-crit">{quizError}</p>}
            {c.status === 'published' && (
              <Link href={`/belajar/${id}?kuis=1`} aria-disabled={!allDone}
                className={`inline-flex w-fit rounded-lg bg-violet px-3.5 py-2 text-sm font-medium text-white ${allDone ? '' : 'pointer-events-none opacity-50'}`}>
                {passed ? 'Ulangi kuis' : 'Mulai kuis'}
              </Link>
            )}
          </>
        )}
        {!!attempts?.length && (
          <ul className="grid gap-1 text-sm text-muted">
            {attempts.map(a => <li key={a.id}>{fmtDate(a.submitted_at!)} · nilai {a.score} · {a.passed ? 'lulus' : 'belum lulus'}</li>)}
          </ul>
        )}
      </Panel>
    </>
  );
}
