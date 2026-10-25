'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { uploadFormFiles } from '@/lib/attachments';
import { employeeIdFrom } from '@/lib/employee-ref';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;
const rupiah = (f: FormData, k: string) => (str(f, k) == null ? null : Number(str(f, k)!.replace(/[^\d]/g, '')));

async function rpc<T = { id: string }>(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function run(paths: string[], ok: string, fn: () => Promise<unknown>): Promise<ActionState> {
  try { await fn(); } catch (e) { return { error: (e as Error).message }; }
  for (const p of paths) revalidatePath(p);
  return { ok };
}
const reqPaths = (f: FormData) => ['/hrga/rekrutmen', `/hrga/rekrutmen/${str(f, 'req')}`, '/tugas'];

export async function createRequisition(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    const supabase = await createClient();
    const { data: pos } = await supabase.from('positions').select('department_id').eq('id', str(f, 'position')!).single();
    const replaced = str(f, 'replaced') ? await employeeIdFrom(supabase, str(f, 'replaced')) : null;
    id = (await rpc('requisition_create', {
      p_department: pos?.department_id, p_position: str(f, 'position'), p_headcount: Number(str(f, 'headcount') ?? 1), p_type: str(f, 'type'),
      p_reason: str(f, 'reason'), p_replaced: replaced, p_needed_by: str(f, 'needed_by'), p_requirements: str(f, 'requirements'),
      p_justification: str(f, 'justification'), p_idempotency_key: str(f, 'idem'),
    })).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/hrga/rekrutmen/${id}`);
}
export async function decideRequisition(_: ActionState, f: FormData) {
  const approve = str(f, 'approve') === '1';
  return run(reqPaths(f), approve ? 'Disetujui' : 'Ditolak', () => rpc('requisition_decide', { p_id: str(f, 'req'), p_approve: approve, p_note: str(f, 'note') }));
}
export async function closeRequisition(_: ActionState, f: FormData) {
  return run(reqPaths(f), 'FPTK ditutup', () => rpc('requisition_close', { p_id: str(f, 'req'), p_cancel: str(f, 'cancel') === '1', p_reason: str(f, 'reason') }));
}

const CAND_FIELDS = ['full_name', 'nik', 'phone', 'email', 'birth_date', 'gender', 'domicile', 'education_level', 'education_major', 'experience_years',
  'last_employer', 'source', 'note'];
async function saveCandidate(f: FormData) {
  const { profile } = await getSession();
  const files = await uploadFormFiles(await createClient(), profile.id, 'kandidat', f.getAll('files'));
  const data: Record<string, unknown> = Object.fromEntries(CAND_FIELDS.map(k => [k, str(f, k)]).filter(([, v]) => v != null));
  data.is_local = f.get('is_local') === 'on';
  return rpc('candidate_save', { p_id: str(f, 'candidate_id'), p_data: data, p_attachments: files });
}
export async function candidateSave(_: ActionState, f: FormData) {
  return run(['/hrga/rekrutmen'], 'Kandidat disimpan', () => saveCandidate(f));
}
// pelamar baru langsung ditautkan ke FPTK; atau pilih dari bank kandidat
export async function addApplicant(_: ActionState, f: FormData) {
  return run(reqPaths(f), 'Pelamar ditambahkan', async () => {
    const id = str(f, 'existing') ?? (await saveCandidate(f)).id;
    await rpc('application_add', { p_requisition: str(f, 'req'), p_candidate: id });
  });
}
export async function recordResult(_: ActionState, f: FormData) {
  const result = str(f, 'result') ?? 'pass';
  return run(reqPaths(f), result === 'pass' ? 'Lanjut ke tahap berikutnya' : 'Hasil dicatat', () => rpc('application_result', {
    p_id: str(f, 'app'), p_result: result, p_score: str(f, 'score') ? Number(str(f, 'score')) : null, p_note: str(f, 'note'), p_next: str(f, 'next'),
  }));
}
export async function saveOffer(_: ActionState, f: FormData) {
  return run(reqPaths(f), 'Penawaran dicatat', () => rpc('offer_save', {
    p_application: str(f, 'app'), p_wage: rupiah(f, 'wage'), p_allowances: str(f, 'allowances'), p_start: str(f, 'start'), p_note: str(f, 'note'),
  }));
}
export async function decideOffer(_: ActionState, f: FormData) {
  return run(reqPaths(f), str(f, 'accepted') === '1' ? 'Penawaran diterima kandidat' : 'Penawaran ditolak kandidat', () => rpc('offer_decide', {
    p_application: str(f, 'app'), p_accepted: str(f, 'accepted') === '1', p_note: str(f, 'note'),
  }));
}
export async function hire(_: ActionState, f: FormData) {
  return run([...reqPaths(f), '/hrga'], 'Tercatat sebagai karyawan baru; checklist mobilisasi dibuat', () => rpc('application_hire', {
    p_id: str(f, 'app'), p_nrp: str(f, 'nrp'), p_email: str(f, 'email'),
  }));
}
