import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { sapWeek } from '@/lib/she';
import { setSapLeave, setSapTarget } from '../actions';
import { SheTabs } from '../fields';

export const metadata = { title: 'SAP' };

type Row = {
  user_id: string; full_name: string | null; on_leave: boolean;
  obs_target: number; insp_target: number; hazard_target: number; obs_act: number; insp_act: number; hazard_act: number;
};

const addDays = (ws: string, days: number) => {
  const d = new Date(`${ws}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
const shift = (ws: string, weeks: number) => addDays(ws, weeks * 7);
const pct = (a: number, p: number) => (p > 0 ? Math.min(a / p, 1) : 1);
const tone = (v: number) => (v >= 1 ? 'text-ok' : v >= 0.5 ? 'text-warn' : 'text-crit');

function Cell({ a, p }: { a: number; p: number }) {
  return <td className={`tabular text-xs ${p ? tone(pct(a, p)) : 'text-muted'}`}>{a} / {p}</td>;
}

export default async function SapPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const ws = sp.minggu ?? sapWeek(new Date(Date.now() + 8 * 3600e3));
  const supabase = await createClient();
  const manage = s.can('sap.manage');
  const [{ data: rows }, { data: people }] = await Promise.all([
    supabase.from('sap_weekly').select('*').eq('week_start', ws).order('full_name').returns<Row[]>(),
    manage ? supabase.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name') : Promise.resolve({ data: null }),
  ]);
  const list = rows ?? [];
  const total = list.reduce((t, r) => ({ p: t.p + r.obs_target + r.insp_target + r.hazard_target,
    a: t.a + Math.min(r.obs_act, r.obs_target) + Math.min(r.insp_act, r.insp_target) + Math.min(r.hazard_act, r.hazard_target) }), { p: 0, a: 0 });

  return (
    <>
      <PageHeader eyebrow="Safety Accountability Program · minggu Selasa–Senin" title="SAP" />
      <SheTabs active="/she/sap" />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/she/sap?minggu=${shift(ws, -1)}`} className="text-accent">← Minggu sebelumnya</Link>
        <span className="font-medium">{fmtDate(ws)} – {fmtDate(addDays(ws, 6))}</span>
        <Link href={`/she/sap?minggu=${shift(ws, 1)}`} className="text-accent">Minggu berikutnya →</Link>
        <span className="ml-auto">Pencapaian: <b className={tone(pct(total.a, total.p))}>{Math.round(pct(total.a, total.p) * 100)}%</b></span>
      </div>
      {list.length ? (
        <Table head={['Pengawas', 'Observasi', 'Inspeksi', 'Hazard', 'Capaian', ...(manage ? ['Cuti'] : [])]}>
          {list.map(r => {
            const p = r.obs_target + r.insp_target + r.hazard_target;
            const a = Math.min(r.obs_act, r.obs_target) + Math.min(r.insp_act, r.insp_target) + Math.min(r.hazard_act, r.hazard_target);
            return (
              <tr key={r.user_id}>
                <td>{r.full_name}{r.on_leave && <span className="ml-2 font-mono text-[10px] uppercase text-muted">cuti</span>}</td>
                <Cell a={r.obs_act} p={r.obs_target} /><Cell a={r.insp_act} p={r.insp_target} /><Cell a={r.hazard_act} p={r.hazard_target} />
                <td className={`tabular text-xs font-medium ${p ? tone(pct(a, p)) : 'text-muted'}`}>{p ? `${Math.round(pct(a, p) * 100)}%` : '–'}</td>
                {manage && <td><ActionForm action={setSapLeave} label={r.on_leave ? 'Batalkan cuti' : 'Tandai cuti'}
                  hidden={{ user: r.user_id, week: ws, leave: r.on_leave ? 'no' : 'yes' }} /></td>}
              </tr>
            );
          })}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada target atau act pada minggu ini.</p>}
      <p className="text-xs text-muted">Act dihitung otomatis dari observasi, inspeksi dan hazard report yang dibuat setiap orang. Saat cuti, target minggu itu nol.</p>
      {manage && (
        <Panel title="Atur target mingguan">
          <ActionForm action={setSapTarget} label="Simpan target" className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-5">
              <label className="grid gap-1 text-sm sm:col-span-2">Pengawas
                <select name="user" required className={input} defaultValue=""><option value="" disabled>Pilih</option>
                  {(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}</select>
              </label>
              <label className="grid gap-1 text-sm">Observasi<input type="number" name="obs" min={0} defaultValue={2} className={input} /></label>
              <label className="grid gap-1 text-sm">Inspeksi<input type="number" name="insp" min={0} defaultValue={1} className={input} /></label>
              <label className="grid gap-1 text-sm">Hazard<input type="number" name="haz" min={0} defaultValue={2} className={input} /></label>
            </div>
            <label className="grid max-w-xs gap-1 text-sm">Berlaku mulai minggu<input type="date" name="from" required defaultValue={ws} className={input} /></label>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
