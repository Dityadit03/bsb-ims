'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;

export async function saveSite(_: ActionState, f: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('site_save', {
    p_code: str(f, 'code'), p_name: str(f, 'name'), p_email_domain: str(f, 'email_domain'), p_kind: str(f, 'kind') ?? 'site', p_active: str(f, 'active') !== 'no',
  });
  if (error) return { error: error.message };
  revalidatePath('/admin/site');
  return { ok: 'Site disimpan' };
}

export async function switchSite(_: ActionState, f: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('site_switch', { p_code: str(f, 'code') });
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  return { ok: 'Site diganti' };
}
