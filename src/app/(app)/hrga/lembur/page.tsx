import { ExportLinks } from '@/components/export-links';
import { PageHeader, Pager, Panel, Stat, input, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { siteToday } from '@/lib/hrga';
import { OvertimeForm } from '../time-forms';
import { OvertimeTable, type OtRow } from '../time-tables';
import { HrTabs } from '../tabs';

export const metadata = { title: 'Lembur (SPL)' };

export default async function LemburPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const isHr = session.canIn('hr.manage', 'HRGA');
  const supabase = await createClient();
  const month = sp.bln && /^\d{4}-\d{2}$/.test(sp.bln) ? sp.bln : siteToday().slice(0, 7);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const { data } = await supabase.from('overtime_register').select('*').gte('work_date', from).lte('work_date', to)
    .order('work_date', { ascending: false }).limit(5000).returns<OtRow[]>();
  const all = data ?? [];
  const status = sp.status ?? 'all';
  let rows = status === 'all' ? all : all.filter(r => r.status === status);
  if (sp.dept) rows = rows.filter(r => r.department_code === sp.dept);
  const pg = paginate(rows, sp.hal);
  const approved = all.filter(r => r.status === 'approved');
  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10;
  const depts = [...new Set(all.map(r => r.department_code))].sort();
  // jam lembur disetujui per departemen bulan ini
  const byDept = depts.map(d => [d, sum(approved.filter(r => r.department_code === d).map(r => Number(r.actual_hours ?? r.hours)))] as const).filter(([, h]) => h > 0);

  return (
    <>
      <PageHeader eyebrow="Time management" title="Lembur (SPL)"><ExportLinks dataset="lembur" /></PageHeader>
      <HrTabs active="/hrga/lembur" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Perlu keputusan Anda" value={all.filter(r => r.can_decide).length} tone={all.some(r => r.can_decide) ? 'warn' : undefined} />
        <Stat label="SPL disetujui" value={approved.length} note={`${sum(approved.map(r => Number(r.hours)))} jam diajukan`} />
        <Stat label="Jam aktual (absensi)" value={sum(approved.map(r => Number(r.actual_hours ?? 0)))} note="Irisan jam SPL dengan absen masuk–pulang" />
        <Stat label="Jam disetujui per dept" value={byDept.length ? byDept.map(([d, h]) => `${d} ${h}`).join(' · ') : '–'} />
      </div>
      <Panel title="Daftar SPL" action={
        <form className="flex flex-wrap gap-2">
          <input aria-label="Periode" type="month" name="bln" defaultValue={month} className={`${input} !w-auto`} />
          <select aria-label="Status" name="status" defaultValue={status} className={`${input} max-w-40`}>
            <option value="all">Semua</option><option value="submitted">Menunggu</option><option value="approved">Disetujui</option>
            <option value="rejected">Ditolak</option><option value="cancelled">Batal</option></select>
          <select aria-label="Departemen" name="dept" defaultValue={sp.dept ?? ''} className={`${input} max-w-32`}><option value="">Semua dept</option>{depts.map(d => <option key={d}>{d}</option>)}</select>
          <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Saring</button>
        </form>}>
        {rows.length ? <><OvertimeTable rows={pg.rows} canCancel={isHr} /><Pager {...pg} params={{ bln: month, status, dept: sp.dept }} /></>
          : <p className="text-sm text-muted">Belum ada SPL pada bulan ini.</p>}
      </Panel>
      <Panel title="Buat SPL" sub="Atasan bisa membuat SPL untuk bawahannya; persetujuan oleh atasan lain atau HRGA (pembuat tidak menyetujui sendiri). Kosongkan karyawan untuk SPL diri sendiri.">
        <OvertimeForm forOther />
      </Panel>
    </>
  );
}
