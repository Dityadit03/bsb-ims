import Link from 'next/link';

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="grid gap-1">
        {eyebrow && <span className="font-mono text-xs uppercase tracking-wider text-muted">{eyebrow}</span>}
        <h1 className="text-4xl font-bold leading-none">{title}</h1>
      </div>
      {children}
    </header>
  );
}

export function Panel({ title, children, action }: { title?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3 rounded-md border border-line bg-panel p-4">
      {(title || action) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h2 className="text-xl font-semibold">{title}</h2>}
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
  return <span className={`inline-flex items-center rounded px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${TONES[tone]}`}>{children}</span>;
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map(h => (
              <th key={h} className="border-b border-line bg-ground px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-muted">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_tr:last-child_td]:border-0">{children}</tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, href, note }: { label: string; value: number | string; href?: string; note?: string }) {
  const body = (
    <div className="grid gap-1 rounded-md border border-line bg-panel p-4">
      <span className="font-mono text-xs uppercase tracking-wider text-muted">{label}</span>
      <span className="tabular font-display text-4xl font-bold leading-none">{value}</span>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
  return href ? <Link href={href} className="hover:[&>div]:border-accent">{body}</Link> : body;
}

export const btn = 'inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50';
export const btnPrimary = `${btn} bg-accent text-white hover:bg-accent/90`;
export const btnGhost = `${btn} border border-line bg-panel hover:border-accent`;
export const input = 'w-full rounded-md border border-line bg-panel px-3 py-2 text-sm';
