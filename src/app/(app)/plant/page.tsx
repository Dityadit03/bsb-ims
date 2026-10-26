import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Stat, Table, input, Pager, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { UNIT_STATUS, paTone } from '@/lib/plant';
import { UNIT_TYPE } from '@/lib/she';
import { saveUnit } from './actions';
import { PlantTabs } from './tabs';
import { DeptSelect, sheMasters } from '../she/fields';

export const metadata = { title: 'Unit' };

type Row = { unit_id: string; unit_no: string; unit_type: string; status: string; current_hm: number; ownership: string; breakdown_hours_30d: number; pa_30d: number };

export default async function PlantPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('unit_availability').select('*').order('unit_no');
  if (sp.status) q = q.eq('status', sp.status);
  if (sp.jenis) q = q.eq('unit_type', sp.jenis);
  const [{ data: rows }, { depts }, { count: woOpen }, { count: pmDue }, { data: stRows }] = await Promise.all([
    q.returns<Row[]>(), sheMasters(),
    supabase.from('work_orders').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress', 'waiting_part']),
    supabase.from('pm_due').select('*', { count: 'exact', head: true }).eq('wo_open', false),
    supabase.from('units').select('status').neq('status', 'retired').returns<{ status: string }[]>(),
  ]);
  const cnt = (st: string) => (stRows ?? []).filter(x => x.status === st).length;
  const ORDER: Record<string, number> = { breakdown: 0, ready: 1, standby: 2 };
  const all = [...(rows ?? [])].sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3) || a.unit_no.localeCompare(b.unit_no, 'id', { numeric: true }));
  const bd = all.filter(r => r.status === 'breakdown').length;
  const pa = all.length ? all.reduce((t, r) => t + Number(r.pa_30d), 0) / all.length : 0;
  const pg = paginate(all, sp.hal);
  const plt = depts.find(d => d.code === 'PLT')?.id;

  return (
    <>
      <PageHeader eyebrow="SMKP 4.4 · Sarana, prasarana, instalasi & peralatan" title="Unit & work order">
        <span className="flex items-center gap-3"><Link href="/plant/qr" className="text-sm text-accent">Stiker QR</Link><ExportLinks dataset="unit" /></span>
      </PageHeader>
      <PlantTabs active="/plant" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Unit aktif" value={all.length} />
        <Stat label="Breakdown sekarang" value={bd} href="/plant?status=breakdown" />
        <Stat label="WO terbuka" value={woOpen ?? 0} href="/plant/wo" />
        <Stat label="PA rata-rata 30 hari" value={`${pa.toFixed(1)}%`} note={`${pmDue ?? 0} PM jatuh tempo`} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {([['', 'Semua', (stRows ?? []).length], ['breakdown', 'Breakdown', cnt('breakdown')], ['ready', 'Siap', cnt('ready')], ['standby', 'Standby', cnt('standby')]] as const).map(([k, l, n]) => (
          <Link key={k} href={k ? `/plant?status=${k}${sp.jenis ? `&jenis=${sp.jenis}` : ''}` : `/plant${sp.jenis ? `?jenis=${sp.jenis}` : ''}`}
            className={`rounded-full border px-3 py-1 text-sm ${(sp.status ?? '') === k ? 'border-violet bg-violet/10 font-semibold text-violet' : 'border-line bg-panel text-muted hover:border-violet/50'}`}>
            {l} <span className="tabular text-xs">{n}</span>
          </Link>
        ))}
        <form className="ml-auto flex items-center gap-2">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <select name="jenis" defaultValue={sp.jenis ?? ''} className={`${input} !w-auto`} aria-label="Jenis">
            <option value="">Semua jenis</option>{Object.entries(UNIT_TYPE).map(([k, l]) => <option key={k} value={k}>{k} · {l}</option>)}
          </select>
          <button className="text-sm text-accent">Saring</button>
        </form>
      </div>
      {all.length ? (
        <Table head={['Unit', 'Jenis', 'HM', 'Kepemilikan', 'Breakdown 30 hari', 'PA 30 hari', 'Status']}>
          {pg.rows.map(r => (
            <tr key={r.unit_id}>
              <td className="font-mono text-xs"><Link href={`/plant/${r.unit_id}`} className="font-medium hover:text-accent">{r.unit_no}</Link></td>
              <td className="text-xs">{UNIT_TYPE[r.unit_type]}</td>
              <td className="tabular text-xs">{Number(r.current_hm).toLocaleString('id-ID')}</td>
              <td className="text-xs">{r.ownership === 'rental' ? 'Rental' : 'Milik'}</td>
              <td className="tabular text-xs">{r.breakdown_hours_30d} jam</td>
              <td><Pill tone={paTone(Number(r.pa_30d))}>{r.pa_30d}%</Pill></td>
              <td><Pill tone={UNIT_STATUS[r.status][0]}>{UNIT_STATUS[r.status][1]}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada unit terdaftar.</p>}
      <Pager {...pg} params={sp} />
      {s.can('plant.manage') && (
        <Panel title="Daftarkan / perbarui unit">
          <ActionForm action={saveUnit} label="Simpan unit" primary className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">No. lambung<input name="unit_no" required className={`${input} uppercase`} placeholder="DT-021" /></label>
              <label className="grid gap-1 text-sm">Jenis
                <select name="unit_type" className={input}>{Object.entries(UNIT_TYPE).map(([k, l]) => <option key={k} value={k}>{k} · {l}</option>)}</select>
              </label>
              <DeptSelect label="Departemen pengelola" depts={depts} value={plt} />
              <label className="grid gap-1 text-sm">Merek<input name="brand" className={input} /></label>
              <label className="grid gap-1 text-sm">Model<input name="model" className={input} /></label>
              <label className="grid gap-1 text-sm">Tahun<input type="number" name="year" min={1980} max={2100} className={input} /></label>
              <label className="grid gap-1 text-sm">No. seri / rangka<input name="serial" className={input} /></label>
              <label className="grid gap-1 text-sm">Kepemilikan<select name="ownership" className={input}><option value="owned">Milik</option><option value="rental">Rental</option></select></label>
              <label className="grid gap-1 text-sm">Vendor (jika rental)<input name="vendor" className={input} /></label>
              <label className="grid gap-1 text-sm">HM / KM saat ini<input type="number" name="hm" min={0} step="0.1" className={input} /></label>
            </div>
            <label className="grid gap-1 text-sm">Catatan<input name="note" className={input} /></label>
            <p className="text-xs text-muted">No. lambung yang sudah ada akan diperbarui datanya. HM tidak bisa diturunkan.</p>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
