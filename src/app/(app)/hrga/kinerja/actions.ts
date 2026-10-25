'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
async function run(f: FormData, ok: string, fn: () => Promise<unknown>): Promise<ActionState> {
  try { await fn(); } catch (e) { return { error: (e as Error).message }; }
  for (const p of ['/hrga/kinerja', '/saya', '/tugas', `/kinerja/${str(f, 'review')}`]) revalidatePath(p);
  return { ok };
}

export async function saveCycle(_: ActionState, f: FormData) {
  return run(f, 'Siklus disimpan', () => rpc('perf_cycle_save', {
    p_id: str(f, 'id'), p_name: str(f, 'name'), p_start: str(f, 'start'), p_end: str(f, 'end'), p_kpi_weight: Number(str(f, 'kpi_weight') ?? 70),
    p_goal_due: str(f, 'goal_due'), p_review_due: str(f, 'review_due'),
  }));
}
export async function advanceCycle(_: ActionState, f: FormData) {
  return run(f, 'Tahap siklus dilanjutkan', () => rpc('perf_cycle_advance', { p_cycle: str(f, 'id') }));
}
export async function enrollCycle(_: ActionState, f: FormData) {
  return run(f, 'Peserta ditambahkan', () => rpc('perf_cycle_enroll', { p_cycle: str(f, 'id'), p_employee: null }));
}

export async function saveGoal(_: ActionState, f: FormData) {
  return run(f, 'KPI disimpan', () => rpc('perf_goal_save', {
    p_review: str(f, 'review'), p_id: str(f, 'goal'), p_title: str(f, 'title'), p_measure: str(f, 'measure'), p_target: str(f, 'target'),
    p_weight: Number(str(f, 'weight') ?? 0),
  }));
}
export async function deleteGoal(_: ActionState, f: FormData) {
  return run(f, 'KPI dihapus', () => rpc('perf_goal_delete', { p_id: str(f, 'goal') }));
}
export async function submitGoals(_: ActionState, f: FormData) {
  return run(f, 'KPI dikirim ke atasan', () => rpc('perf_goals_submit', { p_review: str(f, 'review') }));
}
export async function decideGoals(_: ActionState, f: FormData) {
  const approve = str(f, 'approve') === '1';
  return run(f, approve ? 'KPI disetujui' : 'KPI dikembalikan', () => rpc('perf_goals_decide', { p_review: str(f, 'review'), p_approve: approve, p_note: str(f, 'note') }));
}

// isian nilai: g:<id> nilai KPI, ga:<id> realisasi, gn:<id> catatan; b:<id> nilai perilaku
function items(f: FormData) {
  const out: Record<string, unknown>[] = [];
  for (const [k, v] of f.entries()) {
    const [p, id] = k.split(':');
    if (!id || (p !== 'g' && p !== 'b')) continue;
    const it: Record<string, unknown> = { kind: p === 'g' ? 'goal' : 'behavior', id, score: v ? Number(v) : null, note: str(f, `${p}n:${id}`) };
    if (p === 'g') it.actual = str(f, `ga:${id}`);
    out.push(it);
  }
  return out;
}
export async function selfReview(_: ActionState, f: FormData) {
  return run(f, 'Penilaian diri terkirim', () => rpc('perf_self_review', { p_review: str(f, 'review'), p_items: items(f), p_comment: str(f, 'comment') }));
}
export async function managerReview(_: ActionState, f: FormData) {
  return run(f, 'Nilai atasan disimpan', () => rpc('perf_manager_review', {
    p_review: str(f, 'review'), p_items: items(f), p_comment: str(f, 'comment'), p_development: str(f, 'development'),
  }));
}
export async function calibrate(_: ActionState, f: FormData) {
  return run(f, 'Kalibrasi disimpan', () => rpc('perf_calibrate', { p_review: str(f, 'review'), p_grade: str(f, 'grade') ?? '', p_note: str(f, 'note') }));
}
export async function acknowledge(_: ActionState, f: FormData) {
  return run(f, 'Hasil dikonfirmasi', () => rpc('perf_acknowledge', { p_review: str(f, 'review'), p_comment: str(f, 'comment') }));
}
