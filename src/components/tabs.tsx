'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

// Tab modul: di HP baris tab bisa digeser, dan tab aktif otomatis digeser ke tengah agar terlihat.
// Bayangan pudar di tepi kanan/kiri menandakan masih ada tab lain yang bisa digeser.
export function Tabs({ items, active }: { items: readonly (readonly [string, string])[]; active: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const nav = useRef<HTMLElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = () => {
    const n = nav.current;
    if (n) setEdge({ left: n.scrollLeft > 4, right: n.scrollLeft + n.clientWidth < n.scrollWidth - 4 });
  };
  // hanya menggeser baris tab; scrollIntoView ikut menggeser seluruh halaman ke samping
  useEffect(() => {
    const a = ref.current, n = nav.current;
    if (a && n) n.scrollTo({ left: a.offsetLeft - (n.clientWidth - a.clientWidth) / 2 });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [active]);
  const mask = edge.left && edge.right ? '[mask-image:linear-gradient(to_right,transparent,black_2rem,black_calc(100%-2.5rem),transparent)]'
    : edge.right ? '[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]'
    : edge.left ? '[mask-image:linear-gradient(to_right,transparent,black_2rem)]' : '';
  return (
    <nav ref={nav} onScroll={measure} className={`-mx-4 -mt-2 flex gap-1 overflow-x-auto border-b border-line px-4 text-sm [scrollbar-width:none] sm:mx-0 sm:px-0 ${mask}`}>
      {items.map(([href, label]) => (
        <Link key={href} href={href} ref={href === active ? ref : undefined} aria-current={href === active ? 'page' : undefined}
          className={`whitespace-nowrap border-b-2 px-3 py-2.5 ${href === active ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-ink'}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
