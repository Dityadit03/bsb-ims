'use client';
export function PrintButton() {
  return <button onClick={() => window.print()} className="rounded-xl bg-violet px-3 py-1.5 text-sm font-semibold text-white">Cetak</button>;
}
