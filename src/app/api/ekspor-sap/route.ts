import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { SAP_SECTION, sapWeek } from '@/lib/she';
import { writeLayoutXlsx, type SCell, type Style } from '@/lib/xlsx';
import {
  LEVEL_ORDER, MONTH, SAP_METRICS, ach, addDays, dayLabel, fmtPct, loadSap, mtdWeeks, pooled, statusOf, sum, weekAch, type SapRow,
} from '@/lib/sap';

// Ekspor tab Ringkasan SAP ke Excel dengan tata letak yang sama dengan layar, siap ditempel ke PowerPoint.
// Hak akses mengikuti pengguna yang mengunduh (RLS tetap berlaku).
const COAL = '#1e1433', MUTED = '#625c70', GROUND = '#f4f4f7';
const TONE = {
  ok: { color: '#2f7d4f', fill: '#e1efe6' }, warn: { color: '#b07a00', fill: '#f6ecd2' },
  crit: { color: '#b3261e', fill: '#f7dedb' }, muted: { color: MUTED, fill: '#ececf0' },
} as const;
const METRIC_STYLE = {
  obs: { color: '#5b21b6', fill: '#ece6f6' }, insp: { color: '#2563eb', fill: '#e4ecfc' }, hazard: { color: '#f95a11', fill: '#fee8de' },
} as const;
const toneOf = (v: number | null) => TONE[statusOf(v)[1]];

export async function GET(req: NextRequest) {
  const current = sapWeek(new Date(Date.now() + 7 * 3600e3));
  const q = req.nextUrl.searchParams.get('minggu');
  const ws = q && /^\d{4}-\d{2}-\d{2}$/.test(q) && q <= current ? q : current;
  const supabase = await createClient();
  const { all, weekNo } = await loadSap(supabase, ws);

  const week = all.filter(r => r.week_start === ws);
  const no = weekNo(ws), prevWs = addDays(ws, -7);
  const mtd = mtdWeeks(ws), mtdRows = all.filter(r => mtd.includes(r.week_start));
  const mtdAll = pooled(mtdRows);
  const mtdPrev = mtd.length > 1 ? pooled(mtdRows.filter(r => r.week_start !== ws)) : null;
  const delta = mtdAll != null && mtdPrev != null ? Math.round((mtdAll - mtdPrev) * 100) : null;
  const onsite = week.filter(r => !r.on_leave);
  const below = onsite.filter(r => (weekAch(r) ?? 1) < 1).length;
  const fri = addDays(ws, 3);
  const monthLabel = `${MONTH[Number(fri.slice(5, 7)) - 1]} ${fri.slice(0, 4)}`;
  const [statusText] = statusOf(mtdAll);
  const sections = SAP_SECTION.filter(sec => week.some(r => r.sap_section === sec));

  // Kisi 8 kolom (A–H): kartu 2 kolom, tabel section = label 2 kolom + 6 kolom P/A
  const W = 8;
  const rows: (SCell | null)[][] = [];
  const merges: string[] = [];
  const heights: Record<number, number> = {};
  const col = (i: number) => String.fromCharCode(65 + i);
  const row = () => { const r: (SCell | null)[] = Array(W).fill(null); rows.push(r); return rows.length; }; // nomor baris 1-based
  const put = (rowNo: number, c: number, v: SCell['v'], s: Style, span = 1, rowSpan = 1) => {
    rows[rowNo - 1][c] = { v, s };
    for (let rr = 0; rr < rowSpan; rr++) for (let cc = 0; cc < span; cc++) if (rr || cc) rows[rowNo - 1 + rr][c + cc] = { v: null, s };
    if (span > 1 || rowSpan > 1) merges.push(`${col(c)}${rowNo}:${col(c + span - 1)}${rowNo + rowSpan - 1}`);
  };
  const pct = (v: number | null, s: Style = {}): SCell => ({ v: v == null ? 'N/A' : v, s: { pct: v != null, h: 'center', border: true, b: true, color: toneOf(v).color, fill: toneOf(v).fill, ...s } });
  const putPct = (rowNo: number, c: number, v: number | null, span = 1) => {
    const cell = pct(v);
    put(rowNo, c, cell.v, cell.s!, span);
  };
  const blank = () => row();

  // Judul
  let r = row(); heights[r] = 30;
  put(r, 0, 'Safety Accountability Program (SAP)', { b: true, sz: 16, color: '#ffffff', fill: COAL }, W);
  r = row();
  put(r, 0, `W${no} · ${dayLabel(ws)} – ${dayLabel(addDays(ws, 6))} ${addDays(ws, 6).slice(0, 4)} · MTD ${monthLabel}`, { color: MUTED }, W);
  blank();

  // MTD: lingkaran capaian + status
  const t = toneOf(mtdAll);
  const m1 = row(), m2 = row(), m3 = row(), m4 = row();
  heights[m1] = 22; heights[m2] = 26;
  put(m1, 0, fmtPct(mtdAll), { b: true, sz: 32, color: t.color, fill: t.fill, h: 'center', border: true }, 2, 4);
  put(m1, 2, 'SAP site, month to date', { b: true, color: MUTED }, 6);
  put(m2, 2, statusText, { b: true, sz: 18, color: t.color }, 6);
  if (delta != null) put(m3, 2, `${delta < 0 ? '▼' : '▲'} ${Math.abs(delta)} poin vs W${weekNo(prevWs)}`, { b: true, color: delta < 0 ? TONE.crit.color : TONE.ok.color }, 6);
  put(m4, 2, `${monthLabel} · ${mtd.map(w => `W${weekNo(w)}`).join(' + ')}`, { color: MUTED }, 6);
  blank();

  // Tiga kartu jenis (kolom A–B, D–E, G–H)
  const starts = [0, 3, 6];
  const r1 = row(), r2 = row(), r3 = row(), r4 = row();
  heights[r2] = 34;
  SAP_METRICS.forEach((m, i) => {
    const c = starts[i], ms = METRIC_STYLE[m.key], v = pooled(mtdRows, m.key), tt = sum(mtdRows, m.key), vt = toneOf(v);
    put(r1, c, m.label, { b: true, color: ms.color, fill: ms.fill, h: 'center', border: true }, 2);
    put(r2, c, v == null ? 'N/A' : v, { b: true, sz: 20, pct: v != null, color: vt.color, fill: vt.fill, h: 'center', border: true }, 2);
    put(r3, c, `${tt.act} / ${tt.plan}`, { b: true, sz: 14, h: 'center', border: true }, 2);
    put(r4, c, 'act / plan, onsite', { sz: 9, color: MUTED, h: 'center', border: true }, 2);
  });
  blank();

  // Empat kotak ringkas
  const weekAll = pooled(week);
  const boxes: [string, string | number, string][] = [
    ['Onsite', onsite.length, TONE.ok.color], ['Cuti', week.length - onsite.length, '#1c1726'],
    [`Capaian W${no}`, fmtPct(weekAll), toneOf(weekAll).color], ['Belum target', below, below ? TONE.crit.color : TONE.ok.color],
  ];
  const b1 = row(), b2 = row(); heights[b2] = 30;
  boxes.forEach(([l, v, color], i) => {
    put(b1, i * 2, l, { sz: 10, color: MUTED, h: 'center', border: true, fill: GROUND }, 2);
    put(b2, i * 2, v, { b: true, sz: 18, color, h: 'center', border: true, fill: GROUND }, 2);
  });
  blank();

  // SAP Performance
  r = row(); heights[r] = 24;
  put(r, 0, `SAP Performance (%) · W-${no}`, { b: true, sz: 14, color: '#ffffff', fill: COAL }, W);
  r = row();
  put(r, 0, 'Capaian minggu ini per section dan level · P = % peserta onsite yang punya plan, A = % capaian aktual ÷ plan · N/A = semua cuti', { sz: 9, color: MUTED, wrap: true, v: 'top' }, W);
  heights[r] = 38;
  if (!sections.length) { r = row(); put(r, 0, 'Belum ada peserta SAP pada minggu ini.', { color: MUTED }, W); }
  else {
    blank();
    // Tabel ringkas per section
    r = row();
    put(r, 0, 'SECTION', { b: true, color: '#ffffff', fill: COAL, border: true }, 2);
    SAP_METRICS.forEach((m, i) => put(r, 2 + i * 2, m.short, { b: true, color: METRIC_STYLE[m.key].color, fill: METRIC_STYLE[m.key].fill, h: 'center', border: true }, 2));
    for (const sec of SAP_SECTION) {
      const rs = week.filter(x => x.sap_section === sec);
      r = row();
      put(r, 0, sec, { b: true, border: true }, 2);
      SAP_METRICS.forEach((m, i) => {
        if (rs.length) putPct(r, 2 + i * 2, pooled(rs, m.key), 2);
        else put(r, 2 + i * 2, '–', { color: MUTED, h: 'center', border: true }, 2);
      });
    }
    // Satu tabel per section: baris level + TOTAL, kolom P dan A per jenis
    for (const sec of sections) {
      blank();
      const rs = week.filter(x => x.sap_section === sec);
      const lv = LEVEL_ORDER.filter(l => rs.some(x => x.level === l));
      const h1 = row(), h2 = row(), h3 = row();
      put(h1, 0, sec, { b: true, sz: 12, color: '#ffffff', fill: COAL, border: true, v: 'top' }, 2, 3);
      put(h1, 2, `W-${no} · ${fmtPct(pooled(rs))}`, { b: true, fill: GROUND, h: 'center', border: true }, 6);
      SAP_METRICS.forEach((m, i) => put(h2, 2 + i * 2, m.short, { b: true, color: METRIC_STYLE[m.key].color, fill: METRIC_STYLE[m.key].fill, h: 'center', border: true }, 2));
      SAP_METRICS.forEach((_, i) => { put(h3, 2 + i * 2, 'P', { b: true, color: MUTED, h: 'center', border: true }); put(h3, 3 + i * 2, 'A', { b: true, color: MUTED, h: 'center', border: true }); });
      const line = (label: string, sub: string | null, xs: SapRow[], bold: boolean) => {
        const lr = row(); if (sub) heights[lr] = 30;
        put(lr, 0, sub ? `${label}\n${sub}` : label, { b: true, border: true, wrap: true, ...(bold ? { fill: GROUND } : {}) }, 2);
        SAP_METRICS.forEach((m, i) => {
          const tt = sum(xs, m.key), on = xs.filter(x => !x.on_leave);
          putPct(lr, 2 + i * 2, on.length ? on.filter(x => x[`${m.key}_target`] > 0).length / on.length : null);
          putPct(lr, 3 + i * 2, tt.on ? ach(tt.act, tt.plan) : null);
        });
      };
      for (const l of lv) { const xs = rs.filter(x => x.level === l); line(l, `${xs.filter(x => !x.on_leave).length}/${xs.length}`, xs, false); }
      line('TOTAL', null, rs, true);
    }
  }

  const buf = writeLayoutXlsx({ name: `SAP W${no}`, rows, merges, widths: Array(W).fill(13), heights });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="bsb-sap-ringkasan-W${no}-${ws}.xlsx"`, 'Cache-Control': 'private, no-store',
    },
  });
}
