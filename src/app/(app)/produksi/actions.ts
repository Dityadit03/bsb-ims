'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;
const num = (f: FormData, k: string) => (str(f, k) == null ? null : Number(str(f, k)));

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as { id: string };
}

async function run(path: string, ok: string, fn: () => Promise<unknown>): Promise<ActionState> {
  try { await fn(); } catch (e) { return { error: (e as Error).message }; }
  revalidatePath(path);
  return { ok };
}

export async function openReport(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    id = (await rpc('production_report_open', { p_date: str(f, 'date'), p_shift: num(f, 'shift'), p_note: str(f, 'note') })).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/produksi/${id}`);
}

export async function saveTrip(_: ActionState, f: FormData) {
  return run(`/produksi/${str(f, 'report')}`, 'Ritase disimpan', () => rpc('haul_trip_save', {
    p_report: str(f, 'report'), p_unit: str(f, 'unit'), p_route: str(f, 'route'), p_operator: str(f, 'operator'),
    p_trips: num(f, 'trips'), p_tonnage: num(f, 'tonnage'), p_hm_start: num(f, 'hm_start'), p_hm_end: num(f, 'hm_end'),
  }));
}

export async function removeTrip(_: ActionState, f: FormData) {
  return run(`/produksi/${str(f, 'report')}`, 'Baris dihapus', () => rpc('haul_trip_remove', { p_trip: str(f, 'id') }));
}

export async function addDelay(_: ActionState, f: FormData) {
  return run(`/produksi/${str(f, 'report')}`, 'Hambatan dicatat', () => rpc('production_delay_add', {
    p_report: str(f, 'report'), p_category: str(f, 'category'), p_hours: num(f, 'hours'), p_unit: str(f, 'unit'), p_note: str(f, 'note'),
  }));
}

export async function removeDelay(_: ActionState, f: FormData) {
  return run(`/produksi/${str(f, 'report')}`, 'Hambatan dihapus', () => rpc('production_delay_remove', { p_delay: str(f, 'id') }));
}

export async function submitReport(_: ActionState, f: FormData) {
  return run(`/produksi/${str(f, 'report')}`, 'Laporan dikirim untuk persetujuan', () => rpc('production_submit', { p_report: str(f, 'report') }));
}

export async function reviewReport(_: ActionState, f: FormData) {
  const approve = str(f, 'decision') === 'approve';
  return run(`/produksi/${str(f, 'report')}`, approve ? 'Laporan disetujui' : 'Laporan dikembalikan', () =>
    rpc('production_review', { p_report: str(f, 'report'), p_approve: approve, p_note: str(f, 'note') }));
}

export async function saveRoute(_: ActionState, f: FormData) {
  return run('/produksi/master', 'Rute disimpan', () => rpc('route_save', {
    p_code: str(f, 'code'), p_name: str(f, 'name'), p_from: str(f, 'from'), p_to: str(f, 'to'), p_distance: num(f, 'distance'),
    p_active: str(f, 'active') !== 'false',
  }));
}

export async function setTarget(_: ActionState, f: FormData) {
  return run('/produksi/master', 'Target disimpan', () =>
    rpc('production_set_target', { p_month: `${str(f, 'month')}-01`, p_tonnage: num(f, 'tonnage'), p_note: str(f, 'note') }));
}
