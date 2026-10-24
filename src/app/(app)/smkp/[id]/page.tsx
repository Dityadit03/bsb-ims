import Link from 'next/link';
import { DropZone } from '@/components/drop-zone';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, btnPrimary, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { CAPA_STATUS, FREQUENCY, RISK, clauseHealth } from '@/lib/compliance';
import { fmtDate } from '@/lib/documents';
import { linkEvidence, reviewEvidence } from '../actions';

type Clause = {
  id: string; parent_id: string | null; framework_code: string; code: string; title: string; description: string | null; evidence_expectation: string | null;
  applicability: string; applicability_note: string | null; source_verified: boolean;
  parent: { code: string; title: string } | null; departments: { code: string; name: string } | null;
};
type Evidence = {
  id: string; source_table: string; source_id: string; label: string; status: string; linked_at: string; linked_by: string;
  period_start: string | null; period_end: string | null; review_note: string | null;
  linker: { full_name: string | null } | null; reviewer: { full_name: string | null } | null;
};

const EV_STATUS: Record<string, ['ok' | 'warn' | 'crit', string]> = { submitted: ['warn', 'Menunggu'], accepted: ['ok', 'Diterima'], rejected: ['crit', 'Ditolak'] };

export default async function ClausePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: c } = await supabase.from('compliance_clauses')
    .select('*, parent:parent_id(code, title), departments:owner_department_id(code, name)').eq('id', id).maybeSingle<Clause>();
  if (!c) notFound();

  const [{ data: status }, { data: controls }, { data: evidence }, { data: actions }, { data: docs }, { data: maps }] = await Promise.all([
    supabase.from('compliance_clause_status').select('*').eq('id', id).single(),
    supabase.from('compliance_controls').select('id, title, control_type, frequency, document_type_code').eq('clause_id', id).eq('active', true),
    supabase.from('evidence_links').select('*, linker:linked_by(full_name), reviewer:reviewed_by(full_name)').eq('clause_id', id)
      .order('linked_at', { ascending: false }).returns<Evidence[]>(),
    supabase.from('capa_register').select('id, action_no, title, status, risk_level, due_date, is_overdue, pic_name').eq('clause_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('document_register').select('id, document_number, title').in('status', ['effective', 'under_revision']).order('document_number').limit(500),
    supabase.from('clause_mappings').select('mapped:mapped_clause_id(framework_code, code, title)').eq('clause_id', c.parent_id ?? id)
      .returns<{ mapped: { framework_code: string; code: string; title: string } }[]>(),
  ]);
  const [tone, label] = status ? clauseHealth(status) : ['muted' as const, '–'];
  const canAssess = s.can('compliance.assess');
  const href = (e: Evidence) => e.source_table === 'documents' ? `/dokumen/${e.source_id}` : e.source_table === 'corrective_actions' ? `/capa/${e.source_id}` : null;

  return (
    <>
      <PageHeader eyebrow={`SMKP · Elemen ${c.parent?.code ?? c.code} ${c.parent?.title ?? ''}`} title={`${c.code} ${c.title}`}>
        <Pill tone={tone}>{label}</Pill>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 gap-4">
          <Panel title="Bukti objektif">
            {evidence?.length ? (
              <Table head={['Bukti', 'Periode', 'Dikirim', 'Status', '']}>
                {evidence.map(e => {
                  const [t, l] = EV_STATUS[e.status];
                  const link = href(e);
                  return (
                    <tr key={e.id}>
                      <td className="min-w-56">{link ? <Link href={link} className="hover:text-accent">{e.label}</Link> : e.label}
                        <div className="font-mono text-[10px] text-muted">{e.source_table === 'attachments' ? 'berkas unggahan' : e.source_table.replace('_', ' ')}</div></td>
                      <td className="whitespace-nowrap text-xs">{e.period_start ? `${fmtDate(e.period_start)} – ${fmtDate(e.period_end)}` : '–'}</td>
                      <td className="text-xs">{e.linker?.full_name ?? '–'}<div className="text-muted">{fmtDate(e.linked_at)}</div></td>
                      <td><Pill tone={t}>{l}</Pill>{e.review_note && <div className="mt-1 text-xs text-muted">{e.review_note}</div>}</td>
                      <td className="min-w-48">
                        {canAssess && e.status === 'submitted' && e.linked_by !== s.profile.id && (
                          <ActionForm action={reviewEvidence} label="Simpan" hidden={{ link: e.id, clause: c.id }}>
                            <select name="decision" className={input} aria-label="Keputusan"><option value="accept">Terima</option><option value="reject">Tolak</option></select>
                            <input name="note" placeholder="Catatan (wajib bila ditolak)" className={input} aria-label="Catatan" />
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            ) : <p className="text-sm text-muted">Belum ada bukti untuk persyaratan ini.</p>}
          </Panel>
          <Panel title="Action plan terkait" action={<Link href={`/capa/baru?clause=${c.id}`} className={btnPrimary}>Buat action plan</Link>}>
            {actions?.length ? (
              <Table head={['Nomor', 'Judul', 'Risiko', 'Target', 'PIC', 'Status']}>
                {actions.map(a => (
                  <tr key={a.id}>
                    <td className="font-mono text-xs"><Link href={`/capa/${a.id}`} className="hover:text-accent">{a.action_no}</Link></td>
                    <td>{a.title}</td>
                    <td><Pill tone={RISK[a.risk_level][0]}>{RISK[a.risk_level][1]}</Pill></td>
                    <td className={`whitespace-nowrap text-xs ${a.is_overdue ? 'font-medium text-crit' : ''}`}>{fmtDate(a.due_date)}</td>
                    <td className="text-xs">{a.pic_name}</td>
                    <td><Pill tone={CAPA_STATUS[a.status][0]}>{CAPA_STATUS[a.status][1]}</Pill></td>
                  </tr>
                ))}
              </Table>
            ) : <p className="text-sm text-muted">Tidak ada action plan.</p>}
          </Panel>
        </div>
        <div className="grid content-start gap-4">
          <Panel title="Persyaratan">
            <dl className="grid gap-2 text-sm">
              <div><dt className="text-xs text-muted">Pemilik proses</dt><dd>{c.departments ? `${c.departments.code} · ${c.departments.name}` : '–'}</dd></div>
              {c.description && <div><dt className="text-xs text-muted">Uraian</dt><dd>{c.description}</dd></div>}
              {c.evidence_expectation && <div><dt className="text-xs text-muted">Bukti yang diharapkan</dt><dd>{c.evidence_expectation}</dd></div>}
              {c.applicability !== 'applicable' && <div><dt className="text-xs text-muted">Penerapan</dt><dd>{c.applicability_note}</dd></div>}
              {(maps ?? []).length > 0 && <div><dt className="text-xs text-muted">Pemetaan</dt>
                <dd className="font-mono text-xs">{(maps ?? []).map(m => `${m.mapped.framework_code} §${m.mapped.code}`).join(' · ')}</dd></div>}
              {!c.source_verified && <div className="text-xs text-warn">Rincian belum divalidasi terhadap Lampiran IV / Kepdirjen 185.K/30/DJB/2019.</div>}
            </dl>
          </Panel>
          <Panel title="Kontrol">
            {controls?.length ? (
              <ul className="grid gap-2 text-sm">
                {controls.map(k => <li key={k.id}>{k.title}<div className="font-mono text-[11px] text-muted">{FREQUENCY[k.frequency]}{k.document_type_code ? ` · ${k.document_type_code}` : ''}</div></li>)}
              </ul>
            ) : <p className="text-sm text-muted">Belum ada kontrol.</p>}
          </Panel>
          <Panel title="Kirim bukti">
            <ActionForm action={linkEvidence} label="Kirim" primary hidden={{ clause: c.id }}>
              <label className="grid gap-1 text-sm">Keterangan<input name="label" required className={input} placeholder="mis. Notulen P2K3 Oktober 2026" /></label>
              <label className="grid gap-1 text-sm">Dokumen terkendali
                <select name="document" className={input} defaultValue="">
                  <option value="">— atau unggah berkas di bawah —</option>
                  {(docs ?? []).map(d => <option key={d.id} value={d.id}>{d.document_number} · {d.title}</option>)}
                </select>
              </label>
              <DropZone name="file" label="Berkas" multiple={false} />
              {(controls ?? []).length > 0 && (
                <label className="grid gap-1 text-sm">Kontrol
                  <select name="control" className={input} defaultValue=""><option value="">–</option>
                    {(controls ?? []).map(k => <option key={k.id} value={k.id}>{k.title}</option>)}</select>
                </label>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-sm">Periode mulai<input type="date" name="period_start" className={input} /></label>
                <label className="grid gap-1 text-sm">Periode akhir<input type="date" name="period_end" className={input} /></label>
              </div>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </>
  );
}

