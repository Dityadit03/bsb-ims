import Link from 'next/link';

const TABS = [['/hrga', 'Karyawan'], ['/hrga/kompetensi', 'Kompetensi & SIMPER'], ['/hrga/pelatihan', 'Pelatihan'], ['/hrga/roster', 'Roster'], ['/hrga/ga', 'Permintaan GA']] as const;

export function HrTabs({ active }: { active: string }) {
  return (
    <nav className="-mt-2 flex gap-1 overflow-x-auto border-b border-line text-sm">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href}
          className={`whitespace-nowrap border-b-2 px-3 py-2 ${href === active ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-ink'}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
