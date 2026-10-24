'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { uploadFormFiles } from '@/lib/attachments';
import { employeeIdFrom } from '@/lib/employee-ref';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;
const num = (f: FormData, k: string) => (str(f, k) == null ? null : Number(str(f, k)));

async function rpc(fn: string, args: Record<string, unknown>, f?: FormData, folder = 'she') {
  const supabase = await createClient();
  if (f) {
    const { data: auth } = await supabase.auth.getUser();
    args.p_attachments = await uploadFormFiles(supabase, auth.user!.id, folder, f.getAll('files'));
  }
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

async function run(path: string, ok: string | ((d: Record<string, unknown>) => string), fn: () => Promise<Record<string, unknown> | void>): Promise<ActionState> {
  let d: Record<string, unknown> | void;
  try { d = await fn(); } catch (e) { return { error: (e as Error).message }; }
  revalidatePath(path);
  return { ok: typeof ok === 'string' ? ok : ok(d ?? {}) };
}

const emp = async (f: FormData, k = 'employee') => employeeIdFrom(await createClient(), str(f, k));

// ---------------------------------------------------------------- pelanggaran
export async function recordViolation(_: ActionState, f: FormData) {
  return run('/she/pelanggaran', d => `Tersimpan sebagai ${d.violation_no}`, async () => rpc('violation_record', {
    p_occurred_on: str(f, 'date'), p_department: str(f, 'department'), p_type: str(f, 'type'), p_chronology: str(f, 'chronology'),
    p_employee: await emp(f), p_offender_name: str(f, 'name'), p_company: str(f, 'company'), p_work_area: str(f, 'area'),
    p_location_note: str(f, 'location'), p_source: str(f, 'source'), p_sanction: str(f, 'sanction'), p_idempotency_key: str(f, 'idem'),
  }, f, 'pelanggaran'));
}

export async function followupViolation(_: ActionState, f: FormData) {
  return run('/she/pelanggaran', 'Tindak lanjut tersimpan', () => rpc('violation_followup', {
    p_id: str(f, 'id'), p_sanction: str(f, 'sanction'), p_sp_no: str(f, 'sp_no'), p_sp_date: str(f, 'sp_date'),
    p_counseling_on: str(f, 'counseling_on'), p_counselor: str(f, 'counselor'), p_counseling_result: str(f, 'counseling_result'),
    p_refresh_training: str(f, 'refresh'),
  }, f, 'pelanggaran'));
}

export async function closeViolation(_: ActionState, f: FormData) {
  return run('/she/pelanggaran', 'Pelanggaran ditutup', () => rpc('violation_close', { p_id: str(f, 'id'), p_note: str(f, 'note') }));
}

// ---------------------------------------------------------------- induksi
export async function recordInduction(_: ActionState, f: FormData) {
  return run('/she/induksi', 'Induksi tercatat', async () => rpc('induction_record', {
    p_held_on: str(f, 'date'), p_type: str(f, 'type'), p_presenter: str(f, 'presenter'), p_result: str(f, 'result'),
    p_employee: await emp(f), p_participant_name: str(f, 'name'), p_company: str(f, 'company'), p_position_note: str(f, 'position'),
    p_department: str(f, 'department'), p_score: num(f, 'score'), p_note: str(f, 'note'),
  }, f, 'induksi'));
}

// ---------------------------------------------------------------- izin masuk area
export async function requestPermit(_: ActionState, f: FormData) {
  return run('/she/izin', d => `Izin diajukan: ${d.permit_no}`, async () => rpc('area_permit_request', {
    p_visitor_name: str(f, 'visitor'), p_company: str(f, 'company'), p_purpose: str(f, 'purpose'), p_start: str(f, 'start'),
    p_end: str(f, 'end'), p_people: num(f, 'people') ?? 1, p_work_area: str(f, 'area'), p_area_note: str(f, 'area_note'),
    p_escort: await emp(f, 'escort'), p_idempotency_key: str(f, 'idem'),
  }, f, 'izin'));
}

export async function decidePermit(_: ActionState, f: FormData) {
  return run('/she/izin', f.get('approve') === 'yes' ? 'Izin disetujui' : 'Izin ditolak', async () => rpc('area_permit_decide', {
    p_id: str(f, 'id'), p_approve: f.get('approve') === 'yes', p_note: str(f, 'note'), p_escort: await emp(f, 'escort'),
  }));
}

export async function closePermit(_: ActionState, f: FormData) {
  return run('/she/izin', 'Kunjungan selesai', () => rpc('area_permit_close', { p_id: str(f, 'id') }));
}

// ---------------------------------------------------------------- komisioning / SPIP
export async function saveCommissioning(_: ActionState, f: FormData) {
  return run('/plant/spip', 'Data komisioning tersimpan', () => rpc('commissioning_save', {
    p_id: str(f, 'id'), p_object_type: str(f, 'object_type'), p_ref_code: str(f, 'ref'), p_name: str(f, 'name'),
    p_category: str(f, 'category'), p_reg_no: str(f, 'reg'), p_commissioned_on: str(f, 'from'), p_valid_until: str(f, 'until'),
    p_issuer: str(f, 'issuer'), p_note: str(f, 'note'),
  }, f, 'spip'));
}

// ---------------------------------------------------------------- Pusat Data
export async function saveLink(_: ActionState, f: FormData) {
  return run('/pusat-data', 'Tautan tersimpan', () => rpc('resource_link_save', {
    p_code: str(f, 'code'), p_page: str(f, 'page'), p_section: str(f, 'section'), p_title: str(f, 'title'), p_url: str(f, 'url'),
    p_kind: str(f, 'kind') ?? 'folder', p_description: str(f, 'description'), p_sort: num(f, 'sort') ?? 0, p_active: f.get('active') !== 'no',
  }));
}

// ---------------------------------------------------------------- SAP
export async function saveSapParticipant(_: ActionState, f: FormData) {
  return run('/she/sap', 'Peserta SAP tersimpan', async () => rpc('sap_participant_save', {
    p_employee: await emp(f), p_level: str(f, 'level'), p_section: str(f, 'section'), p_active_from: str(f, 'from'),
    p_sort: num(f, 'sort') ?? 0, p_aliases: (str(f, 'aliases') ?? '').split(',').map(x => x.trim()).filter(Boolean), p_reason: str(f, 'reason'),
  }));
}

export async function endSapParticipant(_: ActionState, f: FormData) {
  return run('/she/sap', 'Peserta dikeluarkan dari SAP', async () => rpc('sap_participant_end', {
    p_employee: str(f, 'employee_id') ?? await emp(f), p_until: str(f, 'until'), p_reason: str(f, 'reason'),
  }));
}

export async function setSapTarget(_: ActionState, f: FormData) {
  return run('/she/sap', 'Target tersimpan', async () => rpc('sap_set_target', {
    p_employee: str(f, 'employee_id') ?? await emp(f), p_valid_from: str(f, 'from'),
    p_obs: num(f, 'obs') ?? 0, p_insp: num(f, 'insp') ?? 0, p_hazard: num(f, 'haz') ?? 0,
  }));
}

export async function setSapLeave(_: ActionState, f: FormData) {
  return run('/she/sap', 'Status cuti diperbarui', () =>
    rpc('sap_set_leave', { p_employee: str(f, 'employee_id'), p_week_start: str(f, 'week'), p_on_leave: f.get('leave') === 'yes' }));
}

export async function copySapLeave(_: ActionState, f: FormData) {
  return run('/she/sap', 'Status cuti minggu lalu disalin', () => rpc('sap_copy_leave', { p_week_start: str(f, 'week') }));
}

export async function lockSapWeek(_: ActionState, f: FormData) {
  return run('/she/sap', 'Minggu dikunci', () => rpc('sap_lock_week', { p_week_start: str(f, 'week') }));
}
