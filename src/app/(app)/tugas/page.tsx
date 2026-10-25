import Link from 'next/link';
import { PageHeader, Panel, Pill } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, rev } from '@/lib/documents';
import { TaskActions } from './task-actions';
import { LeaveTable, OvertimeTable, type LeaveRow, type OtRow } from '../hrga/time-tables';
import { AdvanceTable, ClaimTable, type AdvanceRow, type ClaimRow } from '../hrga/claims';
import type { ReqRow } from '../hrga/rekrutmen/parts';
import { REQ_REASON, REQ_STATUS } from '@/lib/hrga';

export const metadata = { title: 'Kotak tugas' };

type Task = { task_id: string; instance_id: string; step_name: string; step_kind: string; subject_table: string; subject_id: string; due_at: string; on_behalf_of: string | null };
type Ver = { id: string; revision: number; change_summary: string | null; draft_sha256: string | null;
  draft: { file_name: string } | null; documents: { id: string; title: string; registration_no: string; type_code: string; departments: { code: string } } };

export default async function TugasPage() {
  await getSession();
  const supabase = await createClient();
  const { data } = await supabase.rpc('my_tasks');
  const tasks = (data ?? []) as Task[];
  const verIds = tasks.filter(t => t.subject_table === 'document_versions').map(t => t.subject_id);
  const { data: vers } = verIds.length
    ? await supabase.from('document_versions')
        .select('id, revision, change_summary, draft_sha256, draft:draft_attachment_id(file_name), documents(id, title, registration_no, type_code, departments(code))')
        .in('id', verIds).returns<Ver[]>()
    : { data: [] as Ver[] };
  const [{ data: leaves }, { data: ots }, { data: claims }, { data: advs }, { data: reqs }] = await Promise.all([
    supabase.from('leave_register').select('*').eq('can_decide', true).order('start_date').limit(100).returns<LeaveRow[]>(),
    supabase.from('overtime_register').select('*').eq('can_decide', true).order('work_date').limit(100).returns<OtRow[]>(),
    supabase.from('expense_claim_register').select('*').eq('can_decide', true).order('created_at').limit(100).returns<ClaimRow[]>(),
    supabase.from('cash_advance_register').select('*').eq('can_decide', true).order('created_at').limit(100).returns<AdvanceRow[]>(),
    supabase.from('requisition_register').select('*').eq('can_decide', true).order('created_at').limit(100).returns<ReqRow[]>(),
  ]);
  const { data: notes } = await supabase.from('notifications').select('id, title, body, link, created_at, read_at')
    .order('created_at', { ascending: false }).limit(10);
  const now = Date.now();

  return (
    <>
      <PageHeader eyebrow="Workflow" title="Kotak tugas" />
      {!!leaves?.length && <Panel title={`Persetujuan cuti (${leaves.length})`}><LeaveTable rows={leaves} /></Panel>}
      {!!ots?.length && <Panel title={`Persetujuan lembur / SPL (${ots.length})`}><OvertimeTable rows={ots} /></Panel>}
      {!!claims?.length && <Panel title={`Persetujuan klaim (${claims.length})`}><ClaimTable rows={claims} mode="manage" /></Panel>}
      {!!advs?.length && <Panel title={`Persetujuan kasbon / uang muka (${advs.length})`}><AdvanceTable rows={advs} mode="manage" /></Panel>}
      {!!reqs?.length && (
        <Panel title={`Persetujuan FPTK (${reqs.length})`}>
          <ul className="grid gap-2">
            {reqs.map(r => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <Link href={`/hrga/rekrutmen/${r.id}`} className="grid hover:text-accent">
                  <span className="font-mono text-xs text-muted">{r.req_no} · {r.department_code}</span>
                  <span className="text-sm font-semibold">{r.position_name} × {r.headcount} · {REQ_REASON[r.reason] ?? r.reason}</span>
                </Link>
                <Pill tone={REQ_STATUS[r.status]?.[0]}>{r.status === 'submitted' ? 'Perlu verifikasi HR' : 'Perlu persetujuan'}</Pill>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {tasks.length ? (
        <div className="grid gap-4">
          {tasks.map(t => {
            const v = vers?.find(x => x.id === t.subject_id);
            const late = new Date(t.due_at).getTime() < now;
            return (
              <Panel key={t.task_id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <span className="font-mono text-xs text-muted">{v?.documents.registration_no} · {v?.documents.type_code} · {v?.documents.departments.code} · {rev(v?.revision)}</span>
                    <Link href={`/dokumen/${v?.documents.id}`} className="font-display text-2xl font-semibold hover:text-accent">{v?.documents.title}</Link>
                    <span className="text-sm">{t.step_name}{t.on_behalf_of && <span className="ml-2"><Pill tone="accent">atas nama delegator</Pill></span>}</span>
                    {v?.change_summary && <span className="text-sm text-muted">{v.change_summary}</span>}
                  </div>
                  <Pill tone={late ? 'crit' : 'warn'}>{late ? 'Lewat tenggat' : `Tenggat ${fmtDateTime(t.due_at)}`}</Pill>
                </div>
                {v?.draft && (
                  <p className="text-sm">Berkas yang diperiksa: <span className="font-mono text-xs">{v.draft.file_name}</span>{' '}
                    <span className="font-mono text-[11px] text-muted">SHA-256 {v.draft_sha256?.slice(0, 16)}…</span></p>
                )}
                <TaskActions taskId={t.task_id} subjectHash={v?.draft_sha256 ?? ''} kind={t.step_kind} />
              </Panel>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-line p-8 text-center text-sm text-muted">Tidak ada dokumen yang menunggu Anda.</div>
      )}
      <Panel title="Notifikasi terbaru">
        {notes?.length ? (
          <ul className="grid gap-2 text-sm">
            {notes.map(n => (
              <li key={n.id} className="flex flex-wrap justify-between gap-2 border-b border-line pb-2 last:border-0">
                <span>{n.link ? <Link href={n.link} className="hover:text-accent">{n.title}</Link> : n.title}{n.body && <span className="text-muted"> · {n.body}</span>}</span>
                <span className="tabular text-xs text-muted">{fmtDateTime(n.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Belum ada notifikasi.</p>}
      </Panel>
    </>
  );
}
