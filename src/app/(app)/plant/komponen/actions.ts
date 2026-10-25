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
  revalidatePath('/plant/komponen');
  return { ok };
}

export async function registerComponent(_: ActionState, f: FormData) {
  return run('Komponen terdaftar', 'component_save', {
    p_type: str(f, 'type'), p_serial: str(f, 'serial'), p_brand: str(f, 'brand'), p_part_no: str(f, 'part_no'),
    p_life_target: num(f, 'life_target'), p_initial_hm: num(f, 'initial_hm') ?? 0, p_note: str(f, 'note'),
  });
}
export async function installComponent(_: ActionState, f: FormData) {
  return run('Komponen dipasang', 'component_install', {
    p_component: str(f, 'id'), p_unit: str(f, 'unit'), p_unit_hm: num(f, 'hm'), p_position: str(f, 'position'), p_wo: str(f, 'wo'), p_note: str(f, 'note'),
  });
}
export async function removeComponent(_: ActionState, f: FormData) {
  return run('Komponen dilepas', 'component_remove', {
    p_component: str(f, 'id'), p_unit_hm: num(f, 'hm'), p_reason: str(f, 'reason'), p_next: str(f, 'next') ?? 'rebuild', p_wo: str(f, 'wo'), p_note: str(f, 'note'),
  });
}
export async function finishRebuild(_: ActionState, f: FormData) {
  return run('Overhaul selesai, komponen kembali ke stok', 'component_rebuild_done', {
    p_component: str(f, 'id'), p_cost: num(f, 'cost'), p_reset: f.get('reset') === 'on', p_life_target: num(f, 'life_target'), p_note: str(f, 'note'),
  });
}
export async function scrapComponent(_: ActionState, f: FormData) {
  return run('Komponen dibuang', 'component_scrap', { p_component: str(f, 'id'), p_note: str(f, 'note') });
}
