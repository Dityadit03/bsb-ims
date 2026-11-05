'use client';
import { useRouter } from 'next/navigation';

export function SiteSelect({ sites, value, next }: { sites: { code: string; name: string }[]; value: string; next?: string }) {
  const router = useRouter();
  return (
    <select id="site-select" aria-label="Pilih site" value={value}
      onChange={e => router.replace(`/login?site=${encodeURIComponent(e.target.value)}${next ? `&next=${encodeURIComponent(next)}` : ''}`)}
      className="w-full appearance-none rounded-xl border border-white/20 bg-white/10 bg-[length:1.1rem] bg-[right_0.9rem_center] bg-no-repeat px-3.5 py-3 pr-10 text-base font-semibold text-coal-ink focus:border-white/60 focus:outline-none [&>option]:text-ink"
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23ece8f3'%3E%3Cpath d='M5.5 7.5 10 12l4.5-4.5' stroke='%23ece8f3' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")" }}>
      {sites.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
    </select>
  );
}
