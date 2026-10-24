// Tampil seketika saat berpindah halaman, sementara data diambil di server.
export default function Loading() {
  return (
    <div className="grid animate-pulse gap-6" aria-busy="true" aria-label="Memuat">
      <div className="grid gap-2 border-b border-line pb-5">
        <div className="h-3 w-40 rounded bg-line" />
        <div className="h-9 w-64 max-w-full rounded bg-line" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-24 rounded-md border border-line bg-panel" />)}
      </div>
      <div className="h-64 rounded-md border border-line bg-panel" />
    </div>
  );
}
