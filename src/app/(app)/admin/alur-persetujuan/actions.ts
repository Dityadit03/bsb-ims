'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type State = { error?: string; ok?: string };
const EXPIRED = 'Sesi Anda sudah habis. Muat ulang halaman (F5) atau masuk lagi, lalu coba sekali lagi.';

async function run(fn: (s: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ error: { message: string } | null }>, ok: string): Promise<State> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: EXPIRED };
  const { error } = await fn(supabase);
  if (error) return { error: error.message };
  revalidatePath('/admin/alur-persetujuan');
  return { ok };
}

export async function designate(_: State, form: FormData): Promise<State> {
  return run(s => s.rpc('designate_approver', {
    p_employee: String(form.get('employee')),
    p_role: String(form.get('role')),
    p_department: (form.get('department') as string) || null,
    p_basis: (form.get('basis') as string) || null,
  }), 'Penunjukan disimpan');
}

export async function undesignate(_: State, form: FormData): Promise<State> {
  return run(s => s.rpc('undesignate_approver', { p_id: String(form.get('id')) }), 'Penunjukan dicabut');
}

export async function fillSupervisors(_: State): Promise<State> {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { error: EXPIRED };
  const { data, error } = await supabase.rpc('fill_supervisors');
  if (error) return { error: error.message };
  revalidatePath('/admin/alur-persetujuan');
  return { ok: `${data} atasan langsung diisi` };
}
