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
