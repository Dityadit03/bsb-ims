import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { ExportLinks } from '@/components/export-links';
import { Tabs } from '@/components/tabs';
import { PageHeader, Pager, Panel, Pill, Stat, Table, input, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { siteToday } from '@/lib/hrga';
import { EmployeeDatalist, EmployeeInput } from '../../she/fields';
import { LeaveForm } from '../time-forms';
import { adjustLeave } from '../waktu-actions';
import { LeaveTable, type LeaveRow } from '../time-tables';
import { HrTabs } from '../tabs';

export const metadata = { title: 'Cuti & izin' };

type Bal = { employee_id: string; nrp: string; full_name: string; department_code: string; leave_type: string; leave_name: string; quota: number;
  adjustment: number; used: number; pending: number; available: number };

export default async function CutiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const isHr = session.canIn('hr.manage', 'HRGA');
  const supabase = await createClient();
  const tab = sp.tab === 'saldo' ? 'saldo' : 'pengajuan';
  const year = Number(siteToday().slice(0, 4));

  const [{ data: reqs }, { data: bal }] = await Promise.all([
    supabase.from('leave_register').select('*').gte('end_date', `${year - 1}-01-01`).order('created_at', { ascending: false }).limit(3000).returns<LeaveRow[]>(),
    tab === 'saldo' ? supabase.from('leave_balance').select('*').order('full_name').limit(5000).returns<Bal[]>() : Promise.resolve({ data: [] as Bal[] }),
  ]);
  const all = reqs ?? [];
  const status = sp.status ?? 'open';
  let rows = status === 'open' ? all.filter(r => r.status === 'submitted' || r.status === 'approved_1') : status === 'all' ? all : all.filter(r => r.status === status);
  if (sp.dept) rows = rows.filter(r => r.department_code === sp.dept);
  const pg = paginate(rows, sp.hal);
  const today = siteToday();
  const onLeave = all.filter(r => r.status === 'approved' && r.start_date <= today && r.end_date >= today);
  const depts = [...new Set(all.map(r => r.department_code))].sort();

  return (
    <>
      <PageHeader eyebrow="Time management" title="Cuti & izin"><ExportLinks dataset="cuti" /></PageHeader>
      <HrTabs active="/hrga/cuti" />
      <Tabs items={[['/hrga/cuti', 'Pengajuan'], ['/hrga/cuti?tab=saldo', 'Saldo cuti']]} active={tab === 'saldo' ? '/hrga/cuti?tab=saldo' : '/hrga/cuti'} />
      {tab === 'pengajuan' ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Perlu keputusan Anda" value={all.filter(r => r.can_decide).length} tone={all.some(r => r.can_decide) ? 'warn' : undefined} />
            <Stat label="Menunggu atasan" value={all.filter(r => r.status === 'submitted').length} />
            <Stat label="Menunggu HRGA" value={all.filter(r => r.status === 'approved_1').length} />
            <Stat label="Sedang cuti hari ini" value={onLeave.length} note={onLeave.slice(0, 3).map(r => r.full_name.split(' ')[0]).join(', ')} />
          </div>
          <Panel title="Daftar pengajuan" action={
            <form className="flex flex-wrap gap-2">
              <select aria-label="Status" name="status" defaultValue={status} className={`${input} max-w-44`}>
                <option value="open">Belum selesai</option><option value="approved">Disetujui</option><option value="rejected">Ditolak</option>
                <option value="cancelled">Batal</option><option value="all">Semua</option></select>
              <select aria-label="Departemen" name="dept" defaultValue={sp.dept ?? ''} className={`${input} max-w-32`}><option value="">Semua dept</option>{depts.map(d => <option key={d}>{d}</option>)}</select>
              <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Saring</button>
            </form>}>
            {rows.length ? <><LeaveTable rows={pg.rows} cancel={isHr ? 'hr' : undefined} /><Pager {...pg} params={{ status, dept: sp.dept }} /></>
              : <p className="text-sm text-muted">Tidak ada pengajuan.</p>}
          </Panel>
          <Panel title="Ajukan atas nama karyawan" sub="Untuk karyawan tanpa akun aplikasi. Karyawan dengan akun bisa mengajukan sendiri di menu Saya.">
            <LeaveForm forOther />
          </Panel>
        </>
      ) : (
        <>
          <Panel title={`Saldo cuti ${year}`} sub="Kuota 12 hari setelah 12 bulan kerja (UU 13/2003 jo. PP 35/2021) + penyesuaian − terpakai − menunggu persetujuan">
            {bal?.length ? (
              <Table head={['Karyawan', 'Dept', 'Jenis', 'Kuota', 'Penyesuaian', 'Terpakai', 'Menunggu', 'Sisa']}>
                {paginate(bal, sp.hal).rows.map(b => (
                  <tr key={`${b.employee_id}${b.leave_type}`}>
                    <td><Link href={`/hrga/${b.employee_id}`} className="font-medium hover:text-accent">{b.full_name}</Link><span className="block font-mono text-xs text-muted">{b.nrp}</span></td>
                    <td className="text-xs">{b.department_code}</td>
                    <td className="text-sm">{b.leave_name}</td>
                    {[b.quota, b.adjustment, b.used, b.pending].map((v, i) => <td key={i} className="tabular text-sm">{Number(v) || '–'}</td>)}
                    <td><Pill tone={Number(b.available) <= 0 ? 'crit' : Number(b.available) <= 3 ? 'warn' : 'ok'}>{Number(b.available)} hari</Pill></td>
                  </tr>
                ))}
              </Table>
            ) : <p className="text-sm text-muted">Belum ada data saldo yang bisa Anda lihat.</p>}
            {bal && <Pager {...paginate(bal, sp.hal)} params={{ tab: 'saldo' }} />}
          </Panel>
          {isHr && (
            <Panel title="Penyesuaian saldo" sub="Saldo awal dari sistem lama, cuti bersama, atau koreksi. Nilai negatif mengurangi saldo. Massal: Impor data → Saldo cuti.">
              <EmployeeDatalist />
              <ActionForm action={adjustLeave} label="Simpan penyesuaian" hidden={{ type: 'CT' }} className="md:grid-cols-4 md:items-end">
                <EmployeeInput required />
                <label className="grid gap-1 text-sm">Tahun<input type="number" name="year" defaultValue={year} className={input} /></label>
                <label className="grid gap-1 text-sm">Hari (±)<input type="number" step="0.5" name="days" required placeholder="-2" className={input} /></label>
                <label className="grid gap-1 text-sm">Alasan<input name="reason" required placeholder="Saldo terpakai Jan–Okt" className={input} /></label>
              </ActionForm>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
