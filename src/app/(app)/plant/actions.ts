'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { uploadFormFiles } from '@/lib/attachments';
import { once } from '@/lib/client-request';

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

export async function saveUnit(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    id = (await rpc('unit_save', {
      p_unit_no: str(f, 'unit_no'), p_unit_type: str(f, 'unit_type'), p_department: str(f, 'department'), p_ownership: str(f, 'ownership') ?? 'owned',
      p_vendor: str(f, 'vendor'), p_brand: str(f, 'brand'), p_model: str(f, 'model'), p_serial: str(f, 'serial'), p_year: num(f, 'year'),
      p_hm: num(f, 'hm'), p_note: str(f, 'note'),
    })).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/plant/${id}`);
}

export async function setUnitStatus(_: ActionState, f: FormData) {
  return run(`/plant/${str(f, 'id')}`, 'Status diperbarui', () =>
    rpc('unit_set_status', { p_unit: str(f, 'id'), p_status: str(f, 'status'), p_note: str(f, 'note') }));
}

export async function savePmPlan(_: ActionState, f: FormData) {
  return run(`/plant/${str(f, 'unit')}`, 'Rencana PM tersimpan', () => rpc('pm_plan_save', {
    p_unit: str(f, 'unit'), p_task: str(f, 'task'), p_interval_hm: num(f, 'interval'), p_last_service_hm: num(f, 'last'),
  }));
}

export async function createWo(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    id = (await rpc('wo_create', {
      p_unit: str(f, 'unit'), p_type: str(f, 'type'), p_description: str(f, 'description'), p_priority: str(f, 'priority') ?? 'medium',
      p_hm: num(f, 'hm'), p_pm_plan: str(f, 'pm_plan'), p_idempotency_key: str(f, 'idem'),
    })).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/plant/wo/${id}`);
}

export async function startWo(_: ActionState, f: FormData) {
  return run(`/plant/wo/${str(f, 'id')}`, 'WO dikerjakan', () => rpc('wo_start', { p_id: str(f, 'id') }));
}

export async function waitPart(_: ActionState, f: FormData) {
  return run(`/plant/wo/${str(f, 'id')}`, 'Status: tunggu part', () => rpc('wo_wait_part', { p_id: str(f, 'id'), p_note: str(f, 'note') }));
}

export async function completeWo(_: ActionState, f: FormData) {
  return run(`/plant/wo/${str(f, 'id')}`, 'WO selesai', async () => {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const ids = await uploadFormFiles(supabase, auth.user!.id, 'wo', f.getAll('files'));
    return rpc('wo_complete', { p_id: str(f, 'id'), p_action: str(f, 'action'), p_hm: num(f, 'hm'), p_attachments: ids });
  });
}

export async function cancelWo(_: ActionState, f: FormData) {
  return run(`/plant/wo/${str(f, 'id')}`, 'WO dibatalkan', () => rpc('wo_cancel', { p_id: str(f, 'id'), p_reason: str(f, 'reason') }));
}

export async function setWoCosting(_: ActionState, f: FormData) {
  return run(`/plant/wo/${str(f, 'id')}`, 'Kode downtime dan jam kerja disimpan', () =>
    rpc('wo_costing', { p_id: str(f, 'id'), p_downtime_code: str(f, 'downtime_code'), p_labor_hours: num(f, 'labor_hours') ?? 0 }));
}

// ---------------------------------------------------------------- breakdown unscheduled di lapangan
export async function reportBreakdown(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const r = await once(str(f, 'cid'), async () => {
      const supabase = await createClient();
      const { data: auth } = await supabase.auth.getUser();
      const ids = await uploadFormFiles(supabase, auth.user!.id, 'breakdown', f.getAll('files'));
      return await rpc('breakdown_report', {
        p_unit_no: str(f, 'unit'), p_description: str(f, 'description'), p_hm: num(f, 'hm'), p_km: num(f, 'km'),
        p_lat: num(f, 'lat'), p_lng: num(f, 'lng'), p_accuracy: num(f, 'accuracy'), p_location_note: str(f, 'location_note'),
        p_need_tow: f.get('need_tow') === 'on', p_attachments: ids,
      }) as unknown as { report_no: string };
    });
    revalidatePath('/plant/breakdown'); revalidatePath('/plant/wo');
    if (r === 'duplicate') return { ok: 'Laporan ini sudah terkirim sebelumnya' };
    return { ok: `${r.report_no} terkirim. Work order breakdown dibuka dan tim Plant diberi tahu.` };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function verifyBreakdown(_: ActionState, f: FormData) {
  const ok = f.get('decision') === 'ok';
  return run('/plant/breakdown', ok ? 'Laporan diverifikasi' : 'Laporan ditolak', () =>
    rpc('breakdown_verify', { p_id: str(f, 'id'), p_ok: ok, p_note: str(f, 'note') }));
}
