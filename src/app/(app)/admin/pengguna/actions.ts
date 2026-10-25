'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function activateUser(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
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
  const { error } = await supabase.rpc('reject_nik_user', { p_user: String(form.get('user')), p_reason: String(form.get('reason') ?? '') });
  if (error) return { error: error.message };
  revalidatePath('/admin/pengguna');
  return {};
}

// Reset sandi: Edge Function memeriksa izin lewat database lalu mengganti sandi dengan sandi sementara (ditampilkan sekali).
export async function resetPassword(_: { error?: string; password?: string }, form: FormData): Promise<{ error?: string; password?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke('admin-reset-password', { body: { user_id: String(form.get('user')) } });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as unknown as { context: Response }).context.json()).error ?? msg; } catch { /* pakai pesan bawaan */ }
    return { error: msg };
  }
  return { password: (data as { password: string }).password };
}
