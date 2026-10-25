import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Pager, Panel, Pill, Stat, Table, input, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { rp } from '@/lib/plant';
import { PlantTabs } from '../tabs';
import { finishRetread, installTyre, measureTyre, registerTyre, removeTyre } from './actions';

export const metadata = { title: 'Manajemen ban' };

type Tyre = { tyre_id: string; tyre_no: string; serial_no: string; size: string; brand: string | null; pattern: string | null; status: string; position: string | null;
  retread_count: number; unit_id: string | null; unit_no: string | null; otd_mm: number; min_tread_mm: number; last_rtd_mm: number | null; last_psi: number | null;
  last_measured_at: string | null; total_cost: number; run_hm: number; usable_pct: number | null; wear_mm_per_1000hm: number | null; cost_per_hm: number | null; alert: string | null };

const STATUS: Record<string, ['ok' | 'warn' | 'crit' | 'muted', string]> = {
  in_stock: ['muted', 'Di stok'], installed: ['ok', 'Terpasang'], repair: ['warn', 'Vulkanisir'], scrapped: ['muted', 'Dibuang'],
};
const ALERT: Record<string, ['ok' | 'warn' | 'crit', string]> = { replace: ['crit', 'Ganti sekarang'], soon: ['warn', 'Segera ganti'], measure: ['warn', 'Perlu diukur'], ok: ['ok', 'Baik'] };
const REASON: Record<string, string> = { worn: 'Aus habis', puncture: 'Tertusuk / bocor', sidewall: 'Sobek dinding', blowout: 'Pecah', heat: 'Panas berlebih', separation: 'Terkelupas', other: 'Lainnya' };
const n0 = (n: number | string | null) => (n == null ? '–' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: 0 }));

export default async function TyrePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const s = await getSession();
  const supabase = await createClient();
  let q = supabase.from('tyre_status').select('*').order('tyre_no');
  if (sp.status) q = q.eq('status', sp.status); else q = q.neq('status', 'scrapped');
  if (sp.alert) q = q.in('alert', sp.alert.split(','));
  const [{ data: rows }, { data: units }, { data: allRows }] = await Promise.all([
    q.limit(2000).returns<Tyre[]>(),
    supabase.from('units').select('id, unit_no, current_hm').neq('status', 'retired').order('unit_no'),
    supabase.from('tyre_status').select('status, alert').neq('status', 'scrapped').returns<{ status: string; alert: string | null }[]>(),
  ]);
  // yang paling mendesak di atas
  const rank = (t: Tyre) => (t.alert === 'replace' ? 0 : t.alert === 'soon' ? 1 : t.alert === 'measure' ? 2 : 3);
  const list = [...(rows ?? [])].sort((a, b) => rank(a) - rank(b) || a.tyre_no.localeCompare(b.tyre_no));
  const pg = paginate(list, sp.hal);
  const a = allRows ?? [];
  const manage = s.can('plant.manage');
  const work = s.can('plant.work');
  const measure = work || s.can('plant.report');

  return (
    <>
      <PageHeader eyebrow="SMKP 4.4 · Sarana & peralatan" title="Manajemen ban" />
      <PlantTabs active="/plant/ban" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Terpasang" value={a.filter(x => x.status === 'installed').length} href="/plant/ban?status=installed" />
        <Stat label="Ganti sekarang / segera" value={a.filter(x => x.alert === 'replace' || x.alert === 'soon').length} href="/plant/ban?alert=replace,soon"
          tone={a.some(x => x.alert === 'replace') ? 'crit' : a.some(x => x.alert === 'soon') ? 'warn' : 'ok'} note="Alur mendekati batas buang" />
        <Stat label="Perlu diukur" value={a.filter(x => x.alert === 'measure').length} href="/plant/ban?alert=measure" tone={a.some(x => x.alert === 'measure') ? 'warn' : 'ok'} note="Belum diukur > 14 hari" />
        <Stat label="Di stok / vulkanisir" value={`${a.filter(x => x.status === 'in_stock').length} / ${a.filter(x => x.status === 'repair').length}`} href="/plant/ban?status=in_stock" />
      </div>
      <form className="flex flex-wrap items-center gap-2">
        <select name="status" defaultValue={sp.status ?? ''} className={`${input} !w-auto`} aria-label="Status">
          <option value="">Semua (tanpa yang dibuang)</option>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="text-sm text-accent">Saring</button>
      </form>
      {list.length ? (
        <div className="grid gap-3">
          {pg.rows.map(t => (
            <div key={t.tyre_id} className="rounded-xl border border-line bg-panel p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-mono text-sm font-semibold">{t.tyre_no}</span>
                <span className="text-xs text-muted">{t.brand ?? '–'} {t.pattern ?? ''} · {t.size} · seri {t.serial_no}</span>
                <Pill tone={STATUS[t.status][0]}>{STATUS[t.status][1]}</Pill>
                {t.alert && t.alert !== 'ok' && <Pill tone={ALERT[t.alert][0]}>{ALERT[t.alert][1]}</Pill>}
                {t.unit_no && <Link href={`/plant/${t.unit_id}`} className="text-sm font-medium hover:text-accent">{t.unit_no} · posisi {t.position}</Link>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                <div><div className="text-xs text-muted">Sisa alur</div>
                  <div className="tabular font-medium">{t.last_rtd_mm ?? '–'} mm <span className="text-xs text-muted">(batas {t.min_tread_mm})</span></div>
                  {t.usable_pct != null && (
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ground"><div className={`h-full ${t.usable_pct < 15 ? 'bg-crit' : t.usable_pct < 35 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${t.usable_pct}%` }} /></div>
                  )}</div>
                <div><div className="text-xs text-muted">Umur pakai</div><div className="tabular font-medium">{n0(t.run_hm)} HM</div></div>
                <div><div className="text-xs text-muted">Laju aus</div><div className="tabular font-medium">{t.wear_mm_per_1000hm ?? '–'} mm / 1.000 HM</div></div>
                <div><div className="text-xs text-muted">Biaya per HM</div><div className="tabular font-medium">{t.cost_per_hm != null ? rp(t.cost_per_hm) : '–'}</div></div>
                <div><div className="text-xs text-muted">Vulkanisir</div><div className="tabular font-medium">{t.retread_count}×</div></div>
              </div>
              {((t.status === 'installed' && (measure || work)) || (t.status === 'in_stock' && work) || (t.status === 'repair' && manage)) && (
                <details className="mt-3 border-t border-line pt-3">
                  <summary className="cursor-pointer text-sm text-accent">Tindakan</summary>
                  {t.status === 'in_stock' && work && (
                    <ActionForm action={installTyre} label="Pasang di unit" primary hidden={{ id: t.tyre_id }} className="mt-3 sm:grid-cols-5 sm:items-end">
                      <label className="grid gap-1 text-xs">Unit<select name="unit" required className={input}>
                        <option value="">–</option>{(units ?? []).map(u => <option key={u.id} value={u.id}>{u.unit_no} · HM {n0(u.current_hm)}</option>)}</select></label>
                      <label className="grid gap-1 text-xs">Posisi (mis. 1L, 2RO)<input name="position" required maxLength={4} className={`${input} uppercase`} /></label>
                      <label className="grid gap-1 text-xs">HM unit saat pasang<input type="number" name="hm" required min={0} step="0.1" className={input} /></label>
                      <label className="grid gap-1 text-xs">Alur (mm)<input type="number" name="rtd" min={0} step="0.1" defaultValue={t.last_rtd_mm ?? ''} className={input} /></label>
                      <label className="grid gap-1 text-xs">Tekanan (psi)<input type="number" name="psi" min={0} className={input} /></label>
                    </ActionForm>
                  )}
                  {t.status === 'installed' && measure && (
                    <ActionForm action={measureTyre} label="Simpan pengukuran" hidden={{ id: t.tyre_id }} className="mt-3 sm:grid-cols-4 sm:items-end">
                      <label className="grid gap-1 text-xs">Alur terukur (mm)<input type="number" name="rtd" required min={0} max={t.otd_mm} step="0.1" className={input} /></label>
                      <label className="grid gap-1 text-xs">Tekanan (psi)<input type="number" name="psi" min={0} className={input} /></label>
                      <label className="grid gap-1 text-xs sm:col-span-2">Catatan<input name="note" className={input} placeholder="mis. aus tidak rata sisi dalam" /></label>
                    </ActionForm>
                  )}
                  {t.status === 'installed' && work && (
                    <ActionForm action={removeTyre} label="Lepas ban" primary hidden={{ id: t.tyre_id }} className="mt-3 sm:grid-cols-5 sm:items-end">
                      <label className="grid gap-1 text-xs">HM unit saat lepas<input type="number" name="hm" required min={0} step="0.1" className={input} /></label>
                      <label className="grid gap-1 text-xs">Alur saat lepas (mm)<input type="number" name="rtd" required min={0} max={t.otd_mm} step="0.1" className={input} /></label>
                      <label className="grid gap-1 text-xs">Alasan<select name="reason" required className={input}><option value="">–</option>
                        {Object.entries(REASON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                      <label className="grid gap-1 text-xs">Setelah dilepas<select name="next" className={input}>
                        <option value="in_stock">Kembali ke stok</option><option value="repair">Vulkanisir</option><option value="scrap">Buang</option></select></label>
                      <label className="grid gap-1 text-xs">Catatan<input name="note" className={input} /></label>
                    </ActionForm>
                  )}
                  {t.status === 'repair' && manage && (
                    <ActionForm action={finishRetread} label="Vulkanisir selesai" primary hidden={{ id: t.tyre_id }} className="mt-3 sm:grid-cols-4 sm:items-end">
                      <label className="grid gap-1 text-xs">Biaya (Rp)<input type="number" name="cost" required min={0} className={input} /></label>
                      <label className="grid gap-1 text-xs">Alur baru (mm)<input type="number" name="otd" min={0} step="0.1" defaultValue={t.otd_mm} className={input} /></label>
                      <label className="grid gap-1 text-xs sm:col-span-2">Catatan<input name="note" className={input} /></label>
                    </ActionForm>
                  )}
                </details>
              )}
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-muted">Belum ada ban terdaftar.</p>}
      <Pager {...pg} params={sp} />
      {manage && (
        <Panel title="Daftarkan ban" sub="Isi umur awal (HM) bila ban bekas. Alur baru dan batas buang dipakai menghitung sisa alur dan laju aus.">
          <ActionForm action={registerTyre} label="Daftarkan" primary className="max-w-4xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Nomor seri<input name="serial" required className={`${input} uppercase`} /></label>
              <label className="grid gap-1 text-sm">Merek<input name="brand" className={input} placeholder="Bridgestone" /></label>
              <label className="grid gap-1 text-sm">Pola<input name="pattern" className={input} placeholder="L317" /></label>
              <label className="grid gap-1 text-sm">Ukuran<input name="size" defaultValue="11.00-20" className={input} /></label>
              <label className="grid gap-1 text-sm">Harga beli (Rp)<input type="number" name="cost" min={0} className={input} /></label>
              <label className="grid gap-1 text-sm">Umur awal (HM)<input type="number" name="initial_hm" min={0} defaultValue={0} className={input} /></label>
              <label className="grid gap-1 text-sm">Alur baru (mm)<input type="number" name="otd" min={1} step="0.1" defaultValue={20} className={input} /></label>
              <label className="grid gap-1 text-sm">Batas buang (mm)<input type="number" name="min_tread" min={0} step="0.1" defaultValue={3} className={input} /></label>
            </div>
            <label className="grid gap-1 text-sm">Catatan<input name="note" className={input} /></label>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
