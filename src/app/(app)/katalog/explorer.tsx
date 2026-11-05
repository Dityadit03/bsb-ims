'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { VW, VH, buildUnit } from './units';

export type CModel = { id: string; code: string; name: string; brand: string; template: 'pickup' | 'service' | 'dump'; description: string | null };
export type CGroup = { id: string; code: string; name: string; description: string | null; sort: number };
export type CPart = { id: string; group_id: string; ref_no: number; part_no: string; name: string; qty: number; description: string | null;
  material_code: string | null; note: string | null; stock_qty: number | null; uom: string | null; min_stock: number | null };

const W = VW, H = VH;

export function Explorer({ models, current, groups, parts }: { models: CModel[]; current: CModel; groups: CGroup[]; parts: CPart[] }) {
  const [exploded, setExploded] = useState(false);
  const [gid, setGid] = useState<string | null>(null);
  const [pid, setPid] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const art = useMemo(() => buildUnit(current.code, current.template), [current.code, current.template]);
  const asmOf = useMemo(() => new Map(art.asms.map(a => [a.id, a])), [art]);
  const abs = (code: string) => { const m = art.markers[code]; if (!m) return null; const a = asmOf.get(m.asm)!; return { x: m.x + (exploded ? a.dx : 0), y: m.y + (exploded ? a.dy : 0), asm: m.asm }; };
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

  // Callout bernomor di dua kolom tepi; garis penunjuk ke penanda kelompok pada unit
  const anchor = group ? (abs(group.code) ?? { x: W / 2, y: 200, asm: '' }) : null;
  const shown = gparts.slice(0, 28);
  const side = (i: number, ax: number) => (ax < W / 2 ? (i % 2 === 0 ? 'l' : 'r') : (i % 2 === 0 ? 'r' : 'l'));
  const left = shown.filter((_, i) => side(i, anchor?.x ?? 0) === 'l'), right = shown.filter((_, i) => side(i, anchor?.x ?? 0) === 'r');
  const place = (arr: CPart[], x: number) => arr.map((p, i) => ({ p, x, y: 40 + (arr.length === 1 ? (H - 120) / 2 : (i * (H - 120)) / (arr.length - 1)) }));
  const callouts = [...place(left, 34), ...place(right, W - 34)];
  const firstOf = (asm: string) => groups.find(g => art.markers[g.code]?.asm === asm)?.id;

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)_320px]">
      <nav aria-label="Model unit" className="flex gap-2 overflow-x-auto lg:grid lg:content-start lg:overflow-visible">
        {models.map(m => (
          <Link key={m.id} href={`/katalog?model=${m.code}`} aria-current={m.id === current.id ? 'page' : undefined}
            className={`min-w-40 rounded-xl border p-3 text-sm transition-colors ${m.id === current.id ? 'border-violet bg-violet/10' : 'border-line bg-panel hover:border-violet/60'}`}>
            <span className="block text-xs font-medium text-muted">{m.brand}</span>
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

        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Ilustrasi ${current.name}`} className="h-auto w-full select-none rounded-xl" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-violet, #7A1FD0) 7%, transparent), color-mix(in srgb, var(--color-violet, #7A1FD0) 2%, transparent) 70%)' }}>
          {art.defs}
          <ellipse cx={W / 2} cy="326" rx="380" ry="12" fill="#000" opacity=".18" />
          <rect x="0" y="322" width={W} height="2" fill="currentColor" opacity=".12" />
          {art.asms.map((a, i) => {
            const dim = !!gid && !!anchor?.asm && anchor.asm !== a.id;
            const first = firstOf(a.id);
            return (
              <g key={a.id} onClick={() => { if (!exploded) setExploded(true); else if (!gid && first) openGroup(first); }}
                className={`${gid ? '' : 'cursor-pointer'} motion-reduce:!transition-none`}
                style={{ transform: exploded ? `translate(${a.dx}px, ${a.dy}px)` : 'translate(0,0)', transition: `transform .8s cubic-bezier(.2,.8,.2,1) ${i * 45}ms, opacity .4s`, opacity: dim ? 0.28 : 1 }}>
                {a.node}
                {Object.entries(art.markers).filter(([code, m]) => m.asm === a.id && groups.some(g => g.code === code)).map(([code, m]) => {
                  const g = groups.find(x => x.code === code)!;
                  const on = g.id === gid;
                  return (
                    <g key={code} role="button" tabIndex={exploded ? 0 : -1} aria-label={`${g.name}, ${counts.get(g.id) ?? 0} part`}
                      onClick={e => { e.stopPropagation(); if (exploded) openGroup(g.id); }}
                      onKeyDown={e => { if (exploded && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openGroup(g.id); } }}
                      className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-white [&:focus-visible>rect]:stroke-[3]"
                      style={{ opacity: exploded ? 1 : 0, pointerEvents: exploded ? 'auto' : 'none', transition: 'opacity .5s .5s' }}>
                      <title>{g.name}</title>
                      {on && <rect x={m.x - 26} y={m.y - 15} width="52" height="30" rx="15" fill="#7A1FD0" opacity=".25" className="animate-pulse motion-reduce:animate-none" />}
                      <rect x={m.x - 22} y={m.y - 11} width="44" height="22" rx="11" fill={on ? '#7A1FD0' : '#3B2BC9'} stroke="#fff" strokeWidth="2" />
                      <text x={m.x} y={m.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" className="font-mono">{code}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}
          {gid && anchor && callouts.map(({ p, x, y }) => {
            const on = p.id === pid;
            return (
              <g key={p.id} role="button" tabIndex={0} aria-label={`Part ${p.ref_no}: ${p.name}`} className="cursor-pointer outline-none"
                onClick={() => setPid(p.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPid(p.id); } }}>
                <title>{p.name}</title>
                <line x1={anchor.x} y1={anchor.y} x2={x} y2={y} stroke="#7A1FD0" strokeWidth="1.5" opacity={on ? 1 : 0.55} strokeDasharray={on ? undefined : '4 3'} />
                <circle cx={x} cy={y} r="14" strokeWidth="2" stroke="#7A1FD0" fill={on ? '#7A1FD0' : '#fff'} />
                <text x={x} y={y + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill={on ? '#fff' : '#3B2BC9'}>{p.ref_no}</text>
              </g>
            );
          })}
        </svg>
        <p className="text-xs text-muted">Ilustrasi ilustratif unit (bukan gambar teknis pabrikan). {gid ? (callouts.length ? 'Klik nomor untuk melihat part.' : 'Belum ada part di kelompok ini.') : exploded ? 'Klik kelompok sistem untuk melihat part-nya.' : 'Klik unit atau tombol Bongkar untuk memecah per sistem.'}</p>
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
            <span className="text-xs font-medium text-muted">Part #{part.ref_no} · {group?.name}</span>
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
            <span className="text-xs font-medium text-muted">{gparts.length} part</span>
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
            <span className="text-xs font-medium text-muted">{current.brand}</span>
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
