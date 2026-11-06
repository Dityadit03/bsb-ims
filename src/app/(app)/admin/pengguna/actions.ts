'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const EXPIRED = 'Sesi Anda sudah habis. Muat ulang halaman (F5) atau masuk lagi, lalu coba sekali lagi.';
// Token kedaluwarsa membuat database melihat pemanggil sebagai anonim: tampilkan sebabnya, bukan "Tidak berwenang"
async function sessionOk(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.auth.getUser();
  return !!data.user;
}

export async function activateUser(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  if (!(await sessionOk(supabase))) return { error: EXPIRED };
  const { error } = await supabase.rpc('activate_user', {
    p_user: String(form.get('user')),
    p_role: String(form.get('role')),
    p_department: (form.get('department') as string) || null,
    p_basis: (form.get('basis') as string) || null,
  });
  if (error) return { error: error.message };
  revalidatePath('/admin/pengguna');
  return {};
}

export async function activateNikUser(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  if (!(await sessionOk(supabase))) return { error: EXPIRED };
  const { error } = await supabase.rpc('activate_nik_user', {
    p_user: String(form.get('user')),
    p_role: String(form.get('role')),
    p_department: (form.get('department') as string) || null,
    p_basis: (form.get('basis') as string) || null,
  });
  if (error) return { error: error.message };
  revalidatePath('/admin/pengguna');
  return {};
}

export async function rejectNikUser(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  if (!(await sessionOk(supabase))) return { error: EXPIRED };
  const { error } = await supabase.rpc('reject_nik_user', { p_user: String(form.get('user')), p_reason: String(form.get('reason') ?? '') });
  if (error) return { error: error.message };
  revalidatePath('/admin/pengguna');
  return {};
}

// Reset sandi: Edge Function memeriksa izin lewat database lalu mengganti sandi dengan sandi sementara (ditampilkan sekali).
export async function resetPassword(_: { error?: string; password?: string }, form: FormData): Promise<{ error?: string; password?: string }> {
  const supabase = await createClient();
  if (!(await sessionOk(supabase))) return { error: EXPIRED };
  const { data, error } = await supabase.functions.invoke('admin-reset-password', { body: { user_id: String(form.get('user')) } });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as unknown as { context: Response }).context.json()).error ?? msg; } catch { /* pakai pesan bawaan */ }
    return { error: msg };
  }
  return { password: (data as { password: string }).password };
}

// Aktivasi / tambah akses berdasarkan jabatan: peran dan lingkup departemen diturunkan oleh database dari jabatan yang dipilih.
async function activateByPosition(nik: boolean, _: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  if (!(await sessionOk(supabase))) return { error: EXPIRED };
  const position = String(form.get('position') ?? '');
  const { data: acc, error: e1 } = await supabase.rpc('position_access', { p_position: position });
  if (e1) return { error: e1.message };
  const a = (acc as { role_code: string; department_id: string | null }[] | null)?.[0];
  if (!a) return { error: 'Jabatan tidak ditemukan atau tidak aktif' };
  const { data: pos } = await supabase.from('positions').select('name').eq('id', position).maybeSingle();
  const { error } = await supabase.rpc(nik ? 'activate_nik_user' : 'activate_user', {
    p_user: String(form.get('user')), p_role: a.role_code, p_department: a.department_id,
    p_basis: (form.get('basis') as string) || `Jabatan: ${pos?.name ?? position}`,
  });
  if (error) return { error: error.message };
  revalidatePath('/admin/pengguna');
  return {};
}

export async function activateUserByPosition(prev: { error?: string }, form: FormData) { return activateByPosition(false, prev, form); }
export async function activateNikByPosition(prev: { error?: string }, form: FormData) { return activateByPosition(true, prev, form); }
