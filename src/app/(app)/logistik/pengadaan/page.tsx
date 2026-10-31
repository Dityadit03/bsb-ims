import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Stat, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { PO_STATUS, PR_SOURCE, PR_STATUS, rp } from '@/lib/logistics';
import { createPr, requestPurchase } from '../actions';
import { DeptSelect, sheMasters } from '../../she/fields';
import { LogTabs } from '../tabs';

export const metadata = { title: 'Pengadaan' };

type Pr = { id: string; pr_no: string; status: string; purpose: string; need_date: string | null; created_at: string; mr_id: string | null;
  mr_no: string | null; requester_name: string; lines: number; lines_quoted: number; source: string; department_code: string | null; est_total: number };
type Po = { id: string; po_no: string; status: string; pr_id: string | null; pr_no: string | null; supplier_name: string; total_value: number;
  expected_date: string | null; created_at: string };
type Stock = { id: string; code: string; name: string; uom: string; stock_qty: number; min_stock: number; low_stock: boolean };

const OPEN_PR = ['dept_review', 'submitted', 'approved', 'ordered'];
const OPEN_PO = ['awaiting_approval', 'issued', 'partial'];

// Alur pembelian: PR (dari kekurangan MR atau isi ulang stok minimum) → penawaran → PO → penerimaan.
export default async function Pengadaan({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const all = !!sp.semua;
  let prq = supabase.from('pr_register').select('*').order('created_at', { ascending: false }).limit(300);
  let poq = supabase.from('po_register').select('*').order('created_at', { ascending: false }).limit(300);
  if (!all) { prq = prq.in('status', OPEN_PR); poq = poq.in('status', OPEN_PO); }
  const [{ data: prs }, { data: pos }, { data: stock }, { depts }] = await Promise.all([
    prq.returns<Pr[]>(), poq.returns<Po[]>(),
    supabase.from('material_stock').select('id, code, name, uom, stock_qty, min_stock, low_stock').eq('active', true).order('code').returns<Stock[]>(),
    sheMasters(),
  ]);
  const count = <T extends { status: string }>(rows: T[] | null, st: string) => (rows ?? []).filter(r => r.status === st).length;
  const buyer = s.canIn('log.purchase', 'LOG');
  const myDepts = depts.filter(d => s.canIn('log.request', d.code));
  // "Isi dari stok minimum": barang di bawah minimum dimasukkan otomatis, jumlah = 2× minimum − stok
  const low = sp.isi === 'minimum' ? (stock ?? []).filter(m => m.low_stock) : [];
  const rows = low.length ? low.map(m => ({ m: m.id, q: Math.max(1, Math.ceil(Number(m.min_stock) * 2 - Number(m.stock_qty))) })) : [];
  const blank = Math.max(3, rows.length + 2);

  return (
    <>
      <PageHeader eyebrow="Logistik" title="Pengadaan barang"><ExportLinks dataset="tracking" /></PageHeader>
      <LogTabs active="/logistik/pengadaan" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="PR menunggu persetujuan" value={count(prs, 'submitted') + count(prs, 'dept_review')} note={count(prs, 'dept_review') ? `${count(prs, 'dept_review')} masih di departemen` : undefined} />
        <Stat label="PR cari penawaran" value={count(prs, 'approved')} />
        <Stat label="PO menunggu approval" value={count(pos, 'awaiting_approval')} />
        <Stat label="PO dalam pengiriman" value={count(pos, 'issued') + count(pos, 'partial')} />
      </div>
      <div className="grid gap-2 text-xs text-muted">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <li className="font-medium text-ink">Ambil dari stok</li>
          {['MR disetujui', 'Stok kurang → PR', 'PR disetujui', 'Penawaran & pilih supplier', 'Buat PO', 'Terima barang (GR)', 'Keluarkan ke peminta (GI)']
            .map((t, i) => <li key={t} className="rounded-full border border-line bg-panel px-2.5 py-1"><b className="text-accent">{i + 1}</b> {t}</li>)}
        </ol>
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <li className="font-medium text-ink">Beli langsung dari luar</li>
          {['Dept mengajukan', 'Dept Head setuju', 'PR disetujui Logistik', 'Penawaran & pilih supplier', 'Buat PO', 'Barang tiba → diserahkan ke pemohon (tidak masuk stok)']
            .map((t, i) => <li key={t} className="rounded-full border border-line bg-panel px-2.5 py-1"><b className="text-accent">{i + 1}</b> {t}</li>)}
        </ol>
      </div>
      <div className="flex gap-3 text-sm">
        <Link href="/logistik/pengadaan" className={all ? 'text-muted' : 'font-medium text-accent'}>Masih berjalan</Link>
        <Link href="/logistik/pengadaan?semua=1" className={all ? 'font-medium text-accent' : 'text-muted'}>Semua</Link>
      </div>
      <Panel title="Purchase requisition (PR)">
        {prs?.length ? (
          <Table head={['Nomor', 'Asal', 'Keperluan', 'Penawaran', 'Dibutuhkan', 'Status']}>
            {prs.map(p => (
              <tr key={p.id}>
                <td className="whitespace-nowrap font-mono text-xs"><Link href={`/logistik/pengadaan/${p.id}`} className="font-medium hover:text-accent">{p.pr_no}</Link>
                  <div className="text-muted">{fmtDateTime(p.created_at)} · {p.requester_name}</div></td>
                <td className="text-xs"><Pill tone={PR_SOURCE[p.source][0]}>{PR_SOURCE[p.source][1]}</Pill>
                  <div className="mt-1 text-muted">{p.source === 'dept_direct' ? p.department_code : p.mr_id ? <Link href={`/logistik/mr/${p.mr_id}`} className="font-mono text-accent">{p.mr_no}</Link> : ''}</div></td>
                <td className="text-sm">{p.purpose}</td>
                <td className="tabular text-xs">{p.lines_quoted}/{p.lines} barang</td>
                <td className="text-xs">{fmtDate(p.need_date)}</td>
                <td><Pill tone={PR_STATUS[p.status][0]}>{PR_STATUS[p.status][1]}</Pill></td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Tidak ada PR.</p>}
      </Panel>
      <Panel title="Purchase order (PO)">
        {pos?.length ? (
          <Table head={['Nomor', 'Supplier', 'PR', 'Nilai', 'Estimasi tiba', 'Status']}>
            {pos.map(o => (
              <tr key={o.id}>
                <td className="whitespace-nowrap font-mono text-xs">{o.pr_id ? <Link href={`/logistik/pengadaan/${o.pr_id}`} className="font-medium hover:text-accent">{o.po_no}</Link> : o.po_no}
                  <div className="text-muted">{fmtDateTime(o.created_at)}</div></td>
                <td className="text-sm">{o.supplier_name}</td>
                <td className="font-mono text-xs">{o.pr_no ?? '–'}</td>
                <td className="tabular text-xs">{rp(o.total_value)}</td>
                <td className="text-xs">{fmtDate(o.expected_date)}</td>
                <td><Pill tone={PO_STATUS[o.status][0]}>{PO_STATUS[o.status][1]}</Pill></td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Tidak ada PO.</p>}
      </Panel>
      {myDepts.length > 0 && (
        <Panel title="Ajukan pembelian langsung" sub="Untuk barang atau jasa yang dibeli dari luar dan tidak diambil dari stok gudang. Untuk mengambil barang yang ada di stok, buat MR.">
          <ActionForm action={requestPurchase} label="Kirim permintaan pembelian" primary hidden={{ idem: randomUUID() }} className="max-w-4xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <DeptSelect depts={myDepts} value={myDepts.find(d => d.id === s.profile.department_id)?.id ?? (myDepts.length === 1 ? myDepts[0].id : null)} />
              <label className="grid gap-1 text-sm sm:col-span-1">Keperluan<input name="purpose" required className={input} placeholder="mis. Kursi ruang kerja plant" /></label>
              <label className="grid gap-1 text-sm">Dibutuhkan tanggal<input type="date" name="need_date" className={input} /></label>
            </div>
            <div className="grid gap-2">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="grid gap-2 sm:grid-cols-[3fr_1fr_1fr_1.5fr_2fr]">
                  <input type="hidden" name="row" value={i} />
                  <input name={`name_${i}`} className={input} placeholder={i === 0 ? 'Nama barang / jasa & spesifikasi' : '– (opsional)'} aria-label={`Barang ${i + 1}`} required={i === 0} />
                  <input type="number" name={`qty_${i}`} min={0.01} step="0.01" className={input} placeholder="Jumlah" aria-label={`Jumlah ${i + 1}`} required={i === 0} />
                  <input name={`uom_${i}`} className={input} placeholder="Satuan" aria-label={`Satuan ${i + 1}`} required={i === 0} />
                  <input type="number" name={`price_${i}`} min={0} step="1" className={input} placeholder="Perkiraan harga (Rp)" aria-label={`Perkiraan harga ${i + 1}`} />
                  <input name={`note_${i}`} className={input} placeholder="Merek / catatan" aria-label={`Catatan ${i + 1}`} />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">Disetujui Kepala Departemen Anda dulu, lalu diperiksa Logistik. Barang yang tiba tidak masuk stok; Anda diberi tahu untuk mengambilnya.</p>
          </ActionForm>
        </Panel>
      )}
      {buyer && (
        <Panel title="PR baru (isi ulang stok)" action={<Link href="/logistik/pengadaan?isi=minimum#pr-baru" className="text-sm text-accent">Isi otomatis dari stok minimum</Link>}>
          <ActionForm action={createPr} label="Kirim PR" primary hidden={{ idem: randomUUID() }} className="max-w-4xl">
            <div id="pr-baru" className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <label className="grid gap-1 text-sm">Keperluan<input name="purpose" required className={input}
                defaultValue={rows.length ? 'Isi ulang stok di bawah minimum' : ''} /></label>
              <label className="grid gap-1 text-sm">Dibutuhkan tanggal<input type="date" name="need_date" className={input} /></label>
            </div>
            {sp.isi === 'minimum' && !rows.length && <p className="text-sm text-ok">Semua stok di atas minimum.</p>}
            <div className="grid gap-2">
              {Array.from({ length: blank }, (_, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr]">
                  <input type="hidden" name="row" value={i} />
                  <select name={`material_${i}`} className={input} aria-label={`Barang ${i + 1}`} defaultValue={rows[i]?.m ?? ''} required={i === 0}>
                    <option value="">{i === 0 ? 'Pilih barang' : '– (opsional)'}</option>
                    {(stock ?? []).map(m => <option key={m.id} value={m.id}>{m.code} · {m.name} (stok {m.stock_qty}/{m.min_stock} {m.uom})</option>)}
                  </select>
                  <input type="number" name={`qty_${i}`} min={0.01} step="0.01" className={input} placeholder="Jumlah" defaultValue={rows[i]?.q ?? ''} required={i === 0} />
                  <input name={`note_${i}`} className={input} placeholder="Spesifikasi / part number" />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">PR untuk kekurangan MR dibuat dari halaman MR (tombol &quot;Buat PR dari kekurangan&quot;).</p>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
