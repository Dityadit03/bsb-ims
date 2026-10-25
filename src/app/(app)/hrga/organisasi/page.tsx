import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Stat, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { LEVEL } from '@/lib/hrga';
import { setMpp } from '../actions';
import { HrTabs } from '../tabs';

export const metadata = { title: 'Organisasi & MPP' };

type Emp = { id: string; nrp: string; full_name: string; supervisor_id: string | null; department_id: string; positions: { name: string; level: string } | null };
type Gap = { year: number; position_id: string; position_code: string; position_name: string; level: string; department_code: string | null;
  planned: number; actual: number; gap: number; note: string | null };

function Tree({ id, byBoss, emps, depth = 0 }: { id: string; byBoss: Map<string | null, Emp[]>; emps: Map<string, Emp>; depth?: number }) {
  const e = emps.get(id)!;
  const kids = byBoss.get(id) ?? [];
  return (
    <li className={depth ? 'border-l border-line pl-4' : ''}>
      <Link href={`/hrga/${e.id}`} className="inline-flex flex-wrap items-baseline gap-x-2 rounded-lg px-2 py-1 hover:bg-ground">
        <span className="text-sm font-semibold">{e.full_name}</span>
        <span className="text-xs text-muted">{e.positions?.name ?? '–'}</span>
        {kids.length > 0 && <span className="text-[11px] text-violet">{kids.length} bawahan</span>}
      </Link>
      {kids.length > 0 && depth < 6 && <ul className="ml-2 grid gap-0.5">{kids.map(k => <Tree key={k.id} id={k.id} byBoss={byBoss} emps={emps} depth={depth + 1} />)}</ul>}
    </li>
  );
}

export default async function OrgPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const year = Number(sp.tahun ?? new Date(Date.now() + 8 * 3600e3).getUTCFullYear());
  const supabase = await createClient();
  const [{ data: emps }, { data: depts }, { data: gap }, { data: positions }] = await Promise.all([
    supabase.from('employees').select('id, nrp, full_name, supervisor_id, department_id, positions(name, level)').eq('status', 'active').order('full_name').limit(5000).returns<Emp[]>(),
    supabase.from('departments').select('id, code, name').eq('active', true).order('sort_order'),
    supabase.from('manpower_gap').select('*').eq('year', year).order('department_code').order('position_name').returns<Gap[]>(),
    supabase.from('positions').select('id, name, department_id').eq('active', true).order('name'),
  ]);
  const map = new Map((emps ?? []).map(e => [e.id, e]));
  const byBoss = new Map<string | null, Emp[]>();
  for (const e of emps ?? []) {
    const k = e.supervisor_id && map.has(e.supervisor_id) ? e.supervisor_id : null;
    byBoss.set(k, [...(byBoss.get(k) ?? []), e]);
  }
  const rank = (e: Emp) => Object.keys(LEVEL).indexOf(e.positions?.level ?? 'OPR');
  const tops = (byBoss.get(null) ?? []).filter(e => (byBoss.get(e.id) ?? []).length > 0).sort((a, b) => rank(a) - rank(b));
  const noBoss = (byBoss.get(null) ?? []).filter(e => !(byBoss.get(e.id) ?? []).length);
  const planned = (gap ?? []).reduce((t, g) => t + g.planned, 0);
  const actual = (gap ?? []).filter(g => g.planned > 0).reduce((t, g) => t + g.actual, 0);
  const short = (gap ?? []).filter(g => g.gap < 0).reduce((t, g) => t - g.gap, 0);

  return (
    <>
      <PageHeader eyebrow="Struktur organisasi & manpower planning" title="Organisasi & MPP" />
      <HrTabs active="/hrga/organisasi" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`MPP ${year}`} value={planned} note="posisi direncanakan" />
        <Stat label="Terisi" value={actual} note={planned ? `${Math.round((actual / planned) * 100)}% dari MPP` : undefined} />
        <Stat label="Kekurangan" value={short} tone={short ? 'warn' : 'ok'} note="perlu rekrutmen / mutasi" />
        <Stat label="Belum punya atasan" value={noBoss.length} tone={noBoss.length ? 'warn' : undefined} note="isi di profil karyawan" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Manpower planning ${year}`} sub="Aktual = karyawan aktif saat ini per jabatan"
          action={<form className="flex gap-1"><input name="tahun" type="number" defaultValue={year} className={`${input} !w-24`} aria-label="Tahun" /><button className="text-xs text-accent">Lihat</button></form>}>
          {gap?.length ? (
            <Table head={['Dept', 'Jabatan', 'MPP', 'Aktual', 'Selisih']}>
              {gap.map(g => (
                <tr key={g.position_id}>
                  <td className="font-mono text-xs">{g.department_code ?? '–'}</td>
                  <td className="text-sm">{g.position_name}{g.note && <div className="text-xs text-muted">{g.note}</div>}</td>
                  <td className="tabular text-sm">{g.planned}</td>
                  <td className="tabular text-sm">{g.actual}</td>
                  <td>{g.planned ? <Pill tone={g.gap < 0 ? 'crit' : g.gap > 0 ? 'warn' : 'ok'}>{g.gap > 0 ? `+${g.gap}` : g.gap}</Pill> : <span className="text-xs text-muted">tanpa MPP</span>}</td>
                </tr>
              ))}
            </Table>
          ) : <p className="text-sm text-muted">Belum ada MPP untuk tahun ini.</p>}
          {s.canIn('hr.manage', 'HRGA') && (
            <ActionForm action={setMpp} label="Simpan MPP" hidden={{ year: String(year) }}>
              <div className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr]">
                <select name="position" required className={input} aria-label="Jabatan">{(positions ?? []).map(p => <option key={p.id} value={p.id}>{p.name} ({(depts ?? []).find(d => d.id === p.department_id)?.code ?? 'semua'})</option>)}</select>
                <input type="number" name="planned" min={0} required className={input} placeholder="Jumlah" />
                <input name="note" className={input} placeholder="Catatan (mis. tambahan 2 DT baru)" />
              </div>
            </ActionForm>
          )}
        </Panel>
        <Panel title="Struktur organisasi" sub="Disusun dari atasan langsung setiap karyawan">
          {tops.length ? <ul className="grid gap-2">{tops.map(t => <Tree key={t.id} id={t.id} byBoss={byBoss} emps={map} />)}</ul>
            : <p className="text-sm text-muted">Isi atasan langsung di profil karyawan (tab Ringkasan → Ubah data organisasi) agar struktur tampil.</p>}
          {noBoss.length > 0 && tops.length > 0 && <p className="text-xs text-muted">{noBoss.length} karyawan belum punya atasan dan bawahan.</p>}
        </Panel>
      </div>
    </>
  );
}
