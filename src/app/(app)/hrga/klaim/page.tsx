import { ActionForm } from '@/components/action-form';
import { ExportLinks } from '@/components/export-links';
import { Tabs } from '@/components/tabs';
import { PageHeader, Pager, Panel, Pill, Stat, Table, input, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { ADV_STATUS, CLAIM_STATUS, rp } from '@/lib/hrga';
import { AdvanceForm, AdvanceTable, ClaimForm, ClaimTable, type AdvanceRow, type ClaimRow } from '../claims';
import { saveClaimType } from '../klaim-actions';
import { HrTabs } from '../tabs';

export const metadata = { title: 'Klaim & kasbon' };

type ClaimType = { code: string; name: string; taxable: boolean; per_claim_limit: number | null; annual_limit: number | null; requires_attachment: boolean; active: boolean; sort_order: number };

export default async function KlaimPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const payroll = session.can('payroll.manage');
  const tab = sp.tab === 'kasbon' || sp.tab === 'jenis' ? sp.tab : 'klaim';
  const supabase = await createClient();
  const [{ data: claims }, { data: advs }] = await Promise.all([
    supabase.from('expense_claim_register').select('*').order('created_at', { ascending: false }).limit(3000).returns<ClaimRow[]>(),
    supabase.from('cash_advance_register').select('*').order('created_at', { ascending: false }).limit(3000).returns<AdvanceRow[]>(),
  ]);
  const cl = claims ?? [], ad = advs ?? [];
  const sum = (xs: (number | string | null)[]) => xs.reduce<number>((a, b) => a + Number(b ?? 0), 0);
  const unpaid = cl.filter(c => c.status === 'approved');
  const running = ad.filter(a => a.status === 'active');

  return (
    <>
      <PageHeader eyebrow="HRGA" title="Klaim & kasbon">
        {tab !== 'jenis' && <ExportLinks dataset={tab === 'kasbon' ? 'kasbon' : 'klaim'} />}
      </PageHeader>
      <HrTabs active="/hrga/klaim" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Perlu keputusan Anda" value={cl.filter(c => c.can_decide).length + ad.filter(a => a.can_decide).length}
          tone={cl.some(c => c.can_decide) || ad.some(a => a.can_decide) ? 'warn' : undefined} href="/tugas" />
        <Stat label="Klaim disetujui, belum dibayar" value={unpaid.length} note={`Rp ${rp(sum(unpaid.map(c => c.approved_amount)))}`} />
        <Stat label="Kasbon & uang muka berjalan" value={running.length} note={`sisa Rp ${rp(sum(running.map(a => a.balance)))}`} />
        <Stat label="Uang muka lewat batas laporan" value={ad.filter(a => a.report_overdue).length} tone={ad.some(a => a.report_overdue) ? 'crit' : 'ok'} />
      </div>
      <Tabs items={[['/hrga/klaim', 'Reimbursement'], ['/hrga/klaim?tab=kasbon', 'Kasbon & uang muka'], ['/hrga/klaim?tab=jenis', 'Jenis klaim & plafon']]}
        active={tab === 'klaim' ? '/hrga/klaim' : `/hrga/klaim?tab=${tab}`} />
      {tab === 'klaim' && <Claims sp={sp} rows={cl} payroll={payroll} />}
      {tab === 'kasbon' && <Advances sp={sp} rows={ad} payroll={payroll} />}
      {tab === 'jenis' && <Types payroll={payroll} supabase={supabase} />}
    </>
  );
}

function Filter({ tab, sp, statuses, depts }: { tab: string; sp: Record<string, string | undefined>; statuses: Record<string, [string, string]>; depts: string[] }) {
  return (
    <form className="flex gap-2">
      {tab !== 'klaim' && <input type="hidden" name="tab" value={tab} />}
      <select name="status" defaultValue={sp.status ?? ''} className={`${input} max-w-44`}><option value="">Semua status</option>
        {Object.entries(statuses).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
      <select name="dept" defaultValue={sp.dept ?? ''} className={`${input} max-w-32`}><option value="">Semua dept</option>{depts.map(d => <option key={d}>{d}</option>)}</select>
      <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Saring</button>
    </form>
  );
}

function Claims({ sp, rows: all, payroll }: { sp: Record<string, string | undefined>; rows: ClaimRow[]; payroll: boolean }) {
  let rows = sp.status ? all.filter(r => r.status === sp.status) : all;
  if (sp.dept) rows = rows.filter(r => r.department_code === sp.dept);
  const pg = paginate(rows, sp.hal);
  return (
    <>
      <Panel title="Klaim reimbursement" action={<Filter tab="klaim" sp={sp} statuses={CLAIM_STATUS} depts={[...new Set(all.map(r => r.department_code))].sort()} />}>
        {rows.length ? <><ClaimTable rows={pg.rows} mode="manage" payroll={payroll} /><Pager {...pg} params={{ status: sp.status, dept: sp.dept }} /></>
          : <p className="text-sm text-muted">Belum ada klaim.</p>}
      </Panel>
      <Panel title="Ajukan klaim atas nama karyawan" sub="Untuk karyawan yang tidak memakai aplikasi; karyawan lain mengajukan sendiri lewat menu Saya → Klaim & kasbon.">
        <ClaimForm forOther />
      </Panel>
    </>
  );
}

function Advances({ sp, rows: all, payroll }: { sp: Record<string, string | undefined>; rows: AdvanceRow[]; payroll: boolean }) {
  let rows = sp.status ? all.filter(r => r.status === sp.status) : all;
  if (sp.dept) rows = rows.filter(r => r.department_code === sp.dept);
  const pg = paginate(rows, sp.hal);
  return (
    <>
      <Panel title="Kasbon & uang muka" sub="Cicilan kasbon dan sisa uang muka dipotong otomatis di proses gaji bulanan; tercatat lunas saat slip terbit. Saldo dari sistem lama: Impor data → Saldo kasbon."
        action={<Filter tab="kasbon" sp={sp} statuses={ADV_STATUS} depts={[...new Set(all.map(r => r.department_code))].sort()} />}>
        {rows.length ? <><AdvanceTable rows={pg.rows} mode="manage" payroll={payroll} /><Pager {...pg} params={{ tab: 'kasbon', status: sp.status, dept: sp.dept }} /></>
          : <p className="text-sm text-muted">Belum ada kasbon atau uang muka.</p>}
      </Panel>
      <Panel title="Ajukan atas nama karyawan"><AdvanceForm forOther /></Panel>
    </>
  );
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function Types({ payroll, supabase }: { payroll: boolean; supabase: Client }) {
  const { data } = await supabase.from('claim_types').select('*').order('sort_order').returns<ClaimType[]>();
  return (
    <Panel title="Jenis klaim & plafon" sub="Klaim kena pajak (mis. pengobatan) masuk penghasilan bruto PPh 21; perjalanan dinas & biaya kerja tidak.">
      <Table head={['Kode', 'Nama', 'Kena pajak', 'Maks per klaim', 'Plafon setahun', 'Wajib bukti', 'Status']}>
        {(data ?? []).map(t => (
          <tr key={t.code}>
            <td className="font-mono text-xs font-semibold">{t.code}</td>
            <td className="text-sm">{t.name}</td>
            <td className="text-sm">{t.taxable ? 'Ya' : 'Tidak'}</td>
            <td className="tabular text-sm">{t.per_claim_limit ? rp(t.per_claim_limit) : '–'}</td>
            <td className="tabular text-sm">{t.annual_limit ? rp(t.annual_limit) : '–'}</td>
            <td className="text-sm">{t.requires_attachment ? 'Ya' : 'Tidak'}</td>
            <td><Pill tone={t.active ? 'ok' : 'muted'}>{t.active ? 'Aktif' : 'Nonaktif'}</Pill></td>
          </tr>
        ))}
      </Table>
      {payroll && (
        <ActionForm action={saveClaimType} label="Simpan jenis klaim" className="mt-3 md:grid-cols-4 md:items-end">
          <label className="grid gap-1 text-sm">Kode<input name="code" required placeholder="MEDIS" className={input} /></label>
          <label className="grid gap-1 text-sm">Nama<input name="name" required className={input} /></label>
          <label className="grid gap-1 text-sm">Kena pajak<select name="taxable" className={input}><option value="false">Tidak</option><option value="true">Ya</option></select></label>
          <label className="grid gap-1 text-sm">Wajib bukti<select name="attachment" className={input}><option value="true">Ya</option><option value="false">Tidak</option></select></label>
          <label className="grid gap-1 text-sm">Maks per klaim (Rp)<input name="per_claim" inputMode="numeric" placeholder="kosong = tanpa batas" className={input} /></label>
          <label className="grid gap-1 text-sm">Plafon setahun (Rp)<input name="annual" inputMode="numeric" placeholder="kosong = tanpa batas" className={input} /></label>
          <label className="grid gap-1 text-sm">Status<select name="active" className={input}><option value="true">Aktif</option><option value="false">Nonaktif</option></select></label>
          <label className="grid gap-1 text-sm">Urutan<input type="number" name="sort" defaultValue={50} className={input} /></label>
        </ActionForm>
      )}
    </Panel>
  );
}
