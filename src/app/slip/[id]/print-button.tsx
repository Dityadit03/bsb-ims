'use client';

export function PrintButton() {
  return <button onClick={() => window.print()} className="rounded-lg bg-[#5b21b6] px-4 py-2 text-sm font-semibold text-white">Cetak / simpan PDF</button>;
}
