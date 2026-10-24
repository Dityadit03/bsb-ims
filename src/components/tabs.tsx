'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

// Tab modul: di HP baris tab bisa digeser, dan tab aktif otomatis digeser ke tengah agar terlihat.
export function Tabs({ items, active }: { items: readonly (readonly [string, string])[]; active: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [active]);
  return (
    <nav className="-mx-4 -mt-2 flex gap-1 overflow-x-auto border-b border-line px-4 text-sm [scrollbar-width:none] sm:mx-0 sm:px-0">
      {items.map(([href, label]) => (
        <Link key={href} href={href} ref={href === active ? ref : undefined} aria-current={href === active ? 'page' : undefined}
          className={`whitespace-nowrap border-b-2 px-3 py-2.5 ${href === active ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-ink'}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
