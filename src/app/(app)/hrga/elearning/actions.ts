'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { uploadFormFiles } from '@/lib/attachments';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;
const num = (f: FormData, k: string) => (str(f, k) == null ? null : Number(str(f, k)));

async function rpc<T = { id: string }>(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function run(f: FormData, ok: string, fn: () => Promise<unknown>): Promise<ActionState> {
  try { await fn(); } catch (e) { return { error: (e as Error).message }; }
  for (const p of ['/hrga/elearning', `/hrga/elearning/${str(f, 'course')}`, '/belajar', `/belajar/${str(f, 'course')}`]) revalidatePath(p);
  return { ok };
}

const courseData = (f: FormData) => ({
  code: str(f, 'code'), title: str(f, 'title'), description: str(f, 'description'), department_id: str(f, 'department'),
  competency_id: str(f, 'competency') ?? '', pass_score: num(f, 'pass_score'), question_count: num(f, 'question_count'),
  max_attempts: num(f, 'max_attempts'), duration_minutes: num(f, 'duration'), open_enroll: f.get('open_enroll') === 'on',
});
export async function createCourse(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try { id = (await rpc('course_save', { p_id: null, p_data: courseData(f) })).id; } catch (e) { return { error: (e as Error).message }; }
  redirect(`/hrga/elearning/${id}`);
}
export async function updateCourse(_: ActionState, f: FormData) {
  return run(f, 'Kursus disimpan', () => rpc('course_save', { p_id: str(f, 'course'), p_data: courseData(f) }));
}
export async function setCourseStatus(_: ActionState, f: FormData) {
  const st = str(f, 'status');
  return run(f, st === 'published' ? 'Kursus terbit' : 'Status diubah', () => rpc('course_set_status', { p_id: str(f, 'course'), p_status: st }));
}

export async function saveMaterial(_: ActionState, f: FormData) {
  return run(f, 'Materi disimpan', async () => {
    const { profile } = await getSession();
    const [att] = await uploadFormFiles(await createClient(), profile.id, 'elearning', f.getAll('files'));
    const kind = str(f, 'kind') ?? 'text';
    return rpc('course_material_save', {
      p_course: str(f, 'course'), p_id: str(f, 'material'), p_title: str(f, 'title'), p_kind: att ? 'file' : kind,
      p_body: str(f, 'body'), p_url: str(f, 'url'), p_attachment: att ?? null,
    });
  });
}
export async function deleteMaterial(_: ActionState, f: FormData) {
  return run(f, 'Materi dihapus', () => rpc('course_material_delete', { p_id: str(f, 'material') }));
}

export async function saveQuestion(_: ActionState, f: FormData) {
  const options = ['a', 'b', 'c', 'd', 'e', 'f'].map(k => str(f, `opt_${k}`) ?? '');
  return run(f, 'Soal disimpan', () => rpc('course_question_save', {
    p_course: str(f, 'course'), p_id: str(f, 'question'), p_question: str(f, 'text'), p_options: options,
    p_answer: num(f, 'answer'), p_active: true,
  }));
}
export async function deleteQuestion(_: ActionState, f: FormData) {
  return run(f, 'Soal dihapus', () => rpc('course_question_delete', { p_id: str(f, 'question') }));
}

export async function assignCourse(_: ActionState, f: FormData) {
  try {
    const supabase = await createClient();
    const nrps = (str(f, 'nrps') ?? '').split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    let ids: string[] = [];
    if (nrps.length) {
      const { data } = await supabase.from('employees').select('id, nrp').in('nrp', nrps);
      const found = new Set((data ?? []).map(e => e.nrp));
      const missing = nrps.filter(n => !found.has(n));
      if (missing.length) return { error: `NRP tidak ditemukan: ${missing.join(', ')}` };
      ids = (data ?? []).map(e => e.id);
    }
    const n = await rpc<number>('course_assign', {
      p_course: str(f, 'course'), p_employees: ids, p_department: str(f, 'department'), p_position: str(f, 'position'), p_due: str(f, 'due'),
    });
    for (const p of [`/hrga/elearning/${str(f, 'course')}`, '/hrga/elearning', '/belajar']) revalidatePath(p);
    return { ok: `${n} peserta ditugaskan` };
  } catch (e) { return { error: (e as Error).message }; }
}
export async function unassign(_: ActionState, f: FormData) {
  return run(f, 'Penugasan dibatalkan', () => rpc('course_unassign', { p_course: str(f, 'course'), p_employee: str(f, 'employee') }));
}

// peserta
export async function materialDone(_: ActionState, f: FormData) {
  return run(f, 'Ditandai selesai', () => rpc('course_material_done', { p_material: str(f, 'material') }));
}
export async function startQuiz(_: ActionState, f: FormData) {
  return run(f, 'Kuis dimulai', () => rpc('course_start', { p_course: str(f, 'course') }));
}
export async function submitQuiz(_: ActionState, f: FormData): Promise<ActionState> {
  const n = Number(str(f, 'n') ?? 0);
  const answers = Array.from({ length: n }, (_, i) => Number(str(f, `q${i}`) ?? 0));
  try {
    const a = await rpc<{ passed: boolean; score: number; cert_no: string | null }>('course_submit', { p_attempt: str(f, 'attempt'), p_answers: answers });
    for (const p of ['/belajar', `/belajar/${str(f, 'course')}`, '/saya']) revalidatePath(p);
    return a.passed ? { ok: `Lulus dengan nilai ${a.score}. Sertifikat ${a.cert_no}.` } : { error: `Nilai ${a.score}, belum lulus. Pelajari lagi materinya lalu coba kembali.` };
  } catch (e) { return { error: (e as Error).message }; }
}
