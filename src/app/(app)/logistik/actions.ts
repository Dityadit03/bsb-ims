'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { uploadFormFiles } from '@/lib/attachments';

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

export async function saveMaterial(_: ActionState, f: FormData) {
  return run('/logistik', 'Barang disimpan', () => rpc('material_save', {
    p_code: str(f, 'code'), p_name: str(f, 'name'), p_category: str(f, 'category'), p_uom: str(f, 'uom'),
    p_min_stock: num(f, 'min_stock') ?? 0, p_active: str(f, 'active') !== 'false',
  }));
}

export async function savePlanning(_: ActionState, f: FormData) {
  return run('/logistik', 'Perencanaan barang disimpan', () => rpc('material_planning_set', {
    p_material: str(f, 'material'), p_lead_time_days: num(f, 'lead') ?? 7, p_critical: f.get('critical') === 'on',
  }));
}

export async function saveLocation(_: ActionState, f: FormData) {
  return run('/logistik', 'Lokasi rak disimpan', () => rpc('material_location_set', { p_material: str(f, 'material'), p_location: str(f, 'location') }));
}

export async function receiveGoods(_: ActionState, f: FormData) {
  return run('/logistik', 'Penerimaan dicatat', () => rpc('goods_receive', {
    p_material: str(f, 'material'), p_supplier: str(f, 'supplier'), p_qty: num(f, 'qty'), p_unit_cost: num(f, 'cost'),
    p_doc_ref: str(f, 'doc_ref'), p_note: str(f, 'note'), p_idempotency_key: str(f, 'idem'),
  }));
}

export async function issueFuel(_: ActionState, f: FormData) {
  return run('/logistik', 'Pengisian dicatat', () => rpc('fuel_issue', {
    p_unit: str(f, 'unit'), p_material: str(f, 'material'), p_qty: num(f, 'qty'), p_hm: num(f, 'hm'), p_note: str(f, 'note'),
    p_idempotency_key: str(f, 'idem'),
  }));
}

export async function opname(_: ActionState, f: FormData) {
  return run('/logistik', 'Hasil opname disimpan', () =>
    rpc('stock_opname', { p_material: str(f, 'material'), p_counted: num(f, 'counted'), p_note: str(f, 'note') }));
}

export async function createMr(_: ActionState, f: FormData): Promise<ActionState> {
  const lines = [1, 2, 3, 4, 5].map(i => ({ material: str(f, `material_${i}`), qty: num(f, `qty_${i}`), note: str(f, `note_${i}`) }))
    .filter(l => l.material && l.qty);
  const special = [1, 2, 3].map(i => ({ name: str(f, `sp_name_${i}`), spec: str(f, `sp_spec_${i}`), part_no: str(f, `sp_part_${i}`), qty: num(f, `sp_qty_${i}`), uom: str(f, `sp_uom_${i}`) }))
    .filter(x => x.name || x.qty);
  let id: string;
  try {
    id = (await rpc('mr_create', {
      p_department: str(f, 'department'), p_purpose: str(f, 'purpose'), p_lines: lines, p_need_date: str(f, 'need_date'),
      p_wo: str(f, 'wo'), p_idempotency_key: str(f, 'idem'), p_unit: str(f, 'unit'), p_special: special,
    })).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/logistik/mr/${id}`);
}

// Logistik mengaitkan part khusus ke barang katalog (kosongkan barang = tolak, wajib alasan)
export async function resolveSpecial(_: ActionState, f: FormData) {
  return run(`/logistik/mr/${str(f, 'mr')}`, 'Part khusus diproses', () =>
    rpc('mr_special_resolve', { p_item: str(f, 'id'), p_material: str(f, 'material'), p_note: str(f, 'note') }));
}

// Foto/PDF formulir fisik yang sudah ditandatangani (WO, MR, PR, PO)
export async function attachDoc(_: ActionState, f: FormData) {
  return run(str(f, 'path') ?? '/logistik', 'Berkas diunggah', async () => {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const ids = await uploadFormFiles(supabase, auth.user!.id, 'dokumen', f.getAll('files'));
    const { error } = await supabase.rpc('doc_attach', { p_table: str(f, 'table'), p_id: str(f, 'id'), p_attachments: ids });
    if (error) throw new Error(error.message);
  });
}

export async function confirmIssue(_: ActionState, f: FormData) {
  return run(`/logistik/mr/${str(f, 'id')}`, 'Penerimaan barang dikonfirmasi', () =>
    rpc('goods_issue_confirm', { p_mr: str(f, 'id'), p_note: str(f, 'note') }));
}

// Approval ala Syshab: setujui (jumlah per baris bisa dikurangi, 0 = baris ditolak), pending atau tolak dengan catatan
export async function decideMr(_: ActionState, f: FormData) {
  const decision = str(f, 'decision') ?? 'approve';
  const lines = decision === 'approve' ? f.getAll('line').map(String).map(line => ({ line, qty: num(f, `qty_${line}`) ?? 0 })) : [];
  const ok = { approve: 'MR disetujui', pending: 'MR di-pending', reject: 'MR ditolak' }[decision] ?? 'Tersimpan';
  return run(`/logistik/mr/${str(f, 'id')}`, ok, () =>
    rpc('mr_decide', { p_mr: str(f, 'id'), p_decision: decision, p_note: str(f, 'note'), p_lines: lines }));
}

export async function cancelMr(_: ActionState, f: FormData) {
  return run(`/logistik/mr/${str(f, 'id')}`, 'MR dibatalkan', () => rpc('mr_cancel', { p_mr: str(f, 'id'), p_reason: str(f, 'reason') }));
}

export async function issueGoods(_: ActionState, f: FormData) {
  const lines = f.getAll('line').map(String).map(line => ({ line, qty: num(f, `qty_${line}`) ?? 0 }));
  return run(`/logistik/mr/${str(f, 'id')}`, 'Barang dikeluarkan', () =>
    rpc('goods_issue', { p_mr: str(f, 'id'), p_lines: lines, p_note: str(f, 'note'), p_idempotency_key: str(f, 'idem') }));
}

export async function saveSupplier(_: ActionState, f: FormData) {
  return run('/logistik/supplier', 'Supplier disimpan', () => rpc('supplier_save', {
    p_code: str(f, 'code'), p_name: str(f, 'name'), p_category: str(f, 'category'), p_contact: str(f, 'contact'),
    p_phone: str(f, 'phone'), p_active: str(f, 'active') !== 'false',
  }));
}

export async function evaluateSupplier(_: ActionState, f: FormData) {
  return run('/logistik/supplier', 'Evaluasi disimpan', () => rpc('supplier_evaluate', {
    p_supplier: str(f, 'supplier'), p_period: `${str(f, 'period')}-01`, p_quality: num(f, 'quality'), p_delivery: num(f, 'delivery'),
    p_price: num(f, 'price'), p_service: num(f, 'service'), p_safety: num(f, 'safety'), p_note: str(f, 'note'),
  }));
}

// ---------------------------------------------------------------- pengadaan: PR → penawaran → PO → GR
export async function prFromMr(_: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try { id = (await rpc('pr_from_mr', { p_mr: str(f, 'id'), p_idempotency_key: str(f, 'idem') })).id; }
  catch (e) { return { error: (e as Error).message }; }
  redirect(`/logistik/pengadaan/${id}`);
}

export async function createPr(_: ActionState, f: FormData): Promise<ActionState> {
  const lines = f.getAll('row').map(String).map(i => ({ material: str(f, `material_${i}`), qty: num(f, `qty_${i}`), note: str(f, `note_${i}`) }))
    .filter(l => l.material && l.qty);
  let id: string;
  try {
    id = (await rpc('pr_create', { p_purpose: str(f, 'purpose'), p_lines: lines, p_need_date: str(f, 'need_date'), p_idempotency_key: str(f, 'idem') })).id;
  } catch (e) { return { error: (e as Error).message }; }
  redirect(`/logistik/pengadaan/${id}`);
}

const prPath = (f: FormData) => `/logistik/pengadaan/${str(f, 'pr')}`;

export async function decidePr(_: ActionState, f: FormData) {
  const approve = str(f, 'decision') === 'approve';
  return run(prPath(f), approve ? 'PR disetujui' : 'PR ditolak', () => rpc('pr_decide', { p_pr: str(f, 'pr'), p_approve: approve, p_note: str(f, 'note') }));
}

export async function saveQuote(_: ActionState, f: FormData) {
  return run(prPath(f), 'Penawaran disimpan', () => rpc('quote_save', {
    p_pr_line: str(f, 'line'), p_supplier: str(f, 'supplier'), p_unit_price: num(f, 'price'), p_lead_days: num(f, 'lead'), p_note: str(f, 'note'),
  }));
}

export async function selectQuote(_: ActionState, f: FormData) {
  return run(prPath(f), 'Supplier dipilih', () => rpc('quote_select', { p_quote: str(f, 'quote') }));
}

export async function createPo(_: ActionState, f: FormData) {
  return run(prPath(f), 'PO dibuat', () => rpc('po_from_pr', { p_pr: str(f, 'pr'), p_expected: str(f, 'expected') }));
}

export async function approvePo(_: ActionState, f: FormData) {
  const approve = str(f, 'decision') === 'approve';
  return run(prPath(f), approve ? 'PO disetujui' : 'PO dibatalkan', () => rpc('po_approve', { p_po: str(f, 'po'), p_approve: approve, p_note: str(f, 'note') }));
}

export async function receivePo(_: ActionState, f: FormData) {
  const lines = f.getAll('line').map(String).map(line => ({ line, qty: num(f, `qty_${line}`) ?? 0 }));
  return run(prPath(f), 'Barang diterima', () => rpc('goods_receive_po', {
    p_po: str(f, 'po'), p_lines: lines, p_doc_ref: str(f, 'doc_ref'), p_note: str(f, 'note'), p_idempotency_key: str(f, 'idem'),
  }));
}
