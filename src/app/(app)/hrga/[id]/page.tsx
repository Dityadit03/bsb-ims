import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { COMP_CATEGORY, EMPLOYMENT, ROSTER, VALIDITY, pctTone } from '@/lib/hrga';
import { addCompetency, exitEmployee, revokeCompetency } from '../actions';
import { HrTabs } from '../tabs';
import { today } from '../../she/fields';

type Emp = { id: string; nrp: string; full_name: string; department_code: string; position_name: string | null; employment_type: string;
  company: string | null; join_date: string | null; status: string; exit_date: string | null; email: string | null;
  required: number; compliant: number; compliance_pct: number | null };
type Comp = { id: string; competency_code: string; competency_name: string; category: string; cert_no: string | null; issuer: string | null;
  issued_on: string; valid_until: string | null; validity: string; days_left: number | null; revoke_reason: string | null };

export default async function EmployeeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: e } = await supabase.from('employee_register').select('*').eq('id', id).maybeSingle<Emp>();
  if (!e) notFound();
  const from = today();
  const [{ data: comps }, { data: matrix }, { data: masters }, { data: roster }] = await Promise.all([
    supabase.from('employee_competency_view').select('*').eq('employee_id', id).order('issued_on', { ascending: false }).returns<Comp[]>(),
    supabase.from('competency_matrix').select('competency_code, competency_name, status, valid_until').eq('employee_id', id).order('competency_code'),
    supabase.from('competencies').select('id, code, name').eq('active', true).order('code'),
    supabase.from('roster_entries').select('work_date, code').eq('employee_id', id).gte('work_date', from).order('work_date').limit(14),
  ]);
  const hr = s.canIn('hr.manage', 'HRGA');
  const active = e.status === 'active';

  return (
    <>
      <PageHeader eyebrow={`${e.nrp} · ${e.department_code}${e.position_name ? ` · ${e.position_name}` : ''}`} title={e.full_name}>
        {active ? (e.required ? <Pill tone={pctTone(e.compliance_pct)}>Kompetensi {e.compliance_pct}%</Pill> : null) : <Pill tone="muted">Keluar {fmtDate(e.exit_date)}</Pill>}
      </PageHeader>
      <HrTabs active="/hrga" />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          {matrix?.length ? (
            <Panel title="Kompetensi wajib jabatan">
              <ul className="grid gap-2 text-sm sm:grid-cols-2">{matrix.map(m => (
                <li key={m.competency_code} className="flex items-center justify-between gap-2 border-b border-line py-1">
                  <span><span className="font-mono text-xs">{m.competency_code}</span> · {m.competency_name}</span>
                  <Pill tone={VALIDITY[m.status][0]}>{VALIDITY[m.status][1]}{m.valid_until ? ` · s.d. ${fmtDate(m.valid_until)}` : ''}</Pill>
                </li>))}</ul>
            </Panel>
          ) : null}
          <Panel title="Sertifikat, lisensi & pelatihan">
            {comps?.length ? (
              <Table head={['Kompetensi', 'No.', 'Terbit', 'Berlaku s.d.', 'Status', ...(active ? [''] : [])]}>
                {comps.map(c => (
                  <tr key={c.id}>
                    <td className="text-sm"><span className="font-mono text-xs">{c.competency_code}</span> · {c.competency_name}
                      <div className="text-xs text-muted">{COMP_CATEGORY[c.category]}{c.issuer ? ` · ${c.issuer}` : ''}</div></td>
                    <td className="font-mono text-xs">{c.cert_no ?? '–'}</td>
                    <td className="text-xs">{fmtDate(c.issued_on)}</td>
                    <td className="text-xs">{c.valid_until ? fmtDate(c.valid_until) : 'Seumur hidup'}</td>
                    <td><Pill tone={VALIDITY[c.validity][0]}>{VALIDITY[c.validity][1]}{c.validity === 'expiring' ? ` (${c.days_left} hari)` : ''}</Pill>
                      {c.revoke_reason && <div className="text-xs text-crit">{c.revoke_reason}</div>}</td>
                    {active && <td>{c.validity !== 'revoked' && c.validity !== 'expired' && (
                      <details><summary className="cursor-pointer text-xs text-muted">Cabut</summary>
                        <ActionForm action={revokeCompetency} label="Cabut" hidden={{ id: c.id, employee: e.id }}>
                          <input name="reason" required className={input} placeholder="Alasan pencabutan" /></ActionForm></details>)}</td>}
                  </tr>
                ))}
              </Table>
            ) : <p className="text-sm text-muted">Belum ada kompetensi tercatat.</p>}
            {hr && active && (
              <ActionForm action={addCompetency} label="Catat kompetensi" primary hidden={{ employee: e.id }}>
                <div className="grid gap-2 sm:grid-cols-3">
                  <select name="competency" required className={input} aria-label="Kompetensi">{(masters ?? []).map(m => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select>
                  <input name="cert_no" className={input} placeholder="No. sertifikat / SIMPER" />
                  <input name="issuer" className={input} placeholder="Penerbit / lembaga" />
                  <label className="grid gap-1 text-xs">Tanggal terbit<input type="date" name="issued" required max={from} defaultValue={from} className={input} /></label>
                  <label className="grid gap-1 text-xs">Berlaku s.d. (kosong = sesuai master)<input type="date" name="valid_until" className={input} /></label>
                </div>
                <p className="text-xs text-muted">SIMPER hanya bisa dicatat bila induksi dan MCU masih berlaku.</p>
              </ActionForm>
            )}
          </Panel>
        </div>
        <div className="grid content-start gap-4">
          <Panel title="Rincian">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
              <dt>Status kerja</dt><dd>{EMPLOYMENT[e.employment_type]}{e.company ? ` · ${e.company}` : ''}</dd>
              <dt>Masuk</dt><dd>{fmtDate(e.join_date)}</dd>
              <dt>Akun</dt><dd>{e.email ?? '–'}</dd>
            </dl>
          </Panel>
          <Panel title="Roster 14 hari" action={<Link href="/hrga/roster" className="text-xs text-accent">Ubah →</Link>}>
            {roster?.length ? <ul className="grid grid-cols-2 gap-1 text-xs">{roster.map(r => <li key={r.work_date} className="flex justify-between gap-2">
              <span>{fmtDate(r.work_date)}</span><Pill tone={ROSTER[r.code][0]}>{ROSTER[r.code][1]}</Pill></li>)}</ul>
              : <p className="text-sm text-muted">Belum ada roster.</p>}
          </Panel>
          {active && s.canIn('hr.exit', 'HRGA') && (
            <Panel title="Proses keluar">
              <ActionForm action={exitEmployee} label="Proses keluar" hidden={{ employee: e.id }}>
                <input type="date" name="date" required max={from} defaultValue={from} className={input} aria-label="Tanggal keluar" />
                <input name="reason" required className={input} placeholder="Alasan (resign, habis kontrak, PHK)" />
                <p className="text-xs text-muted">Akun aplikasi karyawan ini langsung dinonaktifkan dan semua perannya berakhir.</p>
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
