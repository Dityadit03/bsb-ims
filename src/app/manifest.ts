import type { MetadataRoute } from 'next';

// Agar aplikasi bisa dipasang ke layar utama HP (PWA) dengan logo BSB
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BSB IMS · PT Berkarya Sejahtera Bersama',
    short_name: 'BSB IMS',
    start_url: '/',
    display: 'standalone',
    background_color: '#232826',
    theme_color: '#232826',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
