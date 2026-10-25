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

export async function saveEmployee(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    id = (await rpc('employee_save', {
      p_nrp: str(f, 'nrp'), p_full_name: str(f, 'name'), p_department: str(f, 'department'), p_position: str(f, 'position'),
      p_employment_type: str(f, 'type'), p_company: str(f, 'company'), p_join_date: str(f, 'join_date'), p_email: str(f, 'email'),
    })).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/hrga/${id}`);
}

export async function addCompetency(_: ActionState, f: FormData) {
  return run(`/hrga/${str(f, 'employee')}`, 'Kompetensi dicatat', () => rpc('employee_competency_add', {
    p_employee: str(f, 'employee'), p_competency: str(f, 'competency'), p_issued: str(f, 'issued'), p_valid_until: str(f, 'valid_until'),
    p_cert_no: str(f, 'cert_no'), p_issuer: str(f, 'issuer'),
  }));
}

export async function revokeCompetency(_: ActionState, f: FormData) {
  return run(`/hrga/${str(f, 'employee')}`, 'Kompetensi dicabut', () => rpc('employee_competency_revoke', { p_id: str(f, 'id'), p_reason: str(f, 'reason') }));
}

export async function exitEmployee(_: ActionState, f: FormData) {
  return run(`/hrga/${str(f, 'employee')}`, 'Karyawan keluar diproses; akun dinonaktifkan', () =>
    rpc('employee_exit', { p_employee: str(f, 'employee'), p_date: str(f, 'date'), p_reason: str(f, 'reason') }));
}

export async function saveCompetency(_: ActionState, f: FormData) {
  return run('/hrga/kompetensi', 'Kompetensi disimpan', () => rpc('competency_save', {
    p_code: str(f, 'code'), p_name: str(f, 'name'), p_category: str(f, 'category'), p_validity_months: num(f, 'validity'),
    p_unit_type: str(f, 'unit_type'), p_active: str(f, 'active') !== 'false',
  }));
}

export async function savePosition(_: ActionState, f: FormData) {
  return run('/hrga/kompetensi', 'Jabatan disimpan', () =>
    rpc('position_save', { p_department: str(f, 'department'), p_code: str(f, 'code'), p_name: str(f, 'name'), p_level: str(f, 'level') }));
}

export async function setRequirement(_: ActionState, f: FormData) {
  return run('/hrga/kompetensi', 'Matriks diperbarui', () => rpc('competency_requirement_set', {
    p_position: str(f, 'position'), p_competency: str(f, 'competency'), p_required: str(f, 'required') !== 'false',
  }));
}

export async function saveTraining(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    id = (await rpc('training_save', {
      p_title: str(f, 'title'), p_held_on: str(f, 'held_on'), p_hours: num(f, 'hours'), p_trainer: str(f, 'trainer'),
      p_competency: str(f, 'competency'), p_location: str(f, 'location'), p_employees: f.getAll('employees').map(String),
    })).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/hrga/pelatihan/${id}`);
}

export async function addAttendees(_: ActionState, f: FormData) {
  return run(`/hrga/pelatihan/${str(f, 'training')}`, 'Peserta ditambahkan', () =>
    rpc('training_add_attendees', { p_training: str(f, 'training'), p_employees: f.getAll('employees').map(String) }));
}

export async function completeTraining(_: ActionState, f: FormData) {
  const results = f.getAll('employee').map(String).map(e => ({ employee: e, passed: str(f, `passed_${e}`) === 'true', score: num(f, `score_${e}`) }));
  return run(`/hrga/pelatihan/${str(f, 'training')}`, 'Pelatihan ditutup; kompetensi peserta lulus dicatat', () =>
    rpc('training_complete', { p_training: str(f, 'training'), p_results: results }));
}

export async function setRoster(_: ActionState, f: FormData) {
  return run('/hrga/roster', 'Roster disimpan', () => rpc('roster_set', {
    p_employees: f.getAll('employees').map(String), p_from: str(f, 'from'), p_to: str(f, 'to'), p_code: str(f, 'code'),
  }));
}

export async function createGa(_: ActionState, f: FormData) {
  return run('/hrga/ga', 'Permintaan dikirim', () => rpc('ga_request_create', {
    p_category: str(f, 'category'), p_description: str(f, 'description'), p_location: str(f, 'location'), p_needed_by: str(f, 'needed_by'),
    p_idempotency_key: str(f, 'idem'),
  }));
}

export async function processGa(_: ActionState, f: FormData) {
  return run('/hrga/ga', 'Permintaan diperbarui', () => rpc('ga_request_process', { p_id: str(f, 'id'), p_action: str(f, 'action'), p_note: str(f, 'note') }));
}

export async function cancelGa(_: ActionState, f: FormData) {
  return run('/hrga/ga', 'Permintaan dibatalkan', () => rpc('ga_request_cancel', { p_id: str(f, 'id') }));
}

// ---------------------------------------------------------------- HRIS: Core HR
const PRIVATE_KEYS = ['nik', 'kk_no', 'birth_place', 'birth_date', 'gender', 'religion', 'marital_status', 'ptkp_status', 'blood_type', 'address_ktp',
  'address_domicile', 'phone', 'personal_email', 'emergency_name', 'emergency_relation', 'emergency_phone', 'education_level', 'education_major',
  'npwp', 'bpjs_tk_no', 'bpjs_kes_no', 'bank_name', 'bank_account', 'bank_holder', 'uniform_size', 'shoe_size',
  'kelurahan', 'kecamatan', 'kabupaten', 'provinsi', 'sim_no', 'children_count'];
const pick = (f: FormData) => Object.fromEntries(PRIVATE_KEYS.filter(k => f.has(k)).map(k => [k, String(f.get(k) ?? '').trim()]));
const emp = (f: FormData) => `/hrga/${str(f, 'employee')}`;

export async function saveOrg(_: ActionState, f: FormData) {
  return run(emp(f), 'Data organisasi disimpan', () => rpc('employee_org_save', {
    p_employee: str(f, 'employee'), p_supervisor: str(f, 'supervisor'), p_site: str(f, 'site'), p_grade: str(f, 'grade'),
    p_roster_pattern: str(f, 'roster_pattern'), p_point_of_hire: str(f, 'poh'),
  }));
}

export async function saveClassify(_: ActionState, f: FormData) {
  return run(emp(f), 'Klasifikasi disimpan', () => rpc('employee_classify', {
    p_employee: str(f, 'employee'), p_origin: str(f, 'origin'), p_class: str(f, 'class'),
  }));
}

export async function savePrivate(_: ActionState, f: FormData) {
  return run(emp(f), 'Data pribadi disimpan', () => rpc('employee_private_save', { p_employee: str(f, 'employee'), p_data: pick(f) }));
}

export async function saveMyPrivate(_: ActionState, f: FormData) {
  return run('/saya', 'Data Anda diperbarui', () => rpc('my_private_update', { p_data: pick(f) }));
}

export async function addContract(_: ActionState, f: FormData) {
  return run(emp(f), 'Kontrak dicatat', () => rpc('contract_add', {
    p_employee: str(f, 'employee'), p_type: str(f, 'type'), p_no: str(f, 'no'), p_start: str(f, 'start'), p_end: str(f, 'end'), p_note: str(f, 'note'),
  }));
}

export async function moveEmployee(_: ActionState, f: FormData) {
  return run(emp(f), 'Perubahan dicatat di riwayat', () => rpc('employee_move', {
    p_employee: str(f, 'employee'), p_effective: str(f, 'date'), p_kind: str(f, 'kind'), p_department: str(f, 'department'),
    p_section: str(f, 'section'), p_position: str(f, 'position'), p_employment_type: str(f, 'type'), p_reason: str(f, 'reason'), p_reference: str(f, 'ref'),
  }));
}

export async function setCompetencyDetail(_: ActionState, f: FormData) {
  return run(emp(f), 'Disimpan', () => rpc('employee_competency_detail', {
    p_id: str(f, 'id'), p_fitness: str(f, 'fitness'), p_fitness_note: str(f, 'note'), p_license_class: str(f, 'class'),
  }));
}

export async function issueIdCard(_: ActionState, f: FormData) {
  return run(emp(f), 'ID card diterbitkan', () => rpc('id_card_issue', {
    p_employee: str(f, 'employee'), p_card_no: str(f, 'card_no'), p_areas: f.getAll('areas').map(String), p_valid_until: str(f, 'valid_until'),
  }));
}

export async function setIdCardStatus(_: ActionState, f: FormData) {
  return run(emp(f), 'Status kartu diperbarui', () => rpc('id_card_status', { p_id: str(f, 'id'), p_status: str(f, 'status'), p_note: str(f, 'note') }));
}

export async function createMobilization(_: ActionState, f: FormData) {
  return run(emp(f), 'Checklist dibuat', () => rpc('mobilization_create', {
    p_employee: str(f, 'employee'), p_kind: str(f, 'kind'), p_date: str(f, 'date'), p_note: str(f, 'note'),
  }));
}

export async function checkMobilization(_: ActionState, f: FormData) {
  return run(emp(f), 'Diperbarui', () => rpc('mobilization_check', { p_id: str(f, 'id'), p_key: str(f, 'key'), p_done: str(f, 'done') === 'true' }));
}

export async function completeMobilization(_: ActionState, f: FormData) {
  return run(emp(f), 'Checklist selesai', () => rpc('mobilization_complete', { p_id: str(f, 'id') }));
}

export async function cancelMobilization(_: ActionState, f: FormData) {
  return run(emp(f), 'Checklist dibatalkan', () => rpc('mobilization_cancel', { p_id: str(f, 'id'), p_reason: str(f, 'reason') }));
}

export async function setMpp(_: ActionState, f: FormData) {
  return run('/hrga/organisasi', 'MPP disimpan', () => rpc('mpp_set', {
    p_year: num(f, 'year'), p_position: str(f, 'position'), p_planned: num(f, 'planned'), p_note: str(f, 'note'),
  }));
}
