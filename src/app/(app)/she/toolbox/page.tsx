import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Table, input } from '@/components/ui';
import { fmtDate } from '@/lib/documents';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { recordToolbox } from '../lapangan-actions';
import { DeptSelect, SheTabs, sheMasters, today } from '../fields';

export const metadata = { title: 'Toolbox talk' };

type Row = { id: string; talk_date: string; shift: number; topic: string; notes: string | null; department: { code: string } | null; leader: { full_name: string | null } | null; toolbox_attendees: { count: number }[] };

export default async function ToolboxPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: rows }, { depts }] = await Promise.all([
    supabase.from('toolbox_talks').select('id, talk_date, shift, topic, notes, department:department_id(code), leader:led_by(full_name), toolbox_attendees(count)')
      .order('talk_date', { ascending: false }).order('created_at', { ascending: false }).limit(60).returns<Row[]>(),
    sheMasters(),
  ]);
  return (
    <>
      <PageHeader eyebrow="SMKP 4.4 · Komunikasi keselamatan" title="Toolbox talk" />
      <SheTabs active="/she/toolbox" />
      {s.can('she.report') && (
        <Panel title="Catat toolbox talk" sub="Briefing keselamatan di awal shift. Peserta ditulis lewat NRP.">
          <ActionForm action={recordToolbox} label="Simpan toolbox talk" primary className="max-w-2xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Tanggal<input type="date" name="date" required defaultValue={today()} max={today()} className={input} /></label>
              <label className="grid gap-1 text-sm">Shift<select name="shift" className={input}><option value="1">Shift 1</option><option value="2">Shift 2</option></select></label>
              <DeptSelect depts={depts} value={s.profile.department_id} />
            </div>
            <label className="grid gap-1 text-sm">Topik<input name="topic" required maxLength={160} className={input} placeholder="mis. Jalan licin saat hujan" /></label>
            <label className="grid gap-1 text-sm">Poin yang disampaikan<textarea name="notes" rows={3} className={input} /></label>
            <label className="grid gap-1 text-sm">NRP peserta
              <textarea name="nrps" rows={3} required className={`${input} font-mono`} placeholder="Satu NRP per baris atau dipisah koma" />
            </label>
          </ActionForm>
        </Panel>
      )}
      <Panel title="Riwayat">
        {rows?.length ? (
          <Table head={['Tanggal', 'Shift', 'Dept', 'Topik', 'Pemimpin', 'Peserta']}>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-xs">{fmtDate(r.talk_date)}</td>
                <td className="text-xs">{r.shift}</td>
                <td className="font-mono text-xs">{r.department?.code}</td>
                <td className="min-w-56 text-sm">{r.topic}{r.notes && <div className="text-xs text-muted">{r.notes}</div>}</td>
                <td className="text-xs">{r.leader?.full_name}</td>
                <td className="tabular text-xs">{r.toolbox_attendees[0]?.count ?? 0}</td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada toolbox talk.</p>}
      </Panel>
    </>
  );
}
