import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { PRIORITY, WO_STATUS, WO_TYPE } from '@/lib/plant';
import { MR_STATUS, qty, rp } from '@/lib/logistics';
import { PrintButton } from '../../print-button';
import { Field, FormSheet, Grid, Lines } from '../../form-sheet';

export const metadata = { title: 'Cetak formulir' };

type Row = Record<string, string | number | null>;

// Formulir cetak WO, MR, PR, PO. Data dibaca lewat RLS pemakai, jadi hanya yang berhak melihat dokumen yang bisa mencetaknya.
export default async function CetakPage({ params }: { params: Promise<{ jenis: string; id: string }> }) {
  const { jenis, id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const by = s.profile.full_name ?? 'pengguna';
  let back = '/';
  let sheet: React.ReactNode = null;

  if (jenis === 'wo') {
    const { data: w } = await supabase.from('work_order_register').select('*').eq('id', id).maybeSingle<Row>();
    if (!w) notFound();
    const { data: parts } = await supabase.from('wo_parts').select('mr_no, code, name, uom, qty, qty_approved, qty_issued').eq('wo_id', id).order('mr_no').returns<Row[]>();
    back = `/plant/wo/${id}`;
    sheet = (
      <FormSheet title="Work Order" number={String(w.wo_no)} subtitle="Plant · Perawatan unit" printedBy={by} sign={['Pelapor', 'Mekanik', 'Supervisor Plant', 'Diterima operator']}>
        <Grid>
          <Field label="Unit">{w.unit_no}</Field><Field label="Jenis">{WO_TYPE[String(w.wo_type)]}</Field>
          <Field label="Prioritas">{PRIORITY[String(w.priority)]?.[1]}</Field><Field label="Status">{WO_STATUS[String(w.status)]?.[1]}</Field>
          <Field label="Dilaporkan">{fmtDateTime(String(w.reported_at))}</Field><Field label="Pelapor">{w.reporter_name}</Field>
          <Field label="HM saat lapor">{w.hm_reported != null ? Number(w.hm_reported).toLocaleString('id-ID') : null}</Field><Field label="Mekanik">{w.mechanic_name}</Field>
        </Grid>
        <h2 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-neutral-600">Kerusakan / pekerjaan</h2>
        <p className="min-h-16 whitespace-pre-line border border-neutral-400 p-2">{w.description}</p>
        <h2 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-neutral-600">Suku cadang (dari MR)</h2>
        <Lines head={['No', 'MR', 'Barang', 'Diminta', 'Keluar']} rows={(parts ?? []).map((p, i) => [i + 1, p.mr_no, `${p.code} · ${p.name}`, `${qty(Number(p.qty))} ${p.uom}`, qty(Number(p.qty_issued))])} empty={4} />
        <h2 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-neutral-600">Tindakan perbaikan</h2>
        <p className="min-h-24 whitespace-pre-line border border-neutral-400 p-2">{w.action_taken}</p>
        <Grid>
          <Field label="Mulai">{w.started_at ? fmtDateTime(String(w.started_at)) : null}</Field><Field label="Selesai">{w.completed_at ? fmtDateTime(String(w.completed_at)) : null}</Field>
          <Field label="HM selesai">{w.hm_completed != null ? Number(w.hm_completed).toLocaleString('id-ID') : null}</Field><Field label="Downtime">{w.downtime_hours != null ? `${w.downtime_hours} jam` : null}</Field>
        </Grid>
      </FormSheet>
    );
  } else if (jenis === 'mr') {
    const { data: r } = await supabase.from('mr_register').select('*').eq('id', id).maybeSingle<Row>();
    if (!r) notFound();
    const [{ data: lines }, { data: special }] = await Promise.all([
      supabase.from('mr_tracking').select('material_code, material_name, uom, qty, qty_approved, qty_issued').eq('mr_id', id).order('material_code').returns<Row[]>(),
      supabase.from('mr_special_items').select('name, spec, part_no, qty, uom, status').eq('mr_id', id).returns<Row[]>(),
    ]);
    back = `/logistik/mr/${id}`;
    sheet = (
      <FormSheet title="Material Request" number={String(r.mr_no)} subtitle="Logistik · Permintaan barang" printedBy={by} sign={['Peminta', 'Atasan / Dept Head', 'Petugas gudang', 'Penerima']}>
        <Grid>
          <Field label="Departemen">{r.department_code}</Field><Field label="Tanggal">{fmtDate(String(r.created_at))}</Field>
          <Field label="Unit">{r.unit_no}</Field><Field label="Work order">{r.wo_no}</Field>
          <Field label="Peminta">{r.requester_name}</Field><Field label="Dibutuhkan">{r.need_date ? fmtDate(String(r.need_date)) : null}</Field>
          <Field label="Status">{MR_STATUS[String(r.status)]?.[1]}</Field><Field label="Perkiraan nilai">{rp(Number(r.total_value))}</Field>
        </Grid>
        <h2 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-neutral-600">Keperluan</h2>
        <p className="min-h-10 border border-neutral-400 p-2">{r.purpose}</p>
        <h2 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-neutral-600">Barang</h2>
        <Lines head={['No', 'Kode · Barang', 'Diminta', 'Disetujui', 'Keluar']} rows={(lines ?? []).map((l, i) => [i + 1, `${l.material_code} · ${l.material_name}`, `${qty(Number(l.qty))} ${l.uom}`, l.qty_approved == null ? '' : qty(Number(l.qty_approved)), qty(Number(l.qty_issued))])} empty={6} />
        {special?.length ? (<>
          <h2 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-neutral-600">Part khusus (di luar katalog)</h2>
          <Lines head={['No', 'Nama · spesifikasi', 'No. part', 'Jumlah']} rows={special.map((x, i) => [i + 1, `${x.name}${x.spec ? ` · ${x.spec}` : ''}`, x.part_no, `${qty(Number(x.qty))} ${x.uom}`])} empty={0} />
        </>) : null}
        {r.review_note && <p className="mt-3 text-xs"><span className="text-neutral-500">Catatan persetujuan: </span>{r.review_note}</p>}
      </FormSheet>
    );
  } else if (jenis === 'pr') {
    const { data: pr } = await supabase.from('pr_register').select('*').eq('id', id).maybeSingle<Row>();
    if (!pr) notFound();
    const { data: lines } = await supabase.from('purchase_requisition_lines').select('qty, note, materials(code, name, uom)').eq('pr_id', id)
      .returns<{ qty: number; note: string | null; materials: { code: string; name: string; uom: string } }[]>();
    back = `/logistik/pengadaan/${id}`;
    sheet = (
      <FormSheet title="Purchase Requisition" number={String(pr.pr_no)} subtitle="Logistik · Permintaan pembelian" printedBy={by} sign={['Pembuat', 'Dept Head', 'Purchasing', 'Disetujui PJO']}>
        <Grid>
          <Field label="Tanggal">{fmtDate(String(pr.created_at))}</Field><Field label="Pembuat">{pr.requester_name}</Field>
          <Field label="Dari MR">{pr.mr_no}</Field><Field label="Dibutuhkan">{pr.need_date ? fmtDate(String(pr.need_date)) : null}</Field>
        </Grid>
        <h2 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-neutral-600">Keperluan</h2>
        <p className="min-h-10 border border-neutral-400 p-2">{pr.purpose}</p>
        <h2 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-neutral-600">Barang yang dibeli</h2>
        <Lines head={['No', 'Kode · Barang', 'Jumlah', 'Catatan']} rows={(lines ?? []).map((l, i) => [i + 1, `${l.materials.code} · ${l.materials.name}`, `${qty(l.qty)} ${l.materials.uom}`, l.note])} empty={6} />
      </FormSheet>
    );
  } else if (jenis === 'po') {
    const { data: po } = await supabase.from('po_register').select('*').eq('id', id).maybeSingle<Row>();
    if (!po) notFound();
    const { data: lines } = await supabase.from('purchase_order_lines').select('qty, unit_price, materials(code, name, uom)').eq('po_id', id)
      .returns<{ qty: number; unit_price: number; materials: { code: string; name: string; uom: string } }[]>();
    back = `/logistik/pengadaan/${po.pr_id ?? ''}`;
    sheet = (
      <FormSheet title="Purchase Order" number={String(po.po_no)} subtitle="Logistik · Pesanan pembelian" printedBy={by} sign={['Dibuat oleh', 'Logistik / Purchasing', 'Disetujui PJO', 'Supplier']}>
        <Grid>
          <Field label="Supplier">{po.supplier_name}</Field><Field label="Tanggal">{fmtDate(String(po.created_at))}</Field>
          <Field label="Estimasi tiba">{po.expected_date ? fmtDate(String(po.expected_date)) : null}</Field><Field label="Dibuat oleh">{po.creator_name}</Field>
        </Grid>
        <h2 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-neutral-600">Rincian pesanan</h2>
        <Lines head={['No', 'Kode · Barang', 'Jumlah', 'Harga satuan', 'Total']} rows={(lines ?? []).map((l, i) => [i + 1, `${l.materials.code} · ${l.materials.name}`, `${qty(l.qty)} ${l.materials.uom}`, rp(l.unit_price), rp(l.qty * l.unit_price)])} empty={5} />
        <p className="mt-2 text-right text-sm font-bold">Total {rp(Number(po.total_value))}</p>
        {po.note && <p className="mt-2 text-xs"><span className="text-neutral-500">Catatan: </span>{po.note}</p>}
      </FormSheet>
    );
  } else notFound();

  return (
    <main className="min-h-dvh bg-neutral-100 py-6 text-neutral-900 print:bg-white print:py-0" style={{ colorScheme: 'light' }}>
      <div className="mx-auto mb-3 flex max-w-[210mm] items-center justify-between px-4 print:hidden">
        <Link href={back} className="text-sm text-neutral-600 hover:underline">← Kembali ke dokumen</Link>
        <PrintButton />
      </div>
      {sheet}
    </main>
  );
}
