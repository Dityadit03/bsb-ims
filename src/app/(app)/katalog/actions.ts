'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;
const num = (f: FormData, k: string) => (str(f, k) == null ? null : Number(str(f, k)));

async function run(ok: string, fn: string, args: Record<string, unknown>): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  revalidatePath('/katalog');
  return { ok };
}

export async function savePart(_: ActionState, f: FormData) {
  return run('Part tersimpan', 'catalog_part_save', {
    p_group: str(f, 'group'), p_part_no: str(f, 'part_no'), p_name: str(f, 'name'), p_qty: num(f, 'qty') ?? 1,
    p_ref: num(f, 'ref'), p_description: str(f, 'description'), p_material: str(f, 'material'), p_note: str(f, 'note'),
  });
}
export async function deletePart(_: ActionState, f: FormData) {
  return run('Part dihapus', 'catalog_part_delete', { p_id: str(f, 'id') });
}
export async function saveGroup(_: ActionState, f: FormData) {
  return run('Kelompok tersimpan', 'catalog_group_save', {
    p_model: str(f, 'model'), p_code: str(f, 'code'), p_name: str(f, 'name'), p_description: str(f, 'description'),
  });
}
