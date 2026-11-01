import { btnGhost } from '@/components/ui';

// Tombol unduh register ke Excel / CSV (lihat src/lib/datasets.ts)
export function ExportLinks({ dataset, params, label }: { dataset: string; params?: Record<string, string>; label?: string }) {
  const q = params ? new URLSearchParams(params).toString() : '';
  return (
    <span className="flex items-center gap-1.5">
      {label && <span className="mr-0.5 text-xs font-medium text-muted">{label}</span>}
      <a href={`/api/ekspor/${dataset}${q && `?${q}`}`} className={`${btnGhost} px-2.5 py-1 text-xs`} title="Unduh ke Excel">⇩ Excel</a>
      <a href={`/api/ekspor/${dataset}?format=csv${q && `&${q}`}`} className={`${btnGhost} px-2.5 py-1 text-xs`} title="Unduh CSV">CSV</a>
    </span>
  );
}
