'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function actOnTask(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('act_on_task', {
    p_task: String(form.get('task')),
    p_decision: String(form.get('decision')),
    p_comment: String(form.get('comment') ?? '') || null,
    p_subject_hash: String(form.get('hash') ?? '') || null,
  });
  if (error) return { error: error.message };
  revalidatePath('/tugas');
  return {};
}
