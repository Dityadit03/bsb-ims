'use client';
import { useEffect, useState } from 'react';

// Koordinat GPS untuk laporan breakdown: diambil otomatis, bisa diulang. Bila GPS gagal, keterangan lokasi tertulis tetap bisa dipakai.
export function GpsFields() {
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locate = () => {
    setErr(null);
    if (!navigator.geolocation) return setErr('Perangkat tidak mendukung GPS. Tulis keterangan lokasi.');
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      p => { setBusy(false); setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }); },
      e => { setBusy(false); setErr(e.code === 1 ? 'Izin lokasi ditolak. Aktifkan izin lokasi, atau tulis keterangan lokasi.' : 'Lokasi belum terbaca. Coba lagi di tempat terbuka, atau tulis keterangan lokasi.'); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
    );
  };
  useEffect(locate, []);
  return (
    <div className="grid gap-1 rounded-lg border border-line p-3 text-sm">
      <input type="hidden" name="lat" value={pos?.lat ?? ''} />
      <input type="hidden" name="lng" value={pos?.lng ?? ''} />
      <input type="hidden" name="accuracy" value={pos?.accuracy ?? ''} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{pos ? <>Lokasi GPS terbaca <span className="text-muted">(±{pos.accuracy} m)</span></> : busy ? 'Membaca lokasi GPS…' : 'Lokasi GPS belum terbaca'}</span>
        <button type="button" onClick={locate} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-accent">Ambil ulang lokasi</button>
      </div>
      {err && <span className="text-xs text-warn">{err}</span>}
    </div>
  );
}
