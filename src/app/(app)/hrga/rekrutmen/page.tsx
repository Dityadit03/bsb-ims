import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { ExportLinks } from '@/components/export-links';
import { Tabs } from '@/components/tabs';
import { PageHeader, Pager, Panel, Pill, Stat, Table, input, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { APP_STAGE, CAND_SOURCE, REQ_REASON, REQ_STATUS, siteToday } from '@/lib/hrga';
import { EmployeeDatalist, EmployeeInput } from '../../she/fields';
import { candidateSave, createRequisition } from './actions';
import { CandidateFields, type ReqRow } from './parts';
import { HrTabs } from '../tabs';

export const metadata = { title: 'Rekrutmen' };

type AppRow = { id: string; requisition_id: string; req_no: string; department_code: string; position_name: string; full_name: string; education_level: string | null;
  experience_years: number | null; is_local: boolean; source: string; stage: string; stage_at: string; psikotes_score: number | null; interview_score: number | null };

const STAGES = ['screening', 'psikotes', 'interview', 'mcu', 'offering'];

export default async function RekrutmenPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const isHr = session.canIn('hr.manage', 'HRGA');
  const tab = sp.tab === 'pelamar' || (sp.tab === 'kandidat' && isHr) ? sp.tab : 'fptk';
  const supabase = await createClient();
  const [{ data: reqs }, { data: apps }] = await Promise.all([
    supabase.from('requisition_register').select('*').order('created_at', { ascending: false }).limit(1000).returns<ReqRow[]>(),
    supabase.from('application_register').select('*').order('stage_at', { ascending: false }).limit(5000).returns<AppRow[]>(),
  ]);
  const rq = reqs ?? [], ap = apps ?? [];
  const open = rq.filter(r => r.status === 'open');
  const active = ap.filter(a => STAGES.includes(a.stage));

  return (
    <>
      <PageHeader eyebrow="HRGA" title="Rekrutmen">{tab !== 'kandidat' && <ExportLinks dataset={tab === 'pelamar' ? 'pelamar' : 'fptk'} />}</PageHeader>
      <HrTabs active="/hrga/rekrutmen" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="FPTK perlu keputusan Anda" value={rq.filter(r => r.can_decide).length} tone={rq.some(r => r.can_decide) ? 'warn' : undefined} />
        <Stat label="Lowongan dibuka" value={open.reduce((a, r) => a + r.headcount - r.hired, 0)} note={`${open.length} FPTK`} />
        <Stat label="Pelamar dalam proses" value={active.length} note={STAGES.map(s => `${APP_STAGE[s][1]} ${active.filter(a => a.stage === s).length}`).join(' · ')} />
        <Stat label="FPTK lewat tanggal dibutuhkan" value={rq.filter(r => r.overdue).length} tone={rq.some(r => r.overdue) ? 'crit' : 'ok'} />
      </div>
      <Tabs items={[['/hrga/rekrutmen', 'Permintaan (FPTK)'], ['/hrga/rekrutmen?tab=pelamar', 'Pelamar'], ...(isHr ? [['/hrga/rekrutmen?tab=kandidat', 'Bank kandidat'] as const] : [])]}
        active={tab === 'fptk' ? '/hrga/rekrutmen' : `/hrga/rekrutmen?tab=${tab}`} />
      {tab === 'fptk' && <Requisitions rows={rq} sp={sp} supabase={supabase} />}
      {tab === 'pelamar' && <Applicants rows={ap} sp={sp} />}
      {tab === 'kandidat' && <Candidates sp={sp} supabase={supabase} />}
    </>
  );
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function Requisitions({ rows: all, sp, supabase }: { rows: ReqRow[]; sp: Record<string, string | undefined>; supabase: Client }) {
  const rows = sp.status ? all.filter(r => r.status === sp.status) : all;
  const pg = paginate(rows, sp.hal);
  // jabatan yang bisa diajukan: semua jabatan aktif (pengecekan wewenang departemen di database)
  const { data: positions } = await supabase.from('positions').select('id, name, level, department:department_id(code)').eq('active', true).not('department_id', 'is', null).order('name');
  const pos = (positions ?? []).map(p => ({ ...p, dept: (p.department as unknown as { code: string } | null)?.code ?? '' })).sort((a, b) => a.dept.localeCompare(b.dept));
  return (
    <>
      <Panel title="Permintaan tenaga kerja" sub="Alur: atasan departemen mengajukan → HRGA verifikasi terhadap MPP → PJO / manajemen menyetujui → rekrutmen dibuka"
        action={<form className="flex flex-wrap gap-2"><select aria-label="Status" name="status" defaultValue={sp.status ?? ''} className={`${input} max-w-52`}><option value="">Semua status</option>
          {Object.entries(REQ_STATUS).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
          <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Saring</button></form>}>
        {rows.length ? (
          <>
            <Table head={['No.', 'Jabatan', 'Jumlah', 'Alasan', 'Dibutuhkan', 'MPP', 'Pelamar', 'Status']}>
              {pg.rows.map(r => (
                <tr key={r.id}>
                  <td><Link href={`/hrga/rekrutmen/${r.id}`} className="font-mono text-xs font-semibold hover:text-accent">{r.req_no}</Link></td>
                  <td className="text-sm"><Link href={`/hrga/rekrutmen/${r.id}`} className="font-medium hover:text-accent">{r.position_name}</Link>
                    <span className="block text-xs text-muted">{r.department_code} · {r.employment_type === 'contract' ? 'PKWT' : 'Tetap'}</span></td>
                  <td className="tabular text-sm">{r.hired}/{r.headcount}</td>
                  <td className="text-sm">{REQ_REASON[r.reason]}{r.replaced_name && <span className="block text-xs text-muted">{r.replaced_name}</span>}</td>
                  <td className={`whitespace-nowrap text-sm ${r.overdue ? 'font-semibold text-crit' : ''}`}>{fmtDate(r.needed_by)}</td>
                  <td className="tabular text-xs text-muted">{r.mpp_planned == null ? 'belum ada MPP' : `${r.mpp_actual}/${r.mpp_planned}`}</td>
                  <td className="tabular text-sm">{r.applicants}{r.in_process > 0 && <span className="block text-xs text-muted">{r.in_process} proses</span>}</td>
                  <td><Pill tone={REQ_STATUS[r.status]?.[0] ?? 'muted'}>{REQ_STATUS[r.status]?.[1] ?? r.status}</Pill></td>
                </tr>
              ))}
            </Table>
            <Pager {...pg} params={{ status: sp.status }} />
          </>
        ) : <p className="text-sm text-muted">Belum ada FPTK.</p>}
      </Panel>
      <Panel title="Ajukan FPTK" sub="Diajukan atasan departemen (Supervisor / Superintendent / Dept Head) atau HRGA.">
        <EmployeeDatalist />
        <ActionForm action={createRequisition} label="Ajukan FPTK" primary hidden={{ idem: crypto.randomUUID() }} className="md:grid-cols-3 md:items-end">
          <label className="grid gap-1 text-sm md:col-span-2">Jabatan<select name="position" required className={input} defaultValue="">
            <option value="" disabled>Pilih jabatan</option>
            {pos.map(p => <option key={p.id} value={p.id}>{p.dept} · {p.name} ({p.level})</option>)}</select></label>
          <label className="grid gap-1 text-sm">Jumlah orang<input type="number" name="headcount" min={1} max={200} defaultValue={1} className={input} /></label>
          <label className="grid gap-1 text-sm">Status kerja<select name="type" className={input}><option value="contract">PKWT (kontrak)</option><option value="permanent">Tetap (percobaan 3 bulan)</option></select></label>
          <label className="grid gap-1 text-sm">Alasan<select name="reason" className={input}>{Object.entries(REQ_REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Dibutuhkan tanggal<input type="date" name="needed_by" required min={siteToday()} className={input} /></label>
          <EmployeeInput name="replaced" label="Karyawan yang digantikan" hint="Wajib bila alasan Pengganti" />
          <label className="grid gap-1 text-sm md:col-span-2">Kualifikasi<input name="requirements" required placeholder="mis. SIM B2 umum, pengalaman DT minimal 1 tahun, domisili Kutai Barat" className={input} /></label>
          <label className="grid gap-1 text-sm md:col-span-3">Alasan kebutuhan<input name="justification" placeholder="mis. penambahan unit DT bulan Desember" className={input} /></label>
        </ActionForm>
      </Panel>
    </>
  );
}

function Applicants({ rows: all, sp }: { rows: AppRow[]; sp: Record<string, string | undefined> }) {
  const stage = sp.stage ?? 'aktif';
  const rows = stage === 'aktif' ? all.filter(a => STAGES.includes(a.stage)) : stage === 'all' ? all : all.filter(a => a.stage === stage);
  const pg = paginate(rows, sp.hal);
  return (
    <Panel title="Pelamar" action={<form className="flex flex-wrap gap-2"><input type="hidden" name="tab" value="pelamar" />
      <select aria-label="Tahap" name="stage" defaultValue={stage} className={`${input} max-w-48`}><option value="aktif">Dalam proses</option><option value="all">Semua</option>
        {Object.entries(APP_STAGE).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
      <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Saring</button></form>}>
      {rows.length ? (
        <>
          <Table head={['Nama', 'FPTK', 'Pendidikan', 'Pengalaman', 'Psikotes', 'Wawancara', 'Tahap']}>
            {pg.rows.map(a => (
              <tr key={a.id}>
                <td className="text-sm font-medium">{a.full_name}{a.is_local && <span className="ml-1"><Pill tone="ok">lokal</Pill></span>}
                  <span className="block text-xs text-muted">{CAND_SOURCE[a.source]}</span></td>
                <td className="text-sm"><Link href={`/hrga/rekrutmen/${a.requisition_id}`} className="hover:text-accent">{a.position_name}</Link>
                  <span className="block font-mono text-xs text-muted">{a.req_no} · {a.department_code}</span></td>
                <td className="text-sm">{a.education_level ?? '–'}</td>
                <td className="tabular text-sm">{a.experience_years != null ? `${Number(a.experience_years)} th` : '–'}</td>
                <td className="tabular text-sm">{a.psikotes_score ?? '–'}</td>
                <td className="tabular text-sm">{a.interview_score ?? '–'}</td>
                <td><Pill tone={APP_STAGE[a.stage]?.[0] ?? 'muted'}>{APP_STAGE[a.stage]?.[1] ?? a.stage}</Pill>
                  <span className="block text-xs text-muted">sejak {fmtDate(a.stage_at)}</span></td>
              </tr>
            ))}
          </Table>
          <Pager {...pg} params={{ tab: 'pelamar', stage }} />
        </>
      ) : <p className="text-sm text-muted">Belum ada pelamar.</p>}
    </Panel>
  );
}

type Cand = { id: string; full_name: string; nik: string | null; phone: string | null; education_level: string | null; education_major: string | null;
  experience_years: number | null; last_employer: string | null; domicile: string | null; source: string; is_local: boolean; employee_id: string | null; created_at: string };

async function Candidates({ sp, supabase }: { sp: Record<string, string | undefined>; supabase: Client }) {
  let q = supabase.from('candidates').select('*').order('created_at', { ascending: false }).limit(2000);
  if (sp.q) q = q.or(`full_name.ilike.%${sp.q.replace(/[%,()]/g, '')}%,nik.ilike.%${sp.q.replace(/[%,()]/g, '')}%`);
  const { data } = await q.returns<Cand[]>();
  const pg = paginate(data ?? [], sp.hal);
  return (
    <>
      <Panel title="Bank kandidat" sub="Data pribadi pelamar; hanya HRGA. Massal: Impor data → Bank kandidat."
        action={<form className="flex flex-wrap gap-2"><input type="hidden" name="tab" value="kandidat" />
          <input name="q" defaultValue={sp.q ?? ''} placeholder="Nama / NIK" className={`${input} max-w-48`} />
          <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Cari</button></form>}>
        {pg.rows.length ? (
          <>
            <Table head={['Nama', 'NIK', 'HP', 'Pendidikan', 'Pengalaman', 'Domisili', 'Sumber']}>
              {pg.rows.map(c => (
                <tr key={c.id}>
                  <td className="text-sm font-medium">{c.full_name}{c.is_local && <span className="ml-1"><Pill tone="ok">lokal</Pill></span>}
                    {c.employee_id && <span className="ml-1"><Pill tone="accent">karyawan</Pill></span>}</td>
                  <td className="font-mono text-xs">{c.nik ?? '–'}</td>
                  <td className="text-sm">{c.phone ?? '–'}</td>
                  <td className="text-sm">{[c.education_level, c.education_major].filter(Boolean).join(' ') || '–'}</td>
                  <td className="text-sm">{c.experience_years != null ? `${Number(c.experience_years)} th` : '–'}{c.last_employer && <span className="block text-xs text-muted">{c.last_employer}</span>}</td>
                  <td className="text-sm">{c.domicile ?? '–'}</td>
                  <td className="text-sm">{CAND_SOURCE[c.source]}</td>
                </tr>
              ))}
            </Table>
            <Pager {...pg} params={{ tab: 'kandidat', q: sp.q }} />
          </>
        ) : <p className="text-sm text-muted">Belum ada kandidat.</p>}
      </Panel>
      <Panel title="Tambah kandidat"><CandidateFields action={candidateSave} label="Simpan kandidat" /></Panel>
    </>
  );
}
