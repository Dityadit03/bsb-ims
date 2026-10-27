import Link from 'next/link';

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1.5">
        {eyebrow && <span className="font-mono text-xs uppercase tracking-wider text-muted">{eyebrow}</span>}
        <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">{title}</h1>
      </div>
      {children}
    </header>
  );
}

export function Panel({ title, sub, children, action }: { title?: string; sub?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="grid min-w-0 content-start gap-3 rounded-2xl border border-line bg-panel p-4 shadow-soft sm:p-5">
      {(title || action) && (
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            {title && <h2 className="text-base font-bold tracking-tight">{title}</h2>}
            {sub && <p className="text-xs text-muted">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES = {
  ok: 'bg-ok/10 text-ok',
  warn: 'bg-warn/10 text-warn',
  crit: 'bg-crit/10 text-crit',
  muted: 'bg-line/60 text-muted',
  accent: 'bg-accent-soft text-accent',
} as const;

export function Pill({ tone = 'muted', children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs uppercase tracking-wide ${TONES[tone]}`}>{children}</span>;
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map(h => (
              <th key={h} className="border-b border-line bg-ground px-3 py-2 text-left font-mono text-xs font-medium uppercase tracking-wider text-muted">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:bg-panel [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_tr:last-child_td]:border-0">{children}</tbody>
      </table>
    </div>
  );
}

const BAR = { crit: 'before:bg-crit', warn: 'before:bg-orange', ok: 'before:bg-ok', accent: 'before:bg-accent' } as const;
const VALUE = { crit: 'text-crit', warn: 'text-orange', ok: '', accent: '' } as const;

// Kartu angka; tone memberi garis warna di kiri (merah = perlu tindakan, oranye = segera)
export function Stat({ label, value, href, note, tone }: { label: string; value: number | string; href?: string; note?: string; tone?: keyof typeof BAR }) {
  const body = (
    <div className={`relative grid h-full content-start gap-1.5 overflow-hidden rounded-2xl border border-line bg-panel p-4 shadow-soft transition-colors ${tone ? `before:absolute before:inset-y-0 before:left-0 before:w-1 ${BAR[tone]}` : ''}`}>
      <span className="font-mono text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      <span className={`tabular text-3xl font-extrabold leading-none tracking-tight sm:text-4xl ${tone ? VALUE[tone] : ''}`}>{value}</span>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
  return href ? <Link href={href} className="hover:[&>div]:border-accent">{body}</Link> : body;
}

export const btn = 'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50';
export const btnPrimary = `${btn} bg-violet text-white shadow-sm hover:bg-violet/90`;
export const btnGhost = `${btn} border border-line bg-panel hover:border-violet/60`;
export const input = 'w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

// Pagination sederhana lewat parameter ?hal= agar daftar panjang tidak dirender sekaligus (berat di HP).
export function paginate<T>(items: T[], hal: string | undefined, size = 50) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(pages, Math.max(1, Number(hal) || 1));
  return { rows: items.slice((page - 1) * size, page * size), page, pages, total: items.length, size };
}

export function Pager({ page, pages, total, size, params, param = 'hal' }: {
  page: number; pages: number; total: number; size: number; params: Record<string, string | undefined>; param?: string;
}) {
  if (pages <= 1) return null;
  const href = (n: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, [param]: String(n) }).filter((e): e is [string, string] => !!e[1]));
    return `?${q}`;
  };
  const from = (page - 1) * size + 1;
  return (
    <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Halaman">
      <span className="text-muted">{from}–{Math.min(total, page * size)} dari {total}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link href={href(page - 1)} className={btnGhost}>‹ Sebelumnya</Link> : null}
        {page < pages ? <Link href={href(page + 1)} className={btnGhost}>Berikutnya ›</Link> : null}
      </span>
    </nav>
  );
}

// Daftar panjang: tampilkan beberapa baris pertama, sisanya bisa dibuka.
export function Clamp({ items, limit = 10, className = '' }: { items: React.ReactNode[]; limit?: number; className?: string }) {
  return (
    <div>
      <ul className={className}>{items.slice(0, limit)}</ul>
      {items.length > limit && (
        <details className="group">
          <summary className="cursor-pointer list-none py-2 text-sm text-accent group-open:hidden">Tampilkan semua ({items.length})</summary>
          <ul className={className}>{items.slice(limit)}</ul>
        </details>
      )}
    </div>
  );
}
