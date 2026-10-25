'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { clock } from '../hrga/waktu-actions';

type Pos = { lat: number; lng: number; accuracy: number };

// Perkecil foto ke sisi terpanjang 640px (JPEG) agar unggah cepat di jaringan site.
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Foto gagal diproses'))), 'image/jpeg', 0.75));
}

export function ClockForm({ next, requirePhoto }: { next: 'in' | 'out'; requirePhoto: boolean }) {
  const [state, action, pending] = useActionState(clock, {});
  const [pos, setPos] = useState<Pos | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [kind, setKind] = useState<'in' | 'out'>(next);
  const fileRef = useRef<HTMLInputElement>(null);

  const locate = () => {
    setGeoErr(null);
    if (!navigator.geolocation) return setGeoErr('Perangkat tidak mendukung GPS');
    navigator.geolocation.getCurrentPosition(
      p => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      e => setGeoErr(e.code === 1 ? 'Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini.' : 'Lokasi belum terbaca, coba lagi di tempat terbuka.'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
    );
  };
  useEffect(locate, []);
  useEffect(() => setKind(next), [next]);
  useEffect(() => { if (state.ok) setPhoto(null); }, [state]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const blob = await shrink(f);
    setPhoto({ blob, url: URL.createObjectURL(blob) });
  };

  const submit = (fd: FormData) => {
    if (photo) fd.set('photo', new File([photo.blob], 'selfie.jpg', { type: 'image/jpeg' }));
    if (pos) { fd.set('lat', String(pos.lat)); fd.set('lng', String(pos.lng)); fd.set('accuracy', String(pos.accuracy)); }
    fd.set('kind', kind);
    fd.set('device', navigator.userAgent.slice(0, 200));
    action(fd);
  };
  const ready = !!pos && (!requirePhoto || !!photo);

  return (
    <form action={submit} className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-ground p-1">
        {(['in', 'out'] as const).map(k => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`rounded-lg py-2.5 text-sm font-semibold ${kind === k ? 'bg-panel text-violet shadow-sm' : 'text-muted'}`}>
            {k === 'in' ? 'Masuk' : 'Pulang'}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm">
        <div>
          <div className="font-semibold">Lokasi</div>
          {pos ? <div className="tabular text-xs text-muted">{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)} · akurasi ±{pos.accuracy} m</div>
            : <div className={`text-xs ${geoErr ? 'text-crit' : 'text-muted'}`}>{geoErr ?? 'Membaca GPS…'}</div>}
        </div>
        <button type="button" onClick={locate} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-violet/60">Perbarui</button>
      </div>

      <div className="grid gap-2">
        <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden" onChange={e => pick(e.target.files?.[0])} />
        {photo ? (
          <button type="button" onClick={() => fileRef.current?.click()} className="relative overflow-hidden rounded-xl border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="Selfie" className="mx-auto max-h-64 object-cover" />
            <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white">Ambil ulang</span>
          </button>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()}
            className="grid h-40 place-items-center rounded-xl border-2 border-dashed border-line text-sm text-muted hover:border-violet/60">
            <span><span aria-hidden className="block text-center text-3xl">📷</span>Ambil selfie{requirePhoto ? '' : ' (opsional)'}</span>
          </button>
        )}
      </div>

      <button disabled={!ready || pending}
        className={`rounded-xl py-4 text-lg font-bold text-white shadow-sm disabled:opacity-40 ${kind === 'in' ? 'bg-ok' : 'bg-violet'}`}>
        {pending ? 'Mengirim…' : kind === 'in' ? 'Absen masuk' : 'Absen pulang'}
      </button>
      {state.error && <p role="alert" className="text-center text-sm text-crit">{state.error}</p>}
      {state.ok && <p className="text-center text-sm font-semibold text-ok">{state.ok}</p>}
    </form>
  );
}
