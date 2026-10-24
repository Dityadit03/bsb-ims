import { PageHeader, Panel, Pill, Table } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { PreviewForm } from './preview-form';

export const metadata = { title: 'Penomoran' };

const MODULE_LABEL: Record<string, string> = {
  document: 'Dokumen', correspondence: 'Surat', capa: 'CAPA', she: 'SHE', plant: 'Plant', logistics: 'Logistik', production: 'Produksi',
};

export default async function PenomoranPage() {
  await getSession();
  const supabase = await createClient();
  const [{ data: schemes }, { data: counters }, { data: recent }] = await Promise.all([
    supabase.from('numbering_schemes').select('code, name, pattern, module, active').order('module').order('code'),
    supabase.from('numbering_counters').select('scheme_code, last_value'),
    supabase.from('registrations').select('number, status, issued_at').order('issued_at', { ascending: false }).limit(15),
  ]);
  const issued = new Map<string, number>();
  (counters ?? []).forEach(c => issued.set(c.scheme_code, (issued.get(c.scheme_code) ?? 0) + c.last_value));

  return (
    <>
      <PageHeader eyebrow="Administrasi" title="Penomoran otomatis" />
      <p className="max-w-3xl text-sm text-muted">
        Nomor dialokasikan di database secara atomik: tidak ada nomor kembar walau banyak orang mengajukan bersamaan, nomor batal tidak dipakai ulang,
        dan pola yang sudah menghasilkan nomor tidak bisa diubah. Token: <code className="font-mono">{'{D}'}</code> departemen,{' '}
        <code className="font-mono">{'{S}'}</code> seksi, <code className="font-mono">{'{P}'}</code> dokumen induk,{' '}
        <code className="font-mono">{'{Y}'}</code> tahun, <code className="font-mono">{'{N3}'}</code> nomor urut 3 digit.
      </p>
      <Panel title="Pratinjau nomor berikutnya"><PreviewForm schemes={(schemes ?? []).map(s => ({ code: s.code, name: s.name, pattern: s.pattern }))} /></Panel>
      <Panel title="Skema">
        <Table head={['Kode', 'Jenis', 'Pola', 'Modul', 'Terpakai', 'Status']}>
          {(schemes ?? []).map(s => (
            <tr key={s.code}>
              <td className="font-mono font-medium">{s.code}</td>
              <td>{s.name}</td>
              <td className="whitespace-nowrap font-mono text-xs">{s.pattern}</td>
              <td>{MODULE_LABEL[s.module] ?? s.module}</td>
              <td className="tabular text-right">{issued.get(s.code) ?? 0}</td>
              <td>{s.active ? <Pill tone="ok">Aktif</Pill> : <Pill>Nonaktif</Pill>}</td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel title="Nomor terakhir terbit">
        {recent?.length ? (
          <Table head={['Nomor', 'Status', 'Waktu']}>
            {recent.map(r => (
              <tr key={r.number}>
                <td className="font-mono">{r.number}</td>
                <td><Pill tone={r.status === 'void' ? 'crit' : r.status === 'legacy' ? 'muted' : 'ok'}>{r.status === 'void' ? 'Batal' : r.status === 'legacy' ? 'Migrasi' : 'Terbit'}</Pill></td>
                <td className="tabular text-xs text-muted">{new Date(r.issued_at).toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })}</td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada nomor terbit. Nomor pertama muncul saat Document Control mulai dipakai.</p>}
      </Panel>
    </>
  );
}
