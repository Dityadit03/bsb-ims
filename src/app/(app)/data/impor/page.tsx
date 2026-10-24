import { PageHeader, Panel } from '@/components/ui';
import { getSession } from '@/lib/session';
import { IMPORTS } from '@/lib/datasets';
import { DataTabs } from '../tabs';
import { ImportForm } from './import-form';

export const metadata = { title: 'Impor data' };

// Migrasi data dari Excel lama dalam satu alur: pilih jenis, unggah, periksa, impor.
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ jenis?: string }> }) {
  const s = await getSession();
  const { jenis } = await searchParams;
  const kinds = IMPORTS.filter(k => s.can(k.perm)).map(({ key, label, note, fields }) =>
    ({ key, label, note, fields: fields.map(({ key, label, required }) => ({ key, label, required })) }));

  return (
    <>
      <PageHeader eyebrow="Laporan & data" title="Impor data dari Excel" />
      <DataTabs active="/data/impor" />
      {kinds.length ? (
        <Panel>
          <ol className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
            {['Pilih jenis data', 'Unggah Excel / tempel tabel', 'Periksa (belum disimpan)', 'Impor'].map((t, i) =>
              <li key={t} className="rounded-full border border-line bg-panel px-2.5 py-1"><b className="text-accent">{i + 1}</b> {t}</li>)}
          </ol>
          <ImportForm kinds={kinds} initial={jenis} />
          <p className="text-xs text-muted">Judul kolom dikenali otomatis (mis. &quot;No Lambung&quot;, &quot;Nama Karyawan&quot;, &quot;Masa Berlaku&quot;), jadi berkas Excel lama
            biasanya bisa langsung dipakai. Data yang sudah ada diperbarui, bukan digandakan, dan semua aturan serta hak akses tetap berlaku.</p>
        </Panel>
      ) : <p className="text-sm text-muted">Anda belum punya hak mengelola data master yang bisa diimpor.</p>}
    </>
  );
}
