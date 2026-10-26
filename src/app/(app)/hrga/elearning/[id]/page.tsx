import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { DropZone } from '@/components/drop-zone';
import { Tabs } from '@/components/tabs';
import { PageHeader, Pager, Panel, Pill, Table, input, paginate } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { ASSIGN_STATUS, COURSE_STATUS, MATERIAL_KIND } from '@/lib/hrga';
import { assignCourse, deleteMaterial, deleteQuestion, saveMaterial, saveQuestion, setCourseStatus, unassign, updateCourse } from '../actions';
import { CourseFields, type CourseRow } from '../parts';

export const metadata = { title: 'Kursus' };

type Material = { id: string; title: string; kind: string; body: string | null; url: string | null; attachment_id: string | null };
type Question = { id: string; question: string; options: string[]; answer: number; active: boolean };
type Assign = { id: string; employee_id: string; nrp: string; full_name: string; department_code: string; position_name: string | null; due_on: string | null;
  completed_at: string | null; status: string; attempts: number; best_score: number | null; cert_no: string | null };
const LETTERS = 'ABCDEF';

export default async function CoursePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: c } = await supabase.from('course_register').select('*').eq('id', id).maybeSingle<CourseRow>();
  if (!c || !c.can_manage) notFound();
  const tab = ['soal', 'peserta', 'pengaturan'].includes(sp.tab ?? '') ? sp.tab! : 'materi';
  const h = { course: id };
  const base = `/hrga/elearning/${id}`;

  return (
    <>
      <PageHeader eyebrow={`E-learning · ${c.code} · ${c.department_code}`} title={c.title}>
        <Link href="/hrga/elearning" className="text-sm text-muted hover:text-accent">← Semua kursus</Link>
      </PageHeader>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Pill tone={COURSE_STATUS[c.status][0]}>{COURSE_STATUS[c.status][1]}</Pill>
            <span className="text-muted">Lulus ≥ {c.pass_score} · {c.question_count ? `${c.question_count} soal acak` : 'semua soal'} · {c.max_attempts ? `maks. ${c.max_attempts}× percobaan` : 'percobaan bebas'}{c.duration_minutes ? ` · ${c.duration_minutes} menit` : ''}</span>
            {c.competency_code && <span className="text-muted">· lulus → {c.competency_code}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {c.status !== 'published' && <ActionForm action={setCourseStatus} label="Terbitkan" primary hidden={{ ...h, status: 'published' }} />}
            {c.status === 'published' && <ActionForm action={setCourseStatus} label="Kembalikan ke draf" hidden={{ ...h, status: 'draft' }} />}
            {c.status !== 'archived' && <ActionForm action={setCourseStatus} label="Arsipkan" hidden={{ ...h, status: 'archived' }} />}
            <Link href={`/belajar/${id}`} className="rounded-lg border border-line px-3.5 py-2 text-sm hover:border-violet/60">Lihat sebagai peserta</Link>
          </div>
        </div>
      </Panel>
      <Tabs items={[[base, 'Materi'], [`${base}?tab=soal`, 'Soal kuis'], [`${base}?tab=peserta`, `Peserta (${c.assigned})`], [`${base}?tab=pengaturan`, 'Pengaturan']]}
        active={tab === 'materi' ? base : `${base}?tab=${tab}`} />
      {tab === 'materi' && <Materials id={id} supabase={supabase} />}
      {tab === 'soal' && <Questions id={id} supabase={supabase} />}
      {tab === 'peserta' && <Participants id={id} sp={sp} supabase={supabase} />}
      {tab === 'pengaturan' && <Settings c={c} supabase={supabase} />}
    </>
  );
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function Materials({ id, supabase }: { id: string; supabase: Client }) {
  const { data } = await supabase.from('course_materials').select('id, title, kind, body, url, attachment_id').eq('course_id', id).order('sort_order').returns<Material[]>();
  return (
    <>
      <Panel title="Materi" sub="Peserta wajib menandai semua materi selesai sebelum kuis dibuka.">
        {data?.length ? (
          <ol className="grid gap-2">
            {data.map((m, i) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line p-3">
                <div className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-semibold">{i + 1}. {m.title} <span className="font-normal text-muted">· {MATERIAL_KIND[m.kind]}</span></span>
                  {m.body && <span className="line-clamp-2 text-xs text-muted">{m.body}</span>}
                  {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="truncate text-xs text-violet hover:underline">{m.url}</a>}
                  {m.attachment_id && <a href={`/api/lampiran/${m.attachment_id}`} className="text-xs text-violet hover:underline">Buka berkas</a>}
                </div>
                <ActionForm action={deleteMaterial} label="Hapus" confirm="Hapus materi ini?" hidden={{ course: id, material: m.id }} />
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted">Belum ada materi. Kursus boleh tanpa materi (kuis saja).</p>}
      </Panel>
      <Panel title="Tambah materi" sub="Bacaan singkat, tautan video (YouTube/Drive) atau berkas PDF/gambar.">
        <ActionForm action={saveMaterial} label="Simpan materi" primary hidden={{ course: id }} className="md:grid-cols-[2fr_1fr] md:items-end">
          <label className="grid gap-1 text-sm">Judul<input name="title" required placeholder="Aturan lalu lintas tambang" className={input} /></label>
          <label className="grid gap-1 text-sm">Jenis<select name="kind" className={input}>{Object.entries(MATERIAL_KIND).filter(([k]) => k !== 'file').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="grid gap-1 text-sm md:col-span-2">Isi bacaan<textarea name="body" rows={5} placeholder="Untuk jenis Bacaan" className={input} /></label>
          <label className="grid gap-1 text-sm md:col-span-2">Tautan (https://…)<input name="url" type="url" placeholder="Untuk jenis Video / Tautan" className={input} /></label>
          <div className="md:col-span-2"><DropZone label="Atau unggah berkas (PDF, gambar)" multiple={false} accept="application/pdf,image/*" /></div>
        </ActionForm>
      </Panel>
    </>
  );
}

async function Questions({ id, supabase }: { id: string; supabase: Client }) {
  const { data } = await supabase.from('course_questions').select('id, question, options, answer, active').eq('course_id', id).order('sort_order').returns<Question[]>();
  const act = (data ?? []).filter(q => q.active);
  return (
    <>
      <Panel title={`Bank soal (${act.length} aktif)`} sub="Kunci jawaban hanya terlihat penyusun. Soal massal dari Excel: Impor data → Bank soal kursus.">
        {act.length ? (
          <ol className="grid gap-2">
            {act.map((q, i) => (
              <li key={q.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line p-3">
                <div className="grid gap-1">
                  <span className="text-sm font-semibold">{i + 1}. {q.question}</span>
                  <ul className="grid gap-0.5 text-sm">
                    {q.options.map((o, k) => <li key={k} className={k + 1 === q.answer ? 'font-semibold text-ok' : 'text-muted'}>{LETTERS[k]}. {o}{k + 1 === q.answer && ' ✓'}</li>)}
                  </ul>
                </div>
                <ActionForm action={deleteQuestion} label="Hapus" confirm="Hapus soal ini?" hidden={{ course: id, question: q.id }} />
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted">Belum ada soal. Kursus perlu minimal satu soal sebelum terbit.</p>}
      </Panel>
      <Panel title="Tambah soal pilihan ganda">
        <ActionForm action={saveQuestion} label="Simpan soal" primary hidden={{ course: id }} className="md:grid-cols-2">
          <label className="grid gap-1 text-sm md:col-span-2">Pertanyaan<textarea name="text" required rows={2} className={input} /></label>
          {['a', 'b', 'c', 'd'].map((k, i) => (
            <label key={k} className="grid gap-1 text-sm">Pilihan {k.toUpperCase()}<input name={`opt_${k}`} required={i < 2} className={input} /></label>
          ))}
          <label className="grid gap-1 text-sm">Kunci jawaban<select name="answer" required className={input}>{['A', 'B', 'C', 'D'].map((l, i) => <option key={l} value={i + 1}>{l}</option>)}</select></label>
        </ActionForm>
      </Panel>
    </>
  );
}

async function Participants({ id, sp, supabase }: { id: string; sp: Record<string, string | undefined>; supabase: Client }) {
  const [{ data }, { data: depts }, { data: positions }] = await Promise.all([
    supabase.from('course_assignment_register').select('*').eq('course_id', id).order('department_code').order('full_name').returns<Assign[]>(),
    supabase.from('departments').select('id, code').order('code'),
    supabase.from('positions').select('id, name').eq('active', true).order('name'),
  ]);
  const rows = sp.status ? (data ?? []).filter(r => r.status === sp.status) : data ?? [];
  const pg = paginate(rows, sp.hal);
  return (
    <>
      <Panel title="Peserta" action={
        <form className="flex gap-2"><input type="hidden" name="tab" value="peserta" />
          <select name="status" defaultValue={sp.status ?? ''} className={`${input} max-w-44`}><option value="">Semua status</option>
            {Object.entries(ASSIGN_STATUS).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
          <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Saring</button></form>}>
        {rows.length ? (
          <>
            <Table head={['Karyawan', 'Tenggat', 'Status', 'Percobaan', 'Nilai terbaik', 'Sertifikat', '']}>
              {pg.rows.map(a => (
                <tr key={a.id}>
                  <td><span className="grid"><span className="text-sm font-semibold">{a.full_name}</span><span className="font-mono text-xs text-muted">{a.nrp} · {a.department_code}</span></span></td>
                  <td className="text-sm">{a.due_on ? fmtDate(a.due_on) : '–'}</td>
                  <td><Pill tone={ASSIGN_STATUS[a.status][0]}>{ASSIGN_STATUS[a.status][1]}</Pill></td>
                  <td className="tabular text-sm">{a.attempts}</td>
                  <td className="tabular text-sm">{a.best_score ?? '–'}</td>
                  <td className="font-mono text-xs">{a.cert_no ?? '–'}</td>
                  <td>{!a.completed_at && <ActionForm action={unassign} label="Batalkan" hidden={{ course: id, employee: a.employee_id }} />}</td>
                </tr>
              ))}
            </Table>
            <Pager {...pg} params={{ tab: 'peserta', status: sp.status }} />
          </>
        ) : <p className="text-sm text-muted">Belum ada peserta.</p>}
      </Panel>
      <Panel title="Tugaskan peserta" sub="Kursus harus sudah terbit. Menugaskan ulang peserta yang sudah lulus membuka penyegaran (refresher).">
        <ActionForm action={assignCourse} label="Tugaskan" primary hidden={{ course: id }} className="md:grid-cols-3 md:items-end">
          <label className="grid gap-1 text-sm md:col-span-3">NRP (pisahkan dengan koma / baris baru)<textarea name="nrps" rows={2} placeholder="23.12.002, 23.12.010" className={input} /></label>
          <label className="grid gap-1 text-sm">Atau seluruh departemen<select name="department" className={input}><option value="">–</option>{(depts ?? []).map(d => <option key={d.id} value={d.id}>{d.code}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Atau seluruh jabatan<select name="position" className={input}><option value="">–</option>{(positions ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Tenggat<input type="date" name="due" className={input} /></label>
        </ActionForm>
      </Panel>
    </>
  );
}

async function Settings({ c, supabase }: { c: CourseRow; supabase: Client }) {
  const [{ data: departments }, { data: competencies }] = await Promise.all([
    supabase.from('departments').select('id, code, name').order('code'),
    supabase.from('competencies').select('id, code, name').eq('active', true).order('code'),
  ]);
  return (
    <Panel title="Pengaturan kursus">
      <ActionForm action={updateCourse} label="Simpan" primary hidden={{ course: c.id }} className="md:grid-cols-4 md:items-end">
        <CourseFields c={c} departments={departments ?? []} competencies={competencies ?? []} />
      </ActionForm>
    </Panel>
  );
}
