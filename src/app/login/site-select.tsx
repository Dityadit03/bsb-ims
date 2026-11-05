'use client';
import { useRouter } from 'next/navigation';

export function SiteSelect({ sites, value, next }: { sites: { code: string; name: string }[]; value: string; next?: string }) {
  const router = useRouter();
  return (
    <select aria-label="Pilih site" value={value}
      onChange={e => router.replace(`/login?site=${encodeURIComponent(e.target.value)}${next ? `&next=${encodeURIComponent(next)}` : ''}`)}
      className="w-full rounded-xl border border-white/15 bg-white px-3 py-3 text-base font-semibold text-coal">
      {sites.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
    </select>
  );
}
