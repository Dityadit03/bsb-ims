import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/documents';
import { PRIORITY, WO_STATUS, WO_TYPE } from '@/lib/plant';
import { cancelWo, completeWo, startWo, waitPart } from '../../actions';
import { AttachmentList, Files } from '../../../she/fields';

type Wo = {
  id: string; wo_no: string; unit_id: string; unit_no: string; wo_type: string; priority: string; description: string; status: string;
  reported_at: string; reporter_name: string | null; hm_reported: number | null; mechanic_name: string | null; started_at: string | null;
  waiting_note: string | null; action_taken: string | null; hm_completed: number | null; completed_at: string | null; cancel_reason: string | null;
  downtime_hours: number; pm_task: string | null; source_table: string | null; source_id: string | null;
};

export default async function WoDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: w } = await supabase.from('work_order_register').select('*').eq('id', id).maybeSingle<Wo>();
  if (!w) notFound();
  const work = s.can('plant.work');
  const open = ['open', 'in_progress', 'waiting_part'].includes(w.status);

  return (
    <>
      <PageHeader eyebrow={`Work order · ${WO_TYPE[w.wo_type]}${w.pm_task ? ` · ${w.pm_task}` : ''}`} title={w.wo_no}>
        <div className="flex gap-2"><Pill tone={PRIORITY[w.priority][0]}>{PRIORITY[w.priority][1]}</Pill><Pill tone={WO_STATUS[w.status][0]}>{WO_STATUS[w.status][1]}</Pill></div>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel title="Kerusakan / pekerjaan">
            <p className="whitespace-pre-line text-sm">{w.description}</p>
            {w.waiting_note && <p className="text-sm text-warn">Menunggu part: {w.waiting_note}</p>}
            {w.action_taken && <div className="rounded border border-line bg-ground p-3 text-sm"><div className="mb-1 text-xs text-muted">Tindakan · {fmtDateTime(w.completed_at)}</div>{w.action_taken}</div>}
            {w.cancel_reason && <p className="text-sm text-crit">Dibatalkan: {w.cancel_reason}</p>}
            <AttachmentList table="work_orders" ids={[w.id]} />
          </Panel>
          {work && (w.status === 'open' || w.status === 'waiting_part') && (
            <Panel title="Mulai kerjakan"><ActionForm action={startWo} label={w.status === 'open' ? 'Mulai kerjakan' : 'Part tersedia, lanjutkan'} primary hidden={{ id: w.id }} /></Panel>
          )}
          {work && w.status === 'in_progress' && (
            <>
              <Panel title="Selesaikan">
                <ActionForm action={completeWo} label="Tandai selesai" primary hidden={{ id: w.id }}>
                  <label className="grid gap-1 text-sm">Tindakan perbaikan<textarea name="action" required rows={3} className={input} /></label>
                  <label className="grid max-w-xs gap-1 text-sm">HM saat selesai<input type="number" name="hm" min={w.hm_reported ?? 0} step="0.1" className={input} /></label>
                  <Files label="Foto / job card" />
                </ActionForm>
              </Panel>
              <Panel title="Tunggu part">
                <ActionForm action={waitPart} label="Tandai tunggu part" hidden={{ id: w.id }}>
                  <input name="note" required className={input} placeholder="Part yang ditunggu, no. MR" />
                </ActionForm>
              </Panel>
            </>
          )}
          {open && s.can('plant.manage') && (
            <Panel title="Batalkan">
              <ActionForm action={cancelWo} label="Batalkan WO" hidden={{ id: w.id }}>
                <input name="reason" required className={input} placeholder="Alasan pembatalan" />
              </ActionForm>
            </Panel>
          )}
        </div>
        <Panel title="Rincian">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
            <dt>Unit</dt><dd><Link href={`/plant/${w.unit_id}`} className="font-mono text-accent">{w.unit_no}</Link></dd>
            <dt>Dilaporkan</dt><dd>{fmtDateTime(w.reported_at)}<span className="block text-xs text-muted">{w.reporter_name}</span></dd>
            <dt>HM lapor</dt><dd>{w.hm_reported ?? '–'}</dd>
            <dt>Mekanik</dt><dd>{w.mechanic_name ?? '–'}</dd>
            <dt>Mulai</dt><dd>{fmtDateTime(w.started_at) || '–'}</dd>
            <dt>HM selesai</dt><dd>{w.hm_completed ?? '–'}</dd>
            <dt>Downtime</dt><dd>{w.downtime_hours} jam</dd>
            {w.source_table === 'p2h_checks' && <><dt>Sumber</dt><dd>P2H tidak layak</dd></>}
          </dl>
        </Panel>
      </div>
    </>
  );
}
