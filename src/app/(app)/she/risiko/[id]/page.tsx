import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { HIERARCHY, RISK } from '@/lib/compliance';
import { fmtDate, fmtDateTime } from '@/lib/documents';
import { CATEGORY, CONDITION, RISK_STATUS } from '@/lib/she';
import { approveRisk, retireRisk } from '../../actions';
import { LinkedCapa, sheMasters } from '../../fields';
import { RiskForm, type RiskValues } from '../risk-form';

type Risk = Required<RiskValues> & {
  risk_no: string; revision: number; status: string; initial_score: number; initial_level: string; residual_score: number; residual_level: string;
  department_code: string; work_area_name: string | null; owner_name: string | null; created_by: string; updated_by: string | null;
  approved_by: string | null; approved_at: string | null; review_due: string | null; review_overdue: boolean;
};

export default async function RiskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: r } = await supabase.from('risk_register_view').select('*').eq('id', id).maybeSingle<Risk>();
  if (!r) notFound();
  const [{ depts, areas }, { data: legal }, { data: people }, { data: approver }] = await Promise.all([
    sheMasters(),
    supabase.from('legal_requirements').select('id, register_no, title').order('register_no'),
    supabase.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name'),
    r.approved_by ? supabase.from('profiles').select('full_name').eq('id', r.approved_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const author = r.updated_by ?? r.created_by;
  const canApprove = s.can('risk.approve') && r.status === 'draft' && author !== s.profile.id;

  return (
    <>
      <PageHeader eyebrow={`Risk register · ${r.department_code} · Rev.${String(r.revision).padStart(2, '0')}`} title={r.risk_no}>
        <div className="flex gap-2"><Pill tone={RISK[r.residual_level][0]}>Residual {r.residual_score} {RISK[r.residual_level][1]}</Pill>
          <Pill tone={RISK_STATUS[r.status][0]}>{RISK_STATUS[r.status][1]}</Pill></div>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel title={r.activity}>
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr] [&_dt]:text-muted">
              <dt>Bahaya</dt><dd>{r.hazard}</dd>
              <dt>Risiko</dt><dd>{r.risk}</dd>
              <dt>Pengendalian ada</dt><dd>{r.existing_controls ?? '–'}</dd>
              <dt>Risiko awal</dt><dd><Pill tone={RISK[r.initial_level][0]}>{r.initial_likelihood}×{r.initial_severity} = {r.initial_score} {RISK[r.initial_level][1]}</Pill></dd>
              <dt>Pengendalian tambahan</dt><dd>{r.additional_controls ?? '–'}{r.control_hierarchy && <span className="text-muted"> ({HIERARCHY[r.control_hierarchy]})</span>}</dd>
              <dt>Risiko residual</dt><dd><Pill tone={RISK[r.residual_level][0]}>{r.residual_likelihood}×{r.residual_severity} = {r.residual_score} {RISK[r.residual_level][1]}</Pill></dd>
            </dl>
          </Panel>
          {canApprove && (
            <Panel title="Persetujuan">
              <ActionForm action={approveRisk} label="Setujui risiko" primary hidden={{ id: r.id }} />
            </Panel>
          )}
          {s.can('risk.manage') && r.status !== 'retired' && (
            <Panel title={r.status === 'approved' ? 'Revisi (perlu disetujui ulang)' : 'Ubah draft'}>
              <RiskForm v={r} depts={depts} areas={areas} legal={legal ?? []} people={people ?? []} label="Simpan" />
            </Panel>
          )}
          <Panel title="Action plan pengendalian tambahan">
            <LinkedCapa table="risk_register" id={r.id} sourceType="other" refNo={r.risk_no} clauseCode="2.2" canCreate={s.can('capa.create')} />
          </Panel>
        </div>
        <div className="grid content-start gap-4">
          <Panel title="Rincian">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
              <dt>Lokasi</dt><dd>{r.work_area_name ?? '–'}</dd>
              <dt>Kondisi</dt><dd>{CONDITION[r.condition]}</dd>
              <dt>Kategori</dt><dd>{CATEGORY[r.category]}</dd>
              <dt>Pemilik</dt><dd>{r.owner_name}</dd>
              <dt>Disetujui</dt><dd>{approver?.full_name ?? '–'}{r.approved_at && <span className="block text-xs text-muted">{fmtDateTime(r.approved_at)}</span>}</dd>
              <dt>Tinjau ulang</dt><dd className={r.review_overdue ? 'font-medium text-crit' : ''}>{fmtDate(r.review_due)}</dd>
            </dl>
          </Panel>
          {s.can('risk.approve') && r.status !== 'retired' && (
            <Panel title="Nonaktifkan">
              <ActionForm action={retireRisk} label="Nonaktifkan risiko" hidden={{ id: r.id }}>
                <input name="reason" required className={input} placeholder="Alasan, mis. aktivitas tidak dilakukan lagi" />
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
