import Link from 'next/link';
import { Icon } from '@/components/icon';
import { btnGhost, btnPrimary, input } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';

// Bilah saring untuk daftar rekaman SHE (GET form, tanpa JavaScript). Parameter diberi awalan bila satu halaman punya dua daftar.
export type FilterField =
  | { name: string; label: string; type: 'text'; placeholder?: string }
  | { name: string; label: string; type: 'date' }
  | { name: string; label: string; type: 'select'; options: [string, string][] }
  | { name: string; label: string; type: 'check' };

export const val = (sp: Record<string, string | undefined>, prefix: string, name: string) => (sp[prefix + name] ?? '').trim();
// Buang karakter yang bermakna di sintaks .or() PostgREST dan wildcard ilike
export const needle = (s: string) => s.replace(/[,()%*_\\]/g, ' ').trim().slice(0, 60);
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function FilterBar({ action, fields, sp, prefix = '', shown, total }: {
  action: string; fields: FilterField[]; sp: Record<string, string | undefined>; prefix?: string; shown?: number; total?: number;
}) {
  const active = fields.some(f => val(sp, prefix, f.name));
  const resetQs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && !fields.some(f => prefix + f.name === k)) resetQs.set(k, v);
  const sel = `${input} !w-auto`;
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-panel p-3 shadow-soft">
      {Object.entries(sp).filter(([k, v]) => v && !fields.some(f => prefix + f.name === k)).map(([k, v]) =>
        <input key={k} type="hidden" name={k} value={v} />)}
      {fields.map(f => (
        f.type === 'check' ? (
          <label key={f.name} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name={prefix + f.name} value="1" defaultChecked={!!val(sp, prefix, f.name)} /> {f.label}</label>
        ) : (
          <label key={f.name} className={`grid gap-1 text-xs text-muted ${f.type === 'text' ? 'min-w-44 flex-1' : ''}`}>{f.label}
            {f.type === 'text' ? <input name={prefix + f.name} defaultValue={val(sp, prefix, f.name)} placeholder={f.placeholder} className={`${input} text-ink`} />
              : f.type === 'date' ? <input type="date" name={prefix + f.name} defaultValue={val(sp, prefix, f.name)} className={`${sel} text-ink`} />
              : <select name={prefix + f.name} defaultValue={val(sp, prefix, f.name)} className={`${sel} text-ink`}>
                <option value="">Semua</option>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
          </label>
        )
      ))}
      <button type="submit" className={`${btnPrimary} px-4`}>Terapkan</button>
      {active && <Link href={`${action}${resetQs.size ? `?${resetQs}` : ''}`} className={btnGhost}>Reset</Link>}
      {shown != null && <span className="w-full text-xs text-muted">Menampilkan {shown}{total != null && total !== shown ? ` dari ${total}` : ''} data{active ? ' (disaring)' : ''}.</span>}
    </form>
  );
}

// Satu kueri untuk semua foto/lampiran di daftar: id rekaman -> lampiran
export type Photo = { id: string; file_name: string; mime_type: string };
export async function photosFor(table: string, ids: string[]) {
  const map = new Map<string, Photo[]>();
  if (!ids.length) return map;
  const supabase = await createClient();
  const { data } = await supabase.from('attachments').select('id, owner_id, file_name, mime_type').eq('owner_table', table).in('owner_id', ids).order('uploaded_at');
  for (const a of (data ?? []) as (Photo & { owner_id: string })[]) map.set(a.owner_id, [...(map.get(a.owner_id) ?? []), a]);
  return map;
}

// Gambar mini yang bisa diketuk untuk membuka foto penuh di tab baru
export function Thumbs({ items }: { items?: Photo[] }) {
  if (!items?.length) return <span className="text-xs text-muted">–</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.slice(0, 3).map(p => (
        <a key={p.id} href={`/api/lampiran/${p.id}`} target="_blank" rel="noreferrer" title={p.file_name} aria-label={`Buka ${p.file_name}`}
          className="grid size-12 place-items-center overflow-hidden rounded-lg border border-line bg-ground hover:border-accent">
          {p.mime_type.startsWith('image/')
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`/api/lampiran/${p.id}`} alt={p.file_name} loading="lazy" className="size-full object-cover" />
            : <Icon name="clip" size={18} />}
        </a>
      ))}
      {items.length > 3 && <span className="text-xs text-muted">+{items.length - 3}</span>}
    </div>
  );
}

// Parameter unduhan Excel dari saringan yang sedang aktif (kunci kosong dibuang)
export const exportParams = (o: Record<string, string | undefined | false>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Record<string, string>;
