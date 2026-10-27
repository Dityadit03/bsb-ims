import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { APP_STAGE, CAND_SOURCE, REQ_REASON, REQ_STATUS, rp } from '@/lib/hrga';
import { addApplicant, closeRequisition, decideOffer, decideRequisition, hire, recordResult, saveOffer } from '../actions';
import { CandidateFields, type ReqRow } from '../parts';
import { HrTabs } from '../../tabs';

export const metadata = { title: 'FPTK' };

type App = { id: string; candidate_id: string; full_name: string; phone: string | null; education_level: string | null; experience_years: number | null;
  domicile: string | null; is_local: boolean; source: string; stage: string; stage_at: string; close_reason: string | null; employee_id: string | null };
type Ev = { application_id: string; stage: string; result: string; score: number | null; note: string | null; created_at: string; by: { full_name: string } | null };
type Offer = { application_id: string; basic_wage: number; allowances: string | null; start_date: string; status: string };

const NEXT: Record<string, string[]> = { screening: ['psikotes', 'interview'], psikotes: ['interview'], interview: ['mcu', 'offering'], mcu: ['offering'] };
const RESULT: Record<string, string> = { pass: 'lulus', fail: 'tidak lulus', note: 'catatan', withdrawn: 'mundur' };

export default async function ReqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const isHr = session.canIn('hr.manage', 'HRGA');
  const supabase = await createClient();
  const { data: r } = await supabase.from('requisition_register').select('*').eq('id', id).maybeSingle<ReqRow>();
  if (!r) notFound();
  const [{ data: apps }, { data: evs }, { data: offers }, { data: bank }] = await Promise.all([
    supabase.from('application_register').select('*').eq('requisition_id', id).order('created_at').returns<App[]>(),
    supabase.from('application_events').select('application_id, stage, result, score, note, created_at, by:created_by(full_name)')
      .in('application_id', (await supabase.from('applications').select('id').eq('requisition_id', id)).data?.map(a => a.id) ?? []).order('created_at').returns<Ev[]>(),
    isHr ? supabase.from('job_offers').select('application_id, basic_wage, allowances, start_date, status') : Promise.resolve({ data: [] as Offer[] }),
    isHr ? supabase.from('candidates').select('id, full_name, nik').is('employee_id', null).order('full_name').limit(1000) : Promise.resolve({ data: [] as { id: string; full_name: string; nik: string | null }[] }),
  ]);
  const deptHead = session.canIn('hr.roster', r.department_code);
  const taken = new Set((apps ?? []).map(a => a.candidate_id));
  const offerOf = new Map(((offers ?? []) as Offer[]).map(o => [o.application_id, o]));
  const h = { req: id };

  return (
    <>
      <PageHeader eyebrow={`FPTK · ${r.req_no}`} title={`${r.position_name} · ${r.headcount} orang`}>
        <Link href="/hrga/rekrutmen" className="text-sm text-muted hover:text-accent">← Semua FPTK</Link>
      </PageHeader>
      <HrTabs active="/hrga/rekrutmen" />
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm [&_dt]:text-muted">
            <dt>Status</dt><dd><Pill tone={REQ_STATUS[r.status]?.[0] ?? 'muted'}>{REQ_STATUS[r.status]?.[1] ?? r.status}</Pill> <span className="tabular">{r.hired}/{r.headcount} terisi</span></dd>
            <dt>Departemen</dt><dd>{r.department_code} · {r.employment_type === 'contract' ? 'PKWT' : 'Karyawan tetap'}</dd>
            <dt>Alasan</dt><dd>{REQ_REASON[r.reason]}{r.replaced_name && ` · menggantikan ${r.replaced_name}`}</dd>
            <dt>Dibutuhkan</dt><dd className={r.overdue ? 'font-semibold text-crit' : ''}>{fmtDate(r.needed_by)}</dd>
            <dt>Kualifikasi</dt><dd>{r.requirements}</dd>
            {r.justification && <><dt>Kebutuhan</dt><dd>{r.justification}</dd></>}
            <dt>MPP jabatan ini</dt><dd>{r.mpp_planned == null ? <span className="text-warn">Belum ada rencana MPP tahun ini</span> : `aktual ${r.mpp_actual} dari rencana ${r.mpp_planned}`}</dd>
            <dt>Alur</dt><dd>{[r.requester_name, r.verifier_name, r.approver_name].filter(Boolean).join(' → ')}{r.decision_note && ` · ${r.decision_note}`}</dd>
          </dl>
          <div className="flex flex-wrap items-start gap-2">
            {r.can_decide && <>
              <ActionForm action={decideRequisition} label={r.status === 'submitted' ? 'Verifikasi' : 'Setujui, buka rekrutmen'} primary hidden={{ ...h, approve: '1' }} />
              <details className="text-sm"><summary className="cursor-pointer rounded-lg border border-line px-3.5 py-2 hover:border-crit/60">Tolak</summary>
                <ActionForm action={decideRequisition} label="Kirim penolakan" hidden={{ ...h, approve: '0' }} className="mt-2 w-60">
                  <input name="note" required placeholder="Alasan penolakan" className={input} /></ActionForm></details>
            </>}
            {isHr && ['submitted', 'verified', 'open'].includes(r.status) && (
              <details className="text-sm"><summary className="cursor-pointer rounded-lg border border-line px-3.5 py-2 hover:border-violet/60">Tutup FPTK</summary>
                <ActionForm action={closeRequisition} label="Tutup" confirm="Tutup permintaan tenaga kerja ini?" hidden={h} className="mt-2 w-64">
                  <select name="cancel" className={input}><option value="0">Ditutup (kebutuhan selesai)</option><option value="1">Dibatalkan</option></select>
                  <input name="reason" required placeholder="Alasan" className={input} />
                  <span className="text-xs text-muted">Pelamar yang masih proses dinyatakan tidak lolos.</span></ActionForm></details>
            )}
          </div>
        </div>
      </Panel>

      <Panel title={`Pelamar (${apps?.length ?? 0})`} sub="Tahap: seleksi berkas → psikotes → wawancara user (atasan departemen) → MCU → penawaran → diterima">
        {apps?.length ? (
          <div className="grid gap-3">
            {apps.map(a => {
              const ev = (evs ?? []).filter(e => e.application_id === a.id);
              const offer = offerOf.get(a.id);
              const canRecord = NEXT[a.stage] && (isHr || (a.stage === 'interview' && deptHead));
              return (
                <div key={a.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{a.full_name}{a.is_local && <span className="ml-1"><Pill tone="ok">lokal</Pill></span>}</p>
                      <p className="text-xs text-muted">{[a.education_level, a.experience_years != null ? `${Number(a.experience_years)} th pengalaman` : null, a.domicile, CAND_SOURCE[a.source], a.phone].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="text-right">
                      <Pill tone={APP_STAGE[a.stage]?.[0] ?? 'muted'}>{APP_STAGE[a.stage]?.[1] ?? a.stage}</Pill>
                      {a.close_reason && <p className="text-xs text-muted">{a.close_reason}</p>}
                      {a.employee_id && <Link href={`/hrga/${a.employee_id}`} className="block text-xs text-accent hover:underline">Lihat data karyawan</Link>}
                    </div>
                  </div>
                  {ev.length > 0 && (
                    <ol className="mt-2 grid gap-0.5 border-l-2 border-line pl-3 text-xs">
                      {ev.map((e, i) => <li key={i}><span className="font-medium">{APP_STAGE[e.stage]?.[1] ?? e.stage}</span>: {RESULT[e.result]}{e.score != null && ` · nilai ${Number(e.score)}`}{e.note && ` · ${e.note}`}
                        <span className="text-muted"> · {e.by?.full_name} · {fmtDate(e.created_at)}</span></li>)}
                    </ol>
                  )}
                  {canRecord && r.status === 'open' && (
                    <div className="mt-2 flex flex-wrap items-start gap-2">
                      <ActionForm action={recordResult} label={`Lulus ${low(APP_STAGE[a.stage][1])}`} primary hidden={{ ...h, app: a.id, result: 'pass' }} className="w-full grid-cols-2 md:w-auto md:grid-cols-[6rem_10rem_1fr_auto] md:items-end">
                        <input name="score" inputMode="decimal" placeholder="Nilai" aria-label="Nilai" className={input} />
                        <select name="next" aria-label="Tahap berikutnya" className={input}>{NEXT[a.stage].map(n => <option key={n} value={n}>Ke {low(APP_STAGE[n][1])}</option>)}</select>
                        <input name="note" placeholder="Catatan" className={`${input} col-span-2 md:col-span-1`} />
                      </ActionForm>
                      <details className="text-sm"><summary className="cursor-pointer rounded-lg border border-line px-3.5 py-2 hover:border-crit/60">Tidak lolos / mundur</summary>
                        <ActionForm action={recordResult} label="Simpan" hidden={{ ...h, app: a.id }} className="mt-2 w-64">
                          <select name="result" className={input}><option value="fail">Tidak lolos</option><option value="withdrawn">Mengundurkan diri</option></select>
                          <input name="score" inputMode="decimal" placeholder="Nilai (opsional)" className={input} />
                          <input name="note" required placeholder="Alasan" className={input} /></ActionForm></details>
                    </div>
                  )}
                  {isHr && a.stage === 'offering' && r.status === 'open' && (
                    <div className="mt-3 grid gap-2 rounded-lg bg-violet/5 p-3">
                      {offer && <p className="text-sm">Penawaran: gaji pokok <b>Rp {rp(offer.basic_wage)}</b>{offer.allowances && ` · ${offer.allowances}`} · mulai {fmtDate(offer.start_date)} ·{' '}
                        <Pill tone={offer.status === 'accepted' ? 'ok' : offer.status === 'declined' ? 'crit' : 'warn'}>{offer.status === 'accepted' ? 'diterima' : offer.status === 'declined' ? 'ditolak' : 'menunggu jawaban'}</Pill></p>}
                      {(!offer || offer.status === 'sent') && (
                        <ActionForm action={saveOffer} label={offer ? 'Ubah penawaran' : 'Catat penawaran'} hidden={{ ...h, app: a.id }} className="md:grid-cols-4 md:items-end">
                          <label className="grid gap-1 text-xs">Gaji pokok (Rp)<input name="wage" required inputMode="numeric" defaultValue={offer ? rp(offer.basic_wage) : ''} className={input} /></label>
                          <label className="grid gap-1 text-xs">Tunjangan<input name="allowances" defaultValue={offer?.allowances ?? ''} placeholder="mis. tunjangan site 750rb" className={input} /></label>
                          <label className="grid gap-1 text-xs">Mulai kerja<input type="date" name="start" required defaultValue={offer?.start_date ?? r.needed_by} className={input} /></label>
                          <label className="grid gap-1 text-xs">Catatan<input name="note" className={input} /></label>
                        </ActionForm>
                      )}
                      {offer?.status === 'sent' && (
                        <div className="flex flex-wrap gap-2">
                          <ActionForm action={decideOffer} label="Kandidat menerima" primary hidden={{ ...h, app: a.id, accepted: '1' }} />
                          <ActionForm action={decideOffer} label="Kandidat menolak" hidden={{ ...h, app: a.id, accepted: '0' }} />
                        </div>
                      )}
                      {offer?.status === 'accepted' && (
                        <ActionForm action={hire} label="Jadikan karyawan" primary hidden={{ ...h, app: a.id }} className="md:grid-cols-3 md:items-end">
                          <label className="grid gap-1 text-xs">NRP<input name="nrp" required placeholder="26.11.001" className={input} /></label>
                          <label className="grid gap-1 text-xs">Email akun (opsional)<input name="email" type="email" placeholder="harus sudah pernah login" className={input} /></label>
                          <span className="text-xs text-muted">Membuat data karyawan, kontrak {r.employment_type === 'contract' ? 'PKWT' : 'percobaan'} dan checklist mobilisasi. Payroll diberi tahu untuk mengisi gaji.</span>
                        </ActionForm>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : <p className="text-sm text-muted">Belum ada pelamar.</p>}
      </Panel>

      {isHr && r.status === 'open' && (
        <Panel title="Tambah pelamar">
          <div className="grid gap-4">
            {!!bank?.length && (
              <ActionForm action={addApplicant} label="Tambahkan" hidden={h} className="md:grid-cols-[1fr_auto] md:items-end">
                <label className="grid gap-1 text-sm">Dari bank kandidat<select name="existing" required className={input} defaultValue="">
                  <option value="" disabled>Pilih kandidat</option>
                  {bank.filter(c => !taken.has(c.id)).map(c => <option key={c.id} value={c.id}>{c.full_name}{c.nik ? ` · ${c.nik}` : ''}</option>)}</select></label>
              </ActionForm>
            )}
            <div><p className="mb-2 text-sm font-medium">Atau kandidat baru</p><CandidateFields action={addApplicant} label="Simpan & tambahkan" hidden={h} /></div>
          </div>
        </Panel>
      )}
      {r.status === 'open' && !isHr && deptHead && <p className="text-sm text-muted">Pelamar dicatat HRGA. Anda bisa mencatat hasil wawancara user saat pelamar sampai di tahap wawancara.</p>}
    </>
  );
}

// huruf kecil kecuali singkatan (MCU)
function low(s: string) { return s === s.toUpperCase() ? s : s.toLowerCase(); }
