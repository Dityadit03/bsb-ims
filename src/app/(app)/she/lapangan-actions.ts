'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;

async function rpc(path: string, ok: string, fn: string, args: Record<string, unknown>): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  revalidatePath(path);
  return { ok };
}

// NRP dipisah baris / koma / spasi; boleh juga ditempel "NRP · Nama"
function parseNrps(raw: string | null) {
  return (raw ?? '').split(/[\n,;]+/).map(x => x.split('·')[0].trim()).filter(Boolean);
}

export async function recordToolbox(_: ActionState, f: FormData) {
  return rpc('/she/toolbox', 'Toolbox talk tersimpan', 'toolbox_record', {
    p_date: str(f, 'date'), p_shift: Number(str(f, 'shift')), p_department: str(f, 'department'),
    p_topic: str(f, 'topic'), p_notes: str(f, 'notes'), p_nrps: parseNrps(str(f, 'nrps')),
  });
}

export async function submitHandover(_: ActionState, f: FormData) {
  return rpc('/she/serah-terima', 'Serah terima tersimpan', 'handover_submit', {
    p_date: str(f, 'date'), p_shift: Number(str(f, 'shift')), p_department: str(f, 'department'), p_area: str(f, 'area'),
    p_summary: str(f, 'summary'), p_pending: str(f, 'pending'), p_hazards: str(f, 'hazards'), p_units: str(f, 'units'),
  });
}

export async function ackHandover(_: ActionState, f: FormData) {
  return rpc('/she/serah-terima', 'Serah terima diterima', 'handover_ack', { p_id: str(f, 'id') });
}
