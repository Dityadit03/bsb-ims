import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/documents';
import { INCIDENT_CLASS, INCIDENT_STATUS } from '@/lib/she';
import { assignIncident, closeIncident, investigateIncident } from '../../actions';
import { AttachmentList, LinkedCapa } from '../../fields';

type Incident = {
  id: string; incident_no: string; occurred_at: string; reported_at: string; classification: string; status: string; chronology: string;
  immediate_action: string | null; unit_no: string | null; involved_names: string | null; work_area_name: string | null; location_note: string | null;
  department_code: string; reporter_name: string | null; investigator_id: string | null; investigator_name: string | null;
  root_cause: string | null; investigation_summary: string | null; investigated_at: string | null; late_report: boolean; late_reason: string | null;
  regulator_notified_at: string | null; close_note: string | null; closed_at: string | null; capa_count: number;
};

export default async function IncidentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const supabase = await createClient();
  const { data: x } = await supabase.from('incident_register').select('*').eq('id', id).maybeSingle<Incident>();
  if (!x) notFound();
  const canInvestigate = s.can('she.investigate');
  const { data: people } = canInvestigate && (x.status === 'reported' || x.status === 'investigating')
    ? await supabase.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name')
    : { data: null };
  const needsKait = x.classification === 'lti' || x.classification === 'fatality';

  return (
    <>
      <PageHeader eyebrow={`Insiden · ${x.department_code}`} title={x.incident_no}>
        <div className="flex gap-2"><Pill tone={INCIDENT_CLASS[x.classification][0]}>{INCIDENT_CLASS[x.classification][1]}</Pill>
          <Pill tone={INCIDENT_STATUS[x.status][0]}>{INCIDENT_STATUS[x.status][1]}</Pill></div>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel title="Kronologi">
            <p className="whitespace-pre-line text-sm">{x.chronology}</p>
            {x.immediate_action && <p className="text-sm"><span className="text-muted">Tindakan segera: </span>{x.immediate_action}</p>}
            <AttachmentList table="incidents" ids={[x.id]} />
          </Panel>

          {canInvestigate && (x.status === 'reported' || x.status === 'investigating') && (
            <Panel title={x.status === 'reported' ? 'Tunjuk investigator' : 'Ganti investigator'}>
              <ActionForm action={assignIncident} label="Tunjuk" hidden={{ id: x.id }}>
                <select name="investigator" required className={input} defaultValue={x.investigator_id ?? ''}>
                  <option value="" disabled>Pilih investigator</option>
                  {(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}
                </select>
              </ActionForm>
            </Panel>
          )}

          {x.status === 'investigating' && x.investigator_id === s.profile.id && (
            <Panel title="Hasil investigasi">
              <ActionForm action={investigateIncident} label="Simpan hasil investigasi" primary hidden={{ id: x.id }}>
                <label className="grid gap-1 text-sm">Akar masalah<textarea name="root_cause" required rows={3} className={input} /></label>
                <label className="grid gap-1 text-sm">Ringkasan investigasi dan rekomendasi<textarea name="summary" required rows={4} className={input} /></label>
                <label className="grid gap-1 text-sm">Klasifikasi akhir
                  <select name="classification" className={input} defaultValue={x.classification}>
                    {Object.entries(INCIDENT_CLASS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
              </ActionForm>
            </Panel>
          )}

          {x.root_cause && (
            <Panel title="Investigasi">
              <p className="text-sm"><span className="text-muted">Akar masalah: </span>{x.root_cause}</p>
              <p className="whitespace-pre-line text-sm">{x.investigation_summary}</p>
              <p className="text-xs text-muted">{x.investigator_name} · {fmtDateTime(x.investigated_at)}</p>
            </Panel>
          )}

          <Panel title="Action plan">
            <LinkedCapa table="incidents" id={x.id} sourceType="incident" refNo={x.incident_no} clauseCode="5.4"
              canCreate={s.can('capa.create') && x.status !== 'closed'} />
          </Panel>

          {x.status === 'investigated' && canInvestigate && x.investigator_id !== s.profile.id && (
            <Panel title="Tutup insiden">
              <ActionForm action={closeIncident} label="Tutup insiden" primary hidden={{ id: x.id }}>
                <label className="grid gap-1 text-sm">Catatan penutupan<textarea name="note" required rows={2} className={input} /></label>
                {needsKait && <label className="grid gap-1 text-sm">Waktu pelaporan ke KaIT (wajib untuk LTI/fatality)
                  <input type="datetime-local" name="notified" required={!x.regulator_notified_at} className={input} /></label>}
                {x.classification !== 'nearmiss' && !x.capa_count && <p className="text-xs text-crit">Buat minimal satu action plan sebelum menutup.</p>}
              </ActionForm>
            </Panel>
          )}
          {x.close_note && <Panel title="Penutupan"><p className="text-sm">{x.close_note}</p><p className="text-xs text-muted">{fmtDateTime(x.closed_at)}</p></Panel>}
        </div>
        <Panel title="Rincian">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted">
            <dt>Kejadian</dt><dd>{fmtDateTime(x.occurred_at)}</dd>
            <dt>Dilaporkan</dt><dd>{fmtDateTime(x.reported_at)}{x.late_report && <span className="block text-crit">Terlambat: {x.late_reason}</span>}</dd>
            <dt>Pelapor</dt><dd>{x.reporter_name}</dd>
            <dt>Lokasi</dt><dd>{x.work_area_name ?? '–'}{x.location_note ? ` · ${x.location_note}` : ''}</dd>
            <dt>Unit</dt><dd>{x.unit_no ?? '–'}</dd>
            <dt>Terlibat</dt><dd>{x.involved_names ?? '–'}</dd>
            <dt>Investigator</dt><dd>{x.investigator_name ?? '–'}</dd>
            {needsKait && <><dt>Lapor KaIT</dt><dd>{fmtDateTime(x.regulator_notified_at) || 'Belum'}</dd></>}
          </dl>
        </Panel>
      </div>
    </>
  );
}
