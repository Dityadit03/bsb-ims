import Link from 'next/link';
import { Fragment } from 'react';
import { ExportLinks } from '@/components/export-links';
import { ActionForm } from '@/components/action-form';
import { Tabs } from '@/components/tabs';
import { Panel, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { SAP_LEVEL, SAP_SECTION, sapWeek } from '@/lib/she';
import { copySapLeave, endSapParticipant, lockSapWeek, saveSapParticipant, setSapLeave, setSapTarget } from '../portal-actions';
import { EmployeeDatalist, EmployeeInput } from '../fields';
import { WeekPicker } from './week-picker';

export const metadata = { title: 'SAP' };

type Row = {
  employee_id: string; week_start: string; week_no: number; nrp: string; full_name: string; level: string | null; sap_section: string | null;
  sort_order: number; locked: boolean; on_leave: boolean;
  obs_target: number; insp_target: number; hazard_target: number; obs_act: number; insp_act: number; hazard_act: number;
};
type Metric = 'obs' | 'insp' | 'hazard';

const METRICS: { key: Metric; short: string; label: string; color: string; text: string; bg: string; border: string }[] = [
  { key: 'obs', short: 'OBS', label: 'Observasi', color: 'var(--color-violet)', text: 'text-violet', bg: 'bg-violet/8', border: 'border-t-violet' },
  { key: 'insp', short: 'INS', label: 'Inspeksi', color: 'var(--color-blue)', text: 'text-blue', bg: 'bg-blue/8', border: 'border-t-blue' },
  { key: 'hazard', short: 'HAZ', label: 'Hazard report', color: 'var(--color-flame)', text: 'text-flame', bg: 'bg-flame/8', border: 'border-t-flame' },
];
const LEVEL_ORDER = ['PJO', 'DH', 'SH', 'FOR'];
const TABS = [['ringkasan', 'Ringkasan'], ['tabel', 'Tabel SAP'], ['peserta', 'Peserta & target'], ['laporan', 'Laporan mingguan']] as const;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTH = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const DOW = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

const addDays = (ws: string, days: number) => {
  const d = new Date(`${ws}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
const dayLabel = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
// Achv = Act ÷ Plan, maksimal 100%; plan 0 dianggap 100%
const ach = (a: number, p: number) => (p > 0 ? Math.min(a / p, 1) : 1);
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null; };
const fmtPct = (v: number | null) => (v == null ? 'N/A' : `${Math.round(v * 100)}%`);
const tone = (v: number | null) => (v == null ? 'text-muted' : v >= 0.9 ? 'text-ok' : v >= 0.6 ? 'text-warn' : 'text-crit');
const pill = (v: number | null) => (v == null ? 'bg-line/60 text-muted' : v >= 0.9 ? 'bg-ok/12 text-ok' : v >= 0.6 ? 'bg-warn/12 text-warn' : 'bg-crit/10 text-crit');
const ringColor = (v: number | null) => (v == null ? 'var(--color-line)' : v >= 0.9 ? 'var(--color-ok)' : v >= 0.6 ? 'var(--color-warn)' : 'var(--color-crit)');
const weekAch = (r: Row) => (r.on_leave ? null : avg([ach(r.obs_act, r.obs_target), ach(r.insp_act, r.insp_target), ach(r.hazard_act, r.hazard_target)]));
const sum = (rows: Row[], m: Metric) => {
  const on = rows.filter(r => !r.on_leave);
  return { act: on.reduce((t, r) => t + r[`${m}_act`], 0), plan: on.reduce((t, r) => t + r[`${m}_target`], 0), on: on.length };
};
// Capaian gabungan: per jenis = total act ÷ total plan peserta onsite, lalu rata-rata tiga jenis; N/A bila semua cuti
const pooled = (rows: Row[], m?: Metric): number | null => {
  if (!rows.some(r => !r.on_leave)) return null;
  if (m) { const s = sum(rows, m); return ach(s.act, s.plan); }
  return avg(METRICS.map(x => pooled(rows, x.key)));
};
// Month to date: minggu yang hari Jumat-nya jatuh di bulan yang sama
const mtdWeeks = (ws: string) => {
  const month = addDays(ws, 3).slice(0, 7);
  const out: string[] = [];
  for (let w = ws; addDays(w, 3).slice(0, 7) === month; w = addDays(w, -7)) out.unshift(w);
  return out;
};

function Ring({ value, size = 64, stroke = 7, children }: { value: number | null; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        {value != null && value > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor(value)} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${c * value} ${c}`} />}
      </svg>
      <span className="relative font-extrabold tabular">{children ?? fmtPct(value)}</span>
    </span>
  );
}

const Pct = ({ v }: { v: number | null }) => (
  <span className={`inline-block min-w-12 rounded-full px-2 py-0.5 text-center font-mono text-[11px] font-semibold ${pill(v)}`}>{fmtPct(v)}</span>
);

export default async function SapPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const current = sapWeek(new Date(Date.now() + 8 * 3600e3));
  const ws = sp.minggu && sp.minggu <= current ? sp.minggu : current;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'ringkasan';
  const manage = s.can('sap.manage');
  const supabase = await createClient();
  const [{ data }, { data: anchorRow }] = await Promise.all([
    supabase.from('sap_weekly').select('*').gte('week_start', addDays(ws, -7 * 11)).lte('week_start', ws).not('level', 'is', null).returns<Row[]>(),
    supabase.from('app_settings').select('value').eq('key', 'sap_anchor').maybeSingle(),
  ]);
  const anchor = (anchorRow?.value as { week: number; start: string } | undefined) ?? { week: 41, start: '2026-10-13' };
  const weekNo = (w: string) => ((((Math.round((Date.parse(w) - Date.parse(anchor.start)) / 864e5 / 7) + anchor.week - 1) % 52) + 52) % 52) + 1;

  const all = data ?? [];
  const rowsOf = (w: string) => all.filter(r => r.week_start === w);
  const week = rowsOf(ws).sort((a, b) =>
    SAP_SECTION.indexOf(a.sap_section as never) - SAP_SECTION.indexOf(b.sap_section as never)
    || LEVEL_ORDER.indexOf(a.level!) - LEVEL_ORDER.indexOf(b.level!) || a.sort_order - b.sort_order || a.full_name.localeCompare(b.full_name));
  const no = weekNo(ws), prevWs = addDays(ws, -7);
  const mtd = mtdWeeks(ws);
  const mtdRows = all.filter(r => mtd.includes(r.week_start));
  const mtdAll = pooled(mtdRows);
  const mtdPrev = mtd.length > 1 ? pooled(mtdRows.filter(r => r.week_start !== ws)) : null;
  const delta = mtdAll != null && mtdPrev != null ? Math.round((mtdAll - mtdPrev) * 100) : null;
  const weekAll = pooled(week);
  const onsite = week.filter(r => !r.on_leave);
  const below = onsite.filter(r => (weekAch(r) ?? 1) < 1).length;
  const locked = week.length > 0 && week.every(r => r.locked);
  const running = ws === current;
  const sections = SAP_SECTION.filter(sec => week.some(r => r.sap_section === sec));
  const fri = addDays(ws, 3);
  const monthLabel = `${MONTH[Number(fri.slice(5, 7)) - 1]} ${fri.slice(0, 4)}`;
  const status = mtdAll == null ? ['Belum ada data', 'text-muted'] : mtdAll >= 0.9 ? ['Sesuai target', 'text-ok'] : mtdAll >= 0.6 ? ['Perlu perhatian', 'text-warn'] : ['Di bawah target', 'text-crit'];

  const weekOptions = Array.from({ length: 26 }, (_, i) => addDays(current, -7 * i)).map(w => ({
    start: w, label: `W${weekNo(w)} · ${dayLabel(w)} – ${dayLabel(addDays(w, 6))} ${addDays(w, 6).slice(0, 4)}${w === current ? ' · berjalan' : ''}`,
  }));
  if (!weekOptions.some(w => w.start === ws)) weekOptions.push({ start: ws, label: `W${no} · ${dayLabel(ws)} – ${dayLabel(addDays(ws, 6))} ${addDays(ws, 6).slice(0, 4)}` });
  const link = (t: string) => `/she/sap?tab=${t}${ws !== current ? `&minggu=${ws}` : ''}`;

  return (
    <>
      <header className="grid gap-3">
        <div className="flex flex-wrap gap-2 font-mono text-[11px] font-semibold">
          <span className="rounded-md bg-violet/10 px-2 py-1 text-violet">Fungsi Safety · Evaluasi kinerja</span>
          <span className="rounded-md bg-accent-soft px-2 py-1 text-accent">SMKP IV-C · SMK3 E6 · E12</span>
        </div>
        <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">Safety Accountability Program</h1>
        <p className="max-w-3xl text-sm text-muted sm:text-base">
          Pencapaian <b className="text-ink">observasi</b>, <b className="text-ink">inspeksi</b> dan <b className="text-ink">hazard report</b> setiap pengawas per minggu (Selasa–Senin).
          Act terhitung otomatis dari formulir <Link href="/she/observasi" className="text-violet underline">Observasi</Link>,{' '}
          <Link href="/she/inspeksi" className="text-violet underline">Inspeksi</Link> dan <Link href="/she/hazard" className="text-violet underline">Hazard Report</Link>.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <WeekPicker weeks={weekOptions} value={ws} base={`/she/sap?tab=${tab}`} />
        {!running && <Link href={`/she/sap?tab=${tab}`} className="rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm font-semibold shadow-soft hover:border-violet/60">Minggu ini</Link>}
        <span className="rounded-xl bg-line/50 px-3 py-2.5 text-sm text-muted">📅 MTD {monthLabel}</span>
        {locked && <span className="rounded-xl bg-line/50 px-3 py-2.5 text-sm text-muted">🔒 Terkunci</span>}
        <Link href="/data" className="ml-auto rounded-xl border border-ok/40 bg-ok/8 px-3.5 py-2.5 text-sm font-semibold text-ok hover:bg-ok/15">
          ▦ Tarik data per minggu (Sheet) ↗
        </Link>
      </div>

      <Tabs items={TABS.map(([k, l]) => [link(k), l] as const)} active={link(tab)} />

      {tab === 'ringkasan' && (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <section className="flex min-w-0 items-center gap-5 rounded-2xl border border-line bg-panel p-5 shadow-soft sm:gap-7 sm:p-6">
              <Ring value={mtdAll} size={128} stroke={12}><span className="text-3xl sm:text-4xl">{fmtPct(mtdAll)}</span></Ring>
              <div className="grid gap-1.5">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted">SAP site · month to date</span>
                <span className={`text-2xl font-extrabold tracking-tight sm:text-3xl ${status[1]}`}>{status[0]}</span>
                {delta != null && (
                  <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${delta < 0 ? 'bg-crit/10 text-crit' : 'bg-ok/12 text-ok'}`}>
                    {delta < 0 ? '▼' : '▲'} {Math.abs(delta)} poin vs W{weekNo(prevWs)}
                  </span>
                )}
                <span className="text-xs text-muted">{monthLabel} · {mtd.map(w => `W${weekNo(w)}`).join(' + ')}</span>
              </div>
            </section>
            <div className="grid content-start gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {METRICS.map(m => {
                  const t = sum(mtdRows, m.key);
                  return (
                    <section key={m.key} className={`flex items-center gap-3 rounded-2xl border border-line border-t-4 bg-panel p-4 shadow-soft ${m.border}`}>
                      <Ring value={pooled(mtdRows, m.key)} size={64} stroke={7}><span className="text-sm">{fmtPct(pooled(mtdRows, m.key))}</span></Ring>
                      <div className="grid gap-0.5">
                        <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted">
                          <span className="size-2 rounded-full" style={{ background: m.color }} />{m.label}
                        </span>
                        <span className="tabular"><b className="text-2xl font-extrabold">{t.act}</b><span className="text-sm text-muted"> / {t.plan}</span></span>
                        <span className="text-xs text-muted">act / plan, onsite</span>
                      </div>
                    </section>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 divide-line rounded-2xl border border-line bg-panel shadow-soft sm:grid-cols-4 sm:divide-x">
                {[
                  ['Onsite', onsite.length, 'text-ok'],
                  ['Cuti', week.length - onsite.length, 'text-ink'],
                  [`Capaian W${no}`, fmtPct(weekAll), tone(weekAll)],
                  ['Belum target', below, below ? 'text-crit' : 'text-ok'],
                ].map(([l, v, c]) => (
                  <div key={l as string} className="grid gap-1 px-4 py-3">
                    <span className="text-xs text-muted">{l}</span>
                    <span className={`tabular text-2xl font-extrabold ${c}`}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Panel title={`SAP Performance (%) · W-${no}`} sub="Capaian minggu ini per section dan level · P = plan, A = aktual (warna = capaian) · N/A = semua cuti">
            {sections.length ? (
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="font-mono text-[11px] font-semibold">
                        <th className="bg-coal px-3 py-2 text-left text-coal-ink">SECTION</th>
                        {METRICS.map(m => <th key={m.key} className={`px-2 py-2 ${m.bg} ${m.text}`}>{m.short}</th>)}
                      </tr>
                    </thead>
                    <tbody className="[&_td]:border-t [&_td]:border-line [&_td]:px-2 [&_td]:py-2">
                      {SAP_SECTION.map(sec => {
                        const rs = week.filter(r => r.sap_section === sec);
                        return (
                          <tr key={sec}>
                            <td className="!px-3 font-mono text-xs font-semibold">{sec}</td>
                            {METRICS.map(m => <td key={m.key} className="text-center">{rs.length ? <Pct v={pooled(rs, m.key)} /> : <span className="text-xs text-muted">–</span>}</td>)}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {sections.map(sec => {
                  const rs = week.filter(r => r.sap_section === sec);
                  const lv = LEVEL_ORDER.filter(l => rs.some(r => r.level === l));
                  const line = (label: React.ReactNode, xs: Row[], bold = false) => (
                    <tr className={bold ? 'bg-ground/60 font-semibold' : ''}>
                      <td className="!px-3 font-mono text-xs font-semibold">{label}</td>
                      {METRICS.flatMap(m => {
                        const t = sum(xs, m.key);
                        const v = t.on ? ach(t.act, t.plan) : null;
                        return [
                          <td key={`${m.key}p`} className="tabular text-center text-xs text-muted">{t.on ? t.plan : '–'}</td>,
                          <td key={`${m.key}a`} className="text-center"><span className={`inline-block min-w-8 rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold ${pill(v)}`}>{t.on ? t.act : 'N/A'}</span></td>,
                        ];
                      })}
                    </tr>
                  );
                  return (
                    <div key={sec} className="overflow-x-auto rounded-xl border border-line">
                      <table className="w-full text-sm">
                        <thead className="font-mono text-[11px] font-semibold">
                          <tr>
                            <th rowSpan={3} className="w-16 bg-coal px-3 py-2 text-left align-top text-coal-ink">{sec}</th>
                            <th colSpan={6} className="bg-ground py-1.5 text-center">W-{no} · {fmtPct(pooled(rs))}</th>
                          </tr>
                          <tr>{METRICS.map(m => <th key={m.key} colSpan={2} className={`py-1.5 ${m.bg} ${m.text}`}>{m.short}</th>)}</tr>
                          <tr className="text-muted">{METRICS.flatMap(m => [<th key={`${m.key}p`} className="py-1">P</th>, <th key={`${m.key}a`} className="py-1">A</th>])}</tr>
                        </thead>
                        <tbody className="[&_td]:border-t [&_td]:border-line [&_td]:px-1.5 [&_td]:py-2">
                          {lv.map(l => {
                            const xs = rs.filter(r => r.level === l);
                            return <Fragment key={l}>{line(<>{l}<div className="font-normal text-muted">{xs.filter(r => !r.on_leave).length}/{xs.length}</div></>, xs)}</Fragment>;
                          })}
                          {line('TOTAL', rs, true)}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-muted">Belum ada peserta SAP pada minggu ini.</p>}
          </Panel>
        </>
      )}

      {tab === 'tabel' && (
        week.length ? (
          <Table head={['Peserta', 'Level', 'Observasi', 'Inspeksi', 'Hazard', `W${no}`, 'MTD', ...(manage && !locked ? ['Cuti'] : [])]}>
            {week.map(r => {
              const w = weekAch(r), m = pooled(mtdRows.filter(x => x.employee_id === r.employee_id));
              const cell = (k: Metric) => (
                <td className={`tabular whitespace-nowrap text-xs ${r.on_leave || !r[`${k}_target`] ? 'text-muted' : tone(ach(r[`${k}_act`], r[`${k}_target`]))}`}>
                  {r[`${k}_act`]} / {r[`${k}_target`]}
                </td>
              );
              return (
                <tr key={r.employee_id}>
                  <td className="min-w-44">{r.full_name}<div className="font-mono text-[11px] text-muted">{r.sap_section} · {r.nrp}</div></td>
                  <td className="text-xs">{r.level}</td>
                  {cell('obs')}{cell('insp')}{cell('hazard')}
                  <td>{r.on_leave ? <span className="text-xs text-muted">Cuti</span> : <Pct v={w} />}</td>
                  <td><Pct v={m} /></td>
                  {manage && !locked && <td><ActionForm action={setSapLeave} label={r.on_leave ? 'Onsite' : 'Cuti'}
                    hidden={{ employee_id: r.employee_id, week: ws, leave: r.on_leave ? 'no' : 'yes' }} /></td>}
                </tr>
              );
            })}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada peserta SAP pada minggu ini.</p>
      )}

      {tab === 'peserta' && (
        <>
          <Table head={['Peserta', 'Section', 'Level', 'Target obs', 'Target insp', 'Target hazard', 'Status']}>
            {week.map(r => (
              <tr key={r.employee_id}>
                <td className="min-w-44">{r.full_name}<div className="font-mono text-[11px] text-muted">{r.nrp}</div></td>
                <td className="font-mono text-xs">{r.sap_section}</td>
                <td className="text-xs">{SAP_LEVEL[r.level!] ?? r.level}</td>
                <td className="tabular text-xs">{r.on_leave ? '–' : r.obs_target}</td>
                <td className="tabular text-xs">{r.on_leave ? '–' : r.insp_target}</td>
                <td className="tabular text-xs">{r.on_leave ? '–' : r.hazard_target}</td>
                <td className={`text-xs ${r.on_leave ? 'text-muted' : 'text-ok'}`}>{r.on_leave ? 'Cuti' : 'Onsite'}</td>
              </tr>
            ))}
          </Table>
          {manage ? (
            <div className="grid gap-4 lg:grid-cols-2">
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
          ) : <p className="text-xs text-muted">Perubahan peserta dan target dilakukan oleh HSE (izin sap.manage).</p>}
        </>
      )}

      {tab === 'laporan' && (() => {
        const weeks = Array.from({ length: 12 }, (_, i) => addDays(ws, -7 * (11 - i))).filter(w => all.some(r => r.week_start === w));
        return (
          <>
            <Panel title="Capaian per minggu" sub="12 minggu terakhir · capaian gabungan observasi, inspeksi dan hazard per section" action={<ExportLinks dataset="sap" />}>
              <Table head={['Section', ...weeks.map(w => `W${weekNo(w)}`)]}>
                {[...SAP_SECTION, 'TOTAL'].map(sec => (
                  <tr key={sec}>
                    <td className="font-mono text-xs font-semibold">{sec}</td>
                    {weeks.map(w => {
                      const rs = rowsOf(w).filter(r => sec === 'TOTAL' || r.sap_section === sec);
                      return <td key={w}>{rs.length ? <Pct v={pooled(rs)} /> : <span className="text-xs text-muted">–</span>}</td>;
                    })}
                  </tr>
                ))}
              </Table>
            </Panel>
            {manage && (
              <Panel title={`Kelola W${no}`} sub="Minggu yang dikunci tidak berubah lagi walau ada formulir yang diinput terlambat.">
                <div className="flex flex-wrap gap-3">
                  {!locked && <ActionForm action={copySapLeave} label="Salin status cuti minggu lalu" hidden={{ week: ws }} />}
                  {!running && !locked && <ActionForm action={lockSapWeek} label={`Kunci W${no}`} hidden={{ week: ws }} />}
                  {locked && <span className="text-sm text-muted">Minggu ini sudah terkunci.</span>}
                </div>
              </Panel>
            )}
          </>
        );
      })()}
    </>
  );
}
