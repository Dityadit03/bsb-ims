import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Stat, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { CATEGORY, qty, rp } from '@/lib/logistics';
import { issueFuel, opname, receiveGoods, saveMaterial } from './actions';
import { LogTabs } from './tabs';

export const metadata = { title: 'Logistik' };

type Row = { id: string; code: string; name: string; category: string; uom: string; min_stock: number; stock_qty: number;
  avg_cost: number; stock_value: number; low_stock: boolean; active: boolean };

export default async function LogistikPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('material_stock').select('*').eq('active', true).order('code');
  if (sp.kategori) q = q.eq('category', sp.kategori);
  if (sp.rendah) q = q.eq('low_stock', true);
  const [{ data: rows }, { data: suppliers }, { data: units }, { count: mrOpen }] = await Promise.all([
    q.returns<Row[]>(),
    supabase.from('suppliers').select('id, code, name').eq('active', true).order('name'),
    supabase.from('units').select('id, unit_no, current_hm').neq('status', 'retired').order('unit_no'),
    supabase.from('material_requests').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
  ]);
  const all = rows ?? [];
  const fuels = all.filter(r => r.category === 'fuel' || r.category === 'lubricant');
  const wh = s.can('log.warehouse');

  return (
    <>
      <PageHeader eyebrow="SMKP 4.6 · Sistem pembelian" title="Logistik" />
      <LogTabs active="/logistik" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Jenis barang" value={all.length} />
        <Stat label="Di bawah stok minimum" value={all.filter(r => r.low_stock).length} href="/logistik?rendah=1" />
        <Stat label="Nilai persediaan" value={rp(all.reduce((t, r) => t + Number(r.stock_value), 0))} />
        <Stat label="MR siap dikeluarkan" value={mrOpen ?? 0} href="/logistik/mr?status=approved" />
      </div>
      <form className="flex flex-wrap gap-2">
        <select name="kategori" defaultValue={sp.kategori ?? ''} className={`${input} w-auto`} aria-label="Kategori">
          <option value="">Semua kategori</option>{Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="rendah" value="1" defaultChecked={!!sp.rendah} /> Stok rendah saja</label>
        <button className="text-sm text-accent">Saring</button>
      </form>
      {all.length ? (
        <Table head={['Kode', 'Nama', 'Kategori', 'Stok', 'Minimum', 'Harga rata-rata', 'Nilai']}>
          {all.map(r => (
            <tr key={r.id}>
              <td className="font-mono text-xs">{r.code}</td>
              <td className="text-sm">{r.name}</td>
              <td className="text-xs">{CATEGORY[r.category]}</td>
              <td className="tabular text-xs">{r.low_stock ? <Pill tone="crit">{qty(r.stock_qty)} {r.uom}</Pill> : `${qty(r.stock_qty)} ${r.uom}`}</td>
              <td className="tabular text-xs">{qty(r.min_stock)}</td>
              <td className="tabular text-xs">{rp(r.avg_cost)}</td>
              <td className="tabular text-xs">{rp(r.stock_value)}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada barang.</p>}
      {wh && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Penerimaan barang (GR)">
            <ActionForm action={receiveGoods} label="Catat penerimaan" primary hidden={{ idem: randomUUID() }}>
              <select name="material" required className={input} aria-label="Barang">{all.map(m => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select>
              <select name="supplier" required className={input} aria-label="Supplier">{(suppliers ?? []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" name="qty" required min={0.01} step="0.01" className={input} placeholder="Jumlah" />
                <input type="number" name="cost" required min={0} className={input} placeholder="Harga satuan (Rp)" />
              </div>
              <input name="doc_ref" required className={input} placeholder="No. surat jalan / PO" />
            </ActionForm>
          </Panel>
          <Panel title="Pengisian BBM / oli ke unit">
            <ActionForm action={issueFuel} label="Catat pengisian" primary hidden={{ idem: randomUUID() }}>
              <select name="unit" required className={input} aria-label="Unit">{(units ?? []).map(u => <option key={u.id} value={u.id}>{u.unit_no} · HM {u.current_hm}</option>)}</select>
              <select name="material" required className={input} aria-label="BBM / oli">{fuels.map(m => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" name="qty" required min={0.1} step="0.1" className={input} placeholder="Liter" />
                <input type="number" name="hm" required min={0} step="0.1" className={input} placeholder="HM / KM" />
              </div>
              <input name="note" className={input} placeholder="Operator / catatan" />
            </ActionForm>
          </Panel>
          <Panel title="Stok opname">
            <ActionForm action={opname} label="Simpan hasil hitung">
              <select name="material" required className={input} aria-label="Barang">{all.map(m => <option key={m.id} value={m.id}>{m.code} · stok {qty(m.stock_qty)} {m.uom}</option>)}</select>
              <input type="number" name="counted" required min={0} step="0.01" className={input} placeholder="Jumlah fisik" />
              <input name="note" className={input} placeholder="Keterangan selisih (wajib bila berbeda)" />
            </ActionForm>
          </Panel>
        </div>
      )}
      {s.can('log.manage') && (
        <Panel title="Daftarkan / perbarui barang">
          <ActionForm action={saveMaterial} label="Simpan barang" className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <input name="code" required className={`${input} uppercase`} placeholder="Kode, mis. SP-FLT-01" />
              <input name="name" required className={input} placeholder="Nama barang" />
              <select name="category" className={input} aria-label="Kategori">{Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input name="uom" required className={input} placeholder="Satuan (pcs, L, set)" />
              <input type="number" name="min_stock" min={0} className={input} placeholder="Stok minimum" />
              <select name="active" className={input} aria-label="Aktif"><option value="true">Aktif</option><option value="false">Tidak aktif</option></select>
            </div>
            <p className="text-xs text-muted">Kode yang sudah ada akan diperbarui. Stok dan harga hanya berubah lewat penerimaan, pengeluaran dan opname.</p>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
