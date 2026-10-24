import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { GRADE } from '@/lib/logistics';
import { evaluateSupplier, saveSupplier } from '../actions';
import { LogTabs } from '../tabs';
import { today } from '../../she/fields';

export const metadata = { title: 'Supplier' };

type Row = { id: string; code: string; name: string; category: string | null; contact_name: string | null; phone: string | null; active: boolean;
  score: number | null; evaluations: number | null; last_period: string | null; grade: string | null };

const CRITERIA = [['quality', 'Mutu'], ['delivery', 'Ketepatan kirim'], ['price', 'Harga'], ['service', 'Layanan'], ['safety', 'Kepatuhan K3']] as const;

export default async function SupplierPage() {
  const manage = (await getSession()).canIn('log.manage', 'LOG');
  const supabase = await createClient();
  const { data: rows } = await supabase.from('supplier_score').select('*').order('name').returns<Row[]>();
  const active = (rows ?? []).filter(r => r.active);

  return (
    <>
      <PageHeader eyebrow="SMKP 4.6 · Sistem pembelian" title="Supplier & evaluasi" />
      <LogTabs active="/logistik/supplier" />
      {rows?.length ? (
        <Table head={['Kode', 'Nama', 'Kategori', 'Kontak', 'Nilai 6 bulan', 'Grade']}>
          {rows.map(r => (
            <tr key={r.id} className={r.active ? '' : 'opacity-50'}>
              <td className="font-mono text-xs">{r.code}</td>
              <td className="text-sm">{r.name}</td>
              <td className="text-xs">{r.category ?? '–'}</td>
              <td className="text-xs">{[r.contact_name, r.phone].filter(Boolean).join(' · ') || '–'}</td>
              <td className="tabular text-xs">{r.score ?? '–'}{r.evaluations ? <span className="text-muted"> ({r.evaluations}×, terakhir {r.last_period?.slice(0, 7)})</span> : null}</td>
              <td>{r.grade ? <Pill tone={GRADE[r.grade]}>{r.grade}</Pill> : '–'}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada supplier.</p>}
      <p className="text-xs text-muted">Grade A ≥ 4, B ≥ 3, C &lt; 3 (perlu tindak lanjut / pertimbangkan penggantian).</p>
      {manage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Evaluasi bulanan">
            <ActionForm action={evaluateSupplier} label="Simpan evaluasi" primary>
              <div className="grid grid-cols-2 gap-2">
                <select name="supplier" required className={input} aria-label="Supplier">{active.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                <input type="month" name="period" required defaultValue={today().slice(0, 7)} className={input} aria-label="Periode" />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {CRITERIA.map(([k, l]) => <label key={k} className="grid gap-1 text-xs">{l}
                  <select name={k} className={input} defaultValue="4">{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}</option>)}</select></label>)}
              </div>
              <input name="note" className={input} placeholder="Catatan (wajib bila ada nilai di bawah 3)" />
            </ActionForm>
          </Panel>
          <Panel title="Daftarkan / perbarui supplier">
            <ActionForm action={saveSupplier} label="Simpan supplier">
              <div className="grid grid-cols-2 gap-2">
                <input name="code" required className={`${input} uppercase`} placeholder="Kode" />
                <input name="name" required className={input} placeholder="Nama" />
                <input name="category" className={input} placeholder="Kategori (suku cadang, BBM, jasa)" />
                <input name="contact" className={input} placeholder="Nama kontak" />
                <input name="phone" className={input} placeholder="Telepon" />
                <select name="active" className={input} aria-label="Aktif"><option value="true">Aktif</option><option value="false">Tidak aktif</option></select>
              </div>
            </ActionForm>
          </Panel>
        </div>
      )}
    </>
  );
}
