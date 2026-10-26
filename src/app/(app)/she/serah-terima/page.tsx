import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, input } from '@/components/ui';
import { fmtDate } from '@/lib/documents';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { ackHandover, submitHandover } from '../lapangan-actions';
import { DeptSelect, SheTabs, sheMasters, today } from '../fields';

export const metadata = { title: 'Serah terima shift' };

type Row = {
  id: string; handover_date: string; shift: number; area: string | null; summary: string; pending_work: string | null; hazards: string | null; units_note: string | null;
  created_by: string; received_at: string | null; department: { code: string } | null; author: { full_name: string | null } | null; receiver: { full_name: string | null } | null;
};

export default async function HandoverPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: rows }, { depts }] = await Promise.all([
    supabase.from('shift_handovers')
      .select('id, handover_date, shift, area, summary, pending_work, hazards, units_note, created_by, received_at, department:department_id(code), author:created_by(full_name), receiver:received_by(full_name)')
      .order('handover_date', { ascending: false }).order('created_at', { ascending: false }).limit(40).returns<Row[]>(),
    sheMasters(),
  ]);
  const can = s.can('she.report');
  return (
    <>
      <PageHeader eyebrow="Kesinambungan kerja antar shift" title="Serah terima shift" />
      <SheTabs active="/she/serah-terima" />
      {can && (
        <Panel title="Buat serah terima" sub="Diisi oleh yang menyerahkan; shift berikutnya menekan Terima setelah membaca.">
          <ActionForm action={submitHandover} label="Simpan serah terima" primary className="max-w-2xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Tanggal<input type="date" name="date" required defaultValue={today()} max={today()} className={input} /></label>
              <label className="grid gap-1 text-sm">Shift yang menyerahkan<select name="shift" className={input}><option value="1">Shift 1</option><option value="2">Shift 2</option></select></label>
              <DeptSelect depts={depts} value={s.profile.department_id} />
            </div>
            <label className="grid gap-1 text-sm">Area / front kerja<input name="area" maxLength={80} className={input} placeholder="mis. Pit A – Hauling road KM 7" /></label>
            <label className="grid gap-1 text-sm">Ringkasan kondisi<textarea name="summary" required rows={3} className={input} /></label>
            <label className="grid gap-1 text-sm">Pekerjaan belum selesai<textarea name="pending" rows={2} className={input} /></label>
            <label className="grid gap-1 text-sm">Bahaya / kondisi tidak aman<textarea name="hazards" rows={2} className={input} /></label>
            <label className="grid gap-1 text-sm">Unit bermasalah / standby<textarea name="units" rows={2} className={input} placeholder="mis. DT-05 menunggu ban, HD-12 bocor oli" /></label>
          </ActionForm>
        </Panel>
      )}
      <Panel title="Riwayat serah terima">
        {rows?.length ? (
          <ul className="grid gap-3">
            {rows.map(r => (
              <li key={r.id} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{fmtDate(r.handover_date)} · Shift {r.shift} · {r.department?.code}{r.area ? ` · ${r.area}` : ''}</span>
                  {r.received_at ? <Pill tone="ok">Diterima {r.receiver?.full_name}</Pill> : <Pill tone="warn">Belum diterima</Pill>}
                </div>
                <p className="mt-1 whitespace-pre-line">{r.summary}</p>
                {r.pending_work && <p className="mt-1 text-xs text-muted"><b>Belum selesai:</b> {r.pending_work}</p>}
                {r.hazards && <p className="mt-1 text-xs text-crit"><b>Bahaya:</b> {r.hazards}</p>}
                {r.units_note && <p className="mt-1 text-xs text-muted"><b>Unit:</b> {r.units_note}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
                  <span>Diserahkan oleh {r.author?.full_name}</span>
                  {can && !r.received_at && r.created_by !== s.profile.id && <ActionForm action={ackHandover} label="Terima" primary hidden={{ id: r.id }} />}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Belum ada serah terima.</p>}
      </Panel>
    </>
  );
}
