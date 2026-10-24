import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { byCode } from '@/lib/compliance';
import { REVIEW_STATUS } from '@/lib/management';
import { closeReview, holdReview, saveReviewItem } from '../../actions';
import { MgmtTabs } from '../../tabs';

type R = { id: string; review_no: string; title: string; meeting_date: string; chair_id: string; status: string; attendees: string | null;
  conclusion: string | null; performance_snapshot: Record<string, unknown> | null; held_at: string | null; closed_at: string | null };
type Item = { id: string; topic_code: string; discussion: string; decision: string | null; action_required: boolean; clause_id: string | null; department_id: string | null };

const SNAP: [string, string][] = [
  ['incidents_ytd', 'Insiden tahun berjalan'], ['lti_ytd', 'LTI/fatal'], ['capa_open', 'Action plan terbuka'], ['capa_overdue', 'Action plan lewat target'],
  ['smkp_coverage_pct', 'Cakupan bukti SMKP (%)'], ['pa_avg', 'PA rata-rata (%)'], ['tonnage_mtd', 'Tonase bulan berjalan'], ['competency_gaps', 'Kompetensi belum terpenuhi'],
];

export default async function ReviewDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: r } = await supabase.from('management_reviews').select('*').eq('id', id).maybeSingle<R>();
  if (!r) notFound();
  const [{ data: topics }, { data: items }, { data: clauses }, { data: depts }, { data: capas }] = await Promise.all([
    supabase.from('management_review_topics').select('code, name, required').order('sort_order'),
    supabase.from('management_review_items').select('*').eq('review_id', id).returns<Item[]>(),
    supabase.from('compliance_clauses').select('id, framework_code, code, title').eq('framework_code', 'SMKP').eq('active', true).neq('level', 'element'),
    supabase.from('departments').select('id, code').order('sort_order'),
    supabase.from('corrective_actions').select('id, action_no, status, source_id').eq('source_table', 'management_review_items').neq('status', 'cancelled'),
  ]);
  const byTopic = new Map((items ?? []).map(i => [i.topic_code, i]));
  const capa = new Map((capas ?? []).map(c => [c.source_id as string, c]));
  const chair = r.chair_id === s.profile.id;
  const edit = r.status !== 'closed' && (s.can('mgmt.review') || chair);
  const sorted = [...(clauses ?? [])].sort(byCode);

  return (
    <>
      <PageHeader eyebrow={`Tinjauan manajemen · ${fmtDate(r.meeting_date)}`} title={`${r.review_no} · ${r.title}`}>
        <Pill tone={REVIEW_STATUS[r.status][0]}>{REVIEW_STATUS[r.status][1]}</Pill>
      </PageHeader>
      <MgmtTabs active="/manajemen/tinjauan" />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          {(topics ?? []).map(t => {
            const it = byTopic.get(t.code);
            const c = it ? capa.get(it.id) : undefined;
            return (
              <Panel key={t.code} title={`${t.name}${t.required ? '' : ' (opsional)'}`}>
                {it ? (
                  <div className="grid gap-1 text-sm">
                    <p className="whitespace-pre-line">{it.discussion}</p>
                    {it.decision && <p><b>Keputusan:</b> {it.decision}</p>}
                    {it.action_required && (c ? <Link href={`/capa/${c.id}`} className="font-mono text-xs text-accent">{c.action_no} ({c.status})</Link>
                      : <span className="text-xs"><span className="text-crit">Belum ada action plan.</span>{' '}
                        {s.can('capa.create') && <Link className="text-accent" href={`/capa/baru?tabel=management_review_items&sid=${it.id}&sumber=management_review&ref=${encodeURIComponent(r.review_no)}&clause=${it.clause_id}&dept=${it.department_id}`}>Buat action plan →</Link>}</span>)}
                  </div>
                ) : <p className="text-sm text-muted">Belum dibahas.</p>}
                {edit && (
                  <details open={!it}><summary className="cursor-pointer text-xs text-muted">{it ? 'Ubah' : 'Isi pembahasan'}</summary>
                    <ActionForm action={saveReviewItem} label="Simpan" hidden={{ id: r.id, topic: t.code }}>
                      <textarea name="discussion" required rows={2} defaultValue={it?.discussion} className={input} placeholder="Ringkasan data dan pembahasan" />
                      <input name="decision" defaultValue={it?.decision ?? ''} className={input} placeholder="Keputusan / arahan (opsional)" />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <select name="action" defaultValue={String(it?.action_required ?? false)} className={input} aria-label="Butuh tindakan"><option value="false">Tidak perlu action plan</option><option value="true">Perlu action plan</option></select>
                        <select name="clause" defaultValue={it?.clause_id ?? ''} className={input} aria-label="Persyaratan"><option value="">Persyaratan (bila perlu tindakan)</option>
                          {sorted.map(x => <option key={x.id} value={x.id}>{x.code} · {x.title}</option>)}</select>
                        <select name="department" defaultValue={it?.department_id ?? ''} className={input} aria-label="Departemen"><option value="">Departemen PIC</option>
                          {(depts ?? []).map(d => <option key={d.id} value={d.id}>{d.code}</option>)}</select>
                      </div>
                    </ActionForm>
                  </details>
                )}
              </Panel>
            );
          })}
        </div>
        <div className="grid content-start gap-4">
          {r.status === 'draft' && edit && (
            <Panel title="Catat rapat terlaksana">
              <ActionForm action={holdReview} label="Rapat terlaksana" primary hidden={{ id: r.id }}>
                <textarea name="attendees" required rows={3} className={input} placeholder="Daftar hadir (nama · jabatan)" />
                <p className="text-xs text-muted">Semua masukan wajib harus sudah dibahas. Ringkasan kinerja saat ini disimpan ke notulen.</p>
              </ActionForm>
            </Panel>
          )}
          {r.status === 'held' && chair && (
            <Panel title="Tutup tinjauan">
              <ActionForm action={closeReview} label="Tutup tinjauan" primary hidden={{ id: r.id }}>
                <textarea name="conclusion" required rows={3} className={input} placeholder="Kesimpulan kecukupan, kesesuaian dan efektivitas sistem" />
              </ActionForm>
            </Panel>
          )}
          {r.attendees && <Panel title="Daftar hadir"><p className="whitespace-pre-line text-sm">{r.attendees}</p><p className="text-xs text-muted">{fmtDateTime(r.held_at)}</p></Panel>}
          {r.conclusion && <Panel title="Kesimpulan"><p className="whitespace-pre-line text-sm">{r.conclusion}</p></Panel>}
          {r.performance_snapshot && (
            <Panel title="Kinerja saat rapat">
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm [&_dt]:text-muted">
                {SNAP.map(([k, l]) => <Fragment key={k}><dt>{l}</dt><dd className="tabular">{String(r.performance_snapshot?.[k] ?? '–')}</dd></Fragment>)}
              </dl>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
