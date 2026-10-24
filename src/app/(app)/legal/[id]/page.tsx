import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, btnGhost, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { COMPLIANCE, FREQUENCY, LEGAL_STATUS, byCode } from '@/lib/compliance';
import { fmtDate } from '@/lib/documents';
import { addObligation, evaluateObligation } from '../../smkp/actions';

type Req = {
  id: string; register_no: string; title: string; regulation_no: string; regulation_type: string; issuer: string | null; issued_date: string | null;
  status: string; status_note: string | null; source_url: string | null; summary: string | null; next_review_at: string | null;
  departments: { code: string; name: string } | null;
};
type Ob = {
  id: string; article_ref: string | null; obligation: string; frequency: string; compliance_status: string;
  last_evaluated_at: string | null; next_evaluation_at: string | null; clause: { id: string; code: string } | null;
};

export default async function LegalDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: r } = await supabase.from('legal_requirements').select('*, departments:owner_department_id(code, name)').eq('id', id).maybeSingle<Req>();
  if (!r) notFound();
  const [{ data: obs }, { data: clauses }] = await Promise.all([
    supabase.from('legal_obligations').select('id, article_ref, obligation, frequency, compliance_status, last_evaluated_at, next_evaluation_at, clause:clause_id(id, code)')
      .eq('legal_requirement_id', id).order('created_at').returns<Ob[]>(),
    supabase.from('compliance_clauses').select('id, code, title').eq('framework_code', 'SMKP').neq('level', 'element'),
  ]);
  const canEval = s.can('legal.manage') || s.can('compliance.assess');

  return (
    <>
      <PageHeader eyebrow={`Legal register · ${r.register_no}`} title={r.regulation_no}>
        <Pill tone={LEGAL_STATUS[r.status][0]}>{LEGAL_STATUS[r.status][1]}</Pill>
      </PageHeader>
      <Panel title={r.title}>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted">Jenis</dt><dd>{r.regulation_type}</dd></div>
          <div><dt className="text-xs text-muted">Penerbit</dt><dd>{r.issuer ?? '–'}</dd></div>
          <div><dt className="text-xs text-muted">Pemilik</dt><dd>{r.departments?.code ?? '–'}</dd></div>
          <div><dt className="text-xs text-muted">Tinjau ulang</dt><dd>{fmtDate(r.next_review_at)}</dd></div>
        </dl>
        {r.summary && <p className="text-sm">{r.summary}</p>}
        {r.source_url && <a href={r.source_url} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">Buka sumber resmi ↗</a>}
      </Panel>
      <Panel title="Kewajiban dan evaluasi kepatuhan">
        {obs?.length ? (
          <Table head={['Pasal', 'Kewajiban', 'SMKP', 'Frekuensi', 'Evaluasi', 'Status', '']}>
            {obs.map(o => (
              <tr key={o.id}>
                <td className="whitespace-nowrap text-xs">{o.article_ref ?? '–'}</td>
                <td className="min-w-64 text-sm">{o.obligation}</td>
                <td className="font-mono text-xs">{o.clause ? <Link href={`/smkp/${o.clause.id}`} className="hover:text-accent">{o.clause.code}</Link> : '–'}</td>
                <td className="text-xs">{FREQUENCY[o.frequency]}</td>
                <td className="whitespace-nowrap text-xs">{fmtDate(o.last_evaluated_at)}<div className="text-muted">berikut {fmtDate(o.next_evaluation_at)}</div></td>
                <td><Pill tone={COMPLIANCE[o.compliance_status][0]}>{COMPLIANCE[o.compliance_status][1]}</Pill>
                  {(o.compliance_status === 'non_compliant' || o.compliance_status === 'partial') && (
                    <Link href={`/capa/baru?sumber=legal&ref=${encodeURIComponent(`${r.register_no} ${o.article_ref ?? ''}`)}${o.clause ? `&clause=${o.clause.id}` : ''}`}
                      className={`${btnGhost} mt-2 text-xs`}>Buat action plan</Link>
                  )}
                </td>
                <td className="min-w-56">
                  {canEval && (
                    <ActionForm action={evaluateObligation} label="Evaluasi" hidden={{ obligation: o.id, requirement: r.id }}>
                      <select name="result" className={input} aria-label="Hasil">
                        {['compliant', 'partial', 'non_compliant', 'not_applicable'].map(k => <option key={k} value={k}>{COMPLIANCE[k][1]}</option>)}
                      </select>
                      <input name="note" className={input} placeholder="Catatan (wajib bila tidak patuh)" aria-label="Catatan" />
                      <input type="file" name="file" className={input} aria-label="Bukti" />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada kewajiban yang dirinci.</p>}
      </Panel>
      {s.can('legal.manage') && (
        <Panel title="Tambah kewajiban">
          <ActionForm action={addObligation} label="Tambah" primary hidden={{ requirement: r.id }} className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-[1fr_3fr]">
              <label className="grid gap-1 text-sm">Pasal<input name="article" className={input} placeholder="Pasal 5 ayat 2" /></label>
              <label className="grid gap-1 text-sm">Kewajiban<input name="obligation" required className={input} /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">Persyaratan SMKP
                <select name="clause" className={input} defaultValue=""><option value="">–</option>
                  {[...(clauses ?? [])].sort(byCode).map(c => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select>
              </label>
              <label className="grid gap-1 text-sm">Frekuensi evaluasi
                <select name="frequency" className={input} defaultValue="annual">
                  {['once', 'monthly', 'quarterly', 'semiannual', 'annual', 'event'].map(k => <option key={k} value={k}>{FREQUENCY[k]}</option>)}
                </select>
              </label>
            </div>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
