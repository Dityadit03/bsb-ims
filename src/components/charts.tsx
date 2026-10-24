// Grafik SVG ringan tanpa pustaka. Satu seri tanpa legenda (judul panel yang menamainya); dua seri dengan legenda.
// Setiap titik/batang punya tooltip bawaan (<title>) dan grafik punya ringkasan teks untuk pembaca layar.

const W = 720;
const PAD = { l: 46, r: 16, t: 14, b: 30 };
const compact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find(m => m * p >= v) ?? 10) * p;
}

function Grid({ max, h, suffix = '' }: { max: number; h: number; suffix?: string }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <g className="text-muted">
      {ticks.map(t => {
        const y = PAD.t + (h - PAD.t - PAD.b) * (1 - t);
        return (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.l - 8} y={y + 4} textAnchor="end" fontSize={11} className="fill-current font-mono">{compact.format(max * t)}{suffix}</text>
          </g>
        );
      })}
    </g>
  );
}

// Tren satu ukuran: garis 2px + isian lembut, titik terakhir disorot dan diberi label
export function AreaChart({ data, color = 'var(--color-accent)', height = 240, suffix = '', max: fixedMax, label }: {
  data: { label: string; value: number | null }[]; color?: string; height?: number; suffix?: string; max?: number; label: string;
}) {
  const vals = data.map(d => d.value ?? 0);
  if (!vals.some(v => v > 0)) return <p className="grid h-48 place-items-center rounded-xl border border-dashed border-line text-sm text-muted">Belum ada data untuk periode ini.</p>;
  const max = fixedMax ?? niceMax(Math.max(...vals, 4) * 1.1);
  const iw = W - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (data.length < 2 ? iw / 2 : (iw * i) / (data.length - 1));
  const y = (v: number) => PAD.t + ih * (1 - Math.min(v, max) / max);
  const pts = data.map((d, i) => d.value == null ? null : [x(i), y(d.value)] as const);
  const shown = pts.filter((p): p is readonly [number, number] => p != null);
  const line = shown.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
  const area = shown.length ? `${line}L${shown.at(-1)![0]},${PAD.t + ih}L${shown[0][0]},${PAD.t + ih}Z` : '';
  const lastI = data.map(d => d.value).findLastIndex(v => v != null);
  const id = `g${label.replace(/\W/g, '')}`;
  return (
    <figure className="m-0 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full min-w-[34rem]" role="img" aria-label={`${label}: ${data.map(d => `${d.label} ${d.value == null ? '–' : full.format(d.value) + suffix}`).join(', ')}`}>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.28} /><stop offset="1" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <Grid max={max} h={height} suffix={suffix} />
        {area && <path d={area} fill={`url(#${id})`} />}
        {line && <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />}
        {data.map((d, i) => {
          const p = pts[i];
          return (
            <g key={d.label}>
              <text x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} className="fill-current font-mono text-muted">{d.label}</text>
              {p && (
                <g>
                  <title>{`${d.label}: ${full.format(d.value!)}${suffix}`}</title>
                  <rect x={p[0] - 14} y={PAD.t} width={28} height={ih} fill="transparent" />
                  <circle cx={p[0]} cy={p[1]} r={i === lastI ? 6 : 4} fill={i === lastI ? color : 'var(--color-panel)'} stroke={i === lastI ? 'var(--color-panel)' : color} strokeWidth={2} />
                  {i === lastI && (
                    <text x={p[0] - 8} y={p[1] - 12} textAnchor="end" fontSize={12} fontWeight={700} className="fill-current text-ink">{compact.format(d.value!)}{suffix}</text>
                  )}
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

// Batang berkelompok per bulan (dua seri), dengan legenda dan celah 2px antar batang
export function GroupedBars({ labels, series, height = 220, label }: {
  labels: string[]; series: { name: string; color: string; values: number[] }[]; height?: number; label: string;
}) {
  const max = niceMax(Math.max(4, ...series.flatMap(s => s.values)));
  const iw = W - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
  const slot = iw / labels.length;
  const bw = Math.min(14, (slot - 10) / series.length - 2);
  return (
    <figure className="m-0 grid gap-2 overflow-x-auto">
      <figcaption className="flex flex-wrap gap-4 text-xs text-muted">
        {series.map(s => <span key={s.name} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span>)}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full min-w-[34rem]" role="img"
        aria-label={`${label}: ${labels.map((l, i) => `${l} ${series.map(s => `${s.name} ${s.values[i]}`).join(', ')}`).join('; ')}`}>
        <Grid max={max} h={height} />
        {labels.map((l, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          const start = cx - (series.length * (bw + 2) - 2) / 2;
          return (
            <g key={l}>
              <title>{`${l}: ${series.map(s => `${s.name} ${s.values[i]}`).join(' · ')}`}</title>
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} fill="transparent" />
              {series.map((s, j) => {
                const v = s.values[i];
                if (!v) return null;
                const h = (ih * v) / max;
                const bx = start + j * (bw + 2), by = PAD.t + ih - h;
                const r = Math.min(4, bw / 2, h);
                return <path key={s.name} fill={s.color}
                  d={`M${bx},${by + h}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + bw - r}Q${bx + bw},${by} ${bx + bw},${by + r}V${by + h}Z`} />;
              })}
              <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} className="fill-current font-mono text-muted">{l}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
