import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { ROSTER } from '@/lib/hrga';
import { deletePolicy, savePolicy, setRoster } from '../actions';
import { fmtDate } from '@/lib/documents';
import { HrTabs } from '../tabs';
import { sheMasters, today } from '../../she/fields';

export const metadata = { title: 'Roster' };

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const CELL: Record<string, string> = { D: 'bg-accent/15', N: 'bg-accent/30', K: 'bg-accent/20', OFF: 'bg-line', CUTI: 'bg-ok/20', SAKIT: 'bg-crit/20', IZIN: 'bg-warn/20' };

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
  const [{ data: policies }, { data: soon }] = await Promise.all([
    supabase.from('roster_policy_view').select('id, scope, department_code, nrp, full_name, work_days, off_days, notice_days, max_concurrent_pct, cycle_anchor, note')
      .order('scope').returns<{ id: string; scope: string; department_code: string | null; nrp: string | null; full_name: string | null; work_days: number; off_days: number;
        notice_days: number; max_concurrent_pct: number; cycle_anchor: string | null; note: string | null }[]>(),
    supabase.rpc('upcoming_leave', { p_days: 30 }),
  ]);
  const upcoming = (soon ?? []) as { employee_id: string; nrp: string; full_name: string; department_code: string | null; start_date: string; end_date: string; days: number; starts_in: number; mine: boolean }[];
  const canPolicy = s.canIn('hr.roster', dept) || s.canIn('hr.manage', 'HRGA');
  const edit = s.canIn('hr.roster', dept) || s.canIn('hr.manage', 'HRGA');

  return (
    <>
      <PageHeader eyebrow="HRGA" title="Roster" />
      <HrTabs active="/hrga/roster" />
      <form className="flex flex-wrap gap-2">
        <select name="dept" defaultValue={dept} className={`${input} !w-auto`} aria-label="Departemen">{depts.map(d => <option key={d.id} value={d.code}>{d.code}</option>)}</select>
        <input type="date" name="dari" defaultValue={from} className={`${input} !w-auto`} aria-label="Mulai" />
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
      <Panel title="Cuti terjadwal (30 hari ke depan)" sub="Dari roster: kapan karyawan mulai cuti periodik atau cuti lain.">
        {upcoming.length ? (
          <ul className="grid gap-1 text-sm">
            {upcoming.map(u => (
              <li key={`${u.employee_id}${u.start_date}`} className="flex flex-wrap gap-x-3 rounded-lg border border-line px-3 py-2">
                <span className="font-medium">{u.full_name}</span><span className="font-mono text-xs text-muted">{u.nrp} {u.department_code}</span>
                <span className="tabular text-xs">{fmtDate(u.start_date)} s/d {fmtDate(u.end_date)} · {u.days} hari</span>
                <span className="text-xs text-muted">{u.starts_in <= 0 ? 'sedang berjalan' : `mulai ${u.starts_in} hari lagi`}</span>
              </li>))}
          </ul>
        ) : <p className="text-sm text-muted">Tidak ada cuti terjadwal di roster.</p>}
      </Panel>
      <Panel title="Pengaturan roster cuti periodik" sub="Aturan jeda kerja dan hari cuti bisa disesuaikan sesuai kesepakatan Dept Head dan HRGA. Urutan berlaku: karyawan, lalu departemen, lalu umum.">
        <ul className="mb-3 grid gap-2 text-sm">
          {(policies ?? []).map(p => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2">
              <span className="font-medium">{p.scope === 'Umum' ? 'Umum (semua)' : p.scope === 'Departemen' ? `Dept ${p.department_code}` : `${p.nrp} · ${p.full_name}`}</span>
              <span className="tabular text-xs">{p.work_days} hari kerja → {p.off_days} hari cuti · ajukan {p.notice_days} hari sebelumnya · maks {p.max_concurrent_pct}% cuti bersamaan</span>
              {p.cycle_anchor && <span className="text-xs text-muted">siklus mulai {fmtDate(p.cycle_anchor)}</span>}
              {p.note && <span className="text-xs text-muted">{p.note}</span>}
              {p.scope !== 'Umum' && canPolicy && <ActionForm action={deletePolicy} label="Hapus" hidden={{ id: p.id }} confirm="Hapus pengaturan ini?" />}
            </li>))}
        </ul>
        {canPolicy && (
          <ActionForm action={savePolicy} label="Simpan pengaturan" primary className="max-w-3xl sm:grid-cols-3 sm:items-end">
            <label className="grid gap-1 text-sm">Berlaku untuk
              <select name="department" defaultValue={deptId} className={input}>{s.can('hr.manage') && <option value="">Umum (semua departemen)</option>}{depts.map(d => <option key={d.id} value={d.id}>Departemen {d.code}</option>)}</select></label>
            <label className="grid gap-1 text-sm">Hanya karyawan (opsional)
              <select name="employee" defaultValue="" className={input}><option value="">– seluruh departemen –</option>{(emps ?? []).map(e => <option key={e.id} value={e.id}>{e.nrp} · {e.full_name}</option>)}</select></label>
            <label className="grid gap-1 text-sm">Hari kerja sebelum cuti<input type="number" name="work_days" required min={1} max={365} defaultValue={56} className={input} /></label>
            <label className="grid gap-1 text-sm">Hari cuti periodik<input type="number" name="off_days" required min={1} max={90} defaultValue={14} className={input} /></label>
            <label className="grid gap-1 text-sm">Ajukan paling lambat (hari)<input type="number" name="notice_days" min={0} max={90} defaultValue={14} className={input} /></label>
            <label className="grid gap-1 text-sm">Maks. cuti bersamaan (%)<input type="number" name="max_pct" min={0} max={100} defaultValue={20} className={input} /></label>
            <label className="grid gap-1 text-sm">Siklus mulai (opsional)<input type="date" name="anchor" className={input} /></label>
            <label className="grid gap-1 text-sm sm:col-span-2">Catatan kesepakatan<input name="note" placeholder="mis. disepakati Dept Head PRD dan HRGA" className={input} /></label>
          </ActionForm>
        )}
      </Panel>
    </>
  );
}
