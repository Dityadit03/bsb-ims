'use client';
import { createClient } from '@/lib/supabase/client';

// Web push: izin, langganan, dan pelepasan perangkat saat keluar.
export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// iPhone/iPad hanya mengizinkan push bila aplikasi dipasang ke layar utama.
export const needsInstall = () => {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
  return ios && !standalone;
};

const b64 = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};
const toB64 = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))) : '');

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
}

export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: 'Perangkat ini tidak mendukung pemberitahuan' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, error: 'Izin pemberitahuan ditolak. Aktifkan lewat pengaturan situs di peramban.' };
  const sb = createClient();
  const { data: key } = await sb.rpc('push_public_key');
  if (!key) return { ok: false, error: 'Kunci pemberitahuan belum diatur' };
  await registration();
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key as string) }));
  const { error } = await sb.rpc('push_subscribe', { p_endpoint: sub.endpoint, p_p256dh: toB64(sub.getKey('p256dh')), p_auth: toB64(sub.getKey('auth')), p_ua: navigator.userAgent });
  if (error) return { ok: false, error: error.message };
  await sb.rpc('push_set_pref', { p_push: true });
  return { ok: true };
}

export async function disablePush() {
  const sb = createClient();
  const ep = await currentEndpoint();
  if (ep) {
    await sb.rpc('push_unsubscribe', { p_endpoint: ep });
    await (await navigator.serviceWorker.ready).pushManager.getSubscription().then(s => s?.unsubscribe());
  }
}

// Dipanggil sebelum keluar: perangkat dilepas dari akun (HP bisa dipakai bergantian). Gagal tidak menghalangi keluar.
export async function forgetDevice() {
  try {
    if (!pushSupported()) return;
    const ep = await Promise.race([currentEndpoint(), new Promise<null>(r => setTimeout(() => r(null), 1500))]);
    if (!ep) return;
    const sb = createClient();
    await Promise.race([sb.rpc('push_forget_device', { p_endpoint: ep }), new Promise(r => setTimeout(r, 2000))]);
    await (await navigator.serviceWorker.ready).pushManager.getSubscription().then(s => s?.unsubscribe());
  } catch { /* abaikan */ }
}
