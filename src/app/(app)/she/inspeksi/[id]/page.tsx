import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { RISK } from '@/lib/compliance';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { INSPECTION_TYPE } from '@/lib/she';
import { closeFinding } from '../../actions';
import { PicPartner, AttachmentList, Files, LinkedCapa } from '../../fields';

type Insp = {
  id: string; inspection_no: string; inspected_on: string; inspection_type: string; object: string; note: string | null;
  inspector: { full_name: string | null } | null; area: { name: string } | null; dept: { code: string } | null;
};
type Finding = {
  id: string; seq: number; description: string; risk_level: string; pic_department_code: string; pic_partner_id: string | null; pic_partner_name: string | null; due_date: string; status: string;
  is_overdue: boolean; close_note: string | null; closed_at: string | null;
};

export default async function InspectionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: i } = await supabase.from('inspections')
    .select('id, inspection_no, inspected_on, inspection_type, object, note, inspector:inspector_id(full_name), area:work_area_id(name), dept:department_id(code)')
    .eq('id', id).maybeSingle<Insp>();
  if (!i) notFound();
  const { data: findings } = await supabase.from('she_finding_register').select('*').eq('inspection_id', id).order('seq').returns<Finding[]>();

  return (
    <>
      <PageHeader eyebrow={`Inspeksi · ${INSPECTION_TYPE[i.inspection_type]}`} title={i.inspection_no}>
        {findings?.length ? <Pill tone="warn">{findings.length} temuan</Pill> : <Pill tone="ok">Sesuai</Pill>}
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          {(findings ?? []).map(f => (
            <Panel key={f.id} title={`Temuan ${f.seq}`} action={<div className="flex gap-2"><Pill tone={RISK[f.risk_level][0]}>{RISK[f.risk_level][1]}</Pill>
              <Pill tone={f.status === 'closed' ? 'ok' : f.is_overdue ? 'crit' : 'warn'}>{f.status === 'closed' ? 'Closed' : f.is_overdue ? 'Overdue' : 'Open'}</Pill></div>}>
              <p className="text-sm">{f.description}</p>
              <p className="text-xs text-muted">PIC {f.pic_department_code} · due {fmtDate(f.due_date)}{f.pic_partner_name && f.status !== 'open' ? ` · mitra kerja ${f.pic_partner_name}` : ''}</p>
              {f.status === 'open' && <div className="text-sm"><div className="mb-1 text-xs text-muted">Mitra kerja pelaksana perbaikan</div>
                <PicPartner table="inspection_findings" id={f.id} path={`/she/inspeksi/${i.id}`} current={f.pic_partner_name} currentId={f.pic_partner_id} canEdit={s.can('she.followup')} /></div>}
              <AttachmentList table="inspection_findings" ids={[f.id]} />
              {f.close_note && <div className="rounded border border-line bg-ground p-3 text-sm"><div className="mb-1 text-xs text-muted">Perbaikan · {fmtDateTime(f.closed_at)}</div>{f.close_note}</div>}
              {f.status === 'open' && s.can('she.followup') && (
                <ActionForm action={closeFinding} label="Tutup temuan" hidden={{ id: f.id, inspection: i.id }}>
                  <input name="note" required className={input} placeholder="Tindakan perbaikan" />
                  <Files label={f.risk_level === 'high' || f.risk_level === 'extreme' ? 'Foto bukti (wajib)' : 'Foto bukti'} />
                </ActionForm>
              )}
            </Panel>
          ))}
          <Panel title="Action plan">
            <LinkedCapa table="inspections" id={i.id} sourceType="inspection" refNo={i.inspection_no} clauseCode="5.2" canCreate={s.can('capa.create')} />
          </Panel>
        </div>
        <Panel title="Rincian">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
            <dt>Tanggal</dt><dd>{fmtDate(i.inspected_on)}</dd>
            <dt>Inspektor</dt><dd>{i.inspector?.full_name} · {i.dept?.code}</dd>
            <dt>Lokasi</dt><dd>{i.area?.name ?? '–'}</dd>
            <dt>Objek</dt><dd>{i.object}</dd>
          </dl>
          {i.note && <p className="text-sm">{i.note}</p>}
          <AttachmentList table="inspections" ids={[i.id]} />
        </Panel>
      </div>
    </>
  );
}
