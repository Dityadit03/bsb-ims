'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { uploadFormFiles } from '@/lib/attachments';
import { employeeIdFrom } from '@/lib/employee-ref';
import { once } from '@/lib/client-request';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;
const num = (f: FormData, k: string) => (str(f, k) == null ? null : Number(str(f, k)));

// Unggah lampiran form lalu panggil RPC. Mengembalikan data baris hasil RPC.
async function call(fn: string, args: Record<string, unknown>, f?: FormData, folder = 'she') {
  const supabase = await createClient();
  if (f) {
    const { data: auth } = await supabase.auth.getUser();
    args.p_attachments = await uploadFormFiles(supabase, auth.user!.id, folder, f.getAll('files'));
  }
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as { id: string } & Record<string, unknown>;
}

// Formulir diisi atas nama karyawan lain (pengawas tanpa akun): kreditkan untuk SAP
async function credit(table: string, id: string, f: FormData) {
  const supabase = await createClient();
  const emp = await employeeIdFrom(supabase, str(f, 'credit'));
  if (!emp) return;
  const { error } = await supabase.rpc('she_credit', { p_table: table, p_id: id, p_employee: emp });
  if (error) throw new Error(error.message);
}

async function run(path: string, ok: string, fn: () => Promise<unknown>): Promise<ActionState> {
  try { await fn(); } catch (e) { return { error: (e as Error).message }; }
  revalidatePath(path);
  return { ok };
}

// ---------------------------------------------------------------- hazard report
export async function reportHazard(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    id = (await call('hazard_report', {
      p_reported_on: str(f, 'date'), p_department: str(f, 'department'), p_hazard_type: str(f, 'type'), p_description: str(f, 'description'),
      p_pic_department: str(f, 'pic_department'), p_due: str(f, 'due'), p_work_area: str(f, 'area'), p_location_note: str(f, 'location'),
      p_recommendation: str(f, 'recommendation'), p_risk: str(f, 'risk') ?? 'medium', p_idempotency_key: str(f, 'idem'),
    }, f, 'hazard')).id;
    await credit('hazard_reports', id, f);
  } catch (e) { return { error: (e as Error).message }; }
  // dikirim ulang dari antrean offline di latar belakang: jangan pindahkan halaman pengguna
  if (str(f, 'queued')) return { ok: 'Hazard dari antrean terkirim' };
  redirect(`/she/hazard/${id}`);
}

export async function closeHazard(_: ActionState, f: FormData) {
  return run(`/she/hazard/${str(f, 'id')}`, 'Hazard ditutup', () =>
    call('hazard_close', { p_id: str(f, 'id'), p_note: str(f, 'note') }, f, 'hazard'));
}

// ---------------------------------------------------------------- observasi PTO
export async function recordObservation(_: ActionState, f: FormData) {
  return run('/she/observasi', 'Observasi tersimpan', async () => {
    const o = await call('observation_record', {
      p_observed_on: str(f, 'date'), p_department: str(f, 'department'), p_activity: str(f, 'activity'), p_result: str(f, 'result'),
      p_work_area: str(f, 'area'), p_worker_name: str(f, 'worker'), p_worker_count: num(f, 'count'),
      p_unsafe_behaviour: str(f, 'unsafe'), p_coaching: str(f, 'coaching'), p_idempotency_key: str(f, 'idem'),
    }, f, 'observasi');
    await credit('observations', o.id, f);
  });
}

export async function closeObservation(_: ActionState, f: FormData) {
  return run('/she/observasi', 'Coaching tercatat', () => call('observation_close', { p_id: str(f, 'id'), p_coaching: str(f, 'coaching') }));
}

// ---------------------------------------------------------------- inspeksi
export async function recordInspection(_: ActionState, f: FormData): Promise<ActionState> {
  const findings = [0, 1, 2, 3, 4].map(i => ({
    description: str(f, `f${i}_desc`), risk_level: str(f, `f${i}_risk`) ?? 'medium', recommendation: str(f, `f${i}_rec`),
    pic_department_id: str(f, `f${i}_pic`), due_date: str(f, `f${i}_due`),
  })).filter(x => x.description);
  if (findings.some(x => !x.pic_department_id || !x.due_date)) return { error: 'Setiap temuan wajib punya departemen PIC dan due date' };
  let id: string;
  try {
    id = (await call('inspection_record', {
      p_inspected_on: str(f, 'date'), p_department: str(f, 'department'), p_type: str(f, 'type'), p_object: str(f, 'object'),
      p_findings: findings, p_work_area: str(f, 'area'), p_note: str(f, 'note'), p_idempotency_key: str(f, 'idem'),
    }, f, 'inspeksi')).id;
    await credit('inspections', id, f);
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/she/inspeksi/${id}`);
}

export async function closeFinding(_: ActionState, f: FormData) {
  return run(`/she/inspeksi/${str(f, 'inspection')}`, 'Temuan ditutup', () =>
    call('finding_close', { p_id: str(f, 'id'), p_note: str(f, 'note') }, f, 'inspeksi'));
}

// ---------------------------------------------------------------- P2H & fit to work
export async function submitP2h(_: ActionState, f: FormData) {
  const items: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (k.startsWith('item_')) items[k.slice(5)] = String(v);
  let r: Record<string, unknown> | 'duplicate';
  try {
    r = await once(str(f, 'cid'), () => call('p2h_submit', {
      p_check_date: str(f, 'date'), p_shift: num(f, 'shift'), p_department: str(f, 'department'), p_unit_no: str(f, 'unit'),
      p_unit_type: str(f, 'unit_type'), p_items: items, p_conclusion: str(f, 'conclusion'), p_hour_meter: num(f, 'hm'), p_notes: str(f, 'notes'),
    }, f, 'p2h'));
  } catch (e) { return { error: (e as Error).message }; }
  if (r === 'duplicate') return { ok: 'P2H ini sudah terkirim sebelumnya' };
  revalidatePath('/she/p2h');
  // peringatan tampil merah: unit tidak boleh dioperasikan
  if (r.conclusion === 'unfit') return { error: `${r.p2h_no} tersimpan: UNIT TIDAK LAYAK, jangan dioperasikan. Pengawas dan Plant sudah diberi tahu.` };
  return { ok: `${r.p2h_no} tersimpan` };
}

export async function submitFtw(_: ActionState, f: FormData) {
  return run('/she/ftw', 'Fit to work tersimpan', () => call('ftw_submit', {
    p_check_date: str(f, 'date'), p_shift: num(f, 'shift'), p_department: str(f, 'department'), p_sleep_hours: num(f, 'sleep'),
    p_drowsy_medication: f.get('medication') === 'yes', p_conclusion: str(f, 'conclusion'), p_complaint: str(f, 'complaint'),
    p_blood_pressure: str(f, 'bp'),
  }));
}

export async function checkFtw(_: ActionState, f: FormData) {
  return run('/she/ftw', 'Pemeriksaan tercatat', () =>
    call('ftw_check', { p_id: str(f, 'id'), p_conclusion: str(f, 'conclusion'), p_note: str(f, 'note') }));
}

// ---------------------------------------------------------------- insiden
export async function reportIncident(_: ActionState, f: FormData): Promise<ActionState> {
  const when = str(f, 'occurred');
  let id: string;
  try {
    id = (await call('incident_report', {
      p_occurred_at: when ? `${when}:00+08:00` : null, p_department: str(f, 'department'), p_classification: str(f, 'classification'),
      p_chronology: str(f, 'chronology'), p_work_area: str(f, 'area'), p_location_note: str(f, 'location'), p_unit_no: str(f, 'unit'),
      p_involved_names: str(f, 'involved'), p_immediate_action: str(f, 'immediate'), p_late_reason: str(f, 'late_reason'),
      p_idempotency_key: str(f, 'idem'),
    }, f, 'insiden')).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/she/insiden/${id}`);
}

export async function assignIncident(_: ActionState, f: FormData) {
  return run(`/she/insiden/${str(f, 'id')}`, 'Investigator ditunjuk', () =>
    call('incident_assign', { p_id: str(f, 'id'), p_investigator: str(f, 'investigator') }));
}

export async function investigateIncident(_: ActionState, f: FormData) {
  return run(`/she/insiden/${str(f, 'id')}`, 'Hasil investigasi tersimpan', () => call('incident_investigate', {
    p_id: str(f, 'id'), p_root_cause: str(f, 'root_cause'), p_summary: str(f, 'summary'), p_classification: str(f, 'classification'),
  }));
}

export async function closeIncident(_: ActionState, f: FormData) {
  const when = str(f, 'notified');
  return run(`/she/insiden/${str(f, 'id')}`, 'Insiden ditutup', () => call('incident_close', {
    p_id: str(f, 'id'), p_note: str(f, 'note'), p_regulator_notified_at: when ? `${when}:00+08:00` : null,
  }));
}

// ---------------------------------------------------------------- risk register
export async function saveRisk(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    id = (await call('risk_save', {
      p_id: str(f, 'id'), p_department: str(f, 'department'), p_activity: str(f, 'activity'), p_hazard: str(f, 'hazard'), p_risk: str(f, 'risk'),
      p_initial_l: num(f, 'il'), p_initial_s: num(f, 'is'), p_residual_l: num(f, 'rl'), p_residual_s: num(f, 'rs'),
      p_existing_controls: str(f, 'existing'), p_additional_controls: str(f, 'additional'), p_control_hierarchy: str(f, 'hierarchy'),
      p_work_area: str(f, 'area'), p_condition: str(f, 'condition') ?? 'routine', p_category: str(f, 'category') ?? 'safety',
      p_owner: str(f, 'owner'), p_legal: str(f, 'legal'), p_idempotency_key: str(f, 'idem'),
    })).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/she/risiko/${id}`);
}

export async function approveRisk(_: ActionState, f: FormData) {
  return run(`/she/risiko/${str(f, 'id')}`, 'Risiko disetujui', () => call('risk_approve', { p_id: str(f, 'id') }));
}

export async function retireRisk(_: ActionState, f: FormData) {
  return run(`/she/risiko/${str(f, 'id')}`, 'Risiko dinonaktifkan', () => call('risk_retire', { p_id: str(f, 'id'), p_reason: str(f, 'reason') }));
}


// Mitra kerja pelaksana perbaikan (PIC departemen tetap penanggung jawab). Nama baru di kolom 'new' otomatis didaftarkan.
export async function setPicPartner(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    let partner = str(f, 'partner');
    const fresh = str(f, 'new');
    if (fresh) partner = (await call('partner_save', { p_name: fresh })).id;
    await call('set_pic_partner', { p_table: str(f, 'table'), p_id: str(f, 'id'), p_partner: partner });
  } catch (e) { return { error: (e as Error).message }; }
  revalidatePath(str(f, 'path') ?? '/she');
  return { ok: 'PIC mitra kerja disimpan' };
}
