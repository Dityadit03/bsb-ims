import { randomUUID } from 'node:crypto';
import { ExportLinks } from '@/components/export-links';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Stat, Table, btnGhost, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { OPEN_CLOSED, SANCTION, VIOLATION_TYPE } from '@/lib/she';
import { closeViolation, followupViolation, recordViolation } from '../portal-actions';
import { AreaSelect, AttachmentList, DeptSelect, EmployeeDatalist, EmployeeInput, Files, SheTabs, sheMasters, today } from '../fields';

export const metadata = { title: 'Pelanggaran GR & SPDK' };

type Row = {
  id: string; violation_no: string; occurred_on: string; offender_name: string; nrp: string | null; company: string | null;
  department_code: string; violation_type: string; chronology: string; sanction: string | null; sp_no: string | null; sp_date: string | null;
  counseling_on: string | null; counselor: string | null; counseling_result: string | null; refresh_training: string | null;
  status: string; repeat_no: number; missing: string[]; location_note: string | null;
};

export default async function ViolationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('violation_register').select('*').order('occurred_on', { ascending: false }).limit(300);
  if (sp.status) q = q.eq('status', sp.status);
  if (sp.jenis) q = q.eq('violation_type', sp.jenis);
  if (sp.q) q = q.or(`offender_name.ilike.%${sp.q.replace(/[%,()]/g, '')}%,sp_no.ilike.%${sp.q.replace(/[%,()]/g, '')}%`);
  const [{ data }, { depts, areas }] = await Promise.all([q.returns<Row[]>(), sheMasters()]);
  const rows = data ?? [];
  const write = s.canIn('she.discipline', 'HSE');
  const open = rows.filter(r => r.status === 'open');

  return (
    <>
      <PageHeader eyebrow="Golden Rules & SPDK · SMKP 3.5 · Disiplin" title="Pelanggaran"><ExportLinks dataset="pelanggaran" /></PageHeader>
      <SheTabs active="/she/pelanggaran" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tercatat" value={rows.length} />
        <Stat label="Open" value={open.length} />
        <Stat label="Belum lengkap" value={open.filter(r => r.missing.length).length} note="Sanksi, SP atau konseling" />
        <Stat label="Berulang" value={rows.filter(r => r.repeat_no > 1).length} note="Dalam 12 bulan" />
      </div>
      {write && (
        <Panel title="Catat pelanggaran">
          <ActionForm action={recordViolation} label="Simpan pelanggaran" primary hidden={{ idem: randomUUID() }} className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Tanggal<input type="date" name="date" required defaultValue={today()} max={today()} className={input} /></label>
              <EmployeeInput label="Karyawan" hint="Kosongkan bila pelanggar bukan karyawan terdata" />
              <label className="grid gap-1 text-sm">Nama (non-karyawan)<input name="name" className={input} /></label>
              <label className="grid gap-1 text-sm">Perusahaan<input name="company" className={input} placeholder="Subkon / vendor" /></label>
              <DeptSelect depts={depts} label="Departemen" />
              <label className="grid gap-1 text-sm">Jenis
                <select name="type" required className={input}>{Object.entries(VIOLATION_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <AreaSelect areas={areas} />
              <label className="grid gap-1 text-sm">Detail lokasi<input name="location" className={input} /></label>
              <label className="grid gap-1 text-sm">Sumber temuan<input name="source" className={input} placeholder="Patroli, dashcam, observasi…" /></label>
            </div>
            <label className="grid gap-1 text-sm">Kronologi<textarea name="chronology" required rows={3} className={input} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">Sanksi awal
                <select name="sanction" className={input} defaultValue=""><option value="">Belum ditetapkan</option>
                  {Object.entries(SANCTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <Files label="Bukti (foto / video)" />
            </div>
            <EmployeeDatalist />
          </ActionForm>
        </Panel>
      )}
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Nama / No. SP" className={`${input} w-48`} aria-label="Cari" />
        <select name="jenis" defaultValue={sp.jenis ?? ''} className={`${input} w-auto`} aria-label="Jenis">
          <option value="">Semua jenis</option>{Object.entries(VIOLATION_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className={`${input} w-auto`} aria-label="Status">
          <option value="">Semua status</option><option value="open">Open</option><option value="closed">Closed</option>
        </select>
        <button className={btnGhost}>Saring</button>
      </form>
      {rows.length ? (
        <Table head={['Nomor', 'Tanggal', 'Pelanggar', 'Dept', 'Jenis', 'Sanksi', 'Konseling', 'Status']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs">{r.violation_no}</td>
              <td className="tabular whitespace-nowrap text-xs">{fmtDate(r.occurred_on)}</td>
              <td className="min-w-56">
                <div className="font-medium">{r.offender_name}{r.repeat_no > 1 && <span className="ml-2"><Pill tone="crit">ke-{r.repeat_no}</Pill></span>}</div>
                <div className="text-xs text-muted">{[r.nrp, r.company].filter(Boolean).join(' · ')}</div>
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-accent">Detail & tindak lanjut</summary>
                  <div className="mt-2 grid gap-2">
                    <p className="whitespace-pre-line">{r.chronology}</p>
                    {r.sp_no && <p>SP: {r.sp_no} · {fmtDate(r.sp_date)}</p>}
                    {r.counseling_result && <p>Konseling {fmtDate(r.counseling_on)} oleh {r.counselor}: {r.counseling_result}</p>}
                    {r.refresh_training && <p>Refresh training: {r.refresh_training}</p>}
                    <AttachmentList table="violations" ids={[r.id]} />
                    {write && r.status === 'open' && (
                      <>
                        <ActionForm action={followupViolation} label="Simpan tindak lanjut" hidden={{ id: r.id }}>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <select name="sanction" defaultValue={r.sanction ?? ''} className={input} aria-label="Sanksi">
                              <option value="">Sanksi</option>{Object.entries(SANCTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            </select>
                            <input name="sp_no" defaultValue={r.sp_no ?? ''} placeholder="No. SP" className={input} />
                            <input type="date" name="sp_date" defaultValue={r.sp_date ?? ''} className={input} aria-label="Tanggal SP" />
                            <input type="date" name="counseling_on" defaultValue={r.counseling_on ?? ''} className={input} aria-label="Tanggal konseling" />
                            <input name="counselor" defaultValue={r.counselor ?? ''} placeholder="Konselor" className={input} />
                            <input name="refresh" defaultValue={r.refresh_training ?? ''} placeholder="Refresh training" className={input} />
                          </div>
                          <textarea name="counseling_result" defaultValue={r.counseling_result ?? ''} rows={2} placeholder="Hasil konseling" className={input} />
                          <Files label="SP / form konseling" />
                        </ActionForm>
                        <ActionForm action={closeViolation} label="Tutup (closed)" hidden={{ id: r.id }}>
                          <input name="note" placeholder="Catatan penutupan (opsional)" className={input} />
                        </ActionForm>
                      </>
                    )}
                  </div>
                </details>
              </td>
              <td className="font-mono text-xs">{r.department_code}</td>
              <td className="text-xs">{VIOLATION_TYPE[r.violation_type]}</td>
              <td className="text-xs">{r.sanction ? SANCTION[r.sanction] : '–'}</td>
              <td className="tabular whitespace-nowrap text-xs">{r.counseling_on ? fmtDate(r.counseling_on) : '–'}</td>
              <td>{r.status === 'open' && r.missing.length
                ? <Pill tone="warn">Kurang: {r.missing.join(', ')}</Pill>
                : <Pill tone={OPEN_CLOSED[r.status][0]}>{OPEN_CLOSED[r.status][1]}</Pill>}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada pelanggaran yang bisa Anda lihat untuk saringan ini.</p>}
      <p className="text-xs text-muted">Data pelanggaran hanya terlihat oleh HSE, atasan departemen pelanggar, PJO dan pelanggar sendiri. Lampiran SP dan konseling berklasifikasi terbatas.</p>
    </>
  );
}
