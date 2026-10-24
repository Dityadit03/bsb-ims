import Link from 'next/link';
import { DropZone } from '@/components/drop-zone';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { ACCESS_LABEL, DOC_STATUS, SMKP_ELEMENTS, VERSION_STATUS, fmtDate, fmtDateTime, rev } from '@/lib/documents';
import { acknowledge, distribute, obsoleteDocument, releaseVersion, startRevision, submitVersion, uploadDraft } from '../actions';

type Version = {
  id: string; revision: number; status: string; change_summary: string | null; draft_sha256: string | null; final_sha256: string | null;
  effective_date: string | null; approved_at: string | null; released_at: string | null; workflow_instance_id: string | null;
  draft: { file_name: string } | null;
};
type Doc = {
  id: string; registration_no: string; document_number: string | null; title: string; status: string; access_class: string;
  type_code: string; owner_id: string; department_id: string; effective_date: string | null; next_review_at: string | null;
  valid_until: string | null; issuer: string | null; smkp_elements: number[]; obsolete_reason: string | null;
  current_version_id: string | null; effective_version_id: string | null;
  document_types: { name: string; workflow_code: string | null };
  departments: { code: string; name: string }; sections: { code: string; name: string } | null;
  parent: { id: string; document_number: string | null } | null;
  owner: { full_name: string | null; email: string } | null;
};

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: doc } = await supabase.from('documents')
    .select('*, document_types(name, workflow_code), departments(code, name), sections(code, name), parent:parent_id(id, document_number), owner:owner_id(full_name, email)')
    .eq('id', id).maybeSingle<Doc>();
  if (!doc) notFound();

  const [{ data: versions }, { data: dist }, { data: depts }] = await Promise.all([
    supabase.from('document_versions')
      .select('id, revision, status, change_summary, draft_sha256, final_sha256, effective_date, approved_at, released_at, workflow_instance_id, draft:draft_attachment_id(file_name)')
      .eq('document_id', id).order('revision', { ascending: false }).returns<Version[]>(),
    supabase.from('document_distributions').select('version_id, user_id, acknowledged_at, ack_required, profiles:user_id(full_name, email)').eq('document_id', id)
      .returns<{ version_id: string; user_id: string; acknowledged_at: string | null; ack_required: boolean; profiles: { full_name: string | null; email: string } | null }[]>(),
    supabase.from('departments').select('id, code, name').order('sort_order'),
  ]);
  const instanceIds = (versions ?? []).map(v => v.workflow_instance_id).filter(Boolean) as string[];
  const { data: events } = instanceIds.length
    ? await supabase.from('approval_events').select('instance_id, decision, comment, acted_at, actor:actor_id(full_name, email), task:task_id(step_name)')
        .in('instance_id', instanceIds).order('acted_at')
        .returns<{ instance_id: string; decision: string; comment: string | null; acted_at: string; actor: { full_name: string | null; email: string } | null; task: { step_name: string } | null }[]>()
    : { data: [] };
  const { data: openTasks } = instanceIds.length
    ? await supabase.from('workflow_tasks').select('instance_id, step_name, due_at').in('instance_id', instanceIds).eq('status', 'open')
    : { data: [] };

  const current = versions?.find(v => v.id === doc.current_version_id);
  const effective = versions?.find(v => v.id === doc.effective_version_id);
  const isOwner = doc.owner_id === s.profile.id;
  const canRelease = s.can('document.release');
  const [tone, label] = DOC_STATUS[doc.status] ?? ['muted', doc.status];
  const myDist = dist?.find(d => d.user_id === s.profile.id && d.version_id === doc.effective_version_id);
  const editable = current && ['draft', 'revision_required'].includes(current.status);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader eyebrow={`${doc.document_types.name} · ${doc.departments.code}${doc.sections ? `-${doc.sections.code}` : ''}`} title={doc.title}>
        <Pill tone={tone}>{label}</Pill>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid min-w-0 content-start gap-6">
          {current && current.id !== doc.effective_version_id ? (
            <Panel title={`${rev(current.revision)} · ${VERSION_STATUS[current.status]?.[1] ?? current.status}`}>
              {current.change_summary && <p className="text-sm text-muted">{current.change_summary}</p>}
              {openTasks?.filter(t => t.instance_id === current.workflow_instance_id).map(t => (
                <p key={t.step_name} className="text-sm">Menunggu: <b>{t.step_name}</b> · tenggat {fmtDateTime(t.due_at)}</p>
              ))}
              {current.draft && <p className="text-sm">Berkas draf: <span className="font-mono text-xs">{current.draft.file_name}</span>
                <span className="ml-2 font-mono text-[11px] text-muted">SHA-256 {current.draft_sha256?.slice(0, 12)}…</span></p>}
              {isOwner && editable && (
                <div className="grid gap-4 border-t border-line pt-3">
                  <ActionForm action={uploadDraft} label="Lampirkan draf" hidden={{ version: current.id, document: doc.id }}>
                    <DropZone name="file" label="Berkas draf" multiple={false} accept=".pdf,.docx,.xlsx" required hint="Seret PDF / Word / Excel ke sini atau ketuk untuk memilih" />
                    <span className="text-xs text-muted">PDF diperlukan untuk rilis terkendali. Maksimal 25 MB.</span>
                  </ActionForm>
                  {current.draft && <ActionForm action={submitVersion} label="Ajukan untuk review" primary hidden={{ version: current.id, document: doc.id }} />}
                </div>
              )}
              {canRelease && current.status === 'approved' && (
                <div className="border-t border-line pt-3">
                  <ActionForm action={releaseVersion} label="Terbitkan sebagai dokumen terkendali" primary hidden={{ version: current.id }}>
                    <label className="grid max-w-xs gap-1 text-sm">Tanggal berlaku
                      <input id="effective_date" type="date" name="effective_date" defaultValue={today} className={input} required />
                    </label>
                    <span className="text-xs text-muted">Nomor resmi, stempel CONTROLLED DOCUMENT, QR verifikasi dan SHA-256 dibuat otomatis.</span>
                  </ActionForm>
                </div>
              )}
            </Panel>
          ) : null}

          {effective && (
            <Panel title={`Versi berlaku · ${rev(effective.revision)}`}
              action={<a href={`/api/dokumen/versi/${effective.id}/unduh`} className="text-sm text-accent hover:underline">Unduh PDF</a>}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <dt className="text-muted">Berlaku</dt><dd>{fmtDate(effective.effective_date)}</dd>
                <dt className="text-muted">Terbit</dt><dd>{fmtDateTime(effective.released_at)}</dd>
                <dt className="text-muted">SHA-256</dt><dd className="col-span-3 break-all font-mono text-[11px]">{effective.final_sha256 ?? '–'}</dd>
              </dl>
              {myDist && !myDist.acknowledged_at && myDist.ack_required && (
                <ActionForm action={acknowledge} label="Saya sudah menerima & membaca" primary hidden={{ version: effective.id, document: doc.id }} />
              )}
              {doc.status === 'effective' && (isOwner || s.can('document.request')) && doc.document_types.workflow_code && (
                <ActionForm action={startRevision} label="Mulai revisi" hidden={{ document: doc.id }} className="border-t border-line pt-3">
                  <input id="summary" name="summary" required placeholder="Ringkasan perubahan, mis. penyesuaian regulasi" className={input} />
                </ActionForm>
              )}
            </Panel>
          )}

          <Panel title="Riwayat versi & persetujuan">
            <ol className="grid gap-4">
              {(versions ?? []).map(v => {
                const [vt, vl] = VERSION_STATUS[v.status] ?? ['muted', v.status];
                return (
                  <li key={v.id} className="grid gap-1 border-l-2 border-line pl-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="font-mono">{rev(v.revision)}</b><Pill tone={vt}>{vl}</Pill>
                      {v.released_at && <Link href={`/verifikasi/${v.id}`} className="text-xs text-accent hover:underline">halaman verifikasi</Link>}
                    </div>
                    {v.change_summary && <p className="text-sm text-muted">{v.change_summary}</p>}
                    <ul className="grid gap-0.5 text-xs">
                      {(events ?? []).filter(e => e.instance_id === v.workflow_instance_id).map((e, i) => (
                        <li key={i}>
                          <span className="tabular text-muted">{fmtDateTime(e.acted_at)}</span> · {e.task?.step_name} ·{' '}
                          <b className={e.decision === 'approve' ? 'text-ok' : 'text-crit'}>{e.decision === 'approve' ? 'disetujui' : e.decision === 'return' ? 'dikembalikan' : 'ditolak'}</b>{' '}
                          oleh {e.actor?.full_name ?? e.actor?.email}{e.comment ? ` – “${e.comment}”` : ''}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </Panel>

          {effective && (
            <Panel title={`Distribusi ${rev(effective.revision)}`}>
              {dist?.filter(d => d.version_id === effective.id).length ? (
                <Table head={['Penerima', 'Tanda terima']}>
                  {dist.filter(d => d.version_id === effective.id).map(d => (
                    <tr key={d.user_id}><td className="text-sm">{d.profiles?.full_name ?? d.profiles?.email}</td>
                      <td>{d.acknowledged_at ? <span className="text-xs text-ok">{fmtDateTime(d.acknowledged_at)}</span> : <Pill tone="warn">Belum</Pill>}</td></tr>
                  ))}
                </Table>
              ) : <p className="text-sm text-muted">Belum didistribusikan.</p>}
              {canRelease && doc.status !== 'obsolete' && (
                <ActionForm action={distribute} label="Distribusikan" hidden={{ version: effective.id, document: doc.id }} className="border-t border-line pt-3">
                  <div className="flex flex-wrap gap-2">
                    {(depts ?? []).map(d => (
                      <label key={d.id} className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-sm has-checked:border-accent">
                        <input id={`dist-${d.code}`} type="checkbox" name="departments" value={d.id} className="accent-accent" />{d.code}
                      </label>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input id="ack" type="checkbox" name="ack" defaultChecked className="accent-accent" /> Wajib tanda terima</label>
                </ActionForm>
              )}
            </Panel>
          )}
        </div>

        <aside className="grid content-start gap-4">
          <Panel title="Identitas">
            <dl className="grid gap-2 text-sm">
              <div><dt className="text-xs text-muted">Nomor dokumen</dt><dd className="font-mono">{doc.document_number ?? 'Terbit saat rilis'}</dd></div>
              <div><dt className="text-xs text-muted">Nomor registrasi</dt><dd className="font-mono text-xs">{doc.registration_no}</dd></div>
              {doc.parent && <div><dt className="text-xs text-muted">Dokumen induk</dt><dd><Link href={`/dokumen/${doc.parent.id}`} className="font-mono text-xs text-accent">{doc.parent.document_number}</Link></dd></div>}
              <div><dt className="text-xs text-muted">Pemilik</dt><dd>{doc.owner?.full_name ?? doc.owner?.email}</dd></div>
              <div><dt className="text-xs text-muted">Departemen</dt><dd>{doc.departments.name}{doc.sections ? ` · ${doc.sections.name}` : ''}</dd></div>
              <div><dt className="text-xs text-muted">Akses</dt><dd>{ACCESS_LABEL[doc.access_class]}</dd></div>
              {doc.issuer && <div><dt className="text-xs text-muted">Penerbit / pengirim</dt><dd>{doc.issuer}</dd></div>}
              <div><dt className="text-xs text-muted">Tinjau ulang</dt><dd>{fmtDate(doc.next_review_at)}</dd></div>
              {doc.valid_until && <div><dt className="text-xs text-muted">Berlaku sampai</dt><dd>{fmtDate(doc.valid_until)}</dd></div>}
              {doc.obsolete_reason && <div><dt className="text-xs text-muted">Alasan dicabut</dt><dd>{doc.obsolete_reason}</dd></div>}
            </dl>
          </Panel>
          {doc.smkp_elements.length > 0 && (
            <Panel title="Elemen SMKP">
              <ul className="grid gap-1 text-sm">{SMKP_ELEMENTS.filter(([n]) => doc.smkp_elements.includes(n)).map(([n, l]) => <li key={n}><b className="font-mono">E{n}</b> {l}</li>)}</ul>
            </Panel>
          )}
          {canRelease && ['effective', 'under_revision'].includes(doc.status) && (
            <Panel title="Cabut dokumen">
              <ActionForm action={obsoleteDocument} label="Cabut" hidden={{ document: doc.id }}>
                <input id="reason" name="reason" required placeholder="Alasan pencabutan" className={input} />
                <span className="text-xs text-muted">Versi ditarik dari penggunaan operasional; arsip dan riwayat tetap tersimpan. Penerima diberi tahu.</span>
              </ActionForm>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
