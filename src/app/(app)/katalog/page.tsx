import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { Explorer, type CGroup, type CModel, type CPart } from './explorer';
import { deletePart, savePart, saveGroup } from './actions';

export const metadata = { title: 'Katalog suku cadang' };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const s = await getSession();
  const supabase = await createClient();
  const { data: models } = await supabase.from('catalog_models').select('id, code, name, brand, template, description').eq('active', true).order('name').returns<CModel[]>();
  const list = models ?? [];
  const cur = list.find(m => m.code === sp.model) ?? list[0];
  const [{ data: groups }, { data: parts }] = cur ? await Promise.all([
    supabase.from('catalog_groups').select('id, code, name, description, sort').eq('model_id', cur.id).order('sort').returns<CGroup[]>(),
    supabase.from('catalog_part_view').select('id, group_id, ref_no, part_no, name, qty, description, material_code, note, stock_qty, uom, min_stock').eq('model_id', cur.id).order('ref_no').limit(5000).returns<CPart[]>(),
  ]) : [{ data: [] as CGroup[] }, { data: [] as CPart[] }];
  const manage = s.can('catalog.manage');
  const gs = groups ?? [];
  const ps = parts ?? [];

  return (
    <>
      <PageHeader eyebrow="Plant & Logistik" title="Katalog suku cadang">
        <Link href="/data/impor" className="text-sm text-violet hover:underline">Impor part dari Excel</Link>
      </PageHeader>
      {!cur ? <Panel><p className="text-sm text-muted">Belum ada model unit di katalog.</p></Panel> : (
        <>
          <Explorer models={list} current={cur} groups={gs} parts={ps} />
          {manage && (
            <Panel title="Kelola isi katalog" sub={`${cur.name} · ${ps.length} part. Untuk banyak part sekaligus pakai impor Excel (jenis data: Katalog suku cadang).`}>
              <div className="grid gap-4 lg:grid-cols-2">
                <ActionForm action={savePart} label="Simpan part" primary className="sm:grid-cols-2">
                  <label className="grid gap-1 text-xs sm:col-span-2">Kelompok<select name="group" required className={input}><option value="">–</option>
                    {gs.map(g => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}</select></label>
                  <label className="grid gap-1 text-xs">Nomor part<input name="part_no" required className={input} /></label>
                  <label className="grid gap-1 text-xs">Nama part<input name="name" required className={input} /></label>
                  <label className="grid gap-1 text-xs">Jumlah per unit<input type="number" name="qty" min={0.01} step="any" defaultValue={1} className={input} /></label>
                  <label className="grid gap-1 text-xs">No. gambar (ref)<input type="number" name="ref" min={1} className={input} placeholder="otomatis" /></label>
                  <label className="grid gap-1 text-xs">Kode barang gudang (opsional)<input name="material" className={input} placeholder="SP-FLT-01" /></label>
                  <label className="grid gap-1 text-xs">Keterangan<input name="description" className={input} /></label>
                </ActionForm>
                <div className="grid content-start gap-4">
                  <ActionForm action={saveGroup} label="Tambah kelompok" hidden={{ model: cur.id }} className="sm:grid-cols-2">
                    <label className="grid gap-1 text-xs">Kode<input name="code" required className={input} placeholder="AIR" /></label>
                    <label className="grid gap-1 text-xs">Nama<input name="name" required className={input} placeholder="Filter udara" /></label>
                  </ActionForm>
                  {ps.length > 0 && (
                    <ActionForm action={deletePart} label="Hapus part" confirm="Hapus part ini dari katalog?" className="sm:grid-cols-[1fr_auto] sm:items-end">
                      <select name="id" required className={input}><option value="">Pilih part…</option>
                        {ps.map(p => <option key={p.id} value={p.id}>{p.part_no} · {p.name}</option>)}</select>
                    </ActionForm>
                  )}
                </div>
              </div>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
