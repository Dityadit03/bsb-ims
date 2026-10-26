import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { ExportLinks } from '@/components/export-links';
import { PageHeader, Pager, Panel, Pill, Stat, Table, input, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { RUN_KIND, RUN_STATUS, rp } from '@/lib/hrga';
import { EmployeeDatalist, EmployeeInput } from '../../../she/fields';
import { addInput, approveRun, calculateRun, cancelRun, deleteInput, publishRun, reopenRun } from '../actions';
import { HrTabs } from '../../tabs';

export const metadata = { title: 'Proses gaji' };

type Slip = {
  id: string; employee_id: string; nrp: string; full_name: string; department_code: string; ptkp_status: string; ter_category: string;
  days_present: number; days_absent: number; days_unpaid: number; overtime_hours: number; fixed_wage: number; earnings: number; deductions: number;
  bpjs_ee: number; bpjs_er: number; ter_rate: number | null; pph21: number; annualized: boolean; net: number; employer_cost: number; warnings: string[];
  legacy_net: number | null; diff_net: number | null; diff_pph21: number | null;
};
type Recap = { department_code: string; department_name: string; headcount: number; earnings: number; bpjs_er: number; pph21: number; net: number; employer_cost: number; overtime_hours: number };

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await getSession();
  if (!session.can('payroll.read')) notFound();
  const manage = session.can('payroll.manage');
  const approve = session.can('payroll.approve');
  const supabase = await createClient();
  const { data: run } = await supabase.from('payroll_runs')
    .select('*, calc:calculated_by(full_name), appr:approved_by(full_name), pub:published_by(full_name)').eq('id', id).maybeSingle();
  if (!run) notFound();
  const [{ data: slips }, { data: recap }, { data: inputs }, { data: comps }] = await Promise.all([
    supabase.from('payroll_slip_register').select('*').eq('run_id', id).order('department_code').order('full_name').limit(5000).returns<Slip[]>(),
    supabase.from('payroll_cost_recap').select('*').eq('run_id', id).order('department_code').returns<Recap[]>(),
    supabase.from('payroll_inputs').select('id, component_code, amount, note, created_at, employee:employee_id(nrp, full_name)').eq('run_id', id).order('created_at', { ascending: false }),
    supabase.from('pay_components').select('code, name').eq('calc', 'manual').eq('active', true).order('sort_order'),
  ]);
  const all = slips ?? [];
  const sum = (k: keyof Recap) => (recap ?? []).reduce((a, r) => a + Number(r[k]), 0);
  const warned = all.filter(s => s.warnings?.length);
  const q = (sp.q ?? '').toLowerCase();
  let rows = q ? all.filter(s => s.full_name.toLowerCase().includes(q) || s.nrp.toLowerCase().includes(q)) : all;
  if (sp.dept) rows = rows.filter(s => s.department_code === sp.dept);
  if (sp.f === 'warn') rows = rows.filter(s => s.warnings?.length);
  if (sp.f === 'diff') rows = rows.filter(s => s.diff_net != null && Math.abs(s.diff_net) >= 1000);
  const pg = paginate(rows, sp.hal);
  const withLegacy = all.filter(s => s.legacy_net != null);
  const mismatch = withLegacy.filter(s => Math.abs(s.diff_net ?? 0) >= 1000);
  const name = (x: unknown) => (x as { full_name: string } | null)?.full_name ?? '–';
  const open = run.status === 'draft' || run.status === 'calculated';
  const runId = { run: id };
  // angka besar di kartu: dalam juta rupiah
  const jt = (n: number) => `${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  // catatan dikelompokkan per jenis, mis. "No. rekening kosong" × 120
  const kinds = new Map<string, string[]>();
  for (const s of warned) for (const w of s.warnings) kinds.set(w, [...(kinds.get(w) ?? []), s.full_name]);

  return (
    <>
      <PageHeader eyebrow={`Payroll · ${RUN_KIND[run.kind]}${run.parallel ? ' · uji paralel' : ''}`} title={`${run.run_no} · ${run.period}`}>
        <Link href="/hrga/payroll" className="text-sm text-muted hover:text-accent">← Semua proses</Link>
      </PageHeader>
      <HrTabs active="/hrga/payroll" />
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm [&_dt]:text-muted">
            <dt>Status</dt><dd><Pill tone={RUN_STATUS[run.status]?.[0] ?? 'muted'}>{RUN_STATUS[run.status]?.[1] ?? run.status}</Pill></dd>
            <dt>Periode absensi</dt><dd>{fmtDate(run.att_from)} – {fmtDate(run.att_to)}</dd>
            <dt>Tanggal bayar</dt><dd>{fmtDate(run.pay_date)}</dd>
            <dt>Dihitung</dt><dd>{run.calculated_at ? `${name(run.calc)} · ${fmtDate(run.calculated_at)}` : '–'}</dd>
            <dt>Disetujui</dt><dd>{run.approved_at ? `${name(run.appr)} · ${fmtDate(run.approved_at)}` : '–'}</dd>
            {run.published_at && <><dt>Terbit</dt><dd>{name(run.pub)} · {fmtDate(run.published_at)}</dd></>}
            {run.note && <><dt>Catatan</dt><dd>{run.note}</dd></>}
          </dl>
          <div className="flex flex-wrap items-start gap-2">
            {manage && open && <ActionForm action={calculateRun} label={run.status === 'draft' ? 'Hitung gaji' : 'Hitung ulang'} primary={run.status === 'draft'} hidden={runId} />}
            {approve && run.status === 'calculated' && <ActionForm action={approveRun} label="Setujui" confirm="Setujui penggajian periode ini?" primary hidden={runId} />}
            {manage && run.status === 'approved' && !run.parallel && <ActionForm action={publishRun} label="Terbitkan slip ke karyawan" confirm="Terbitkan slip ke seluruh karyawan? Tidak bisa ditarik." primary hidden={runId} />}
            {(manage || approve) && run.status === 'approved' && (
              <details className="text-sm">
                <summary className="cursor-pointer rounded-lg border border-line px-3.5 py-2 hover:border-violet/60">Buka ulang</summary>
                <ActionForm action={reopenRun} label="Buka ulang" hidden={runId} className="mt-2 w-64"><input name="reason" required placeholder="Alasan" className={input} /></ActionForm>
              </details>
            )}
            {manage && run.status !== 'published' && run.status !== 'cancelled' && (
              <details className="text-sm">
                <summary className="cursor-pointer rounded-lg border border-line px-3.5 py-2 hover:border-crit/60">Batalkan</summary>
                <ActionForm action={cancelRun} label="Batalkan proses" confirm="Batalkan proses penggajian ini?" hidden={runId} className="mt-2 w-64"><input name="reason" required placeholder="Alasan" className={input} /></ActionForm>
              </details>
            )}
          </div>
        </div>
        {run.status === 'calculated' && <p className="mt-3 text-xs text-muted">Persetujuan oleh pemegang peran Penyetuju payroll selain orang yang menghitung.</p>}
        {run.parallel && <p className="mt-3 text-xs text-muted">Uji paralel tidak diterbitkan ke karyawan. Impor hasil sistem lama (Impor data → Hasil gaji sistem lama) untuk membandingkan.</p>}
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Karyawan" value={all.length} note={warned.length ? `${warned.length} dengan catatan` : undefined} tone={warned.length ? 'warn' : undefined} />
        <Stat label="Total gaji bersih" value={jt(sum('net'))} note={`Rp ${rp(sum('net'))}`} />
        <Stat label="PPh 21" value={jt(sum('pph21'))} note={`Rp ${rp(sum('pph21'))}`} />
        <Stat label="BPJS perusahaan" value={jt(sum('bpjs_er'))} note={`Rp ${rp(sum('bpjs_er'))}`} />
        {run.parallel
          ? <Stat label="Beda dgn sistem lama" value={withLegacy.length ? `${mismatch.length}/${withLegacy.length}` : '–'} note="selisih bersih ≥ Rp1.000" tone={mismatch.length ? 'crit' : withLegacy.length ? 'ok' : undefined} />
          : <Stat label="Biaya perusahaan" value={jt(sum('employer_cost'))} note="bruto + BPJS perusahaan" />}
      </div>

      {warned.length > 0 && (
        <Panel title="Perlu diperiksa" sub="Catatan dari perhitungan; slip tetap dibuat. Lengkapi data lalu hitung ulang.">
          <ul className="grid gap-1.5 text-sm">
            {[...kinds].sort((a, b) => b[1].length - a[1].length).map(([w, names]) => (
              <li key={w}><span className="font-medium">{w}</span> <span className="text-muted">· {names.length} karyawan{names.length <= 5 ? `: ${names.join(', ')}` : ''}</span></li>
            ))}
          </ul>
          <Link href="?f=warn" className="mt-2 inline-block text-xs text-accent hover:underline">Lihat karyawan dengan catatan</Link>
        </Panel>
      )}

      <Panel title="Slip per karyawan" action={
        <div className="flex flex-wrap gap-2">
          <form className="flex gap-2">
            <input name="q" defaultValue={sp.q ?? ''} placeholder="Nama / NRP" className={`${input} max-w-40`} />
            <select name="dept" defaultValue={sp.dept ?? ''} className={`${input} max-w-28`}><option value="">Semua dept</option>{(recap ?? []).map(r => <option key={r.department_code}>{r.department_code}</option>)}</select>
            <select name="f" defaultValue={sp.f ?? ''} className={`${input} max-w-36`}><option value="">Semua</option><option value="warn">Ada catatan</option>{run.parallel && <option value="diff">Beda dgn sistem lama</option>}</select>
            <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Saring</button>
          </form>
          <ExportLinks dataset="slip_gaji" params={{ run: id }} />
        </div>}>
        {all.length ? (
          <>
            <Table head={['Karyawan', 'PTKP', 'Hadir', 'Lembur', 'Upah tetap', 'Bruto', 'Potongan', 'BPJS kary.', 'PPh 21', 'Bersih', ...(run.parallel ? ['Sistem lama', 'Selisih'] : []), '']}>
              {pg.rows.map(s => (
                <tr key={s.id}>
                  <td><span className="font-medium">{s.full_name}</span><span className="block font-mono text-[11px] text-muted">{s.nrp} · {s.department_code}</span></td>
                  <td className="text-xs">{s.ptkp_status} · {s.ter_category}</td>
                  <td className="tabular text-sm">{s.days_present}{(s.days_absent > 0 || s.days_unpaid > 0) && <span className="ml-1 text-[11px] text-crit">−{s.days_absent + s.days_unpaid}</span>}</td>
                  <td className="tabular text-sm">{Number(s.overtime_hours) || '–'}</td>
                  <td className="tabular text-sm">{rp(s.fixed_wage)}</td>
                  <td className="tabular text-sm">{rp(s.earnings)}</td>
                  <td className="tabular text-sm">{rp(s.deductions)}</td>
                  <td className="tabular text-sm">{rp(s.bpjs_ee)}</td>
                  <td className="tabular text-sm">{rp(s.pph21)}<span className="block text-[10px] text-muted">{s.annualized ? 'setahun' : s.ter_rate != null ? `TER ${s.ter_rate}%` : ''}</span></td>
                  <td className="tabular text-sm font-semibold">{rp(s.net)}</td>
                  {run.parallel && <>
                    <td className="tabular text-sm">{rp(s.legacy_net)}</td>
                    <td className={`tabular text-sm ${s.diff_net && Math.abs(s.diff_net) >= 1000 ? 'font-semibold text-crit' : 'text-muted'}`}>{s.diff_net == null ? '–' : rp(s.diff_net)}</td>
                  </>}
                  <td><Link href={`/slip/${s.id}`} className="text-xs text-accent hover:underline">Slip</Link>{s.warnings?.length > 0 && <span className="ml-1" title={s.warnings.join('; ')}>⚠</span>}</td>
                </tr>
              ))}
            </Table>
            <Pager {...pg} params={{ q: sp.q, dept: sp.dept, f: sp.f }} />
          </>
        ) : <p className="text-sm text-muted">Belum dihitung. Isi input bila ada, lalu tekan “Hitung gaji”.</p>}
      </Panel>

      {(recap ?? []).length > 0 && (
        <Panel title="Rekap biaya per departemen">
          <Table head={['Dept', 'Karyawan', 'Bruto', 'BPJS perusahaan', 'Biaya perusahaan', 'PPh 21', 'Gaji bersih', 'Jam lembur']}>
            {(recap ?? []).map(r => (
              <tr key={r.department_code}>
                <td className="text-sm"><span className="font-mono text-xs font-semibold">{r.department_code}</span> {r.department_name}</td>
                <td className="tabular text-sm">{r.headcount}</td>
                <td className="tabular text-sm">{rp(r.earnings)}</td>
                <td className="tabular text-sm">{rp(r.bpjs_er)}</td>
                <td className="tabular text-sm font-semibold">{rp(r.employer_cost)}</td>
                <td className="tabular text-sm">{rp(r.pph21)}</td>
                <td className="tabular text-sm">{rp(r.net)}</td>
                <td className="tabular text-sm">{Math.round(Number(r.overtime_hours) * 10) / 10}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      <Panel title="Input per proses" sub="Insentif, rapel, kasbon, potongan lain. Lembur, kehadiran, dan shift malam diambil otomatis dari absensi & SPL. Massal: Impor data → Input gaji.">
        {inputs?.length ? (
          <Table head={['Karyawan', 'Komponen', 'Nilai', 'Keterangan', '']}>
            {inputs.map(i => {
              const e = i.employee as unknown as { nrp: string; full_name: string } | null;
              return (
                <tr key={i.id}>
                  <td className="text-sm">{e?.full_name}<span className="block font-mono text-[11px] text-muted">{e?.nrp}</span></td>
                  <td className="font-mono text-xs">{i.component_code}</td>
                  <td className="tabular text-sm">{rp(i.amount)}</td>
                  <td className="text-sm text-muted">{i.note ?? ''}</td>
                  <td>{manage && open && <ActionForm action={deleteInput} label="Hapus" confirm="Hapus input ini?" hidden={{ id: i.id, run: id }} />}</td>
                </tr>
              );
            })}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada input.</p>}
        {manage && open && (
          <>
            <EmployeeDatalist />
            <ActionForm action={addInput} label="Tambah input" hidden={runId} className="mt-3 md:grid-cols-4 md:items-end">
              <EmployeeInput required />
              <label className="grid gap-1 text-sm">Komponen<select name="component" className={input}>{(comps ?? []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
              <label className="grid gap-1 text-sm">Nilai (Rp)<input name="amount" required inputMode="numeric" className={input} /></label>
              <label className="grid gap-1 text-sm">Keterangan<input name="note" className={input} /></label>
            </ActionForm>
          </>
        )}
      </Panel>
    </>
  );
}
