import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { PERMIT_STATUS } from '@/lib/she';
import { closePermit, decidePermit, requestPermit } from '../portal-actions';
import { AreaSelect, EmployeeDatalist, EmployeeInput, Files, SheTabs, sheMasters, today } from '../fields';

export const metadata = { title: 'Izin masuk area' };

type Row = {
  id: string; permit_no: string; visitor_name: string; company: string; people_count: number; purpose: string; start_on: string; end_on: string;
  status: string; work_area_name: string | null; area_note: string | null; escort_name: string | null; requester_name: string | null;
  requested_by: string; decision_note: string | null; on_site_today: boolean;
};

export default async function PermitPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data }, { areas }] = await Promise.all([
    supabase.from('area_permit_register').select('*').order('start_on', { ascending: false }).limit(200).returns<Row[]>(),
    sheMasters(),
  ]);
  const rows = data ?? [];
  const approver = s.canIn('she.permit', 'HSE');
  const onSite = rows.filter(r => r.on_site_today);

  return (
    <>
      <PageHeader eyebrow="Mitra kerja & tamu · SMKP 5.1" title="Izin masuk area" />
      <SheTabs active="/she/izin" />
      {onSite.length > 0 && (
        <p className="rounded-lg border border-line bg-accent-soft px-4 py-3 text-sm">
          <b>{onSite.reduce((t, r) => t + r.people_count, 0)} tamu</b> di area hari ini: {onSite.map(r => `${r.visitor_name} (${r.company})`).join(', ')}
        </p>
      )}
      <Panel title="Ajukan izin">
        <ActionForm action={requestPermit} label="Ajukan izin" primary hidden={{ idem: randomUUID() }} className="max-w-3xl">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm">Nama tamu / ketua rombongan<input name="visitor" required className={input} /></label>
            <label className="grid gap-1 text-sm">Perusahaan<input name="company" required className={input} /></label>
            <label className="grid gap-1 text-sm">Jumlah orang<input type="number" name="people" min={1} defaultValue={1} className={input} /></label>
            <label className="grid gap-1 text-sm">Mulai<input type="date" name="start" required defaultValue={today()} min={today()} className={input} /></label>
            <label className="grid gap-1 text-sm">Selesai<input type="date" name="end" required defaultValue={today()} min={today()} className={input} /></label>
            <AreaSelect areas={areas} />
          </div>
          <label className="grid gap-1 text-sm">Tujuan kunjungan / pekerjaan<input name="purpose" required className={input} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <EmployeeInput name="escort" label="Pendamping" />
            <Files label="Surat tugas / KTP / dokumen" />
          </div>
          <EmployeeDatalist />
        </ActionForm>
      </Panel>
      {rows.length ? (
        <Table head={['Nomor', 'Tamu', 'Tujuan', 'Tanggal', 'Area', 'Pendamping', 'Status']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs">{r.permit_no}</td>
              <td className="min-w-44">{r.visitor_name}<div className="text-xs text-muted">{r.company} · {r.people_count} orang</div></td>
              <td className="min-w-48 text-xs">{r.purpose}<div className="text-muted">Pemohon: {r.requester_name}</div>
                {approver && r.status === 'submitted' && (
                  <div className="mt-2 grid gap-2">
                    <ActionForm action={decidePermit} label="Setujui" hidden={{ id: r.id, approve: 'yes' }}>
                      {!r.escort_name && <EmployeeInput name="escort" label="Pendamping" required />}
                    </ActionForm>
                    <ActionForm action={decidePermit} label="Tolak" hidden={{ id: r.id, approve: 'no' }}>
                      <input name="note" placeholder="Alasan penolakan" className={input} />
                    </ActionForm>
                  </div>
                )}
                {r.status === 'approved' && (approver || r.requested_by === s.profile.id) && (
                  <ActionForm action={closePermit} label="Tandai selesai" hidden={{ id: r.id }} className="mt-2" />
                )}
              </td>
              <td className="tabular whitespace-nowrap text-xs">{fmtDate(r.start_on)}{r.end_on !== r.start_on && ` – ${fmtDate(r.end_on)}`}</td>
              <td className="text-xs">{r.work_area_name}{r.area_note ? ` · ${r.area_note}` : ''}</td>
              <td className="text-xs">{r.escort_name ?? '–'}</td>
              <td><Pill tone={PERMIT_STATUS[r.status][0]}>{PERMIT_STATUS[r.status][1]}</Pill>
                {r.decision_note && <div className="mt-1 text-xs text-muted">{r.decision_note}</div>}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada izin masuk area.</p>}
    </>
  );
}
