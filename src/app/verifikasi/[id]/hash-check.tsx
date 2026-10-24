'use client';
import { useState } from 'react';

// Mencocokkan SHA-256 berkas di tangan dengan yang tercatat saat terbit. Berkas tidak dikirim ke mana pun.
export function HashCheck({ expected }: { expected: string }) {
  const [result, setResult] = useState<'match' | 'diff' | null>(null);
  async function check(file: File) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    setResult(hex === expected ? 'match' : 'diff');
  }
  return (
    <div className="grid gap-2 border-t border-line pt-4 text-sm">
      <label className="grid gap-1">Cek keaslian berkas PDF asli (diperiksa di perangkat ini)
        <input id="pdf" type="file" accept="application/pdf" onChange={e => e.target.files?.[0] && check(e.target.files[0])} />
      </label>
      {result === 'match' && <p className="text-ok">Cocok: berkas sama persis dengan yang diterbitkan.</p>}
      {result === 'diff' && <p className="text-crit">Tidak cocok: berkas sudah berubah, atau ini salinan unduhan berlabel tidak terkendali.</p>}
      <p className="break-all font-mono text-[11px] text-muted">SHA-256 terbit: {expected}</p>
    </div>
  );
}
