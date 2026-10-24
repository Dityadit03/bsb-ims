import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { SAP_LEVEL, SAP_SECTION, sapWeek } from '@/lib/she';
import { copySapLeave, endSapParticipant, lockSapWeek, saveSapParticipant, setSapLeave, setSapTarget } from '../portal-actions';
import { EmployeeDatalist, EmployeeInput, SheTabs } from '../fields';

export const metadata = { title: 'SAP' };

type Row = {
  employee_id: string; week_start: string; week_no: number; nrp: string; full_name: string; level: string | null; sap_section: string | null;
  sort_order: number; locked: boolean; on_leave: boolean;
  obs_target: number; insp_target: number; hazard_target: number; obs_act: number; insp_act: number; hazard_act: number;
};

const addDays = (ws: string, days: number) => {
  const d = new Date(`${ws}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
// Achv = Act ÷ Plan, maksimal 100%; plan 0 dianggap 100%
const ach = (a: number, p: number) => (p > 0 ? Math.min(a / p, 1) : 1);
const tone = (v: number | null) => (v == null ? 'text-muted' : v >= 1 ? 'text-ok' : v >= 0.5 ? 'text-warn' : 'text-crit');
const fmtPct = (v: number | null) => (v == null ? 'N/A' : `${Math.round(v * 100)}%`);
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null; };
const weekAch = (r: Row) => (r.on_leave ? null : avg([ach(r.obs_act, r.obs_target), ach(r.insp_act, r.insp_target), ach(r.hazard_act, r.hazard_target)]));
// Month to date: minggu yang hari Jumat-nya jatuh di bulan yang sama
const mtdWeeks = (ws: string) => {
  const month = addDays(ws, 3).slice(0, 7);
  const out: string[] = [];
  for (let w = ws; addDays(w, 3).slice(0, 7) === month; w = addDays(w, -7)) out.unshift(w);
  return out;
};
const mtdAch = (rows: Row[]) => {
  const on = rows.filter(r => !r.on_leave);
  if (!on.length) return null;
  const s = (k: 'obs' | 'insp' | 'hazard') => ach(on.reduce((t, r) => t + r[`${k}_act`], 0), on.reduce((t, r) => t + r[`${k}_target`], 0));
  return avg([s('obs'), s('insp'), s('hazard')]);
};

function Cell({ a, p, leave }: { a: number; p: number; leave: boolean }) {
  return <td className={`tabular whitespace-nowrap text-xs ${leave || !p ? 'text-muted' : tone(ach(a, p))}`}>{a} / {p}</td>;
}

export default async function SapPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const ws = sp.minggu ?? sapWeek(new Date(Date.now() + 8 * 3600e3));
  const weeks = mtdWeeks(ws);
  const supabase = await createClient();
  const manage = s.can('sap.manage');
  const { data } = await supabase.from('sap_weekly').select('*').in('week_start', weeks).not('level', 'is', null).returns<Row[]>();
  const all = data ?? [];
  const week = all.filter(r => r.week_start === ws).sort((a, b) =>
    SAP_SECTION.indexOf(a.sap_section as never) - SAP_SECTION.indexOf(b.sap_section as never) || a.sort_order - b.sort_order || a.full_name.localeCompare(b.full_name));
  const byPerson = new Map<string, Row[]>();
  for (const r of all) byPerson.set(r.employee_id, [...(byPerson.get(r.employee_id) ?? []), r]);
  const mtd = new Map([...byPerson].map(([id, rs]) => [id, mtdAch(rs)]));
  const weekNo = week[0]?.week_no;
  const locked = week.length > 0 && week.every(r => r.locked);
  const past = addDays(ws, 6) < sapWeek(new Date(Date.now() + 8 * 3600e3));
  const sections = SAP_SECTION.filter(sec => week.some(r => r.sap_section === sec));
  const levels = Object.keys(SAP_LEVEL);
  const secAch = (sec: string, lvl?: string) => avg(week.filter(r => r.sap_section === sec && (!lvl || r.level === lvl)).map(weekAch));
  const total = avg(week.map(weekAch));
  const totalMtd = avg(week.map(r => mtd.get(r.employee_id) ?? null));

  return (
    <>
      <PageHeader eyebrow="Safety Accountability Program · minggu Selasa–Senin" title="SAP"><ExportLinks dataset="sap" /></PageHeader>
      <SheTabs active="/she/sap" />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/she/sap?minggu=${addDays(ws, -7)}`} className="text-accent">← Sebelumnya</Link>
        <span className="font-medium">{weekNo ? `W${weekNo} · ` : ''}{fmtDate(ws)} – {fmtDate(addDays(ws, 6))}{locked && ' · terkunci'}</span>
        <Link href={`/she/sap?minggu=${addDays(ws, 7)}`} className="text-accent">Berikutnya →</Link>
        <span className="ml-auto">Minggu ini <b className={tone(total)}>{fmtPct(total)}</b> · MTD <b className={tone(totalMtd)}>{fmtPct(totalMtd)}</b></span>
      </div>
      {sections.length > 0 && (
        <Panel title="SAP performance per section">
          <Table head={['Section', ...levels.map(l => SAP_LEVEL[l]), 'Section']}>
            {sections.map(sec => (
              <tr key={sec}>
                <td className="font-mono text-xs font-medium">{sec}</td>
                {levels.map(l => {
                  const has = week.some(r => r.sap_section === sec && r.level === l);
                  const v = secAch(sec, l);
                  return <td key={l} className={`tabular text-xs ${has ? tone(v) : 'text-muted'}`}>{has ? fmtPct(v) : '–'}</td>;
                })}
                <td className={`tabular text-xs font-medium ${tone(secAch(sec))}`}>{fmtPct(secAch(sec))}</td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-muted">Persen = rata-rata capaian peserta onsite; N/A bila semua peserta di level itu cuti.</p>
        </Panel>
      )}
      {week.length ? (
        <Table head={['Peserta', 'Level', 'Observasi', 'Inspeksi', 'Hazard', 'Minggu', 'MTD', ...(manage && !locked ? ['Cuti'] : [])]}>
          {week.map(r => {
            const w = weekAch(r), m = mtd.get(r.employee_id) ?? null;
            return (
              <tr key={r.employee_id}>
                <td className="min-w-44">{r.full_name}<div className="font-mono text-[11px] text-muted">{r.sap_section} · {r.nrp}</div></td>
                <td className="text-xs">{r.level}</td>
                <Cell a={r.obs_act} p={r.obs_target} leave={r.on_leave} /><Cell a={r.insp_act} p={r.insp_target} leave={r.on_leave} />
                <Cell a={r.hazard_act} p={r.hazard_target} leave={r.on_leave} />
                <td className={`tabular text-xs font-medium ${tone(w)}`}>{r.on_leave ? 'Cuti' : fmtPct(w)}</td>
                <td className={`tabular text-xs ${tone(m)}`}>{fmtPct(m)}</td>
                {manage && !locked && <td><ActionForm action={setSapLeave} label={r.on_leave ? 'Onsite' : 'Cuti'}
                  hidden={{ employee_id: r.employee_id, week: ws, leave: r.on_leave ? 'no' : 'yes' }} /></td>}
              </tr>
            );
          })}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada peserta SAP pada minggu ini.</p>}
      <p className="text-xs text-muted">Act dihitung otomatis dari observasi, inspeksi dan hazard report yang dibuat atau diisi atas nama setiap peserta. Saat cuti, plan minggu itu nol dan tidak dihitung di persen section.</p>
      {manage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Minggu ini">
            <div className="flex flex-wrap gap-3">
              {!locked && <ActionForm action={copySapLeave} label="Salin status cuti minggu lalu" hidden={{ week: ws }} />}
              {past && !locked && <ActionForm action={lockSapWeek} label="Kunci minggu ini" hidden={{ week: ws }} />}
            </div>
            <p className="text-xs text-muted">Minggu yang dikunci tidak berubah lagi walau ada formulir yang diinput terlambat.</p>
          </Panel>
          <Panel title="Target mingguan">
            <ActionForm action={setSapTarget} label="Simpan target">
              <EmployeeInput label="Peserta" required />
              <div className="grid grid-cols-4 gap-2">
                <label className="grid gap-1 text-sm">Obs<input type="number" name="obs" min={0} defaultValue={1} className={input} /></label>
                <label className="grid gap-1 text-sm">Insp<input type="number" name="insp" min={0} defaultValue={1} className={input} /></label>
                <label className="grid gap-1 text-sm">Hazard<input type="number" name="haz" min={0} defaultValue={1} className={input} /></label>
                <label className="grid gap-1 text-sm">Mulai<input type="date" name="from" required defaultValue={ws} className={input} /></label>
              </div>
            </ActionForm>
          </Panel>
          <Panel title="Manpower SAP: tambah / ubah">
            <ActionForm action={saveSapParticipant} label="Simpan peserta">
              <EmployeeInput label="Karyawan" required />
              <div className="grid grid-cols-3 gap-2">
                <label className="grid gap-1 text-sm">Level
                  <select name="level" className={input}>{Object.entries(SAP_LEVEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </label>
                <label className="grid gap-1 text-sm">Section
                  <select name="section" className={input}>{SAP_SECTION.map(x => <option key={x}>{x}</option>)}</select>
                </label>
                <label className="grid gap-1 text-sm">Efektif<input type="date" name="from" required defaultValue={ws} className={input} /></label>
              </div>
              <label className="grid gap-1 text-sm">Keterangan<input name="reason" className={input} placeholder="Karyawan baru, pengangkatan jabatan, mutasi masuk…" /></label>
            </ActionForm>
          </Panel>
          <Panel title="Manpower SAP: keluarkan">
            <ActionForm action={endSapParticipant} label="Keluarkan dari SAP">
              <EmployeeInput label="Peserta" required />
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-sm">Tanggal efektif<input type="date" name="until" required className={input} /></label>
                <label className="grid gap-1 text-sm">Alasan<input name="reason" required className={input} placeholder="Resign, PHK, mutasi keluar" /></label>
              </div>
            </ActionForm>
          </Panel>
          <EmployeeDatalist />
        </div>
      )}
    </>
  );
}
