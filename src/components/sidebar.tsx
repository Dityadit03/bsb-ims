'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NAV } from '@/lib/modules';
import type { Alert } from '@/lib/alerts';
import { PushToggle, WhatsappToggle } from './push-toggle';
import { forgetDevice } from '@/lib/push';

// Aksi yang paling sering dipakai di lapangan, selalu terlihat di bawah layar HP
const QUICK = [['/', 'Beranda', '⌂'], ['/absen', 'Absen', '◉'], ['/she/p2h', 'P2H', '✓'], ['/she/hazard', 'Hazard', '⚠'], ['/tugas', 'Tugas', '✉']] as const;

const Icon = ({ d, className = 'size-5' }: { d: string; className?: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const I = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9m4.3 13a1.94 1.94 0 0 0 3.4 0',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  chev: 'm6 9 6 6 6-6',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2m3.45-6.89L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 0v6h6M8 13h8M8 17h5',
  layers: 'm12 2 10 5-10 5L2 7zm-10 10 10 5 10-5M2 17l10 5 10-5',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-4',
  truck: 'M10 17h4V5H2v12h3m15 0h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1m-8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm12 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  brief: 'M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
  sliders: 'M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-6h6m2 8h6',
};
const GROUP_ICON: Record<string, string> = { M2: I.file, M3: I.layers, M4: I.shield, M5: I.truck, M6: I.chart, M7: I.box, M8: I.users, M9: I.brief, ADM: I.sliders };

const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
const base = (href: string) => href.split('?')[0];
const Badge = ({ n, tone = 'crit' }: { n: number; tone?: 'crit' | 'violet' }) => n > 0
  ? <span className={`ml-auto min-w-6 rounded-full px-1.5 text-center text-xs font-bold leading-5 text-white ${tone === 'crit' ? 'bg-crit' : 'bg-violet'}`}>{n > 999 ? '999+' : n}</span>
  : null;

type Theme = 'system' | 'light' | 'dark';

// Kerangka aplikasi: bilah atas (menu, cari, peringatan, pengaturan, profil) + menu samping yang dibuka dari tombol ☰.
export function Sidebar({ permissions, name, email, role, unit, alerts, alertTotal }: {
  permissions: string[]; name: string; email: string; role: string; unit: string; alerts: Alert[]; alertTotal: number;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [pop, setPop] = useState<null | 'alerts' | 'settings' | 'profile'>(null);
  const [theme, setTheme] = useState<Theme>('system');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const search = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const perms = new Set(permissions);

  useEffect(() => { setOpen(false); setPop(null); }, [path]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  useEffect(() => {
    try { const t = localStorage.getItem('bsb-theme'); if (t === 'light' || t === 'dark') setTheme(t); } catch {}
  }, []);
  // "/" memfokuskan pencarian, Esc menutup menu/panel, klik di luar menutup panel
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); search.current?.focus(); }
      if (e.key === 'Escape') { setOpen(false); setPop(null); }
    };
    const click = (e: MouseEvent) => { if (bar.current && !bar.current.contains(e.target as Node)) setPop(null); };
    window.addEventListener('keydown', key);
    document.addEventListener('mousedown', click);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('mousedown', click); };
  }, []);

  const applyTheme = (t: Theme) => {
    setTheme(t);
    try { if (t === 'system') localStorage.removeItem('bsb-theme'); else localStorage.setItem('bsb-theme', t); } catch {}
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  };
  const toggle = (p: 'alerts' | 'settings' | 'profile') => setPop(cur => (cur === p ? null : p));

  // angka penanda per menu: peringatan yang menuju halaman itu
  const itemBadge = (href: string) => alerts.filter(a => a.tone !== 'accent' || href === '/tugas').filter(a => base(a.href) === href).reduce((t, a) => t + a.n, 0);
  const isActive = (href: string, siblings: string[]) =>
    href === '/' ? path === '/' : path === href || (path.startsWith(href + '/') && !siblings.some(o => o !== href && o.length > href.length && path.startsWith(o)));
  const groups = NAV.filter(g => g.ready).map(g => ({ ...g, items: g.items.filter(i => !i.perm || perms.has(i.perm)) })).filter(g => g.items.length);
  const activeGroup = groups.find(g => g.items.some(i => isActive(i.href, g.items.map(x => x.href))))?.code;
  const isOpen = (code: string) => code === 'M0' || code === activeGroup || expanded.has(code);
  const flip = (code: string) => setExpanded(s => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });

  const first = name.split(' ')[0];
  const iconBtn = (on: boolean) => `relative grid size-10 shrink-0 place-items-center rounded-xl border bg-panel transition-colors ${on ? 'border-accent text-accent' : 'border-line text-ink hover:border-violet/50'}`;
  const popBox = 'absolute right-0 top-12 z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-panel p-4 shadow-xl';
  const row = 'flex items-center justify-between gap-3 border-t border-line py-3 first:border-0 first:pt-0';
  const small = 'shrink-0 rounded-xl border border-line px-3 py-1.5 text-sm font-semibold hover:border-violet/50';

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur after:brand-line after:absolute after:inset-x-0 after:-bottom-px after:h-0.5">
        <div className="flex h-16 items-center gap-3 px-3 sm:px-5">
          <button onClick={() => setOpen(true)} className={iconBtn(false)} aria-label="Buka menu" aria-expanded={open} aria-controls="nav"><Icon d={I.menu} /></button>
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Image src="/logo.png" alt="" width={34} height={34} priority className="size-8" />
            <span className="hidden leading-none sm:grid">
              <span className="text-[15px] font-extrabold tracking-tight">BSB IMS</span>
              <span className="font-mono text-xs uppercase tracking-wider text-muted">Site BDA</span>
            </span>
          </Link>
          <form action="/cari" role="search" className="mx-auto hidden w-full max-w-xl md:block">
            <label className="flex items-center gap-2 rounded-xl border border-line bg-ground px-3 py-2 text-muted focus-within:border-violet/60 focus-within:bg-panel">
              <Icon d={I.search} className="size-4" />
              <input ref={search} name="q" type="search" placeholder="Cari formulir, dokumen, karyawan, unit…" aria-label="Cari di semua modul"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none" />
              <kbd className="rounded border border-line bg-panel px-1.5 font-mono text-xs">/</kbd>
            </label>
          </form>
          <div ref={bar} className="relative ml-auto flex items-center gap-2 md:ml-0">
            <Link href="/cari" className={`${iconBtn(false)} md:hidden`} aria-label="Cari"><Icon d={I.search} /></Link>
            <button onClick={() => toggle('alerts')} className={iconBtn(pop === 'alerts')} aria-expanded={pop === 'alerts'} aria-label={`Peringatan, ${alertTotal}`}>
              <Icon d={I.bell} />
              {alertTotal > 0 && <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-crit px-1 text-center text-xs font-bold leading-5 text-white">{alertTotal > 999 ? '999+' : alertTotal}</span>}
            </button>
            <button onClick={() => toggle('settings')} className={`${iconBtn(pop === 'settings')} hidden sm:grid`} aria-expanded={pop === 'settings'} aria-label="Pengaturan"><Icon d={I.gear} /></button>
            <button onClick={() => toggle('profile')} aria-expanded={pop === 'profile'} aria-label="Profil"
              className={`flex items-center gap-2 rounded-xl border bg-panel py-1 pl-1 pr-1 transition-colors sm:pr-3 ${pop === 'profile' ? 'border-accent' : 'border-line hover:border-violet/50'}`}>
              <span className="grid size-8 place-items-center rounded-full bg-[linear-gradient(135deg,#ea0b60,#900fb3_60%,#f95a11)] text-xs font-bold text-white">{initials(name)}</span>
              <span className="hidden text-sm font-semibold sm:inline">{first}</span>
            </button>

            {pop === 'alerts' && (
              <div className={popBox} role="dialog" aria-label="Peringatan">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-bold">Peringatan</span>
                  <Link href="/" className="text-xs font-semibold text-violet underline underline-offset-2">Lihat semua</Link>
                </div>
                <ul className="-mr-2 grid max-h-[60vh] gap-0.5 overflow-y-auto pr-2">
                  {alerts.map(a => (
                    <li key={a.title}>
                      <Link href={a.href} className="flex gap-3 rounded-xl px-2 py-2 hover:bg-ground">
                        <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${a.tone === 'crit' ? 'bg-crit ring-4 ring-crit/15' : a.tone === 'warn' ? 'bg-orange' : 'bg-violet'}`} />
                        <span className="grid"><span className="text-sm font-semibold">{a.title[0].toUpperCase() + a.title.slice(1)}</span><span className="text-xs text-muted">{a.sub}</span></span>
                      </Link>
                    </li>
                  ))}
                  {!alerts.length && <li className="py-6 text-center text-sm text-muted">Tidak ada peringatan 👍</li>}
                </ul>
              </div>
            )}

            {pop === 'settings' && (
              <div className={popBox} role="dialog" aria-label="Pengaturan">
                <div className="mb-3 font-bold">Pengaturan</div>
                <div className={row}>
                  <span className="grid"><span className="text-sm font-medium">Tema tampilan</span><span className="text-xs text-muted">Ikuti perangkat, terang, atau gelap</span></span>
                  <span className="flex shrink-0 rounded-xl bg-ground p-1 text-sm" role="radiogroup" aria-label="Tema">
                    {([['system', 'Sistem'], ['light', 'Terang'], ['dark', 'Gelap']] as const).map(([k, l]) => (
                      <button key={k} role="radio" aria-checked={theme === k} onClick={() => applyTheme(k)}
                        className={`rounded-lg px-2.5 py-1 ${theme === k ? 'bg-panel font-semibold shadow-sm' : 'text-muted'}`}>{l}</button>
                    ))}
                  </span>
                </div>
                <PushToggle />
                <WhatsappToggle />
                <div className={row}>
                  <span className="grid"><span className="text-sm font-medium">Tautan Google Drive</span><span className="text-xs text-muted">Link Form / Sheet / Drive di Pusat Data</span></span>
                  <Link href="/pusat-data" className={small}>Atur tautan</Link>
                </div>
                <div className={row}>
                  <span className="grid"><span className="text-sm font-medium">Migrasi data</span><span className="text-xs text-muted">Upload Excel/CSV, cek otomatis, lalu simpan</span></span>
                  <Link href="/data/impor" className={small}>Buka</Link>
                </div>
                <div className={row}>
                  <span className="grid"><span className="text-sm font-medium">Laporan ke spreadsheet</span><span className="text-xs text-muted">Unduh Excel atau hubungkan Google Sheets</span></span>
                  <Link href="/data" className={small}>Buka</Link>
                </div>
                {perms.has('user.manage') && (
                  <div className={row}>
                    <span className="grid"><span className="text-sm font-medium">Kelola akses</span><span className="text-xs text-muted">Aktivasi pengguna & peran</span></span>
                    <Link href="/admin/pengguna" className={small}>Buka</Link>
                  </div>
                )}
                <div className={row}>
                  <span className="grid min-w-0"><span className="text-sm font-medium">Akses Anda</span><span className="truncate text-xs text-muted">{name} · {role}</span></span>
                  <form action="/auth/keluar" method="post" onSubmit={async e => { e.preventDefault(); const f = e.currentTarget; await forgetDevice(); f.submit(); }}><button className={small}>Keluar</button></form>
                </div>
              </div>
            )}

            {pop === 'profile' && (
              <div className={`${popBox} w-64`} role="menu">
                <div className="truncate font-semibold">{name}</div>
                <div className="truncate text-xs text-muted">{email.endsWith('@nrp.bsb.local') ? `NIK ${email.split('@')[0].toUpperCase()}` : email}</div>
                <div className="truncate text-xs text-muted">{role} · {unit}</div>
                <div className="my-2 border-t border-line" />
                <Link href="/saya" className="block rounded-lg px-2 py-1.5 text-sm hover:bg-ground">Profil & pengajuan saya</Link>
                <Link href="/absen" className="block rounded-lg px-2 py-1.5 text-sm hover:bg-ground">Absen</Link>
                <Link href="/tugas" className="block rounded-lg px-2 py-1.5 text-sm hover:bg-ground">Kotak tugas</Link>
                {email.endsWith('@nrp.bsb.local') && <Link href="/ganti-sandi" className="block rounded-lg px-2 py-1.5 text-sm hover:bg-ground">Ganti sandi</Link>}
                <button onClick={() => setPop('settings')} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-ground">Pengaturan</button>
                <form action="/auth/keluar" method="post" onSubmit={async e => { e.preventDefault(); const f = e.currentTarget; await forgetDevice(); f.submit(); }}><button className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-crit hover:bg-ground">Keluar</button></form>
              </div>
            )}
          </div>
        </div>
      </header>

      {open && <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden />}
      <aside id="nav" className={`${open ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-50 w-80 max-w-[88vw] flex-col overflow-y-auto bg-coal text-coal-ink shadow-2xl before:brand-line before:absolute before:inset-x-0 before:top-0 before:h-1`}>
        <div className="flex items-start gap-3 border-b border-white/10 px-5 pb-4 pt-6">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white p-1"><Image src="/logo.png" alt="" width={40} height={40} /></span>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="font-bold">PT Berkarya Sejahtera Bersama</span>
            <span className="truncate text-xs text-coal-ink/60">{unit} · Site BDA</span>
          </span>
          <button onClick={() => setOpen(false)} className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/15 text-coal-ink/80 hover:bg-white/10" aria-label="Tutup menu">✕</button>
        </div>
        <nav className="grid gap-3 px-3 py-4" aria-label="Menu utama">
          {groups.map(g => {
            const hrefs = g.items.map(i => i.href);
            const total = g.items.reduce((t, i) => t + itemBadge(i.href), 0);
            const items = g.items.map(item => {
              const active = isActive(item.href, hrefs);
              const n = itemBadge(item.href);
              return (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${active ? 'border border-accent/70 bg-[linear-gradient(90deg,rgb(194_18_90/0.28),transparent)] font-semibold text-white' : 'border border-transparent text-coal-ink/85 hover:bg-white/5 hover:text-white'}`}>
                  {g.code === 'M0' && <Icon d={item.href === '/' ? I.home : I.inbox} className="size-4 shrink-0 opacity-80" />}
                  <span className="truncate">{item.label}</span>
                  <Badge n={n} tone={item.href === '/tugas' ? 'violet' : 'crit'} />
                </Link>
              );
            });
            if (g.code === 'M0') return <div key={g.code} className="grid gap-0.5">{items}</div>;
            const on = isOpen(g.code);
            return (
              <div key={g.code} className="grid gap-0.5">
                <button onClick={() => flip(g.code)} aria-expanded={on}
                  className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-coal-ink hover:bg-white/5">
                  <Icon d={GROUP_ICON[g.code] ?? I.file} className="size-4 shrink-0 opacity-80" />
                  <span className="flex-1 truncate">{g.label}</span>
                  {!on && <Badge n={total} />}
                  <Icon d={I.chev} className={`size-4 shrink-0 opacity-60 transition-transform ${on ? 'rotate-180' : ''}`} />
                </button>
                {on && <div className="ml-5 grid gap-0.5 border-l border-white/10 pl-2">{items}</div>}
              </div>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-white/10 px-5 py-4 text-xs text-coal-ink/60">
          <div className="truncate font-semibold text-coal-ink">{name}</div>
          <div className="truncate">{role} · {email}</div>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-line bg-panel/95 backdrop-blur pb-[env(safe-area-inset-bottom)] text-xs lg:hidden" aria-label="Aksi cepat">
        {QUICK.map(([href, label, icon]) => {
          const active = href === '/' ? path === '/' : path.startsWith(href);
          return (
            <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 py-2 ${active ? 'font-semibold text-violet' : 'text-muted'}`}>
              <span aria-hidden className="text-lg leading-none">{icon}</span>{label}
            </Link>
          );
        })}
        <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-muted" aria-controls="nav" aria-expanded={open}>
          <span aria-hidden className="text-lg leading-none">☰</span>Menu
        </button>
      </nav>
    </>
  );
}
