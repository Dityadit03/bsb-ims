'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { uploadAttachment, uploadFormFiles } from '@/lib/attachments';
import { employeeIdFrom } from '@/lib/employee-ref';
import { once } from '@/lib/client-request';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;
const num = (f: FormData, k: string) => (str(f, k) == null ? null : Number(str(f, k)));

// Karyawan: id tersembunyi, atau isian "NRP · Nama" dari daftar; kosong = diri sendiri
const UUID = /^[0-9a-f-]{36}$/i;
async function emp(f: FormData) {
  const v = str(f, 'employee');
  return v == null || UUID.test(v) ? v : employeeIdFrom(await createClient(), v);
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

async function run(paths: string[], ok: string, fn: () => Promise<unknown>): Promise<ActionState> {
  try { await fn(); } catch (e) { return { error: (e as Error).message }; }
  for (const p of paths) revalidatePath(p);
  return { ok };
}

// ---------------------------------------------------------------- absensi
// Absen dari ponsel: selfie (sudah diperkecil di browser) diunggah dulu, lalu dicatat beserta lokasi GPS.
export async function clock(_: ActionState, f: FormData): Promise<ActionState> {
  const kind = str(f, 'kind');
  const label = kind === 'in' ? 'Absen masuk tercatat' : 'Absen pulang tercatat';
  const at = num(f, 'at'); // ms epoch saat tombol ditekan di perangkat (penting untuk antrean offline)
  let dup = false;
  const r = await run(['/absen', '/saya'], label, async () => {
    const res = await once(str(f, 'cid'), async () => {
      const { profile } = await getSession();
      const supabase = await createClient();
      let photo: string | null = null;
      const file = f.get('photo');
      if (file instanceof File && file.size > 0) {
        if (file.size > 2 * 1024 * 1024) throw new Error('Foto terlalu besar');
        photo = (await uploadAttachment(supabase, `drafts/${profile.id}/absen/${crypto.randomUUID()}.jpg`,
          new Uint8Array(await file.arrayBuffer()), 'selfie.jpg', 'image/jpeg')).id;
      }
      await rpc('attendance_clock', {
        p_kind: kind, p_lat: num(f, 'lat'), p_lng: num(f, 'lng'), p_accuracy: num(f, 'accuracy'), p_photo: photo, p_device: str(f, 'device'),
        p_at: at ? new Date(at).toISOString() : null, p_note: str(f, 'note'),
      });
    });
    dup = res === 'duplicate';
  });
  return dup ? { ok: 'Absen ini sudah terkirim sebelumnya' } : r;
}

export async function manualAttendance(_: ActionState, f: FormData) {
  // input datetime-local berisi jam site; tambahkan offset WITA
  const at = str(f, 'at');
  return run(['/hrga/absensi'], 'Koreksi absen dicatat', async () => rpc('attendance_manual', {
    p_employee: await emp(f), p_at: at ? `${at}:00+08:00` : null, p_kind: str(f, 'kind'), p_note: str(f, 'note'),
  }));
}

export async function saveLocation(_: ActionState, f: FormData) {
  return run(['/hrga/absensi'], 'Lokasi absen disimpan', () => rpc('attendance_location_save', {
    p_id: str(f, 'id'), p_name: str(f, 'name'), p_lat: num(f, 'lat'), p_lng: num(f, 'lng'), p_radius: num(f, 'radius'), p_active: str(f, 'active') !== 'false',
  }));
}

export async function setHoliday(_: ActionState, f: FormData) {
  return run(['/hrga/absensi'], str(f, 'name') ? 'Hari libur disimpan' : 'Hari libur dihapus', () =>
    rpc('holiday_set', { p_date: str(f, 'date'), p_name: str(f, 'name') ?? '', p_kind: str(f, 'kind') ?? 'national' }));
}

export async function saveShift(_: ActionState, f: FormData) {
  return run(['/hrga/absensi'], 'Shift disimpan', () => rpc('shift_save', {
    p_code: str(f, 'code'), p_name: str(f, 'name'), p_start: str(f, 'start'), p_end: str(f, 'end'), p_grace: num(f, 'grace'), p_break: num(f, 'break'),
  }));
}

// ---------------------------------------------------------------- cuti
export async function createLeave(_: ActionState, f: FormData): Promise<ActionState> {
  return run(['/saya', '/hrga/cuti', '/tugas'], 'Pengajuan cuti terkirim ke atasan', async () => {
    const { profile } = await getSession();
    const supabase = await createClient();
    const files = await uploadFormFiles(supabase, profile.id, 'cuti', f.getAll('files'));
    await rpc('leave_request_create', {
      p_employee: await emp(f), p_type: str(f, 'type'), p_start: str(f, 'start'), p_end: str(f, 'end') ?? str(f, 'start'),
      p_reason: str(f, 'reason'), p_attachments: files, p_idempotency_key: str(f, 'idem'),
    });
  });
}

export async function decideLeave(_: ActionState, f: FormData) {
  const approve = str(f, 'approve') === '1';
  return run(['/hrga/cuti', '/tugas', '/saya'], approve ? 'Cuti disetujui' : 'Cuti ditolak', () =>
    rpc('leave_request_decide', { p_id: str(f, 'id'), p_approve: approve, p_note: str(f, 'note') }));
}

export async function cancelLeave(_: ActionState, f: FormData) {
  return run(['/hrga/cuti', '/saya'], 'Pengajuan dibatalkan', () => rpc('leave_request_cancel', { p_id: str(f, 'id') }));
}

export async function adjustLeave(_: ActionState, f: FormData) {
  return run(['/hrga/cuti'], 'Saldo cuti disesuaikan', async () => rpc('leave_adjust', {
    p_employee: await emp(f), p_year: num(f, 'year'), p_type: str(f, 'type') ?? 'CT', p_days: num(f, 'days'), p_reason: str(f, 'reason'),
  }));
}

// ---------------------------------------------------------------- lembur
export async function createOvertime(_: ActionState, f: FormData) {
  return run(['/saya', '/hrga/lembur', '/tugas'], 'SPL terkirim untuk persetujuan', async () => rpc('overtime_request_create', {
    p_employee: await emp(f), p_date: str(f, 'date'), p_start: str(f, 'start'), p_end: str(f, 'end'), p_reason: str(f, 'reason'),
    p_idempotency_key: str(f, 'idem'),
  }));
}

export async function decideOvertime(_: ActionState, f: FormData) {
  const approve = str(f, 'approve') === '1';
  return run(['/hrga/lembur', '/tugas', '/saya'], approve ? 'SPL disetujui' : 'SPL ditolak', () =>
    rpc('overtime_request_decide', { p_id: str(f, 'id'), p_approve: approve, p_note: str(f, 'note') }));
}

export async function cancelOvertime(_: ActionState, f: FormData) {
  return run(['/hrga/lembur', '/saya'], 'SPL dibatalkan', () => rpc('overtime_request_cancel', { p_id: str(f, 'id') }));
}
