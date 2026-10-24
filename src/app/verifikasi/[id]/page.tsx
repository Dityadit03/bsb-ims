import { createClient } from '@/lib/supabase/server';
import { fmtDate, rev } from '@/lib/documents';
import { HashCheck } from './hash-check';

export const metadata = { title: 'Verifikasi dokumen' };

type Result = { document_number: string; title: string; revision: number; version_status: string; document_status: string;
  effective_date: string; final_sha256: string | null; latest_revision: number | null };

// Halaman tujuan QR pada PDF terkendali. Bisa dibuka tanpa login; hanya menampilkan status, bukan isi dokumen.
export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = /^[0-9a-f-]{36}$/i.test(id)
    ? await supabase.rpc('verify_document', { p_version: id }).maybeSingle<Result>()
    : { data: null };
  const valid = data?.version_status === 'effective' && data.document_status !== 'obsolete';

  return (
    <main className="grid min-h-dvh place-items-center bg-ground px-4 py-10">
      <div className="grid w-full max-w-lg gap-6">
        <span className="font-mono text-xs uppercase tracking-wider text-muted">BSB IMS · Verifikasi dokumen terkendali</span>
        {!data ? (
          <div className="grid gap-2 rounded-md border-2 border-crit bg-panel p-6">
            <h1 className="text-3xl font-bold text-crit">Tidak terdaftar</h1>
            <p className="text-sm">Kode ini tidak cocok dengan dokumen terbit mana pun. Jangan gunakan dokumen ini dan hubungi Document Control.</p>
          </div>
        ) : (
          <div className={`grid gap-4 rounded-md border-2 bg-panel p-6 ${valid ? 'border-ok' : 'border-crit'}`}>
            <h1 className={`text-4xl font-bold ${valid ? 'text-ok' : 'text-crit'}`}>{valid ? 'Berlaku' : data.document_status === 'obsolete' ? 'Dicabut' : 'Sudah digantikan'}</h1>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Nomor</dt><dd className="font-mono">{data.document_number}</dd>
              <dt className="text-muted">Judul</dt><dd>{data.title}</dd>
              <dt className="text-muted">Revisi</dt><dd className="font-mono">{rev(data.revision)}</dd>
              <dt className="text-muted">Berlaku sejak</dt><dd>{fmtDate(data.effective_date)}</dd>
            </dl>
            {!valid && data.latest_revision != null && data.latest_revision !== data.revision && (
              <p className="rounded bg-warn/10 px-3 py-2 text-sm">Versi yang berlaku saat ini adalah <b>{rev(data.latest_revision)}</b>. Minta salinan terbaru ke Document Control.</p>
            )}
            {data.final_sha256 && <HashCheck expected={data.final_sha256} />}
          </div>
        )}
      </div>
    </main>
  );
}
