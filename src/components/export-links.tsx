import { btnGhost } from '@/components/ui';

// Tombol unduh register ke Excel / CSV (lihat src/lib/datasets.ts)
export function ExportLinks({ dataset }: { dataset: string }) {
  return (
    <span className="flex gap-1.5">
      <a href={`/api/ekspor/${dataset}`} className={`${btnGhost} px-2.5 py-1 text-xs`} title="Unduh ke Excel">⇩ Excel</a>
      <a href={`/api/ekspor/${dataset}?format=csv`} className={`${btnGhost} px-2.5 py-1 text-xs`} title="Unduh CSV">CSV</a>
    </span>
  );
}
