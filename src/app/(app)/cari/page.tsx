import Link from 'next/link';
import { PageHeader, Panel, input, btnPrimary } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Cari' };

type Hit = { href: string; code: string; text: string; note?: string };
type Source = { label: string; view: string; cols: string[]; select: string; hit: (r: Record<string, string | null>) => Hit };

// Pencarian lintas modul. Hasil tetap dibatasi hak akses (RLS) pengguna.
const SOURCES: Source[] = [
  { label: 'Dokumen', view: 'document_register', cols: ['document_number', 'registration_no', 'title'], select: 'id, document_number, registration_no, title, status',
    hit: r => ({ href: `/dokumen/${r.id}`, code: r.document_number ?? r.registration_no ?? '', text: r.title ?? '', note: r.status ?? '' }) },
  { label: 'Karyawan', view: 'employee_register', cols: ['nrp', 'full_name', 'position_name'], select: 'id, nrp, full_name, department_code, position_name',
    hit: r => ({ href: `/hrga/${r.id}`, code: r.nrp ?? '', text: r.full_name ?? '', note: [r.department_code, r.position_name].filter(Boolean).join(' · ') }) },
  { label: 'Unit', view: 'units', cols: ['unit_no', 'brand', 'model', 'vendor'], select: 'id, unit_no, unit_type, brand, model, status',
    hit: r => ({ href: `/plant/${r.id}`, code: r.unit_no ?? '', text: [r.unit_type, r.brand, r.model].filter(Boolean).join(' '), note: r.status ?? '' }) },
  { label: 'Work order', view: 'work_order_register', cols: ['wo_no', 'unit_no', 'description'], select: 'id, wo_no, unit_no, description, status',
    hit: r => ({ href: `/plant/wo/${r.id}`, code: r.wo_no ?? '', text: `${r.unit_no} · ${r.description}`, note: r.status ?? '' }) },
  { label: 'Barang', view: 'material_stock', cols: ['code', 'name'], select: 'id, code, name, stock_qty, uom',
    hit: r => ({ href: `/logistik?q=${encodeURIComponent(r.code ?? '')}`, code: r.code ?? '', text: r.name ?? '', note: `stok ${r.stock_qty} ${r.uom}` }) },
  { label: 'Material request', view: 'mr_register', cols: ['mr_no', 'purpose', 'requester_name'], select: 'id, mr_no, purpose, status',
    hit: r => ({ href: `/logistik/mr/${r.id}`, code: r.mr_no ?? '', text: r.purpose ?? '', note: r.status ?? '' }) },
  { label: 'PR', view: 'pr_register', cols: ['pr_no', 'purpose'], select: 'id, pr_no, purpose, status',
    hit: r => ({ href: `/logistik/pengadaan/${r.id}`, code: r.pr_no ?? '', text: r.purpose ?? '', note: r.status ?? '' }) },
  { label: 'PO', view: 'po_register', cols: ['po_no', 'supplier_name'], select: 'id, po_no, pr_id, supplier_name, status',
    hit: r => ({ href: r.pr_id ? `/logistik/pengadaan/${r.pr_id}` : '/logistik/pengadaan?semua=1', code: r.po_no ?? '', text: r.supplier_name ?? '', note: r.status ?? '' }) },
  { label: 'Supplier', view: 'supplier_score', cols: ['code', 'name'], select: 'id, code, name, grade',
    hit: r => ({ href: '/logistik/supplier', code: r.code ?? '', text: r.name ?? '', note: r.grade ? `grade ${r.grade}` : '' }) },
  { label: 'Hazard', view: 'she_hazard_register', cols: ['hazard_no', 'description', 'location_note'], select: 'id, hazard_no, description, status',
    hit: r => ({ href: `/she/hazard/${r.id}`, code: r.hazard_no ?? '', text: r.description ?? '', note: r.status ?? '' }) },
  { label: 'Insiden', view: 'incident_register', cols: ['incident_no', 'chronology', 'unit_no'], select: 'id, incident_no, chronology, status',
    hit: r => ({ href: `/she/insiden/${r.id}`, code: r.incident_no ?? '', text: r.chronology ?? '', note: r.status ?? '' }) },
  { label: 'Action plan', view: 'capa_register', cols: ['action_no', 'title', 'source_ref'], select: 'id, action_no, title, status',
    hit: r => ({ href: `/capa/${r.id}`, code: r.action_no ?? '', text: r.title ?? '', note: r.status ?? '' }) },
];

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? '').trim().slice(0, 60);
  // karakter khusus filter PostgREST dibuang
  const term = q.replace(/[%,()*:"\\]/g, ' ').trim();
  const supabase = await createClient();
  const results = term.length >= 2 ? await Promise.all(SOURCES.map(async s => {
    const { data } = await supabase.from(s.view).select(s.select).or(s.cols.map(c => `${c}.ilike.*${term}*`).join(',')).limit(8);
    return { s, hits: ((data ?? []) as unknown as Record<string, string | null>[]).map(s.hit) };
  })) : [];
  const found = results.filter(r => r.hits.length);

  return (
    <>
      <PageHeader eyebrow="Pencarian" title={q ? `Hasil untuk "${q}"` : 'Cari di semua modul'} />
      <form className="flex gap-2" role="search">
        <input name="q" type="search" defaultValue={q} autoFocus placeholder="Nomor dokumen, NRP, nama, no. unit, kode barang, MR/PR/PO…" className={input} />
        <button className={btnPrimary}>Cari</button>
      </form>
      {term.length >= 2 && !found.length && <p className="text-sm text-muted">Tidak ada yang cocok. Coba kata lain atau sebagian nomor.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {found.map(({ s, hits }) => (
          <Panel key={s.label} title={s.label}>
            <ul className="grid gap-1">
              {hits.map(h => (
                <li key={h.href + h.code}>
                  <Link href={h.href} className="grid gap-0.5 rounded-lg px-2 py-1.5 hover:bg-accent-soft/50">
                    <span className="flex items-baseline justify-between gap-2"><span className="font-mono text-xs font-medium text-accent">{h.code}</span>
                      {h.note && <span className="text-xs text-muted">{h.note}</span>}</span>
                    <span className="line-clamp-1 text-sm">{h.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  );
}
