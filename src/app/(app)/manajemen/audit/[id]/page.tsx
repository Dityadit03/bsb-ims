import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { byCode } from '@/lib/compliance';
import { AUDIT_STATUS, FINDING } from '@/lib/management';
import { addFinding, cancelAudit, closeAudit, removeFinding, reportAudit, startAudit } from '../../actions';
import { MgmtTabs } from '../../tabs';

type A = { id: string; audit_no: string; title: string; framework_code: string; scope: string; auditee_department_id: string | null;
  department_code: string | null; planned_start: string; planned_end: string; status: string; lead_auditor_id: string; lead_name: string;
  report_summary: string | null; reported_at: string | null; closed_at: string | null; cancel_reason: string | null; without_capa: number };
type F = { id: string; finding_ref: string; category: string; statement: string; evidence: string; clause_id: string; framework_code: string;
  clause_code: string; clause_title: string; department_id: string; department_code: string; recorded_by_name: string;
  capa_id: string | null; action_no: string | null; capa_status: string | null; needs_capa: boolean };

export default async function AuditDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: a } = await supabase.from('audit_register').select('*').eq('id', id).maybeSingle<A>();
  if (!a) notFound();
  const [{ data: team }, { data: findings }, { data: clauses }, { data: depts }] = await Promise.all([
    supabase.from('audit_team').select('user_id, team_role, profiles(full_name, email)').eq('audit_id', id),
    supabase.from('audit_finding_register').select('*').eq('audit_id', id).order('finding_no').returns<F[]>(),
    supabase.from('compliance_clauses').select('id, framework_code, code, title').eq('framework_code', a.framework_code).eq('active', true).neq('level', 'element'),
    supabase.from('departments').select('id, code').order('sort_order'),
  ]);
  const me = s.profile.id;
  const lead = a.lead_auditor_id === me;
  const member = (team ?? []).some(t => t.user_id === me);
  const people = (team ?? []) as unknown as { user_id: string; team_role: string; profiles: { full_name: string | null; email: string } }[];

  return (
    <>
      <PageHeader eyebrow={`Audit internal · ${a.department_code ?? 'Seluruh site'} · ${fmtDate(a.planned_start)} – ${fmtDate(a.planned_end)}`} title={`${a.audit_no} · ${a.title}`}>
        <Pill tone={AUDIT_STATUS[a.status][0]}>{AUDIT_STATUS[a.status][1]}</Pill>
      </PageHeader>
      <MgmtTabs active="/manajemen/audit" />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel title={`Temuan (${findings?.length ?? 0})`}>
            {findings?.length ? (
              <ul className="grid gap-3">
                {findings.map(f => (
                  <li key={f.id} className="grid gap-1 border-b border-line pb-3 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{f.finding_ref}</span><Pill tone={FINDING[f.category][0]}>{FINDING[f.category][1]}</Pill>
                      <span className="text-xs text-muted">{f.framework_code} {f.clause_code} · {f.department_code}</span>
                    </div>
                    <p className="text-sm">{f.statement}</p>
                    <p className="text-xs text-muted">Bukti: {f.evidence} · {f.recorded_by_name}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      {f.capa_id ? <Link href={`/capa/${f.capa_id}`} className="font-mono text-accent">{f.action_no} ({f.capa_status})</Link>
                        : f.needs_capa ? <>
                          <span className="text-crit">Belum ada action plan</span>
                          {s.can('capa.create') && <Link className="text-accent" href={`/capa/baru?tabel=audit_findings&sid=${f.id}&sumber=audit&ref=${encodeURIComponent(f.finding_ref)}&clause=${f.clause_id}&dept=${f.department_id}`}>Buat action plan →</Link>}
                        </> : null}
                      {member && a.status === 'in_progress' && <ActionForm action={removeFinding} label="Hapus" hidden={{ id: a.id, finding: f.id }} />}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Belum ada temuan.</p>}
            {member && a.status === 'in_progress' && (
              <ActionForm action={addFinding} label="Catat temuan" primary hidden={{ id: a.id }}>
                <div className="grid gap-2 sm:grid-cols-3">
                  <select name="category" className={input} aria-label="Kategori">{Object.entries(FINDING).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select>
                  <select name="clause" required className={`${input} sm:col-span-2`} aria-label="Persyaratan" defaultValue=""><option value="" disabled>Persyaratan yang diaudit</option>
                    {[...(clauses ?? [])].sort(byCode).map(c => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select>
                  {!a.auditee_department_id && <select name="department" required className={input} aria-label="Departemen" defaultValue=""><option value="" disabled>Departemen</option>
                    {(depts ?? []).map(d => <option key={d.id} value={d.id}>{d.code}</option>)}</select>}
                </div>
                <textarea name="statement" required rows={2} className={input} placeholder="Pernyataan temuan (persyaratan apa yang tidak dipenuhi)" />
                <textarea name="evidence" required rows={2} className={input} placeholder="Bukti objektif (dokumen, wawancara, observasi)" />
              </ActionForm>
            )}
          </Panel>
          {lead && a.status === 'planned' && <Panel title="Mulai audit"><ActionForm action={startAudit} label="Mulai audit" primary hidden={{ id: a.id }} /></Panel>}
          {lead && a.status === 'in_progress' && (
            <Panel title="Terbitkan laporan">
              <ActionForm action={reportAudit} label="Terbitkan laporan" primary hidden={{ id: a.id }}>
                <textarea name="summary" required rows={3} className={input} placeholder="Ringkasan hasil, kesimpulan pemenuhan, rekomendasi" />
                <p className="text-xs text-muted">Setelah laporan terbit, temuan terkunci.</p>
              </ActionForm>
            </Panel>
          )}
          {a.status === 'reported' && s.can('ia.manage') && !lead && (
            <Panel title="Tutup audit">
              {a.without_capa > 0 && <p className="text-sm text-crit">{a.without_capa} temuan mayor/minor belum punya action plan.</p>}
              <ActionForm action={closeAudit} label="Tutup audit" primary hidden={{ id: a.id }} />
            </Panel>
          )}
          {['planned', 'in_progress'].includes(a.status) && s.can('ia.manage') && (
            <Panel title="Batalkan">
              <ActionForm action={cancelAudit} label="Batalkan audit" hidden={{ id: a.id }}><input name="reason" required className={input} placeholder="Alasan" /></ActionForm>
            </Panel>
          )}
        </div>
        <div className="grid content-start gap-4">
          <Panel title="Lingkup">
            <p className="whitespace-pre-line text-sm">{a.scope}</p>
            {a.report_summary && <div className="rounded border border-line bg-ground p-3 text-sm"><div className="mb-1 text-xs text-muted">Laporan · {fmtDateTime(a.reported_at)}</div>{a.report_summary}</div>}
            {a.cancel_reason && <p className="text-sm text-crit">Dibatalkan: {a.cancel_reason}</p>}
            {a.closed_at && <p className="text-xs text-muted">Ditutup {fmtDateTime(a.closed_at)}</p>}
          </Panel>
          <Panel title="Tim audit">
            <ul className="grid gap-1 text-sm">{people.map(t => <li key={t.user_id}>{t.profiles.full_name ?? t.profiles.email}{t.team_role === 'lead' && <span className="text-xs text-muted"> · ketua</span>}</li>)}</ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
