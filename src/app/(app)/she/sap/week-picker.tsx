'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// Pemilih minggu SAP: panah sebelumnya/berikutnya dan daftar minggu
export function WeekPicker({ weeks, value, base }: { weeks: { start: string; label: string }[]; value: string; base: string }) {
  const router = useRouter();
  const i = weeks.findIndex(w => w.start === value);
  const go = (start: string) => `${base}${base.includes('?') ? '&' : '?'}minggu=${start}`;
  const arrow = 'grid size-9 shrink-0 place-items-center rounded-lg text-lg text-muted hover:bg-ground hover:text-ink';
  return (
    <div className="flex w-full min-w-0 items-center gap-1 rounded-xl sm:w-auto border border-line bg-panel px-1.5 py-1 shadow-soft">
      {i < weeks.length - 1 ? <Link href={go(weeks[i + 1].start)} className={arrow} aria-label="Minggu sebelumnya">‹</Link> : <span className={`${arrow} opacity-30`}>‹</span>}
      <select value={value} onChange={e => router.push(go(e.target.value))} aria-label="Pilih minggu"
        className="w-full min-w-0 flex-1 cursor-pointer truncate bg-transparent py-1.5 text-sm font-semibold focus:outline-none sm:min-w-[22rem]">
        {weeks.map(w => <option key={w.start} value={w.start}>{w.label}</option>)}
      </select>
      {i > 0 ? <Link href={go(weeks[i - 1].start)} className={arrow} aria-label="Minggu berikutnya">›</Link> : <span className={`${arrow} opacity-30`}>›</span>}
    </div>
  );
}
