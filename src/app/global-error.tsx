'use client';

// Cadangan terakhir bila tata letak utama pun gagal; tanpa bergantung pada CSS aplikasi.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', minHeight: '100dvh', placeItems: 'center', margin: 0, padding: 24, textAlign: 'center' }}>
        <div style={{ maxWidth: 360 }}>
          <h1 style={{ fontSize: 20 }}>Aplikasi gagal dimuat</h1>
          <p style={{ color: '#666', fontSize: 14 }}>Periksa sinyal lalu coba lagi.</p>
          <button onClick={reset} style={{ marginTop: 12, width: '100%', padding: '12px 0', borderRadius: 12, border: 0, background: '#5b21b6', color: '#fff', fontWeight: 600, fontSize: 16 }}>
            Coba lagi
          </button>
        </div>
      </body>
    </html>
  );
}
