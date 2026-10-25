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
  for (const p of ['/logistik/bbm', '/logistik', '/logistik/mutasi']) revalidatePath(p);
  return { ok };
}

export async function saveTank(_: ActionState, f: FormData) {
  return run('Tangki disimpan', 'fuel_tank_save', {
    p_code: str(f, 'code'), p_name: str(f, 'name'), p_material: str(f, 'material'), p_capacity: num(f, 'capacity'), p_active: f.get('active') !== 'off',
  });
}
export async function openTank(_: ActionState, f: FormData) {
  return run('Isi awal dicatat', 'fuel_tank_opening', { p_tank: str(f, 'tank'), p_liters: num(f, 'liters'), p_note: str(f, 'note') });
}
export async function receiveFuel(_: ActionState, f: FormData) {
  return run('Kiriman diterima', 'fuel_tank_receive', {
    p_tank: str(f, 'tank'), p_supplier: str(f, 'supplier'), p_liters: num(f, 'liters'), p_unit_cost: num(f, 'unit_cost'), p_doc_ref: str(f, 'doc_ref'),
    p_dip_before: num(f, 'dip_before'), p_dip_after: num(f, 'dip_after'), p_note: str(f, 'note'),
  });
}
export async function dispenseFuel(_: ActionState, f: FormData) {
  return run('BBM dikeluarkan', 'fuel_tank_dispense', {
    p_tank: str(f, 'tank'), p_unit: str(f, 'unit'), p_liters: num(f, 'liters'), p_hm: num(f, 'hm'), p_note: str(f, 'note'),
  });
}
export async function dipTank(_: ActionState, f: FormData) {
  return run('Hasil ukur dicatat', 'fuel_tank_dip', { p_tank: str(f, 'tank'), p_measured: num(f, 'measured'), p_note: str(f, 'note') });
}
