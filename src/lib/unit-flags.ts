export type UnitFlag = { unit_no: string; spip_validity: string | null; open_breakdown: boolean };

/** Teks peringatan singkat untuk pilihan unit; kosong bila unit baik. */
export function unitFlagText(f?: UnitFlag | null): string {
  if (!f) return '';
  const w: string[] = [];
  if (f.open_breakdown) w.push('breakdown terbuka');
  if (f.spip_validity === 'expired') w.push('SPIP expired');
  return w.length ? ` · ⚠ ${w.join(', ')}` : '';
}
