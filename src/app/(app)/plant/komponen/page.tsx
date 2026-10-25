import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { ExportLinks } from '@/components/export-links';
import { PageHeader, Pager, Panel, Pill, Stat, Table, input, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { COMP_STATUS, COMP_TYPE, REMOVE_REASON, lifeTone } from '@/lib/plant';
import { PlantTabs } from '../tabs';
import { finishRebuild, installComponent, registerComponent, removeComponent, scrapComponent } from './actions';

export const metadata = { title: 'Umur komponen' };

type Comp = { id: string; comp_no: string; component_type: string; serial_no: string; brand: string | null; part_no: string | null; life_target_hm: number;
  rebuild_count: number; status: string; installed_unit_id: string | null; unit_no: string | null; position: string | null; life_hm: number; life_pct: number;
  remaining_hm: number; due: boolean; installed_unit_hm: number | null };
type Stat_ = { component_type: string; brand: string; removals: number; avg_run_hm: number; failures: number };

const n0 = (n: number | string) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 0 });

export default async function ComponentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const s = await getSession();
  const supabase = await createClient();
  let q = supabase.from('component_view').select('*').order('due', { ascending: false }).order('life_pct', { ascending: false });
  if (sp.status) q = q.eq('status', sp.status); else q = q.neq('status', 'scrapped');
  if (sp.jenis) q = q.eq('component_type', sp.jenis);
  const [{ data: comps }, { data: stats }, { data: units }] = await Promise.all([
    q.limit(2000).returns<Comp[]>(),
    supabase.from('component_life_stats').select('*').order('component_type').returns<Stat_[]>(),
    supabase.from('units').select('id, unit_no, current_hm').neq('status', 'retired').order('unit_no'),
  ]);
  const all = comps ?? [];
  const pg = paginate(all, sp.hal);
  const manage = s.can('plant.manage');
  const work = s.can('plant.work');
  const count = (st: string) => all.filter(c => c.status === st).length;

  return (
    <>
      <PageHeader eyebrow="SMKP 4.4 · Sarana & peralatan" title="Umur komponen">
        <span className="flex gap-3"><ExportLinks dataset="komponen" /><ExportLinks dataset="riwayat_komponen" /></span>
      </PageHeader>
      <PlantTabs active="/plant/komponen" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Terpasang" value={count('installed')} />
        <Stat label="Segera overhaul" value={all.filter(c => c.due && c.status !== 'rebuild').length} href="/plant/komponen" tone={all.some(c => c.due) ? 'warn' : 'ok'} note="Umur ≥ 90% target" />
        <Stat label="Sedang overhaul" value={count('rebuild')} href="/plant/komponen?status=rebuild" />
        <Stat label="Di stok" value={count('in_stock')} href="/plant/komponen?status=in_stock" />
      </div>
      <form className="flex flex-wrap gap-2">
        <select name="status" defaultValue={sp.status ?? ''} className={`${input} !w-auto`} aria-label="Status">
          <option value="">Aktif (tanpa yang dibuang)</option>{Object.entries(COMP_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="jenis" defaultValue={sp.jenis ?? ''} className={`${input} !w-auto`} aria-label="Jenis">
          <option value="">Semua jenis</option>{Object.entries(COMP_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="text-sm text-accent">Saring</button>
      </form>
      {all.length ? (
        <div className="grid gap-3">
          {pg.rows.map(c => (
            <div key={c.id} className="rounded-2xl border border-line bg-panel p-4 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid">
                  <span className="text-sm font-semibold">{COMP_TYPE[c.component_type]} · <span className="font-mono">{c.serial_no}</span></span>
                  <span className="font-mono text-xs text-muted">{c.comp_no}{c.brand ? ` · ${c.brand}` : ''}{c.part_no ? ` · ${c.part_no}` : ''}{c.rebuild_count ? ` · overhaul ${c.rebuild_count}x` : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  {c.status === 'installed' && c.installed_unit_id && (
                    <Link href={`/plant/${c.installed_unit_id}`} className="font-mono text-sm text-accent">{c.unit_no}{c.position ? ` · ${c.position}` : ''}</Link>
                  )}
                  <Pill tone={COMP_STATUS[c.status][0]}>{COMP_STATUS[c.status][1]}</Pill>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-3">
                <span className="h-2.5 rounded-full bg-line/60">
                  <span className={`block h-full rounded-full ${lifeTone(c.life_pct) === 'crit' ? 'bg-crit' : lifeTone(c.life_pct) === 'warn' ? 'bg-warn' : 'bg-ok'}`}
                    style={{ width: `${Math.min(100, c.life_pct)}%` }} />
                </span>
                <span className="tabular text-xs">{n0(c.life_hm)} / {n0(c.life_target_hm)} HM · sisa {n0(c.remaining_hm)}</span>
              </div>
              {(work || manage) && c.status !== 'scrapped' && (
                <details className="mt-3 border-t border-line pt-3">
                  <summary className="cursor-pointer text-sm text-accent">
                    {c.status === 'in_stock' ? 'Pasang ke unit' : c.status === 'installed' ? 'Lepas dari unit' : 'Selesaikan overhaul'}
                  </summary>
                  {c.status === 'in_stock' && work && (
                    <div className="mt-3 grid gap-4">
                      <ActionForm action={installComponent} label="Pasang" primary hidden={{ id: c.id }} className="sm:grid-cols-4 sm:items-end">
                        <label className="grid gap-1 text-xs">Unit<select name="unit" required className={input}><option value="">–</option>
                          {(units ?? []).map(u => <option key={u.id} value={u.id}>{u.unit_no} · {n0(u.current_hm)} HM</option>)}</select></label>
                        <label className="grid gap-1 text-xs">HM unit saat pasang<input type="number" name="hm" required min={0} step="0.1" className={input} /></label>
                        <label className="grid gap-1 text-xs">Posisi (bila lebih dari satu)<input name="position" className={input} placeholder="Kiri / Kanan / Depan" /></label>
                        <label className="grid gap-1 text-xs">Catatan<input name="note" className={input} /></label>
                      </ActionForm>
                      {manage && (
                        <ActionForm action={scrapComponent} label="Buang komponen" hidden={{ id: c.id }} className="sm:grid-cols-[1fr_auto] sm:items-end">
                          <input name="note" required className={input} placeholder="Alasan dibuang (mis. blok retak)" />
                        </ActionForm>
                      )}
                    </div>
                  )}
                  {c.status === 'installed' && work && (
                    <ActionForm action={removeComponent} label="Lepas" primary hidden={{ id: c.id }} className="mt-3 sm:grid-cols-4 sm:items-end">
                      <label className="grid gap-1 text-xs">HM unit saat lepas<input type="number" name="hm" required min={c.installed_unit_hm ?? 0} step="0.1" className={input} /></label>
                      <label className="grid gap-1 text-xs">Alasan<select name="reason" required className={input}><option value="">–</option>
                        {Object.entries(REMOVE_REASON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                      <label className="grid gap-1 text-xs">Setelah dilepas<select name="next" className={input}>
                        <option value="rebuild">Overhaul</option><option value="in_stock">Kembali ke stok</option><option value="scrap">Buang</option></select></label>
                      <label className="grid gap-1 text-xs">Catatan<input name="note" className={input} /></label>
                    </ActionForm>
                  )}
                  {c.status === 'rebuild' && manage && (
                    <ActionForm action={finishRebuild} label="Overhaul selesai" primary hidden={{ id: c.id }} className="mt-3 sm:grid-cols-4 sm:items-end">
                      <label className="grid gap-1 text-xs">Biaya overhaul (Rp)<input type="number" name="cost" min={0} className={input} /></label>
                      <label className="grid gap-1 text-xs">Target umur baru (HM)<input type="number" name="life_target" min={1} defaultValue={c.life_target_hm} className={input} /></label>
                      <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="reset" defaultChecked /> Hitung umur dari nol</label>
                      <label className="grid gap-1 text-xs">Catatan<input name="note" className={input} /></label>
                    </ActionForm>
                  )}
                </details>
              )}
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-muted">Belum ada komponen terdaftar.</p>}
      <Pager {...pg} params={sp} />
      {stats?.length ? (
        <Panel title="Jam pakai rata-rata per pemasangan" sub="Menurut jenis dan merek; dasar menilai kualitas suku cadang dan target umur.">
          <Table head={['Jenis', 'Merek', 'Dilepas', 'Rata-rata HM', 'Rusak']}>
            {stats.map(x => (
              <tr key={`${x.component_type}-${x.brand}`}>
                <td className="text-sm">{COMP_TYPE[x.component_type]}</td><td className="text-sm">{x.brand}</td>
                <td className="tabular text-xs">{x.removals}</td><td className="tabular text-xs">{n0(x.avg_run_hm)}</td><td className="tabular text-xs">{x.failures}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}
      {manage && (
        <Panel title="Daftarkan komponen" sub="Isi umur awal (HM) bila komponen bekas atau sudah pernah dipakai.">
          <ActionForm action={registerComponent} label="Daftarkan" primary className="max-w-4xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Jenis<select name="type" className={input}>{Object.entries(COMP_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="grid gap-1 text-sm">Nomor seri<input name="serial" required className={`${input} uppercase`} /></label>
              <label className="grid gap-1 text-sm">Merek<input name="brand" className={input} /></label>
              <label className="grid gap-1 text-sm">Part number<input name="part_no" className={input} /></label>
              <label className="grid gap-1 text-sm">Target umur (HM)<input type="number" name="life_target" required min={1} className={input} placeholder="15000" /></label>
              <label className="grid gap-1 text-sm">Umur awal (HM)<input type="number" name="initial_hm" min={0} defaultValue={0} className={input} /></label>
            </div>
            <label className="grid gap-1 text-sm">Catatan<input name="note" className={input} /></label>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
