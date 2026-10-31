'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';

export type CModel = { id: string; code: string; name: string; brand: string; template: 'pickup' | 'service' | 'dump'; description: string | null };
export type CGroup = { id: string; code: string; name: string; description: string | null; sort: number };
export type CPart = { id: string; group_id: string; ref_no: number; part_no: string; name: string; qty: number; description: string | null;
  material_code: string | null; note: string | null; stock_qty: number | null; uom: string | null; min_stock: number | null };

const W = 800, H = 380;

// Tata letak blok kelompok: grid 3 baris. "Terpasang" = blok merapat ke tengah dan mengecil membentuk unit; "terbongkar" = menyebar.
function layout(n: number) {
  const rows = 3, cols = Math.max(1, Math.ceil(n / rows));
  const cw = (W - 40) / cols, ch = 100;
  return Array.from({ length: n }, (_, i) => {
    const r = i % rows, c = Math.floor(i / rows);
    const w = cw - 14, h = ch - 14;
    const x = 20 + c * cw + 7, y = 15 + r * (ch + 22) + 7;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  });
}

function Truck({ template }: { template: CModel['template'] }) {
  const body = template === 'pickup' ? 'M60 230 h40 l20 -50 h90 l40 50 h200 v20 H60z' : template === 'service' ? 'M60 230 h40 l20 -60 h90 v-20 h330 v100 H60z' : 'M60 230 h40 l20 -60 h90 l10 -30 h20 l260 -10 v110 H60z';
  return (
    <g className="text-muted" fill="none" stroke="currentColor" strokeWidth="2" opacity=".5">
      <path d={body} />
      <circle cx="170" cy="262" r="26" /><circle cx="540" cy="262" r="26" /><circle cx="610" cy="262" r="26" />
    </g>
  );
}

export function Explorer({ models, current, groups, parts }: { models: CModel[]; current: CModel; groups: CGroup[]; parts: CPart[] }) {
  const [exploded, setExploded] = useState(false);
  const [gid, setGid] = useState<string | null>(null);
  const [pid, setPid] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const pos = useMemo(() => layout(groups.length), [groups.length]);
  const counts = useMemo(() => { const m = new Map<string, number>(); parts.forEach(p => m.set(p.group_id, (m.get(p.group_id) ?? 0) + 1)); return m; }, [parts]);
  const group = groups.find(g => g.id === gid) ?? null;
  const gparts = useMemo(() => parts.filter(p => p.group_id === gid), [parts, gid]);
  const part = parts.find(p => p.id === pid) ?? null;
  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t.length < 2 ? [] : parts.filter(p => p.part_no.toLowerCase().includes(t) || p.name.toLowerCase().includes(t)).slice(0, 12);
  }, [q, parts]);

  const openGroup = (id: string) => { setGid(id); setPid(null); setExploded(true); };
  const jump = (p: CPart) => { setGid(p.group_id); setPid(p.id); setQ(''); };
  const back = () => { if (pid) setPid(null); else setGid(null); };

  // Titik callout pada elips di sekitar blok kelompok terfokus
  const callouts = gparts.slice(0, 40).map((p, i, a) => {
    const ang = (i / a.length) * Math.PI * 2 - Math.PI / 2;
    return { p, x: W / 2 + Math.cos(ang) * 300, y: H / 2 + Math.sin(ang) * 135 };
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)_320px]">
      <nav aria-label="Model unit" className="flex gap-2 overflow-x-auto lg:grid lg:content-start lg:overflow-visible">
        {models.map(m => (
          <Link key={m.id} href={`/katalog?model=${m.code}`} aria-current={m.id === current.id ? 'page' : undefined}
            className={`min-w-40 rounded-xl border p-3 text-sm transition-colors ${m.id === current.id ? 'border-violet bg-violet/10' : 'border-line bg-panel hover:border-violet/60'}`}>
            <span className="block font-mono text-xs uppercase text-muted">{m.brand}</span>
            <span className="block font-semibold leading-snug">{m.name}</span>
          </Link>
        ))}
      </nav>

      <section className="grid min-w-0 content-start gap-3 rounded-2xl border border-line bg-panel p-3 shadow-soft sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-base font-bold">{group ? `${group.code} · ${group.name}` : current.name}</h2>
          {gid
            ? <button type="button" onClick={back} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-violet/60">← {pid ? 'Daftar part' : 'Kembali ke unit'}</button>
            : <button type="button" onClick={() => setExploded(v => !v)} aria-pressed={exploded} className="rounded-lg bg-violet px-3 py-1.5 text-sm font-medium text-white hover:bg-violet/90">{exploded ? 'Rakit unit' : 'Bongkar unit'}</button>}
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Diagram skematik ${current.name}`} className="h-auto w-full select-none">
          {!gid && (
            <g style={{ transition: 'opacity .5s' }} opacity={exploded ? 0 : 1}><Truck template={current.template} /></g>
          )}
          {!gid && groups.map((g, i) => {
            const p = pos[i];
            const dx = (W / 2 - p.cx) * 0.55, dy = (H / 2 - p.cy) * 0.55;
            const tf = exploded ? 'translate(0px,0px) scale(1)' : `translate(${dx}px,${dy}px) scale(.5)`;
            return (
              <g key={g.id} role="button" tabIndex={0} aria-label={`${g.name}, ${counts.get(g.id) ?? 0} part`}
                onClick={() => (exploded ? openGroup(g.id) : setExploded(true))}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (exploded) openGroup(g.id); else setExploded(true); } }}
                className="cursor-pointer outline-none motion-reduce:!transition-none [&:focus-visible>rect]:stroke-[3]"
                style={{ transform: tf, transformBox: 'fill-box', transformOrigin: 'center', transition: `transform .7s cubic-bezier(.2,.8,.2,1) ${i * 35}ms` }}>
                <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="12" className="fill-panel stroke-violet" strokeWidth="2" style={{ fill: 'color-mix(in srgb, var(--color-violet, #7A1FD0) 10%, var(--color-panel, #fff))' }} />
                <text x={p.cx} y={p.cy - 6} textAnchor="middle" className="fill-current font-mono" fontSize="15" fontWeight="700">{g.code}</text>
                <text x={p.cx} y={p.cy + 14} textAnchor="middle" className="fill-current" fontSize="12">{g.name.length > 24 ? g.name.slice(0, 23) + '…' : g.name}</text>
                <text x={p.cx} y={p.cy + 32} textAnchor="middle" className="fill-muted" fontSize="11">{counts.get(g.id) ?? 0} part</text>
              </g>
            );
          })}
          {gid && (
            <g>
              <rect x={W / 2 - 110} y={H / 2 - 50} width="220" height="100" rx="16" strokeWidth="2.5" className="stroke-violet" style={{ fill: 'color-mix(in srgb, var(--color-violet, #7A1FD0) 12%, var(--color-panel, #fff))' }} />
              <text x={W / 2} y={H / 2 - 4} textAnchor="middle" className="fill-current font-mono" fontSize="22" fontWeight="700">{group?.code}</text>
              <text x={W / 2} y={H / 2 + 22} textAnchor="middle" className="fill-current" fontSize="13">{group?.name}</text>
              {callouts.map(({ p, x, y }) => (
                <g key={p.id} role="button" tabIndex={0} aria-label={`Part ${p.ref_no}: ${p.name}`} className="cursor-pointer outline-none"
                  onClick={() => setPid(p.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPid(p.id); } }}>
                  <line x1={W / 2} y1={H / 2} x2={x} y2={y} strokeWidth="1" className="stroke-line" />
                  <circle cx={x} cy={y} r="15" strokeWidth="2" className={p.id === pid ? 'fill-violet stroke-violet' : 'fill-panel stroke-violet'} />
                  <text x={x} y={y + 5} textAnchor="middle" fontSize="13" fontWeight="700" className={p.id === pid ? 'fill-white' : 'fill-current'}>{p.ref_no}</text>
                </g>
              ))}
            </g>
          )}
        </svg>
        <p className="text-xs text-muted">Gambar skematik (bukan skala). {gid ? (callouts.length ? 'Klik nomor untuk melihat part.' : 'Belum ada part di kelompok ini.') : exploded ? 'Klik kelompok sistem untuk melihat part-nya.' : 'Klik unit atau tombol Bongkar untuk memecah per sistem.'}</p>
      </section>

      <aside className="grid min-w-0 content-start gap-3 rounded-2xl border border-line bg-panel p-4 shadow-soft">
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Cari nomor / nama part…" aria-label="Cari part"
          className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
        {found.length > 0 ? (
          <ul className="grid gap-1.5">
            {found.map(p => (
              <li key={p.id}><button type="button" onClick={() => jump(p)} className="w-full rounded-lg border border-line p-2 text-left text-sm hover:border-violet/60">
                <span className="font-mono text-xs text-muted">{p.part_no}</span><br />{p.name}</button></li>
            ))}
          </ul>
        ) : part ? (
          <div className="grid gap-2 text-sm">
            <span className="font-mono text-xs uppercase text-muted">Part #{part.ref_no} · {group?.name}</span>
            <h3 className="text-lg font-bold leading-snug">{part.name}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted">Nomor part</dt><dd className="font-mono font-semibold">{part.part_no}</dd>
              <dt className="text-muted">Jumlah/unit</dt><dd>{part.qty}</dd>
              <dt className="text-muted">Kode gudang</dt><dd className="font-mono">{part.material_code ?? '–'}</dd>
              <dt className="text-muted">Stok gudang</dt>
              <dd>{part.material_code ? (part.stock_qty != null ? `${part.stock_qty} ${part.uom ?? ''}${part.min_stock != null && part.stock_qty <= part.min_stock ? ' (di bawah minimum)' : ''}` : 'kode belum ada di master barang') : 'belum terhubung'}</dd>
            </dl>
            {part.description && <p>{part.description}</p>}
            {part.note && <p className="text-muted">{part.note}</p>}
            <Link href="/logistik/mr" className="text-violet hover:underline">Buat permintaan material →</Link>
          </div>
        ) : group ? (
          <div className="grid gap-2 text-sm">
            <span className="font-mono text-xs uppercase text-muted">{gparts.length} part</span>
            {group.description && <p>{group.description}</p>}
            {gparts.length === 0 ? <p className="text-muted">Belum ada part. Logistik/Plant mengisi dari buku parts lewat Impor Excel atau form kelola.</p> : (
              <ul className="grid gap-1.5">
                {gparts.map(p => (
                  <li key={p.id}><button type="button" onClick={() => setPid(p.id)} className="grid w-full grid-cols-[2rem_1fr] gap-2 rounded-lg border border-line p-2 text-left hover:border-violet/60">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-violet/10 font-mono text-xs font-bold">{p.ref_no}</span>
                    <span><span className="block">{p.name}</span><span className="font-mono text-xs text-muted">{p.part_no}</span></span></button></li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="grid gap-2 text-sm">
            <span className="font-mono text-xs uppercase text-muted">{current.brand}</span>
            <h3 className="text-lg font-bold leading-snug">{current.name}</h3>
            {current.description && <p>{current.description}</p>}
            <p className="text-muted">{groups.length} kelompok sistem · {parts.length} part terdaftar.</p>
            <ul className="grid gap-1">
              {groups.map(g => (
                <li key={g.id}><button type="button" onClick={() => openGroup(g.id)} className="flex w-full justify-between rounded-lg px-2 py-1.5 text-left hover:bg-violet/10">
                  <span><span className="font-mono text-xs text-muted">{g.code}</span> {g.name}</span><span className="text-muted">{counts.get(g.id) ?? 0}</span></button></li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
