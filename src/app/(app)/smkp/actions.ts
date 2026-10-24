'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { uploadFormFiles } from '@/lib/attachments';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;

// Bukti bisa berupa dokumen terkendali yang berlaku atau berkas yang diunggah langsung.
export async function linkEvidence(_: ActionState, f: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const clause = str(f, 'clause');
  let source = 'documents', sourceId = str(f, 'document');
  if (!sourceId) {
    const { data: auth } = await supabase.auth.getUser();
    try { sourceId = (await uploadFormFiles(supabase, auth.user!.id, 'evidence', f.getAll('file')))[0] ?? null; }
    catch (e) { return { error: (e as Error).message }; }
    source = 'attachments';
  }
  if (!sourceId) return { error: 'Pilih dokumen atau unggah berkas bukti' };
  const { error } = await supabase.rpc('evidence_link', {
    p_clause: clause, p_source_table: source, p_source_id: sourceId, p_label: str(f, 'label'),
    p_control: str(f, 'control'), p_period_start: str(f, 'period_start'), p_period_end: str(f, 'period_end'),
  });
  if (error) return { error: error.message };
  revalidatePath(`/smkp/${clause}`);
  return { ok: 'Bukti dikirim untuk dinilai' };
}

export async function reviewEvidence(_: ActionState, f: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('evidence_review', { p_link: str(f, 'link'), p_accept: f.get('decision') === 'accept', p_note: str(f, 'note') });
  if (error) return { error: error.message };
  revalidatePath(`/smkp/${str(f, 'clause')}`);
  return { ok: 'Penilaian tersimpan' };
}

export async function registerLegal(_: ActionState, f: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('legal_register', {
    p_title: str(f, 'title'), p_regulation_no: str(f, 'regulation_no'), p_regulation_type: str(f, 'regulation_type'),
    p_owner_department: str(f, 'department'), p_issuer: str(f, 'issuer'), p_issued_date: str(f, 'issued_date'),
    p_source_url: str(f, 'source_url'), p_summary: str(f, 'summary'),
  });
  if (error) return { error: error.message };
  redirect(`/legal/${(data as { id: string }).id}`);
}

export async function addObligation(_: ActionState, f: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('legal_add_obligation', {
    p_requirement: str(f, 'requirement'), p_obligation: str(f, 'obligation'), p_article: str(f, 'article'),
    p_clause: str(f, 'clause'), p_frequency: str(f, 'frequency') ?? 'annual',
  });
  if (error) return { error: error.message };
  revalidatePath(`/legal/${str(f, 'requirement')}`);
  return { ok: 'Kewajiban ditambahkan' };
}

export async function evaluateObligation(_: ActionState, f: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  let att: string | null = null;
  try { att = (await uploadFormFiles(supabase, auth.user!.id, 'legal', f.getAll('file')))[0] ?? null; }
  catch (e) { return { error: (e as Error).message }; }
  const { error } = await supabase.rpc('legal_evaluate', { p_obligation: str(f, 'obligation'), p_result: str(f, 'result'), p_note: str(f, 'note'), p_attachment: att });
  if (error) return { error: error.message };
  revalidatePath(`/legal/${str(f, 'requirement')}`);
  return { ok: 'Evaluasi tersimpan' };
}
