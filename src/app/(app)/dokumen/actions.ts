'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { sha256, stampControlled } from '@/lib/pdf-stamp';

export type ActionState = { error?: string; ok?: string };
const MAX_BYTES = 25 * 1024 * 1024;
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;

async function uploadAttachment(supabase: Awaited<ReturnType<typeof createClient>>, path: string, bytes: Uint8Array, name: string, mime: string) {
  const { error: upErr } = await supabase.storage.from('records').upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) throw new Error(`Gagal mengunggah berkas: ${upErr.message}`);
  const { data, error } = await supabase.from('attachments')
    .insert({ bucket: 'records', storage_path: path, file_name: name, mime_type: mime, size_bytes: bytes.byteLength, sha256: sha256(bytes) })
    .select('id, sha256').single();
  if (error) throw new Error(error.message);
  return data;
}

export async function requestDocument(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const type = str(form, 'type')!;
  const { data: t } = await supabase.from('document_types').select('workflow_code').eq('code', type).single();
  const smkp = form.getAll('smkp').map(Number);
  const common = { p_type: type, p_department: str(form, 'department'), p_title: str(form, 'title'), p_section: str(form, 'section'),
    p_access_class: str(form, 'access') ?? 'internal', p_smkp_elements: smkp, p_idempotency_key: str(form, 'idem') };
  const { data, error } = t?.workflow_code
    ? await supabase.rpc('document_request', { ...common, p_parent: str(form, 'parent') })
    : await supabase.rpc('document_register_record', { ...common, p_date: str(form, 'date'), p_valid_until: str(form, 'valid_until'), p_issuer: str(form, 'issuer') });
  if (error) return { error: error.message };
  redirect(`/dokumen/${(data as { id: string }).id}`);
}

export async function uploadDraft(_: ActionState, form: FormData): Promise<ActionState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Pilih berkas draf' };
  if (file.size > MAX_BYTES) return { error: 'Ukuran berkas maksimal 25 MB' };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
    const att = await uploadAttachment(supabase, `drafts/${auth.user!.id}/${crypto.randomUUID()}-${safe}`, bytes, file.name, file.type || 'application/octet-stream');
    const { error } = await supabase.rpc('document_attach_draft', { p_version: str(form, 'version'), p_attachment: att.id });
    if (error) return { error: error.message };
  } catch (e) { return { error: (e as Error).message }; }
  revalidatePath(`/dokumen/${str(form, 'document')}`);
  return { ok: 'Draf terlampir' };
}

async function rpcAndRefresh(fn: string, args: Record<string, unknown>, doc: string | null, ok: string): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  revalidatePath(`/dokumen/${doc}`);
  return { ok };
}

export async function submitVersion(_: ActionState, form: FormData) {
  return rpcAndRefresh('document_submit', { p_version: str(form, 'version') }, str(form, 'document'), 'Diajukan untuk review');
}
export async function startRevision(_: ActionState, form: FormData) {
  return rpcAndRefresh('document_start_revision', { p_document: str(form, 'document'), p_change_summary: str(form, 'summary') }, str(form, 'document'), 'Revisi dibuat');
}
export async function obsoleteDocument(_: ActionState, form: FormData) {
  return rpcAndRefresh('document_obsolete', { p_document: str(form, 'document'), p_reason: str(form, 'reason') }, str(form, 'document'), 'Dokumen dicabut');
}
export async function acknowledge(_: ActionState, form: FormData) {
  return rpcAndRefresh('document_acknowledge', { p_version: str(form, 'version') }, str(form, 'document'), 'Penerimaan dikonfirmasi');
}
export async function distribute(_: ActionState, form: FormData) {
  const depts = form.getAll('departments').map(String);
  if (!depts.length) return { error: 'Pilih minimal satu departemen' };
  return rpcAndRefresh('document_distribute', { p_version: str(form, 'version'), p_departments: depts, p_ack_required: form.get('ack') === 'on' },
    str(form, 'document'), 'Terdistribusi');
}

// Rilis: pesan nomor → stempel PDF draf yang disetujui → unggah sebagai controlled → catat rilis.
export async function releaseVersion(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const versionId = str(form, 'version')!;
  const effective = str(form, 'effective_date');
  if (!effective) return { error: 'Isi tanggal berlaku' };

  const { data: v } = await supabase.from('document_versions')
    .select('id, revision, status, draft_sha256, approved_at, approved:approved_by(full_name, email), draft:draft_attachment_id(storage_path, mime_type, sha256), documents(id, title)')
    .eq('id', versionId).single<{
      id: string; revision: number; status: string; draft_sha256: string; approved_at: string;
      approved: { full_name: string | null; email: string } | null;
      draft: { storage_path: string; mime_type: string; sha256: string } | null;
      documents: { id: string; title: string };
    }>();
  if (!v || v.status !== 'approved') return { error: 'Versi ini belum disetujui' };
  if (!v.draft || v.draft.mime_type !== 'application/pdf') return { error: 'Draf yang disetujui harus berupa PDF agar bisa distempel' };

  const { data: number, error: numErr } = await supabase.rpc('document_reserve_number', { p_version: versionId });
  if (numErr) return { error: numErr.message };
  const { data: blob, error: dlErr } = await supabase.storage.from('records').download(v.draft.storage_path);
  if (dlErr || !blob) return { error: 'Draf tidak bisa diunduh dari penyimpanan' };
  const source = new Uint8Array(await blob.arrayBuffer());
  if (sha256(source) !== v.draft_sha256) return { error: 'Berkas di penyimpanan tidak sama dengan yang disetujui (hash berbeda)' };

  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  try {
    const stamped = await stampControlled(source, {
      number: number as string, revision: v.revision, title: v.documents.title, effectiveDate: effective,
      approvedBy: v.approved?.full_name ?? v.approved?.email ?? '-', approvedAt: v.approved_at,
      verifyUrl: `${origin}/verifikasi/${versionId}`,
    });
    const att = await uploadAttachment(supabase, `controlled/${v.documents.id}/${versionId}.pdf`, stamped,
      `${String(number).replace(/[/\\]/g, '_')}_Rev${String(v.revision).padStart(2, '0')}.pdf`, 'application/pdf');
    const { error } = await supabase.rpc('document_release', { p_version: versionId, p_effective_date: effective, p_final_attachment: att.id });
    if (error) return { error: error.message };
  } catch (e) { return { error: (e as Error).message }; }
  revalidatePath(`/dokumen/${v.documents.id}`);
  return { ok: `Terbit sebagai ${number}` };
}
