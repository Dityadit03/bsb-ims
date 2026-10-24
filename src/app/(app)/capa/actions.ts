'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { uploadFormFiles } from '@/lib/attachments';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;

export async function createAction(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('capa_create', {
    p_title: str(form, 'title'), p_description: str(form, 'description'), p_source_type: str(form, 'source_type'),
    p_clause: str(form, 'clause'), p_risk: str(form, 'risk'), p_department: str(form, 'department'),
    p_pic: str(form, 'pic'), p_verifier: str(form, 'verifier'), p_due: str(form, 'due'),
    p_action_type: str(form, 'action_type') ?? 'corrective', p_control_hierarchy: str(form, 'hierarchy'),
    p_source_ref: str(form, 'source_ref'), p_source_table: str(form, 'source_table'), p_source_id: str(form, 'source_id'),
    p_idempotency_key: str(form, 'idem'),
  });
  if (error) return { error: error.message };
  redirect(`/capa/${(data as { id: string }).id}`);
}

async function rpc(fn: string, args: Record<string, unknown>, id: string | null, ok: string): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  revalidatePath(`/capa/${id}`);
  return { ok };
}

export async function startAction(_: ActionState, f: FormData) {
  return rpc('capa_start', { p_action: str(f, 'id') }, str(f, 'id'), 'Status: dikerjakan');
}

export async function submitAction(_: ActionState, f: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  let ids: string[];
  try { ids = await uploadFormFiles(supabase, auth.user!.id, 'capa', f.getAll('files')); }
  catch (e) { return { error: (e as Error).message }; }
  if (!ids.length) return { error: 'Lampirkan minimal satu bukti (foto, dokumen)' };
  return rpc('capa_submit', { p_action: str(f, 'id'), p_note: str(f, 'note'), p_attachments: ids }, str(f, 'id'), 'Dikirim ke verifikator');
}

export async function verifyAction(_: ActionState, f: FormData) {
  const accept = f.get('decision') === 'accept';
  return rpc('capa_verify', { p_action: str(f, 'id'), p_accept: accept, p_note: str(f, 'note') }, str(f, 'id'),
    accept ? 'Action plan ditutup' : 'Dikembalikan ke PIC');
}

export async function extendAction(_: ActionState, f: FormData) {
  return rpc('capa_extend', { p_action: str(f, 'id'), p_new_due: str(f, 'due'), p_reason: str(f, 'reason') }, str(f, 'id'), 'Target diperpanjang');
}

export async function cancelAction(_: ActionState, f: FormData) {
  return rpc('capa_cancel', { p_action: str(f, 'id'), p_reason: str(f, 'reason') }, str(f, 'id'), 'Dibatalkan');
}

export async function reviewEffectiveness(_: ActionState, f: FormData) {
  return rpc('capa_review_effectiveness', { p_action: str(f, 'id'), p_effective: f.get('effective') === 'yes', p_note: str(f, 'note'),
    p_new_due: str(f, 'due') }, str(f, 'id'), 'Efektivitas tercatat');
}
