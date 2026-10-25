'use client';
import { useEffect } from 'react';

// Di halaman masuk, salinan halaman milik sesi sebelumnya dibuang dari cache ponsel (ponsel bisa dipinjam / berganti pengguna).
export function ClearOfflineCache() {
  useEffect(() => {
    try {
      navigator.serviceWorker?.controller?.postMessage('clear');
      void caches?.keys().then(ks => ks.filter(k => k.startsWith('bsb-v') && k.endsWith('-pages')).forEach(k => caches.delete(k)));
    } catch { /* abaikan */ }
  }, []);
  return null;
}
