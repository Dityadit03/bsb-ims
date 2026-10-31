import { Icon } from '@/components/icon';
import Link from 'next/link';
import { DropZone } from '@/components/drop-zone';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { ACTION_TYPE, CAPA_EVENT, CAPA_STATUS, HIERARCHY, RISK, SOURCE_TYPE } from '@/lib/compliance';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { cancelAction, extendAction, reviewEffectiveness, startAction, submitAction, verifyAction } from '../actions';

type Capa = {
  id: string; action_no: string; title: string; description: string; status: string; risk_level: string; source_type: string;
  source_ref: string | null; action_type: string; control_hierarchy: string | null; due_date: string; original_due_date: string;
  extension_count: number; is_overdue: boolean; pic_id: string; verifier_id: string; pic_name: string | null; verifier_name: string | null;
  clause_id: string; clause_code: string; clause_title: string; framework_code: string; department_code: string; department_id: string;
  completion_note: string | null; cancel_reason: string | null; closed_at: string | null; parent_id: string | null;
  effectiveness_due: string | null; effectiveness_result: string | null; effectiveness_note: string | null;
};

export default async function CapaDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: a } = await supabase.from('capa_register').select('*').eq('id', id).maybeSingle<Capa>();
  if (!a) notFound();
  const [{ data: events }, { data: evidence }, { data: followUps }, { data: parent }] = await Promise.all([
    supabase.from('capa_events').select('id, event, note, created_at, actor:actor_id(full_name)').eq('action_id', id).order('id')
      .returns<{ id: number; event: string; note: string | null; created_at: string; actor: { full_name: string | null } | null }[]>(),
    supabase.from('action_evidence').select('id, submitted_at, attachments:attachment_id(id, file_name)').eq('action_id', id)
      .returns<{ id: string; submitted_at: string; attachments: { id: string; file_name: string } | null }[]>(),
    supabase.from('corrective_actions').select('id, action_no, status').eq('parent_id', id),
    a.parent_id ? supabase.from('corrective_actions').select('id, action_no').eq('id', a.parent_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const me = s.profile.id;
  const isPic = a.pic_id === me, isVerifier = a.verifier_id === me;
  const working = a.status === 'open' || a.status === 'in_progress';
  const canManage = s.can('capa.manage');
  const [tone, label] = CAPA_STATUS[a.status];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader eyebrow={`Action plan · ${a.department_code}`} title={a.action_no}>
        <div className="flex gap-2"><Pill tone={RISK[a.risk_level][0]}>Risiko {RISK[a.risk_level][1]}</Pill><Pill tone={tone}>{label}</Pill></div>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel title={a.title}>
            <p className="whitespace-pre-line text-sm">{a.description}</p>
            {a.completion_note && <div className="rounded border border-line bg-ground p-3 text-sm"><div className="mb-1 text-xs text-muted">Laporan penyelesaian PIC</div>{a.completion_note}</div>}
            {evidence?.length ? (
              <ul className="grid gap-1 text-sm">
                {evidence.map(e => <li key={e.id} className="font-mono text-xs"><Icon name="clip" size={14} className="mr-1 inline" />{e.attachments?.file_name} · {fmtDateTime(e.submitted_at)}</li>)}
              </ul>
            ) : null}
            {a.cancel_reason && <p className="text-sm text-crit">Dibatalkan: {a.cancel_reason}</p>}
          </Panel>

          {isPic && a.status === 'open' && (
            <Panel title="Mulai pekerjaan"><ActionForm action={startAction} label="Mulai dikerjakan" primary hidden={{ id }} /></Panel>
          )}
          {isPic && working && (
            <Panel title="Laporkan penyelesaian">
              <ActionForm action={submitAction} label="Kirim ke verifikator" primary hidden={{ id }}>
                <label className="grid gap-1 text-sm">Uraian tindakan yang dilakukan<textarea name="note" required rows={3} className={input} /></label>
                <DropZone label="Bukti (foto sebelum/sesudah, dokumen)" required />
              </ActionForm>
            </Panel>
          )}
          {isVerifier && a.status === 'submitted' && (
            <Panel title="Verifikasi">
              <ActionForm action={verifyAction} label="Simpan verifikasi" primary hidden={{ id }}>
                <select name="decision" className={input} aria-label="Keputusan">
                  <option value="accept">Sesuai, tutup action plan</option><option value="return">Belum sesuai, kembalikan ke PIC</option>
                </select>
                <textarea name="note" rows={2} className={input} placeholder="Catatan verifikasi (wajib bila dikembalikan)" aria-label="Catatan" />
              </ActionForm>
            </Panel>
          )}
          {a.status === 'closed' && a.effectiveness_due && !a.effectiveness_result && (isVerifier || canManage) && (
            <Panel title={`Cek efektivitas${a.effectiveness_due > today ? ` (dijadwalkan ${fmtDate(a.effectiveness_due)})` : ''}`}>
              <ActionForm action={reviewEffectiveness} label="Simpan" hidden={{ id }}>
                <select name="effective" className={input} aria-label="Hasil">
                  <option value="yes">Efektif, masalah tidak berulang</option><option value="no">Tidak efektif, buat action plan lanjutan</option>
                </select>
                <textarea name="note" required rows={2} className={input} placeholder="Dasar penilaian" aria-label="Catatan" />
                <label className="grid gap-1 text-sm">Target lanjutan (bila tidak efektif)<input type="date" name="due" className={input} /></label>
              </ActionForm>
            </Panel>
          )}
          {canManage && working && !isPic && (
            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="Perpanjang target">
                <ActionForm action={extendAction} label="Perpanjang" hidden={{ id }}>
                  <input type="date" name="due" required className={input} aria-label="Target baru" />
                  <input name="reason" required className={input} placeholder="Alasan" aria-label="Alasan" />
                  <p className="text-xs text-muted">Sudah diperpanjang {a.extension_count} dari maksimal 2 kali.</p>
                </ActionForm>
              </Panel>
              <Panel title="Batalkan">
                <ActionForm action={cancelAction} label="Batalkan action plan" hidden={{ id }}>
                  <input name="reason" required className={input} placeholder="Alasan pembatalan" aria-label="Alasan" />
                </ActionForm>
              </Panel>
            </div>
          )}
        </div>

        <div className="grid content-start gap-4">
          <Panel title="Rincian">
            <dl className="grid gap-2 text-sm">
              <div><dt className="text-xs text-muted">Persyaratan</dt>
                <dd><Link href={`/smkp/${a.clause_id}`} className="hover:text-accent">{a.framework_code} {a.clause_code} · {a.clause_title}</Link></dd></div>
              <div><dt className="text-xs text-muted">Sumber</dt><dd>{SOURCE_TYPE[a.source_type]}{a.source_ref ? ` · ${a.source_ref}` : ''}</dd></div>
              <div><dt className="text-xs text-muted">Jenis</dt><dd>{ACTION_TYPE[a.action_type]}{a.control_hierarchy ? ` · ${HIERARCHY[a.control_hierarchy]}` : ''}</dd></div>
              <div><dt className="text-xs text-muted">PIC</dt><dd>{a.pic_name}</dd></div>
              <div><dt className="text-xs text-muted">Verifikator</dt><dd>{a.verifier_name}</dd></div>
              <div><dt className="text-xs text-muted">Target</dt>
                <dd className={a.is_overdue ? 'font-medium text-crit' : ''}>{fmtDate(a.due_date)}
                  {a.due_date !== a.original_due_date && <span className="text-xs text-muted"> (awal {fmtDate(a.original_due_date)})</span>}</dd></div>
              {a.effectiveness_result && <div><dt className="text-xs text-muted">Efektivitas</dt>
                <dd>{a.effectiveness_result === 'effective' ? 'Efektif' : 'Tidak efektif'}: {a.effectiveness_note}</dd></div>}
              {parent && <div><dt className="text-xs text-muted">Lanjutan dari</dt><dd><Link href={`/capa/${parent.id}`} className="font-mono text-xs hover:text-accent">{parent.action_no}</Link></dd></div>}
              {followUps?.map(f => <div key={f.id}><dt className="text-xs text-muted">Action plan lanjutan</dt>
                <dd><Link href={`/capa/${f.id}`} className="font-mono text-xs hover:text-accent">{f.action_no}</Link></dd></div>)}
            </dl>
          </Panel>
          <Panel title="Riwayat">
            <ol className="grid gap-3 border-l border-line pl-4 text-sm">
              {(events ?? []).map(e => (
                <li key={e.id}>
                  <div className="font-medium">{CAPA_EVENT[e.event] ?? e.event}</div>
                  <div className="text-xs text-muted">{e.actor?.full_name ?? 'Sistem'} · {fmtDateTime(e.created_at)}</div>
                  {e.note && <div className="mt-1 text-xs">{e.note}</div>}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
