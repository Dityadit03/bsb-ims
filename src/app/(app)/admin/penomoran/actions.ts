'use server';
import { createClient } from '@/lib/supabase/server';

export type PreviewState = { number?: string; error?: string };

export async function previewNumber(_: PreviewState, form: FormData): Promise<PreviewState> {
  const params: Record<string, string> = {};
  for (const k of ['D', 'S', 'P']) {
    const v = String(form.get(k) ?? '').trim();
    if (v) params[k] = v;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('preview_number', { p_scheme: String(form.get('scheme')), p_params: params });
  if (error) return { error: error.message };
  return { number: data as string };
}
