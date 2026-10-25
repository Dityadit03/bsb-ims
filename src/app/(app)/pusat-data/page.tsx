import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, btnGhost, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { saveLink } from '../she/portal-actions';

export const metadata = { title: 'Pusat Data SHE' };

type Link = { id: string; code: string; page: string; section: string; kind: string; title: string; description: string | null; url: string | null; sort_order: number };

const KIND: Record<string, [string, string]> = {
  folder: ['📁', 'Folder'], sheet: ['📊', 'Database'], doc: ['📄', 'Dokumen'], form: ['📝', 'Formulir'], file: ['📎', 'Berkas'], link: ['🔗', 'Tautan'],
};

export default async function DataCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from('resource_links').select('id, code, page, section, kind, title, description, url, sort_order')
    .eq('active', true).order('page').order('sort_order').order('title').returns<Link[]>();
  const all = data ?? [];
  const pages = [...new Set(all.map(l => l.page))];
  const term = sp.q?.toLowerCase().trim();
  const rows = all.filter(l => (!sp.hal || l.page === sp.hal) && (!term || `${l.title} ${l.description ?? ''} ${l.section}`.toLowerCase().includes(term)));
  const grouped = new Map<string, Map<string, Link[]>>();
  for (const l of rows) {
    const p = grouped.get(l.page) ?? new Map<string, Link[]>(); grouped.set(l.page, p);
    p.set(l.section, [...(p.get(l.section) ?? []), l]);
  }

  return (
    <>
      <PageHeader eyebrow="Folder & database Google Drive per elemen SMKP" title="Pusat Data SHE" />
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Cari folder atau database…" className={`${input} w-64`} aria-label="Cari" />
        <select name="hal" defaultValue={sp.hal ?? ''} className={`${input} !w-auto`} aria-label="Halaman">
          <option value="">Semua kelompok</option>{pages.map(p => <option key={p}>{p}</option>)}
        </select>
        <button className={btnGhost}>Cari</button>
      </form>
      {[...grouped].map(([page, sections]) => (
        <section key={page} className="grid gap-3">
          <h2 className="text-2xl font-semibold">{page}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[...sections].map(([section, links]) => (
              <Panel key={section} title={section}>
                <ul className="grid gap-1">
                  {links.map(l => (
                    <li key={l.id}>
                      <a href={l.url ?? undefined} target="_blank" rel="noopener noreferrer"
                        className={`flex gap-2 rounded-lg px-2 py-1.5 text-sm ${l.url ? 'hover:bg-accent-soft' : 'pointer-events-none opacity-60'}`}>
                        <span aria-hidden>{KIND[l.kind]?.[0]}</span>
                        <span className="min-w-0"><span className="font-medium">{l.title}</span>
                          {l.description && <span className="block text-xs text-muted">{l.description}</span>}
                          {!l.url && <span className="block text-xs text-muted">Tautan belum diisi</span>}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        </section>
      ))}
      {!rows.length && <p className="text-sm text-muted">Tidak ada tautan yang cocok.</p>}
      {s.can('library.manage') && (
        <details className="rounded-xl border border-line bg-panel p-4 shadow-soft">
          <summary className="cursor-pointer font-display text-xl font-semibold">Tambah / ubah tautan</summary>
          <ActionForm action={saveLink} label="Simpan tautan" primary className="mt-3 max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Kode (unik)<input name="code" required className={input} placeholder="dt-mcu-status" /></label>
              <label className="grid gap-1 text-sm">Kelompok halaman<input name="page" required list="link-pages" className={input} /></label>
              <label className="grid gap-1 text-sm">Sub-kelompok<input name="section" required className={input} /></label>
              <label className="grid gap-1 text-sm sm:col-span-2">Judul<input name="title" required className={input} /></label>
              <label className="grid gap-1 text-sm">Jenis
                <select name="kind" className={input}>{Object.entries(KIND).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
            </div>
            <label className="grid gap-1 text-sm">URL (https://)<input name="url" type="url" className={input} /></label>
            <label className="grid gap-1 text-sm">Keterangan<input name="description" className={input} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" value="no" /> Nonaktifkan tautan dengan kode ini</label>
            <datalist id="link-pages">{pages.map(p => <option key={p} value={p} />)}</datalist>
          </ActionForm>
        </details>
      )}
    </>
  );
}
