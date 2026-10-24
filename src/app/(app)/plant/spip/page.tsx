import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Stat, Table, btnGhost, input, paginate, Pager } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { OBJECT_TYPE, VALIDITY } from '@/lib/she';
import { saveCommissioning } from '../../she/portal-actions';
import { Files } from '../../she/fields';

export const metadata = { title: 'Komisioning SPIP' };

type Row = {
  id: string; object_type: string; ref_code: string; name: string; category: string | null; reg_no: string | null;
  commissioned_on: string | null; valid_until: string | null; note: string | null; validity: string; unit_status: string | null; unit_id: string | null;
};

export default async function SpipPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('commissioning_register').select('*').order('valid_until', { ascending: true, nullsFirst: true }).order('ref_code');
  if (sp.status) q = q.eq('validity', sp.status);
  if (sp.jenis) q = q.eq('object_type', sp.jenis);
  if (sp.q) q = q.or(`ref_code.ilike.%${sp.q.replace(/[%,()]/g, '')}%,name.ilike.%${sp.q.replace(/[%,()]/g, '')}%`);
  const { data } = await q.returns<Row[]>();
  const all = data ?? [];
  const count = (v: string) => all.filter(r => r.validity === v).length;
  const pg = paginate(all, sp.hal);
  const write = s.canIn('spip.manage', 'PLT') || s.canIn('spip.manage', 'HSE');

  return (
    <>
      <PageHeader eyebrow="SMKP 4.4 · Komisioning sarana, prasarana, instalasi & peralatan" title="Komisioning SPIP">
        <ExportLinks dataset="spip" />
        <Link href="/plant" className="text-sm text-accent hover:underline">← Unit</Link>
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Berlaku" value={count('valid')} href="/plant/spip?status=valid" />
        <Stat label="Segera habis" value={count('expiring')} href="/plant/spip?status=expiring" note="≤ 30 hari" />
        <Stat label="Expired" value={count('expired')} href="/plant/spip?status=expired" />
        <Stat label="Belum komisioning" value={count('none')} href="/plant/spip?status=none" />
      </div>
      {write && (
        <details className="group rounded-xl border border-line bg-panel p-4 shadow-soft">
          <summary className="cursor-pointer font-display text-xl font-semibold">Tambah / perbarui komisioning</summary>
          <ActionForm action={saveCommissioning} label="Simpan" primary className="mt-3 max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Jenis objek
                <select name="object_type" className={input}>{Object.entries(OBJECT_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <label className="grid gap-1 text-sm">Kode / no. lambung<input name="ref" required className={input} placeholder="LV-05, SJ-08…" /></label>
              <label className="grid gap-1 text-sm">Nama<input name="name" required className={input} /></label>
              <label className="grid gap-1 text-sm">Kategori<input name="category" className={input} placeholder="Sarana / Prasarana / Tool" /></label>
              <label className="grid gap-1 text-sm">No. register<input name="reg" className={input} /></label>
              <label className="grid gap-1 text-sm">Penerbit<input name="issuer" className={input} placeholder="PT BDA" /></label>
              <label className="grid gap-1 text-sm">Tanggal komisioning<input type="date" name="from" className={input} /></label>
              <label className="grid gap-1 text-sm">Berlaku sampai<input type="date" name="until" className={input} /></label>
              <Files label="Sertifikat / stiker" />
            </div>
            <label className="grid gap-1 text-sm">Catatan<input name="note" className={input} /></label>
          </ActionForm>
        </details>
      )}
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Kode / nama" className={`${input} w-44`} aria-label="Cari" />
        <select name="jenis" defaultValue={sp.jenis ?? ''} className={`${input} w-auto`} aria-label="Jenis">
          <option value="">Semua jenis</option>{Object.entries(OBJECT_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className={`${input} w-auto`} aria-label="Status">
          <option value="">Semua status</option>{Object.entries(VALIDITY).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className={btnGhost}>Saring</button>
      </form>
      {pg.rows.length ? (
        <Table head={['Kode', 'Nama', 'Jenis', 'No. register', 'Komisioning', 'Berlaku s.d.', 'Status']}>
          {pg.rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs">{r.unit_id ? <Link href={`/plant/${r.unit_id}`} className="hover:text-accent">{r.ref_code}</Link> : r.ref_code}</td>
              <td className="min-w-48">{r.name}{r.note && <div className="line-clamp-2 text-xs text-muted">{r.note}</div>}</td>
              <td className="text-xs">{OBJECT_TYPE[r.object_type]}{r.category ? ` · ${r.category}` : ''}</td>
              <td className="font-mono text-xs">{r.reg_no ?? '–'}</td>
              <td className="tabular whitespace-nowrap text-xs">{fmtDate(r.commissioned_on)}</td>
              <td className="tabular whitespace-nowrap text-xs">{fmtDate(r.valid_until)}</td>
              <td><Pill tone={VALIDITY[r.validity][0]}>{VALIDITY[r.validity][1]}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada data komisioning untuk saringan ini.</p>}
      <Pager {...pg} params={{ status: sp.status, jenis: sp.jenis, q: sp.q }} />
    </>
  );
}
