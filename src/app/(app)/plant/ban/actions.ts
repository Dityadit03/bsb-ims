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
  revalidatePath('/plant/ban');
  return { ok };
}

export async function registerTyre(_: ActionState, f: FormData) {
  return run('Ban terdaftar', 'tyre_register', {
    p_serial: str(f, 'serial'), p_size: str(f, 'size'), p_brand: str(f, 'brand'), p_pattern: str(f, 'pattern'), p_cost: num(f, 'cost') ?? 0,
    p_otd: num(f, 'otd') ?? 20, p_min_tread: num(f, 'min_tread') ?? 3, p_initial_hm: num(f, 'initial_hm') ?? 0, p_note: str(f, 'note'),
  });
}
export async function installTyre(_: ActionState, f: FormData) {
  return run('Ban dipasang', 'tyre_install', { p_tyre: str(f, 'id'), p_unit: str(f, 'unit'), p_unit_hm: num(f, 'hm'), p_position: str(f, 'position'), p_rtd: num(f, 'rtd'), p_psi: num(f, 'psi') });
}
export async function measureTyre(_: ActionState, f: FormData) {
  return run('Pengukuran tersimpan', 'tyre_measure', { p_tyre: str(f, 'id'), p_rtd: num(f, 'rtd'), p_psi: num(f, 'psi'), p_note: str(f, 'note') });
}
export async function removeTyre(_: ActionState, f: FormData) {
  return run('Ban dilepas', 'tyre_remove', { p_tyre: str(f, 'id'), p_unit_hm: num(f, 'hm'), p_rtd: num(f, 'rtd'), p_reason: str(f, 'reason'), p_next: str(f, 'next') ?? 'in_stock', p_note: str(f, 'note') });
}
export async function finishRetread(_: ActionState, f: FormData) {
  return run('Vulkanisir selesai, ban kembali ke stok', 'tyre_retread_done', { p_tyre: str(f, 'id'), p_cost: num(f, 'cost'), p_otd: num(f, 'otd'), p_note: str(f, 'note') });
}
