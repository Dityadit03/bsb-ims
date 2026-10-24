'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NAV } from '@/lib/modules';

// Aksi yang paling sering dipakai di lapangan, selalu terlihat di bawah layar HP
const QUICK = [['/', 'Beranda', '⌂'], ['/she/p2h', 'P2H', '✓'], ['/she/hazard', 'Hazard', '⚠'], ['/tugas', 'Tugas', '✉']] as const;

export function Sidebar({ permissions, name, email }: { permissions: string[]; name: string; email: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const perms = new Set(permissions);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      <div className="sticky top-0 z-20 flex items-center justify-between bg-coal px-4 py-3 text-coal-ink after:brand-line after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 lg:hidden">
<span className="flex items-center gap-2 font-display text-xl font-bold tracking-wide"><span className="grid size-8 place-items-center rounded-lg bg-white p-0.5 shadow-sm"><Image src="/logo.png" alt="" width={32} height={32} priority /></span>BSB IMS</span>
        <button onClick={() => setOpen(o => !o)} className="rounded-lg border border-white/20 px-3 py-1 text-sm" aria-expanded={open} aria-controls="nav">
          Menu
        </button>
      </div>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside id="nav" className={`${open ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] flex-col overflow-y-auto bg-coal bg-[radial-gradient(120%_50%_at_0%_0%,rgb(144_15_179/0.28),transparent_60%)] text-coal-ink shadow-xl lg:sticky lg:top-0 lg:bottom-auto lg:z-auto lg:flex lg:h-dvh lg:w-64 lg:max-w-none lg:shrink-0 lg:shadow-none`}>
        <div className="flex items-center justify-between px-5 pt-4 lg:hidden">
  <span className="flex items-center gap-2 font-display text-xl font-bold tracking-wide"><span className="grid size-8 place-items-center rounded-lg bg-white p-0.5 shadow-sm"><Image src="/logo.png" alt="" width={32} height={32} priority /></span>BSB IMS</span>
          <button onClick={() => setOpen(false)} className="rounded px-3 py-2 text-sm text-coal-ink/70" aria-label="Tutup menu">Tutup</button>
        </div>
        <div className="hidden px-5 pb-2 pt-6 lg:block">
          <div className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-wide">
            <span className="grid size-10 place-items-center rounded-lg bg-white p-0.5 shadow-sm"><Image src="/logo.png" alt="" width={40} height={40} priority /></span>BSB IMS
          </div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-coal-ink/60">Integrated Management System</div>
        </div>
        <nav className="grid gap-4 px-3 py-4" aria-label="Menu utama">
          {NAV.map(group => (
            <div key={group.code} className="grid gap-0.5">
              <div className="flex items-center justify-between px-2 pb-1">
                <span className="font-mono text-[11px] uppercase tracking-wider text-coal-ink/50">{group.label}</span>
                {!group.ready && <span className="font-mono text-[10px] text-coal-ink/40">{group.code}</span>}
              </div>
              {group.items
                .filter(i => !i.perm || perms.has(i.perm))
                .map(item => {
                  const active = item.href === '/' ? path === '/' : path === item.href || (path.startsWith(item.href + '/') && !group.items.some(o => o.href !== item.href && path.startsWith(o.href)));
                  if (!group.ready)
                    return (
                      <span key={item.href} className="cursor-not-allowed rounded px-2 py-1.5 text-sm text-coal-ink/35" title="Modul belum dibangun">
                        {item.label}
                      </span>
                    );
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                      className={`relative rounded-lg px-3 py-2.5 text-sm transition-colors lg:py-1.5 ${active ? 'bg-white/10 font-medium text-white before:brand-line before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full' : 'text-coal-ink/80 hover:bg-white/5 hover:text-white'}`}>
                      {item.label}
                    </Link>
                  );
                })}
            </div>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/10 px-5 py-4 text-sm">
          <div className="truncate font-medium">{name}</div>
          <div className="truncate text-xs text-coal-ink/60">{email}</div>
          <form action="/auth/keluar" method="post" className="mt-2">
            <button className="text-xs text-coal-ink/70 hover:text-white hover:underline">Keluar</button>
          </form>
        </div>
      </aside>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-panel/95 backdrop-blur pb-[env(safe-area-inset-bottom)] text-[11px] lg:hidden" aria-label="Aksi cepat">
        {QUICK.map(([href, label, icon]) => {
          const active = href === '/' ? path === '/' : path.startsWith(href);
          return (
            <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 py-2 ${active ? 'font-medium text-accent' : 'text-muted'}`}>
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
