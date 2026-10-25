import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { ExportLinks } from '@/components/export-links';
import { PageHeader, Panel, Pill, Stat, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/documents';
import { LogTabs } from '../tabs';
import { dipTank, dispenseFuel, openTank, receiveFuel, saveTank } from './actions';

export const metadata = { title: 'Stasiun BBM' };

type Tank = { tank_id: string; code: string; name: string; active: boolean; material_name: string; capacity_l: number; level_l: number; opened: boolean; level_pct: number;
  last_dip_at: string | null; last_dip_variance: number | null; received_30d: number; issued_30d: number; days_cover: number | null };
type Log = { id: string; created_at: string; tank_code: string; kind: string; liters: number; level_after: number; movement_no: string | null; supplier_name: string | null;
  doc_ref: string | null; unit_no: string | null; hour_meter: number | null; note: string | null; by_name: string | null };
type Anom = { unit_id: string; unit_no: string; recent_l_per_hm: number; base_l_per_hm: number; deviation_pct: number; is_anomaly: boolean };
type Gap = { code: string; name: string; book_stock: number; tank_total: number; gap: number };

const KIND: Record<string, string> = { opening: 'Isi awal', receipt: 'Terima', issue: 'Keluar', dip: 'Ukur' };
const l0 = (n: number | string) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 1 });

export default async function FuelPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: tanks }, { data: logs }, { data: anom }, { data: gaps }, { data: suppliers }, { data: units }, { data: fuels }] = await Promise.all([
    supabase.from('fuel_tank_status').select('*').order('code').returns<Tank[]>(),
    supabase.from('fuel_tank_log_view').select('*').order('created_at', { ascending: false }).limit(40).returns<Log[]>(),
    supabase.from('fuel_anomaly').select('*').eq('is_anomaly', true).order('deviation_pct', { ascending: false }).returns<Anom[]>(),
    supabase.from('fuel_reconciliation').select('*').returns<Gap[]>(),
    supabase.from('suppliers').select('id, code, name').eq('active', true).order('name'),
    supabase.from('units').select('id, unit_no, current_hm').neq('status', 'retired').order('unit_no'),
    supabase.from('materials').select('id, code, name').eq('category', 'fuel').eq('active', true).order('code'),
  ]);
  const ts = (tanks ?? []).filter(t => t.active);
  const warehouse = s.can('log.warehouse');
  const manage = s.can('log.manage');
  const totalL = ts.reduce((t, x) => t + Number(x.level_l), 0);
  const issued = ts.reduce((t, x) => t + Number(x.issued_30d), 0);
  const gapBad = (gaps ?? []).filter(g => Math.abs(Number(g.gap)) >= 1);
  const tankOpts = ts.map(t => <option key={t.tank_id} value={t.tank_id}>{t.code} · {l0(t.level_l)} L</option>);

  return (
    <>
      <PageHeader eyebrow="Logistik · SMKP 4.6" title="Stasiun BBM">
        <span className="flex gap-3"><ExportLinks dataset="tangki_bbm" /><ExportLinks dataset="log_bbm" /><ExportLinks dataset="konsumsi_bbm" /></span>
      </PageHeader>
      <LogTabs active="/logistik/bbm" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Isi semua tangki" value={`${l0(totalL)} L`} />
        <Stat label="Keluar 30 hari" value={`${l0(issued)} L`} />
        <Stat label="Unit konsumsi tidak wajar" value={anom?.length ?? 0} tone={anom?.length ? 'warn' : 'ok'} note="L/HM 14 hari vs 90 hari" />
        <Stat label="Selisih buku vs tangki" value={gapBad.length ? `${l0(gapBad[0].gap)} L` : 'Cocok'} tone={gapBad.length ? 'crit' : 'ok'} note="Stok barang vs isi tangki" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {ts.map(t => (
          <div key={t.tank_id} className="rounded-2xl border border-line bg-panel p-4 shadow-soft">
            <div className="flex items-start justify-between gap-2">
              <div className="grid"><span className="text-sm font-semibold">{t.code} · {t.name}</span><span className="text-xs text-muted">{t.material_name} · kapasitas {l0(t.capacity_l)} L</span></div>
              {!t.opened ? <Pill tone="warn">Isi awal belum dicatat</Pill> : <Pill tone={Number(t.level_pct) < 15 ? 'crit' : Number(t.level_pct) < 30 ? 'warn' : 'ok'}>{t.level_pct}%</Pill>}
            </div>
            <div className="mt-2 h-3 rounded-full bg-line/60"><div className="h-full rounded-full bg-violet" style={{ width: `${Math.min(100, Number(t.level_pct))}%` }} /></div>
            <p className="mt-2 text-xs text-muted">
              Isi {l0(t.level_l)} L{t.days_cover != null && <> · cukup ±{l0(t.days_cover)} hari</>} · masuk {l0(t.received_30d)} L / keluar {l0(t.issued_30d)} L (30 hari)
              {t.last_dip_at && <> · ukur terakhir {fmtDateTime(t.last_dip_at)} (selisih {l0(t.last_dip_variance ?? 0)} L)</>}
            </p>
            {!t.opened && warehouse && (
              <ActionForm action={openTank} label="Catat isi awal" hidden={{ tank: t.tank_id }} className="mt-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <input type="number" name="liters" required min={0} step="0.1" className={input} placeholder="Liter hasil ukur" />
                <input name="note" className={input} placeholder="Catatan" />
              </ActionForm>
            )}
          </div>
        ))}
        {!ts.length && <p className="text-sm text-muted">Belum ada tangki. {manage ? 'Buat tangki di bagian bawah.' : 'Pengelola logistik perlu membuat tangki.'}</p>}
      </div>
      {anom?.length ? (
        <Panel title="Konsumsi BBM tidak wajar" sub="Liter per HM 14 hari terakhir melebihi rata-rata 90 hari sebelumnya. Periksa kebocoran, pengisian tidak tercatat, atau kondisi mesin.">
          <Table head={['Unit', '14 hari', '90 hari', 'Selisih']}>
            {anom.map(a => (
              <tr key={a.unit_id}>
                <td className="font-mono text-xs"><Link href={`/plant/${a.unit_id}`} className="hover:text-accent">{a.unit_no}</Link></td>
                <td className="tabular text-xs">{a.recent_l_per_hm} L/HM</td><td className="tabular text-xs">{a.base_l_per_hm} L/HM</td>
                <td><Pill tone="warn">+{a.deviation_pct}%</Pill></td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}
      {warehouse && ts.some(t => t.opened) && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Terima kiriman vendor" sub="Ukur tangki sebelum dan sesudah bongkar; selisih dengan surat jalan di atas toleransi wajib diberi catatan.">
            <ActionForm action={receiveFuel} label="Terima" primary>
              <select name="tank" required className={input} aria-label="Tangki"><option value="">Tangki</option>{tankOpts}</select>
              <select name="supplier" required className={input} aria-label="Supplier"><option value="">Supplier</option>{(suppliers ?? []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" name="liters" required min={1} step="0.1" className={input} placeholder="Liter (surat jalan)" />
                <input type="number" name="unit_cost" required min={0} step="0.01" className={input} placeholder="Harga / liter" />
                <input type="number" name="dip_before" min={0} step="0.1" className={input} placeholder="Ukur sebelum (L)" />
                <input type="number" name="dip_after" min={0} step="0.1" className={input} placeholder="Ukur sesudah (L)" />
              </div>
              <input name="doc_ref" required className={input} placeholder="No. surat jalan / DO" />
              <input name="note" className={input} placeholder="Catatan" />
            </ActionForm>
          </Panel>
          <Panel title="Keluarkan ke unit" sub="HM unit wajib dan tidak boleh mundur; masuk ke biaya BBM dan konsumsi L/HM unit.">
            <ActionForm action={dispenseFuel} label="Keluarkan" primary>
              <select name="tank" required className={input} aria-label="Tangki"><option value="">Tangki</option>{tankOpts}</select>
              <select name="unit" required className={input} aria-label="Unit"><option value="">Unit</option>{(units ?? []).map(u => <option key={u.id} value={u.id}>{u.unit_no} · {l0(u.current_hm)} HM</option>)}</select>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" name="liters" required min={1} step="0.1" className={input} placeholder="Liter" />
                <input type="number" name="hm" required min={0} step="0.1" className={input} placeholder="HM unit" />
              </div>
              <input name="note" className={input} placeholder="Catatan" />
            </ActionForm>
          </Panel>
          <Panel title="Ukur tangki (dipstick)" sub="Selisih dengan catatan sistem menyesuaikan isi tangki dan stok; keterangan wajib bila ada selisih.">
            <ActionForm action={dipTank} label="Catat hasil ukur" primary>
              <select name="tank" required className={input} aria-label="Tangki"><option value="">Tangki</option>{tankOpts}</select>
              <input type="number" name="measured" required min={0} step="0.1" className={input} placeholder="Hasil ukur (L)" />
              <input name="note" className={input} placeholder="Keterangan selisih (susut, kebocoran, salah catat)" />
            </ActionForm>
          </Panel>
        </div>
      )}
      <Panel title="Buku tangki terbaru">
        {logs?.length ? (
          <Table head={['Waktu', 'Tangki', 'Jenis', 'Liter', 'Isi sesudah', 'Keterangan']}>
            {logs.map(l => (
              <tr key={l.id}>
                <td className="text-xs">{fmtDateTime(l.created_at)}</td><td className="font-mono text-xs">{l.tank_code}</td>
                <td><Pill tone={l.kind === 'issue' ? 'accent' : l.kind === 'dip' ? 'warn' : 'ok'}>{KIND[l.kind]}</Pill></td>
                <td className="tabular text-xs">{Number(l.liters) > 0 ? '+' : ''}{l0(l.liters)}</td><td className="tabular text-xs">{l0(l.level_after)}</td>
                <td className="text-xs">{[l.movement_no, l.supplier_name, l.doc_ref, l.unit_no && `${l.unit_no}${l.hour_meter ? ` · ${l0(l.hour_meter)} HM` : ''}`, l.note].filter(Boolean).join(' · ') || '–'}</td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada transaksi tangki.</p>}
      </Panel>
      {manage && (
        <Panel title="Tangki" sub="Kode yang sudah ada diperbarui. Barang harus berkategori BBM di master barang.">
          <ActionForm action={saveTank} label="Simpan tangki" primary className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="grid gap-1 text-sm">Kode<input name="code" required className={`${input} uppercase`} placeholder="TK-01" /></label>
              <label className="grid gap-1 text-sm">Nama<input name="name" required className={input} /></label>
              <label className="grid gap-1 text-sm">BBM<select name="material" required className={input}><option value="">–</option>{(fuels ?? []).map(m => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select></label>
              <label className="grid gap-1 text-sm">Kapasitas (L)<input type="number" name="capacity" required min={1} className={input} /></label>
            </div>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
