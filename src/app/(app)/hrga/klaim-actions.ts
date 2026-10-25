'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { uploadFormFiles } from '@/lib/attachments';
import { employeeIdFrom } from '@/lib/employee-ref';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;
// nominal rupiah boleh diketik "1.500.000"
const rupiah = (f: FormData, k: string) => (str(f, k) == null ? null : Number(str(f, k)!.replace(/[^\d]/g, '')));
const PATHS = ['/hrga/klaim', '/saya', '/tugas'];

const UUID = /^[0-9a-f-]{36}$/i;
async function emp(f: FormData) {
  const v = str(f, 'employee');
  return v == null || UUID.test(v) ? v : employeeIdFrom(await createClient(), v);
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
}

async function run(ok: string, fn: () => Promise<unknown>): Promise<ActionState> {
  try { await fn(); } catch (e) { return { error: (e as Error).message }; }
  for (const p of PATHS) revalidatePath(p);
  return { ok };
}

async function files(f: FormData, folder: string) {
  const { profile } = await getSession();
  return uploadFormFiles(await createClient(), profile.id, folder, f.getAll('files'));
}

export async function createClaim(_: ActionState, f: FormData) {
  return run('Klaim terkirim ke atasan', async () => rpc('expense_claim_create', {
    p_employee: await emp(f), p_type: str(f, 'type'), p_date: str(f, 'date'), p_amount: rupiah(f, 'amount'), p_description: str(f, 'description'),
    p_advance: str(f, 'advance'), p_attachments: await files(f, 'klaim'), p_idempotency_key: str(f, 'idem'),
  }));
}
export async function decideClaim(_: ActionState, f: FormData) {
  const approve = str(f, 'approve') === '1';
  return run(approve ? 'Klaim disetujui' : 'Klaim ditolak', () => rpc('expense_claim_decide', {
    p_id: str(f, 'id'), p_approve: approve, p_note: str(f, 'note'), p_amount: rupiah(f, 'amount'), p_pay_method: str(f, 'pay_method') ?? 'payroll',
  }));
}
export async function cancelClaim(_: ActionState, f: FormData) {
  return run('Klaim dibatalkan', () => rpc('expense_claim_cancel', { p_id: str(f, 'id') }));
}
export async function markClaimPaid(_: ActionState, f: FormData) {
  return run('Klaim ditandai sudah ditransfer', () => rpc('expense_claim_mark_paid', { p_id: str(f, 'id'), p_date: str(f, 'date') }));
}
export async function saveClaimType(_: ActionState, f: FormData) {
  return run('Jenis klaim disimpan', () => rpc('claim_type_save', {
    p_code: str(f, 'code'), p_name: str(f, 'name'), p_taxable: f.get('taxable') === 'true', p_per_claim: rupiah(f, 'per_claim'),
    p_annual: rupiah(f, 'annual'), p_requires_attachment: f.get('attachment') !== 'false', p_active: f.get('active') !== 'false', p_sort: Number(str(f, 'sort') ?? 0),
  }));
}

export async function createAdvance(_: ActionState, f: FormData) {
  return run('Pengajuan terkirim ke atasan', async () => rpc('cash_advance_create', {
    p_employee: await emp(f), p_kind: str(f, 'kind'), p_purpose: str(f, 'purpose'), p_amount: rupiah(f, 'amount'),
    p_installments: Number(str(f, 'installments') ?? 1), p_idempotency_key: str(f, 'idem'),
  }));
}
export async function decideAdvance(_: ActionState, f: FormData) {
  const approve = str(f, 'approve') === '1';
  return run(approve ? 'Disetujui' : 'Ditolak', () => rpc('cash_advance_decide', { p_id: str(f, 'id'), p_approve: approve, p_note: str(f, 'note') }));
}
export async function cancelAdvance(_: ActionState, f: FormData) {
  return run('Pengajuan dibatalkan', () => rpc('cash_advance_cancel', { p_id: str(f, 'id') }));
}
export async function disburseAdvance(_: ActionState, f: FormData) {
  return run('Tercatat sudah dicairkan', () => rpc('cash_advance_disburse', { p_id: str(f, 'id'), p_date: str(f, 'date') }));
}
export async function reportAdvance(_: ActionState, f: FormData) {
  return run('Pertanggungjawaban tersimpan', async () => rpc('cash_advance_report', {
    p_id: str(f, 'id'), p_actual: rupiah(f, 'actual'), p_note: str(f, 'note'), p_attachments: await files(f, 'uang-muka'),
  }));
}
export async function repayAdvance(_: ActionState, f: FormData) {
  return run('Pengembalian dicatat', () => rpc('advance_repay', { p_id: str(f, 'id'), p_amount: rupiah(f, 'amount'), p_date: str(f, 'date'), p_note: str(f, 'note') }));
}
