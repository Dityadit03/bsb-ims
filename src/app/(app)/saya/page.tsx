import Link from 'next/link';
import { Fragment } from 'react';
import { ActionForm } from '@/components/action-form';
import { Tabs } from '@/components/tabs';
import { PageHeader, Panel, Pill, Stat, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { ATT_STATUS, EMPLOYMENT, PRIVATE_FIELDS, ROSTER, RUN_KIND, SELF_EDITABLE, VALIDITY, fmtTime, rp, siteToday } from '@/lib/hrga';
import { saveMyPrivate } from '../hrga/actions';
import { LeaveForm, OvertimeForm } from '../hrga/time-forms';
import { LeaveTable, OvertimeTable, type LeaveRow, type OtRow } from '../hrga/time-tables';
import { AdvanceForm, AdvanceTable, ClaimForm, ClaimTable, type AdvanceRow, type ClaimRow } from '../hrga/claims';
import { ReviewTable, type ReviewRow } from '../hrga/kinerja/parts';

export const metadata = { title: 'Saya' };

const TABS = [['/saya', 'Profil'], ['/saya?tab=absen', 'Kehadiran'], ['/saya?tab=cuti', 'Cuti'], ['/saya?tab=lembur', 'Lembur'], ['/saya?tab=klaim', 'Klaim & kasbon'], ['/saya?tab=gaji', 'Slip gaji'], ['/saya?tab=kinerja', 'Kinerja']] as const;

// Employee self service: profil & data kontak, rekap kehadiran, pengajuan cuti dan SPL milik sendiri.
export default async function SayaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { profile } = await getSession();
  const supabase = await createClient();
  const tab = ['absen', 'cuti', 'lembur', 'klaim', 'gaji', 'kinerja'].includes(sp.tab ?? '') ? sp.tab! : 'profil';
  const { data: me } = await supabase.from('employee_register').select('*').eq('profile_id', profile.id).eq('status', 'active').maybeSingle();

  return (
    <>
      <PageHeader eyebrow="Employee self service" title={me?.full_name ?? profile.full_name ?? 'Saya'} />
      {!me ? (
        <Panel><p className="text-sm">Akun Anda ({profile.email}) belum ditautkan ke data karyawan. Minta HRGA mengisi email ini di data karyawan Anda.</p></Panel>
      ) : (
        <>
          <Tabs items={TABS} active={tab === 'profil' ? '/saya' : `/saya?tab=${tab}`} />
          {tab === 'profil' && <Profil me={me} supabase={supabase} />}
          {tab === 'absen' && <Kehadiran id={me.id} month={sp.bln} supabase={supabase} />}
          {tab === 'cuti' && <Cuti id={me.id} supabase={supabase} />}
          {tab === 'lembur' && <Lembur id={me.id} supabase={supabase} />}
          {tab === 'klaim' && <Klaim id={me.id} supabase={supabase} />}
          {tab === 'gaji' && <Gaji id={me.id} supabase={supabase} />}
          {tab === 'kinerja' && <Kinerja id={me.id} supabase={supabase} />}
        </>
      )}
    </>
  );
}

type Client = Awaited<ReturnType<typeof createClient>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Me = Record<string, any>;

async function Profil({ me, supabase }: { me: Me; supabase: Client }) {
  const [{ data: priv }, { data: org }, { data: comps }, { data: card }] = await Promise.all([
    supabase.from('employee_private').select('*').eq('employee_id', me.id).maybeSingle(),
    supabase.from('employees').select('roster_pattern, point_of_hire, grade, supervisor:supervisor_id(full_name, nrp)').eq('id', me.id).maybeSingle(),
    supabase.from('employee_competency_view').select('id, competency_name, valid_until, validity, fitness').eq('employee_id', me.id)
      .neq('validity', 'revoked').order('valid_until', { ascending: true, nullsFirst: false }),
    supabase.from('id_card_register').select('card_no, status, valid_until, access_areas').eq('employee_id', me.id).eq('status', 'active').maybeSingle(),
  ]);
  const sup = org?.supervisor as unknown as { full_name: string; nrp: string } | null;
  const label = (k: string) => PRIVATE_FIELDS.find(p => p[0] === k)?.[1] ?? k;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Data kepegawaian">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
          <dt>NRP</dt><dd className="font-mono">{me.nrp}</dd>
          <dt>Jabatan</dt><dd>{me.position_name ?? '–'} · {me.department_code}</dd>
          <dt>Status kerja</dt><dd>{EMPLOYMENT[me.employment_type] ?? me.employment_type}{me.company && ` · ${me.company}`}</dd>
          <dt>Tanggal masuk</dt><dd>{fmtDate(me.join_date)}</dd>
          <dt>Atasan langsung</dt><dd>{sup ? `${sup.full_name} (${sup.nrp})` : '–'}</dd>
          <dt>Pola roster</dt><dd>{org?.roster_pattern ?? '–'}{org?.point_of_hire && ` · POH ${org.point_of_hire}`}</dd>
          <dt>ID card</dt><dd>{card ? `${card.card_no} · s.d. ${fmtDate(card.valid_until)} · ${(card.access_areas ?? []).join(', ')}` : <span className="text-warn">Belum ada kartu aktif</span>}</dd>
        </dl>
      </Panel>
      <Panel title="Sertifikat & kompetensi" sub="Perpanjangan diurus HRGA; segera lapor bila hampir habis">
        {comps?.length ? (
          <ul className="grid gap-2 text-sm">
            {comps.map(c => (
              <li key={c.id} className="flex justify-between gap-2 border-b border-line pb-2 last:border-0">
                <span>{c.competency_name}<span className="block text-xs text-muted">{c.valid_until ? `s.d. ${fmtDate(c.valid_until)}` : 'Tanpa masa berlaku'}</span></span>
                <Pill tone={VALIDITY[c.validity]?.[0] ?? 'muted'}>{VALIDITY[c.validity]?.[1] ?? c.validity}</Pill>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Belum ada sertifikat tercatat.</p>}
      </Panel>
      <Panel title="Kontak & ukuran perlengkapan" sub="Anda bisa memperbarui data ini sendiri. Data lain (NIK, rekening, NPWP, BPJS) diubah lewat HRGA.">
        <ActionForm action={saveMyPrivate} label="Simpan" primary>
          <div className="grid gap-3 sm:grid-cols-2">
            {SELF_EDITABLE.map(k => (
              <label key={k} className="grid gap-1 text-xs">{label(k)}<input name={k} defaultValue={priv?.[k] ?? ''} className={input} /></label>
            ))}
          </div>
        </ActionForm>
      </Panel>
      <Panel title="Data pribadi (dikelola HRGA)">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
          {PRIVATE_FIELDS.filter(([k]) => !SELF_EDITABLE.includes(k)).map(([k, l]) => (
            <Fragment key={k}><dt>{l}</dt><dd className="break-all">{priv?.[k] ?? '–'}</dd></Fragment>
          ))}
        </dl>
      </Panel>
    </div>
  );
}

async function Kehadiran({ id, month: m, supabase }: { id: string; month?: string; supabase: Client }) {
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : siteToday().slice(0, 7);
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const { data } = await supabase.from('attendance_daily').select('work_date, roster_code, clock_in, clock_out, late_minutes, worked_hours, status, outside_geofence')
    .eq('employee_id', id).gte('work_date', `${month}-01`).lte('work_date', to).order('work_date', { ascending: false });
  const rows = data ?? [];
  const n = (s: string) => rows.filter(r => r.status === s).length;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <form className="flex gap-2"><input type="hidden" name="tab" value="absen" />
          <input type="month" name="bln" defaultValue={month} className={`${input} !w-auto`} />
          <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Lihat</button></form>
        <Link href="/absen" className="rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white">Absen sekarang</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Hadir" value={n('hadir') + n('terlambat')} tone="ok" />
        <Stat label="Terlambat" value={n('terlambat')} note={`${rows.reduce((a, r) => a + (r.late_minutes ?? 0), 0)} menit`} tone={n('terlambat') ? 'warn' : undefined} />
        <Stat label="Alpa" value={n('alpa')} tone={n('alpa') ? 'crit' : undefined} />
        <Stat label="Cuti / sakit / izin" value={n('cuti') + n('sakit') + n('izin')} />
        <Stat label="Jam kerja" value={Math.round(rows.reduce((a, r) => a + Number(r.worked_hours ?? 0), 0))} />
      </div>
      <Panel>
        {rows.length ? (
          <Table head={['Tanggal', 'Roster', 'Masuk', 'Pulang', 'Jam', 'Status']}>
            {rows.map(r => (
              <tr key={r.work_date}>
                <td className="whitespace-nowrap text-sm">{fmtDate(r.work_date)}</td>
                <td>{r.roster_code ? <Pill tone={ROSTER[r.roster_code]?.[0] ?? 'muted'}>{ROSTER[r.roster_code]?.[1] ?? r.roster_code}</Pill> : '–'}</td>
                <td className="tabular text-sm">{fmtTime(r.clock_in)}{r.late_minutes > 0 && <span className="ml-1 text-[11px] text-warn">+{r.late_minutes}</span>}</td>
                <td className="tabular text-sm">{fmtTime(r.clock_out)}</td>
                <td className="tabular text-sm">{r.worked_hours ?? '–'}</td>
                <td><Pill tone={ATT_STATUS[r.status]?.[0] ?? 'muted'}>{ATT_STATUS[r.status]?.[1] ?? r.status}</Pill></td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada data kehadiran bulan ini.</p>}
      </Panel>
    </>
  );
}

async function Cuti({ id, supabase }: { id: string; supabase: Client }) {
  const [{ data: bal }, { data: reqs }] = await Promise.all([
    supabase.from('leave_balance').select('leave_type, leave_name, quota, adjustment, used, pending, available').eq('employee_id', id),
    supabase.from('leave_register').select('*').eq('employee_id', id).order('start_date', { ascending: false }).limit(50).returns<LeaveRow[]>(),
  ]);
  const ct = bal?.find(b => b.leave_type === 'CT');
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sisa cuti tahunan" value={ct ? `${Number(ct.available)} hari` : '–'} tone={ct && Number(ct.available) <= 3 ? 'warn' : 'ok'} />
        <Stat label="Kuota tahun ini" value={ct ? Number(ct.quota) + Number(ct.adjustment) : '–'} note={ct && Number(ct.quota) === 0 ? 'Belum 12 bulan kerja' : undefined} />
        <Stat label="Terpakai" value={ct ? Number(ct.used) : '–'} />
        <Stat label="Menunggu persetujuan" value={ct ? Number(ct.pending) : '–'} />
      </div>
      <Panel title="Ajukan cuti / izin"><LeaveForm /></Panel>
      <Panel title="Riwayat pengajuan">
        {reqs?.length ? <LeaveTable rows={reqs} cancel="self" /> : <p className="text-sm text-muted">Belum ada pengajuan.</p>}
      </Panel>
    </>
  );
}

async function Lembur({ id, supabase }: { id: string; supabase: Client }) {
  const { data } = await supabase.from('overtime_register').select('*').eq('employee_id', id).order('work_date', { ascending: false }).limit(50).returns<OtRow[]>();
  return (
    <>
      <Panel title="Ajukan lembur (SPL)"><OvertimeForm /></Panel>
      <Panel title="Riwayat SPL">
        {data?.length ? <OvertimeTable rows={data} canCancel /> : <p className="text-sm text-muted">Belum ada SPL.</p>}
      </Panel>
    </>
  );
}

// Hanya slip yang sudah diterbitkan (RLS); uji paralel tidak pernah tampil di sini.
async function Gaji({ id, supabase }: { id: string; supabase: Client }) {
  const { data } = await supabase.from('payroll_slip_register').select('id, run_no, period, kind, pay_date, earnings, pph21, net')
    .eq('employee_id', id).eq('run_status', 'published').eq('parallel', false).order('period', { ascending: false }).limit(36);
  return (
    <Panel title="Slip gaji" sub="Slip terbit setelah gaji disetujui. Buka untuk melihat rincian atau mencetak / menyimpan PDF.">
      {data?.length ? (
        <Table head={['Periode', 'Jenis', 'Tanggal bayar', 'Bruto', 'PPh 21', 'Diterima', '']}>
          {data.map(s => (
            <tr key={s.id}>
              <td className="text-sm font-medium">{s.period}</td>
              <td className="text-sm">{RUN_KIND[s.kind]}</td>
              <td className="text-sm">{fmtDate(s.pay_date)}</td>
              <td className="tabular text-sm">{rp(s.earnings)}</td>
              <td className="tabular text-sm">{rp(s.pph21)}</td>
              <td className="tabular text-sm font-semibold">{rp(s.net)}</td>
              <td><Link href={`/slip/${s.id}`} className="text-sm text-accent hover:underline">Buka</Link></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada slip gaji yang diterbitkan.</p>}
    </Panel>
  );
}

async function Klaim({ id, supabase }: { id: string; supabase: Client }) {
  const [{ data: claims }, { data: advs }] = await Promise.all([
    supabase.from('expense_claim_register').select('*').eq('employee_id', id).order('created_at', { ascending: false }).limit(50).returns<ClaimRow[]>(),
    supabase.from('cash_advance_register').select('*').eq('employee_id', id).order('created_at', { ascending: false }).limit(30).returns<AdvanceRow[]>(),
  ]);
  return (
    <>
      <Panel title="Ajukan klaim biaya"><ClaimForm employeeId={id} /></Panel>
      <Panel title="Riwayat klaim">
        {claims?.length ? <ClaimTable rows={claims} mode="self" /> : <p className="text-sm text-muted">Belum ada klaim.</p>}
      </Panel>
      <Panel title="Ajukan kasbon / uang muka dinas"><AdvanceForm /></Panel>
      <Panel title="Kasbon & uang muka">
        {advs?.length ? <AdvanceTable rows={advs} mode="self" /> : <p className="text-sm text-muted">Belum ada kasbon atau uang muka.</p>}
      </Panel>
    </>
  );
}

async function Kinerja({ id, supabase }: { id: string; supabase: Client }) {
  const [{ data: mine }, { data: team }] = await Promise.all([
    supabase.from('perf_review_register').select('*').eq('employee_id', id).order('period_start', { ascending: false }).returns<ReviewRow[]>(),
    supabase.from('perf_review_register').select('*').eq('is_manager', true).neq('cycle_status', 'closed').order('full_name').limit(500).returns<ReviewRow[]>(),
  ]);
  return (
    <>
      <Panel title="Penilaian saya" sub="Susun KPI, isi penilaian diri, lalu lihat hasil setelah HRGA menerbitkan.">
        {mine?.length ? <ReviewTable rows={mine} cycle /> : <p className="text-sm text-muted">Belum ada siklus penilaian untuk Anda.</p>}
      </Panel>
      {!!team?.length && (
        <Panel title={`Tim saya (${team.length})`} sub="Karyawan yang Anda nilai sebagai atasan langsung atau atasan departemen.">
          <ReviewTable rows={team} />
        </Panel>
      )}
    </>
  );
}
