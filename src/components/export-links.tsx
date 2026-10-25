import { btnGhost } from '@/components/ui';

// Tombol unduh register ke Excel / CSV (lihat src/lib/datasets.ts)
export function ExportLinks({ dataset, params }: { dataset: string; params?: Record<string, string> }) {
  const q = params ? new URLSearchParams(params).toString() : '';
  return (
    <span className="flex gap-1.5">
      <a href={`/api/ekspor/${dataset}${q && `?${q}`}`} className={`${btnGhost} px-2.5 py-1 text-xs`} title="Unduh ke Excel">⇩ Excel</a>
      <a href={`/api/ekspor/${dataset}?format=csv${q && `&${q}`}`} className={`${btnGhost} px-2.5 py-1 text-xs`} title="Unduh CSV">CSV</a>
    </span>
  );
}
