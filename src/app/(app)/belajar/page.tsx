import Link from 'next/link';
import { PageHeader, Panel, Pill, Stat } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import type { CourseRow } from '../hrga/elearning/parts';

export const metadata = { title: 'Belajar' };

export default async function BelajarPage() {
  const supabase = await createClient();
  const { data } = await supabase.from('course_register').select('*').eq('status', 'published').order('title').returns<CourseRow[]>();
  const all = (data ?? []).filter(c => c.open_enroll || c.my_assigned);
  const todo = all.filter(c => c.my_assigned && !c.my_completed_at);
  const done = all.filter(c => c.my_passed);
  const rest = all.filter(c => !todo.includes(c) && !done.includes(c));
  const Card = ({ c }: { c: CourseRow }) => (
    <Link href={`/belajar/${c.id}`} className="grid gap-1 rounded-xl border border-line p-3 hover:border-violet/60">
      <span className="text-sm font-semibold">{c.title}</span>
      <span className="font-mono text-xs text-muted">{c.code} · {c.department_code}{c.competency_code ? ` · lulus → ${c.competency_code}` : ''}</span>
      <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {c.materials > 0 && <span>Materi {c.my_materials_done}/{c.materials}</span>}
        {c.my_best_score != null && <span>Nilai terbaik {c.my_best_score}</span>}
        {c.my_due_on && !c.my_completed_at && <Pill tone={c.my_due_on < new Date().toISOString().slice(0, 10) ? 'crit' : 'warn'}>Tenggat {fmtDate(c.my_due_on)}</Pill>}
        {c.my_passed && <Pill tone="ok">Lulus</Pill>}
      </span>
    </Link>
  );
  return (
    <>
      <PageHeader eyebrow="E-learning" title="Belajar" />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Ditugaskan" value={todo.length} tone={todo.length ? 'warn' : 'ok'} />
        <Stat label="Lulus" value={done.length} tone="ok" />
        <Stat label="Tersedia" value={rest.length} />
      </div>
      {!!todo.length && <Panel title="Ditugaskan untuk Anda"><div className="grid gap-2 md:grid-cols-2">{todo.map(c => <Card key={c.id} c={c} />)}</div></Panel>}
      {!!rest.length && <Panel title="Kursus tersedia"><div className="grid gap-2 md:grid-cols-2">{rest.map(c => <Card key={c.id} c={c} />)}</div></Panel>}
      {!!done.length && <Panel title="Sudah lulus"><div className="grid gap-2 md:grid-cols-2">{done.map(c => <Card key={c.id} c={c} />)}</div></Panel>}
      {!all.length && <Panel><p className="text-sm text-muted">Belum ada kursus untuk Anda.</p></Panel>}
    </>
  );
}
