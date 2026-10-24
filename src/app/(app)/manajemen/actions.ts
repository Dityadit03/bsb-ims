'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type ActionState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null;

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

export async function planAudit(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    id = (await rpc('audit_plan', {
      p_title: str(f, 'title'), p_scope: str(f, 'scope'), p_start: str(f, 'start'), p_end: str(f, 'end'), p_lead: str(f, 'lead'),
      p_department: str(f, 'department'), p_members: f.getAll('members').map(String), p_idempotency_key: str(f, 'idem'),
    })).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/manajemen/audit/${id}`);
}

const auditPath = (f: FormData) => `/manajemen/audit/${str(f, 'id')}`;
export async function startAudit(_: ActionState, f: FormData) {
  return run(auditPath(f), 'Audit dimulai', () => rpc('audit_start', { p_audit: str(f, 'id') }));
}
export async function addFinding(_: ActionState, f: FormData) {
  return run(auditPath(f), 'Temuan dicatat', () => rpc('audit_finding_add', {
    p_audit: str(f, 'id'), p_clause: str(f, 'clause'), p_category: str(f, 'category'), p_statement: str(f, 'statement'),
    p_evidence: str(f, 'evidence'), p_department: str(f, 'department'),
  }));
}
export async function removeFinding(_: ActionState, f: FormData) {
  return run(auditPath(f), 'Temuan dihapus', () => rpc('audit_finding_remove', { p_finding: str(f, 'finding') }));
}
export async function reportAudit(_: ActionState, f: FormData) {
  return run(auditPath(f), 'Laporan audit terbit', () => rpc('audit_report', { p_audit: str(f, 'id'), p_summary: str(f, 'summary') }));
}
export async function closeAudit(_: ActionState, f: FormData) {
  return run(auditPath(f), 'Audit ditutup', () => rpc('audit_close', { p_audit: str(f, 'id') }));
}
export async function cancelAudit(_: ActionState, f: FormData) {
  return run(auditPath(f), 'Audit dibatalkan', () => rpc('audit_cancel', { p_audit: str(f, 'id'), p_reason: str(f, 'reason') }));
}

export async function createReview(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    id = (await rpc('mgmt_review_create', {
      p_title: str(f, 'title'), p_meeting_date: str(f, 'date'), p_chair: str(f, 'chair'), p_idempotency_key: str(f, 'idem'),
    })).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/manajemen/tinjauan/${id}`);
}

const reviewPath = (f: FormData) => `/manajemen/tinjauan/${str(f, 'id')}`;
export async function saveReviewItem(_: ActionState, f: FormData) {
  return run(reviewPath(f), 'Pembahasan disimpan', () => rpc('mgmt_review_item_save', {
    p_review: str(f, 'id'), p_topic: str(f, 'topic'), p_discussion: str(f, 'discussion'), p_decision: str(f, 'decision'),
    p_action_required: str(f, 'action') === 'true', p_clause: str(f, 'clause'), p_department: str(f, 'department'),
  }));
}
export async function holdReview(_: ActionState, f: FormData) {
  return run(reviewPath(f), 'Rapat dicatat terlaksana', () => rpc('mgmt_review_hold', { p_review: str(f, 'id'), p_attendees: str(f, 'attendees') }));
}
export async function closeReview(_: ActionState, f: FormData) {
  return run(reviewPath(f), 'Tinjauan ditutup', () => rpc('mgmt_review_close', { p_review: str(f, 'id'), p_conclusion: str(f, 'conclusion') }));
}
