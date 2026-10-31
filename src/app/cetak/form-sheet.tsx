import type { ReactNode } from 'react';

// Lembar formulir A4 untuk dicetak, ditandatangani, lalu dipindai dan diunggah kembali ke dokumen di sistem.
export function FormSheet({ title, number, subtitle, printedBy, sign, children }: {
  title: string; number: string; subtitle?: string; printedBy: string; sign: string[]; children: ReactNode;
}) {
  const printed = new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Makassar' });
  return (
    <article className="mx-auto flex min-h-[273mm] max-w-[210mm] flex-col bg-white p-8 text-[13px] leading-snug shadow-sm print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
      <style>{'@page{size:A4;margin:12mm}'}</style>
      <header className="flex items-start justify-between gap-4 border-b-2 border-[#5b21b6] pb-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-12 w-auto" />
          <div>
            <p className="text-base font-extrabold">PT Berkarya Sejahtera Bersama</p>
            <p className="text-xs text-neutral-500">Site BDA{subtitle ? ` · ${subtitle}` : ''}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-extrabold uppercase">{title}</p>
          <p className="font-mono text-sm">{number}</p>
        </div>
      </header>
      <div className="mt-4 flex-1">{children}</div>
      <section className="mt-8 break-inside-avoid">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${sign.length}, minmax(0, 1fr))` }}>
          {sign.map(s => (
            <div key={s} className="text-center">
              <p className="text-xs font-semibold">{s}</p>
              <div className="h-20 border-b border-neutral-400" />
              <p className="mt-1 text-[11px] text-neutral-500">Nama / tanggal</p>
            </div>
          ))}
        </div>
        <p className="mt-6 border-t border-neutral-200 pt-2 text-[10px] text-neutral-500">
          Dicetak dari BSB IMS oleh {printedBy} pada {printed}. Dokumen sah setelah ditandatangani; unggah hasil pindai pada halaman dokumen di sistem.
        </p>
      </section>
    </article>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <><dt className="text-neutral-500">{label}</dt><dd className="font-medium">{children || '–'}</dd></>;
}

export function Grid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-5 gap-y-1">{children}</dl>;
}

export function Lines({ head, rows, empty = 6 }: { head: string[]; rows: ReactNode[][]; empty?: number }) {
  // baris kosong menambah ruang tulis tangan bila daftar pendek
  const blanks = Math.max(0, empty - rows.length);
  return (
    <table className="w-full border-collapse text-[12px]">
      <thead><tr>{head.map((h, i) => <th key={h} className={`border border-neutral-400 bg-neutral-100 px-2 py-1 text-left font-semibold ${i === 0 ? 'w-8' : ''}`}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-neutral-400 px-2 py-1 align-top">{c}</td>)}</tr>)}
        {Array.from({ length: blanks }).map((_, i) => <tr key={`b${i}`}>{head.map(h => <td key={h} className="h-7 border border-neutral-400" />)}</tr>)}
      </tbody>
    </table>
  );
}
