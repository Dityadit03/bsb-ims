import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { ROSTER } from '@/lib/hrga';
import { setRoster } from '../actions';
import { HrTabs } from '../tabs';
import { sheMasters, today } from '../../she/fields';

export const metadata = { title: 'Roster' };

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const CELL: Record<string, string> = { D: 'bg-accent/15', N: 'bg-accent/30', OFF: 'bg-line', CUTI: 'bg-ok/20', SAKIT: 'bg-crit/20', IZIN: 'bg-warn/20' };

export default async function RosterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const { depts } = await sheMasters();
  const dept = sp.dept ?? depts.find(d => d.id === s.profile.department_id)?.code ?? 'PRD';
  const deptId = depts.find(d => d.code === dept)?.id ?? '';
  const from = sp.dari ?? today();
  const days = Array.from({ length: 14 }, (_, i) => addDays(from, i));
  const { data: emps } = await supabase.from('employees').select('id, nrp, full_name').eq('status', 'active').eq('department_id', deptId).order('full_name');
  const ids = (emps ?? []).map(e => e.id);
  const { data: entries } = ids.length
    ? await supabase.from('roster_entries').select('employee_id, work_date, code').in('employee_id', ids).gte('work_date', days[0]).lte('work_date', days[13])
    : { data: [] };
  const cell = new Map((entries ?? []).map(e => [`${e.employee_id}:${e.work_date}`, e.code as string]));
  const edit = s.canIn('hr.roster', dept) || s.canIn('hr.manage', 'HRGA');

  return (
    <>
      <PageHeader eyebrow="HRGA" title="Roster" />
      <HrTabs active="/hrga/roster" />
      <form className="flex flex-wrap gap-2">
        <select name="dept" defaultValue={dept} className={`${input} w-auto`} aria-label="Departemen">{depts.map(d => <option key={d.id} value={d.code}>{d.code}</option>)}</select>
        <input type="date" name="dari" defaultValue={from} className={`${input} w-auto`} aria-label="Mulai" />
        <button className="text-sm text-accent">Tampilkan</button>
      </form>
      {emps?.length ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="text-xs">
            <thead><tr><th className="p-2 text-left">Karyawan</th>{days.map(d => <th key={d} className="p-1 font-normal text-muted">{d.slice(8)}/{d.slice(5, 7)}</th>)}</tr></thead>
            <tbody>{emps.map(e => (
              <tr key={e.id} className="border-t border-line">
                <td className="whitespace-nowrap p-2">{e.full_name} <span className="font-mono text-muted">{e.nrp}</span></td>
                {days.map(d => { const c = cell.get(`${e.id}:${d}`); return <td key={d} className={`p-1 text-center ${c ? CELL[c] : ''}`}>{c ?? ''}</td>; })}
              </tr>))}</tbody>
          </table>
        </div>
      ) : <p className="text-sm text-muted">Belum ada karyawan aktif di departemen ini.</p>}
      <p className="text-xs text-muted">{Object.entries(ROSTER).map(([k, [, l]]) => `${k} = ${l}`).join(' · ')}</p>
      {edit && emps?.length ? (
        <Panel title="Atur roster">
          <ActionForm action={setRoster} label="Simpan roster" primary className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Dari<input type="date" name="from" required defaultValue={from} className={input} /></label>
              <label className="grid gap-1 text-sm">Sampai<input type="date" name="to" required defaultValue={days[6]} className={input} /></label>
              <label className="grid gap-1 text-sm">Kode<select name="code" className={input}>{Object.entries(ROSTER).map(([k, [, l]]) => <option key={k} value={k}>{k} · {l}</option>)}</select></label>
            </div>
            <label className="grid gap-1 text-sm">Karyawan (tahan Ctrl / ⌘ untuk memilih banyak)
              <select name="employees" multiple required size={8} className={input}>{emps.map(e => <option key={e.id} value={e.id}>{e.nrp} · {e.full_name}</option>)}</select></label>
          </ActionForm>
        </Panel>
      ) : null}
    </>
  );
}
