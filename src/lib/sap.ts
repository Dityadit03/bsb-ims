// Hitungan capaian SAP yang dipakai halaman /she/sap dan ekspor Excel Ringkasan (harus sama persis).
import type { SupabaseClient } from '@supabase/supabase-js';

export type SapRow = {
  employee_id: string; week_start: string; week_no: number; nrp: string; full_name: string; level: string | null; sap_section: string | null;
  sort_order: number; locked: boolean; on_leave: boolean;
  obs_target: number; insp_target: number; hazard_target: number; obs_act: number; insp_act: number; hazard_act: number;
};
export type SapMetric = 'obs' | 'insp' | 'hazard';

export const SAP_METRICS: { key: SapMetric; short: string; label: string }[] = [
  { key: 'obs', short: 'OBS', label: 'Observasi' },
  { key: 'insp', short: 'INS', label: 'Inspeksi' },
  { key: 'hazard', short: 'HAZ', label: 'Hazard report' },
];
export const LEVEL_ORDER = ['PJO', 'DH', 'SH', 'FOR'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const MONTH = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const DOW = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

export const addDays = (ws: string, days: number) => {
  const d = new Date(`${ws}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
export const dayLabel = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
// Achv = Act ÷ Plan, maksimal 100%; plan 0 dianggap 100%
export const ach = (a: number, p: number) => (p > 0 ? Math.min(a / p, 1) : 1);
export const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null; };
export const fmtPct = (v: number | null) => (v == null ? 'N/A' : `${Math.round(v * 100)}%`);
export const weekAch = (r: SapRow) => (r.on_leave ? null : avg(SAP_METRICS.map(m => ach(r[`${m.key}_act`], r[`${m.key}_target`]))));
export const sum = (rows: SapRow[], m: SapMetric) => {
  const on = rows.filter(r => !r.on_leave);
  return { act: on.reduce((t, r) => t + r[`${m}_act`], 0), plan: on.reduce((t, r) => t + r[`${m}_target`], 0), on: on.length };
};
// Capaian gabungan: per jenis = total act ÷ total plan peserta onsite, lalu rata-rata tiga jenis; N/A bila semua cuti
export const pooled = (rows: SapRow[], m?: SapMetric): number | null => {
  if (!rows.some(r => !r.on_leave)) return null;
  if (m) { const s = sum(rows, m); return ach(s.act, s.plan); }
  return avg(SAP_METRICS.map(x => pooled(rows, x.key)));
};
// Month to date: minggu yang hari Jumat-nya jatuh di bulan yang sama
export const mtdWeeks = (ws: string) => {
  const month = addDays(ws, 3).slice(0, 7);
  const out: string[] = [];
  for (let w = ws; addDays(w, 3).slice(0, 7) === month; w = addDays(w, -7)) out.unshift(w);
  return out;
};
// Status MTD: label dan nada (ok/warn/crit/muted)
export const statusOf = (v: number | null): [string, 'ok' | 'warn' | 'crit' | 'muted'] =>
  v == null ? ['Belum ada data', 'muted'] : v >= 0.9 ? ['Sesuai target', 'ok'] : v >= 0.6 ? ['Perlu perhatian', 'warn'] : ['Di bawah target', 'crit'];

export async function loadSap(supabase: SupabaseClient, ws: string) {
  const [{ data }, { data: anchorRow }] = await Promise.all([
    supabase.from('sap_weekly').select('*').gte('week_start', addDays(ws, -7 * 11)).lte('week_start', ws).not('level', 'is', null).returns<SapRow[]>(),
    supabase.from('app_settings').select('value').eq('key', 'sap_anchor').maybeSingle(),
  ]);
  const anchor = (anchorRow?.value as { week: number; start: string } | undefined) ?? { week: 41, start: '2026-10-13' };
  const weekNo = (w: string) => ((((Math.round((Date.parse(w) - Date.parse(anchor.start)) / 864e5 / 7) + anchor.week - 1) % 52) + 52) % 52) + 1;
  return { all: data ?? [], weekNo };
}
