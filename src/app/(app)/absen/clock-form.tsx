'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { clock } from '../hrga/waktu-actions';
import { shrinkImage } from '@/lib/image';
import { enqueue, formToFields, queueSupported } from '@/lib/offline/queue';
import { flushQueue } from '@/lib/offline/replay';

type Pos = { lat: number; lng: number; accuracy: number };

export function ClockForm({ next, requirePhoto }: { next: 'in' | 'out'; requirePhoto: boolean }) {
  const [state, setState] = useState<{ error?: string; ok?: string }>({});
  const [pending, start] = useTransition();
  const [noGps, setNoGps] = useState(false);
  const [reason, setReason] = useState('');
  const [pos, setPos] = useState<Pos | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [kind, setKind] = useState<'in' | 'out'>(next);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cid, setCid] = useState(() => crypto.randomUUID());

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
  useEffect(() => { if (state.ok) { setPhoto(null); setReason(''); } }, [state]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const small = await shrinkImage(f, 800, 0.75);
    setPhoto({ blob: small, url: URL.createObjectURL(small) });
  };

  const submit = (fd: FormData) => {
    if (photo) fd.set('photo', new File([photo.blob], 'selfie.jpg', { type: 'image/jpeg' }));
    if (pos) { fd.set('lat', String(pos.lat)); fd.set('lng', String(pos.lng)); fd.set('accuracy', String(pos.accuracy)); }
    else fd.set('note', reason.trim());
    fd.set('kind', kind);
    fd.set('device', navigator.userAgent.slice(0, 200));
    fd.set('at', String(Date.now())); // waktu tekan tombol, bukan waktu terkirim
    fd.set('cid', cid);
    setState({});
    const queue = async () => {
      if (!queueSupported()) return setState({ error: 'Tidak ada jaringan. Coba lagi saat sinyal ada.' });
      await enqueue('absen', kind === 'in' ? 'Absen masuk' : 'Absen pulang', formToFields(fd));
      setCid(crypto.randomUUID());
      setState({ ok: 'Tersimpan di perangkat dengan jam saat ini. Dikirim otomatis saat ada sinyal.' });
    };
    start(async () => {
      if (!navigator.onLine) return queue();
      try {
        const r = await Promise.race([clock({}, fd), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))]);
        setState(r);
        if (r.ok) setCid(crypto.randomUUID());
      } catch { await queue(); void flushQueue(); }
    });
  };
  const ready = (!!pos || (noGps && reason.trim().length >= 5)) && (!requirePhoto || !!photo);

  return (
    <form onSubmit={e => { e.preventDefault(); submit(new FormData()); }} className="grid gap-4">
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
      {!pos && geoErr && !noGps && (
        <button type="button" onClick={() => setNoGps(true)} className="rounded-xl border border-warn/50 bg-warn/10 px-3 py-2 text-left text-sm text-warn">
          GPS tidak bisa dipakai? <span className="font-semibold underline">Absen tanpa GPS</span> (ditandai untuk ditinjau atasan)
        </button>
      )}
      {!pos && noGps && (
        <label className="grid gap-1 text-sm">Alasan absen tanpa GPS
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="mis. izin lokasi ditolak / GPS rusak" maxLength={200}
            className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm" />
        </label>
      )}

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
