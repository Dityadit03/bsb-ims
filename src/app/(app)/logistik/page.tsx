import { randomUUID } from 'node:crypto';
import { ExportLinks } from '@/components/export-links';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Stat, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { CATEGORY, qty, rp } from '@/lib/logistics';
import { issueFuel, opname, receiveGoods, saveLocation, saveMaterial, savePlanning } from './actions';
import { LogTabs } from './tabs';

export const metadata = { title: 'Logistik' };

type Row = { id: string; code: string; name: string; category: string; uom: string; min_stock: number; stock_qty: number;
  avg_cost: number; stock_value: number; low_stock: boolean; active: boolean; location: string | null };

type Plan = { material_id: string; critical: boolean; lead_time_days: number; daily_use: number; cover_days: number | null; reorder_point: number;
  suggested_qty: number; reorder_now: boolean; reserved_qty: number; abc: 'A' | 'B' | 'C'; on_order: number };

export default async function LogistikPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('material_stock').select('*').eq('active', true).order('code');
  if (sp.kategori) q = q.eq('category', sp.kategori);
  if (sp.rendah) q = q.eq('low_stock', true);
  const [{ data: plan }, { data: rows }, { data: suppliers }, { data: units }, { count: mrOpen }] = await Promise.all([
    supabase.from('stock_planning').select('*').returns<Plan[]>(),
    q.returns<Row[]>(),
    supabase.from('suppliers').select('id, code, name').eq('active', true).order('name'),
    supabase.from('units').select('id, unit_no, current_hm').neq('status', 'retired').order('unit_no'),
    supabase.from('material_requests').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
  ]);
  const pm = new Map((plan ?? []).map(p => [p.material_id, p]));
  const base = rows ?? [];
  const all = base.filter(r => (!sp.pesan || pm.get(r.id)?.reorder_now) && (!sp.kritis || pm.get(r.id)?.critical));
  const reorderCount = (plan ?? []).filter(p => p.reorder_now).length;
  const criticalLow = (plan ?? []).filter(p => p.critical && p.reorder_now).length;
  const term = (sp.q ?? '').toLowerCase();
  const shown = term ? all.filter(r => `${r.code} ${r.name} ${r.location ?? ''}`.toLowerCase().includes(term)) : all;
  const fuels = base.filter(r => r.category === 'fuel' || r.category === 'lubricant');
  const wh = s.canIn('log.warehouse', 'LOG');

  return (
    <>
      <PageHeader eyebrow="SMKP 4.6 · Sistem pembelian" title="Logistik"><ExportLinks dataset="stok" /></PageHeader>
      <LogTabs active="/logistik" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Jenis barang" value={base.length} />
        <Stat label="Perlu dipesan (ROP)" value={reorderCount} href="/logistik?pesan=1" tone={criticalLow ? 'crit' : reorderCount ? 'warn' : 'ok'}
          note={criticalLow ? `${criticalLow} suku cadang kritis` : `${base.filter(r => r.low_stock).length} di bawah stok minimum`} />
        <Stat label="Nilai persediaan" value={rp(base.reduce((t, r) => t + Number(r.stock_value), 0))} />
        <Stat label="MR siap dikeluarkan" value={mrOpen ?? 0} href="/logistik/mr?status=approved" />
      </div>
      <form className="flex flex-wrap gap-2">
        <input name="q" type="search" defaultValue={sp.q ?? ''} placeholder="Cari kode / nama / rak" className={`${input} !w-56`} />
        <select name="kategori" defaultValue={sp.kategori ?? ''} className={`${input} !w-auto`} aria-label="Kategori">
          <option value="">Semua kategori</option>{Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="rendah" value="1" defaultChecked={!!sp.rendah} /> Stok rendah</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="pesan" value="1" defaultChecked={!!sp.pesan} /> Perlu dipesan</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="kritis" value="1" defaultChecked={!!sp.kritis} /> Kritis</label>
        <button className="text-sm text-accent">Saring</button>
      </form>
      {shown.length ? (
        <Table head={['Kode', 'Nama', 'Rak', 'Stok', 'Hari cukup', 'ROP', 'Usulan pesan', 'ABC', 'Nilai']}>
          {shown.map(r => (
            <tr key={r.id}>
              <td className="font-mono text-xs">{r.code}</td>
              <td className="text-sm">{r.name}</td>
              <td className="font-mono text-xs">{r.location ?? <span className="text-muted">–</span>}<span className="block font-sans text-xs text-muted">{CATEGORY[r.category]}</span></td>
              <td className="tabular text-xs">{r.low_stock ? <Pill tone="crit">{qty(r.stock_qty)} {r.uom}</Pill> : `${qty(r.stock_qty)} ${r.uom}`}{Number(pm.get(r.id)?.reserved_qty) > 0 && <span className="block text-xs text-muted">dicadangkan {qty(pm.get(r.id)!.reserved_qty)}</span>}</td>
              <td className="tabular text-xs">{pm.get(r.id)?.cover_days != null ? `${pm.get(r.id)!.cover_days} hr` : '–'}</td>
              <td className="tabular text-xs">{qty(pm.get(r.id)?.reorder_point ?? r.min_stock)}</td>
              <td className="tabular text-xs">{pm.get(r.id)?.reorder_now ? <Pill tone={pm.get(r.id)!.critical ? 'crit' : 'warn'}>{qty(pm.get(r.id)!.suggested_qty)} {r.uom}</Pill> : (pm.get(r.id)?.on_order ? <span className="text-muted">PO {qty(pm.get(r.id)!.on_order)}</span> : '–')}</td>
              <td className="text-xs">{pm.get(r.id) ? <span className={pm.get(r.id)!.abc === 'A' ? 'font-semibold' : 'text-muted'}>{pm.get(r.id)!.abc}</span> : '–'}{pm.get(r.id)?.critical && <span title="Suku cadang kritis" className="ml-1 text-crit">●</span>}</td>
              <td className="tabular text-xs">{rp(r.stock_value)}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada barang.</p>}
      {wh && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Penerimaan barang (GR)">
            <ActionForm action={receiveGoods} label="Catat penerimaan" primary hidden={{ idem: randomUUID() }}>
              <select name="material" required className={input} aria-label="Barang">{base.map(m => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select>
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
              <select name="material" required className={input} aria-label="Barang">{base.map(m => <option key={m.id} value={m.id}>{m.code} · stok {qty(m.stock_qty)} {m.uom}</option>)}</select>
              <input type="number" name="counted" required min={0} step="0.01" className={input} placeholder="Jumlah fisik" />
              <input name="note" className={input} placeholder="Keterangan selisih (wajib bila berbeda)" />
            </ActionForm>
          </Panel>
        </div>
      )}
      {wh && (
        <Panel title="Perencanaan barang" sub="Lead time (hari dari pesan sampai barang datang) dan penanda suku cadang kritis (unit tidak bisa jalan tanpanya). ROP = pemakaian harian 90 hari × lead time + stok minimum.">
          <ActionForm action={savePlanning} label="Simpan perencanaan" className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
              <select name="material" required className={input} aria-label="Barang">{base.map(m => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select>
              <label className="grid gap-1 text-xs">Lead time (hari)<input type="number" name="lead" min={0} max={365} defaultValue={7} className={input} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="critical" /> Suku cadang kritis</label>
            </div>
          </ActionForm>
        </Panel>
      )}
      {wh && (
        <Panel title="Lokasi rak" sub="Kode rak / bin tempat barang disimpan, mis. R2-B03. Kosongkan untuk menghapus.">
          <ActionForm action={saveLocation} label="Simpan lokasi" className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-2">
              <select name="material" required className={input} aria-label="Barang">{base.map(m => <option key={m.id} value={m.id}>{m.code} · {m.name}{m.location ? ` (${m.location})` : ''}</option>)}</select>
              <input name="location" maxLength={24} className={`${input} uppercase`} placeholder="R2-B03" />
            </div>
          </ActionForm>
        </Panel>
      )}
      {s.canIn('log.manage', 'LOG') && (
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
