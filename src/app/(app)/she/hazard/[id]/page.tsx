import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { RISK } from '@/lib/compliance';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { HAZARD_TYPE, OPEN_CLOSED } from '@/lib/she';
import { closeHazard } from '../../actions';
import { AttachmentList, Files, LinkedCapa } from '../../fields';

type Hazard = {
  id: string; hazard_no: string; reported_on: string; hazard_type: string; description: string; recommendation: string | null;
  risk_level: string; status: string; due_date: string; is_overdue: boolean; work_area_name: string | null; location_note: string | null;
  department_code: string; pic_department_code: string; pic_department_id: string; reporter_name: string | null;
  close_note: string | null; closed_at: string | null;
};

export default async function HazardDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: h } = await supabase.from('she_hazard_register').select('*').eq('id', id).maybeSingle<Hazard>();
  if (!h) notFound();
  const [tone, label] = h.is_overdue ? ['crit', 'Overdue'] as const : OPEN_CLOSED[h.status];

  return (
    <>
      <PageHeader eyebrow={`Hazard report · ${HAZARD_TYPE[h.hazard_type]}`} title={h.hazard_no}>
        <div className="flex gap-2"><Pill tone={RISK[h.risk_level][0]}>Risiko {RISK[h.risk_level][1]}</Pill><Pill tone={tone}>{label}</Pill></div>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel title="Temuan">
            <p className="whitespace-pre-line text-sm">{h.description}</p>
            {h.recommendation && <p className="text-sm"><span className="text-muted">Rekomendasi: </span>{h.recommendation}</p>}
            <AttachmentList table="hazard_reports" ids={[h.id]} />
            {h.close_note && <div className="rounded border border-line bg-ground p-3 text-sm"><div className="mb-1 text-xs text-muted">Perbaikan · {fmtDateTime(h.closed_at)}</div>{h.close_note}</div>}
          </Panel>
          {h.status === 'open' && s.can('she.followup') && (
            <Panel title="Tutup hazard">
              <ActionForm action={closeHazard} label="Tandai closed" primary hidden={{ id: h.id }}>
                <label className="grid gap-1 text-sm">Tindakan perbaikan yang dilakukan<textarea name="note" required rows={3} className={input} /></label>
                <Files label={h.risk_level === 'high' || h.risk_level === 'extreme' ? 'Foto bukti perbaikan (wajib)' : 'Foto bukti perbaikan'} />
                <p className="text-xs text-muted">Hanya pengawas departemen {h.pic_department_code} yang bisa menutup.</p>
              </ActionForm>
            </Panel>
          )}
          <Panel title="Action plan">
            <LinkedCapa table="hazard_reports" id={h.id} sourceType="hazard_report" refNo={h.hazard_no} clauseCode="2.2" canCreate={s.can('capa.create')} />
          </Panel>
        </div>
        <Panel title="Rincian">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
            <dt>Tanggal</dt><dd>{fmtDate(h.reported_on)}</dd>
            <dt>Pelapor</dt><dd>{h.reporter_name} · {h.department_code}</dd>
            <dt>Lokasi</dt><dd>{h.work_area_name ?? '–'}{h.location_note ? ` · ${h.location_note}` : ''}</dd>
            <dt>PIC</dt><dd>{h.pic_department_code}</dd>
            <dt>Due date</dt><dd className={h.is_overdue ? 'font-medium text-crit' : ''}>{fmtDate(h.due_date)}</dd>
          </dl>
        </Panel>
      </div>
    </>
  );
}
