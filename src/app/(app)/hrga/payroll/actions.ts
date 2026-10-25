'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { employeeIdFrom } from '@/lib/employee-ref';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;
// nominal rupiah boleh diketik "1.500.000"
const rupiah = (f: FormData, k: string) => (str(f, k) == null ? null : Number(str(f, k)!.replace(/[^\d]/g, '')));

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as { id: string };
}

async function run(paths: string[], ok: string, fn: () => Promise<unknown>): Promise<ActionState> {
  try { await fn(); } catch (e) { return { error: (e as Error).message }; }
  for (const p of paths) revalidatePath(p);
  return { ok };
}

const emp = async (f: FormData) => employeeIdFrom(await createClient(), str(f, 'employee'));

export async function createRun(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    id = (await rpc('payroll_run_create', {
      p_period: str(f, 'period'), p_kind: str(f, 'kind'), p_pay_date: str(f, 'pay_date'), p_parallel: f.get('parallel') === 'on', p_note: str(f, 'note'),
    })).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/hrga/payroll/${id}`);
}

const runPath = (f: FormData) => [`/hrga/payroll/${str(f, 'run')}`, '/hrga/payroll'];

export async function calculateRun(_: ActionState, f: FormData) {
  return run(runPath(f), 'Gaji dihitung', () => rpc('payroll_calculate', { p_run: str(f, 'run') }));
}
export async function approveRun(_: ActionState, f: FormData) {
  return run(runPath(f), 'Disetujui', () => rpc('payroll_approve', { p_run: str(f, 'run'), p_note: str(f, 'note') }));
}
export async function publishRun(_: ActionState, f: FormData) {
  return run(runPath(f), 'Slip diterbitkan ke karyawan', () => rpc('payroll_publish', { p_run: str(f, 'run') }));
}
export async function reopenRun(_: ActionState, f: FormData) {
  return run(runPath(f), 'Proses dibuka ulang', () => rpc('payroll_reopen', { p_run: str(f, 'run'), p_reason: str(f, 'reason') }));
}
export async function cancelRun(_: ActionState, f: FormData) {
  return run(runPath(f), 'Proses dibatalkan', () => rpc('payroll_cancel', { p_run: str(f, 'run'), p_reason: str(f, 'reason') }));
}
export async function addInput(_: ActionState, f: FormData) {
  return run(runPath(f), 'Input dicatat; hitung ulang gaji', async () => rpc('payroll_input_add', {
    p_run: str(f, 'run'), p_employee: await emp(f), p_component: str(f, 'component'), p_amount: rupiah(f, 'amount'), p_note: str(f, 'note'),
  }));
}
export async function deleteInput(_: ActionState, f: FormData) {
  return run(runPath(f), 'Input dihapus', () => rpc('payroll_input_delete', { p_id: str(f, 'id') }));
}
export async function setPay(_: ActionState, f: FormData) {
  return run(['/hrga/payroll'], 'Struktur gaji disimpan', async () => rpc('employee_pay_set', {
    p_employee: await emp(f), p_component: str(f, 'component'), p_amount: rupiah(f, 'amount'), p_effective: str(f, 'effective'), p_note: str(f, 'note'),
  }));
}
export async function saveComponent(_: ActionState, f: FormData) {
  const category = str(f, 'category');
  return run(['/hrga/payroll'], 'Komponen disimpan', () => rpc('pay_component_save', {
    p_code: str(f, 'code'), p_name: str(f, 'name'), p_kind: category === 'deduction' ? 'deduction' : 'earning', p_category: category,
    p_calc: category === 'basic' || category === 'fixed_allowance' ? 'fixed' : str(f, 'calc'), p_taxable: f.get('taxable') !== 'false',
    p_active: f.get('active') !== 'false', p_sort: Number(str(f, 'sort') ?? 0),
  }));
}
export async function saveSetting(_: ActionState, f: FormData) {
  return run(['/hrga/payroll'], 'Tersimpan', () => rpc('payroll_setting_set', { p_key: str(f, 'key'), p_value: Number(str(f, 'value')?.replace(',', '.') ?? NaN) }));
}
