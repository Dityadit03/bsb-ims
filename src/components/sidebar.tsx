'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NAV } from '@/lib/modules';

// Aksi yang paling sering dipakai di lapangan, selalu terlihat di bawah layar HP
const QUICK = [['/', 'Beranda', '⌂'], ['/she/p2h', 'P2H', '✓'], ['/she/hazard', 'Hazard', '⚠'], ['/tugas', 'Tugas', '✉']] as const;

const Icon = ({ d, className = 'size-5' }: { d: string; className?: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const MENU = 'M4 6h16M4 12h16M4 18h16';
const SEARCH = 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35';
const BELL = 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9m4.3 13a1.94 1.94 0 0 0 3.4 0';
const GEAR = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z';

const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

// Kerangka aplikasi: bilah atas (menu, cari, notifikasi, pengaturan, profil) + menu samping yang dibuka dari tombol ☰.
export function Sidebar({ permissions, name, email, unread, settings }: {
  permissions: string[]; name: string; email: string; unread: number; settings: string | null;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const perms = new Set(permissions);
  useEffect(() => { setOpen(false); setProfile(false); }, [path]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  // "/" memfokuskan pencarian, Esc menutup menu
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); search.current?.focus(); }
      if (e.key === 'Escape') { setOpen(false); setProfile(false); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const first = name.split(' ')[0];
  const iconBtn = 'relative grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-panel text-ink transition-colors hover:border-violet/50';

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur after:brand-line after:absolute after:inset-x-0 after:-bottom-px after:h-0.5">
        <div className="flex h-16 items-center gap-3 px-3 sm:px-5">
          <button onClick={() => setOpen(true)} className={iconBtn} aria-label="Buka menu" aria-expanded={open} aria-controls="nav"><Icon d={MENU} /></button>
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Image src="/logo.png" alt="" width={34} height={34} priority className="size-8" />
            <span className="hidden leading-none sm:grid">
              <span className="text-[15px] font-extrabold tracking-tight">BSB IMS</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted">Site BDA</span>
            </span>
          </Link>
          <form action="/cari" role="search" className="mx-auto hidden w-full max-w-xl md:block">
            <label className="flex items-center gap-2 rounded-xl border border-line bg-ground px-3 py-2 text-muted focus-within:border-violet/60 focus-within:bg-panel">
              <Icon d={SEARCH} className="size-4" />
              <input ref={search} name="q" type="search" placeholder="Cari dokumen, karyawan, unit, MR/PO…" aria-label="Cari di semua modul"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none" />
              <kbd className="rounded border border-line bg-panel px-1.5 font-mono text-[11px]">/</kbd>
            </label>
          </form>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <Link href="/cari" className={`${iconBtn} md:hidden`} aria-label="Cari"><Icon d={SEARCH} /></Link>
            <Link href="/tugas" className={iconBtn} aria-label={`Tugas & notifikasi${unread ? `, ${unread} belum dibaca` : ''}`}>
              <Icon d={BELL} />
              {unread > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-crit px-1 text-center text-[10px] font-bold leading-5 text-white">{unread > 99 ? '99+' : unread}</span>}
            </Link>
            {settings && <Link href={settings} className={`${iconBtn} hidden sm:grid`} aria-label="Pengaturan"><Icon d={GEAR} /></Link>}
            <div className="relative">
              <button onClick={() => setProfile(p => !p)} aria-expanded={profile} aria-haspopup="menu"
                className="flex items-center gap-2 rounded-xl border border-line bg-panel py-1 pl-1 pr-1 transition-colors hover:border-violet/50 sm:pr-3">
                <span className="grid size-8 place-items-center rounded-full bg-[linear-gradient(135deg,#ea0b60,#900fb3_60%,#f95a11)] text-xs font-bold text-white">{initials(name)}</span>
                <span className="hidden text-sm font-semibold sm:inline">{first}</span>
              </button>
              {profile && (
                <div role="menu" className="absolute right-0 top-12 z-40 grid w-64 gap-1 rounded-2xl border border-line bg-panel p-3 text-sm shadow-xl">
                  <div className="truncate font-semibold">{name}</div>
                  <div className="truncate text-xs text-muted">{email}</div>
                  <div className="my-1 border-t border-line" />
                  <Link href="/tugas" className="rounded-lg px-2 py-1.5 hover:bg-ground">Kotak tugas</Link>
                  {settings && <Link href={settings} className="rounded-lg px-2 py-1.5 hover:bg-ground">Pengaturan</Link>}
                  <form action="/auth/keluar" method="post"><button className="w-full rounded-lg px-2 py-1.5 text-left text-crit hover:bg-ground">Keluar</button></form>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {open && <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} aria-hidden />}
      <aside id="nav" className={`${open ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] flex-col overflow-y-auto bg-coal bg-[radial-gradient(120%_50%_at_0%_0%,rgb(144_15_179/0.28),transparent_60%)] text-coal-ink shadow-2xl`}>
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <span className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight">
            <span className="grid size-9 place-items-center rounded-lg bg-white p-0.5"><Image src="/logo.png" alt="" width={36} height={36} /></span>BSB IMS
          </span>
          <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-coal-ink/70 hover:bg-white/10" aria-label="Tutup menu">✕</button>
        </div>
        <nav className="grid gap-4 px-3 py-4" aria-label="Menu utama">
          {NAV.map(group => (
            <div key={group.code} className="grid gap-0.5">
              <span className="px-2 pb-1 font-mono text-[11px] uppercase tracking-wider text-coal-ink/50">{group.label}</span>
              {group.items
                .filter(i => !i.perm || perms.has(i.perm))
                .map(item => {
                  const active = item.href === '/' ? path === '/' : path === item.href || (path.startsWith(item.href + '/') && !group.items.some(o => o.href !== item.href && path.startsWith(o.href)));
                  if (!group.ready)
                    return <span key={item.href} className="cursor-not-allowed rounded px-2 py-1.5 text-sm text-coal-ink/35" title="Modul belum dibangun">{item.label}</span>;
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                      className={`relative rounded-lg px-3 py-2 text-sm transition-colors ${active ? 'bg-white/10 font-semibold text-white before:brand-line before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full' : 'text-coal-ink/80 hover:bg-white/5 hover:text-white'}`}>
                      {item.label}
                    </Link>
                  );
                })}
            </div>
          ))}
        </nav>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-panel/95 backdrop-blur pb-[env(safe-area-inset-bottom)] text-[11px] lg:hidden" aria-label="Aksi cepat">
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
