import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { PageHeader, Pill, Table, btnPrimary, input, btnGhost } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { DOC_STATUS, fmtDate, rev } from '@/lib/documents';

export const metadata = { title: 'Register dokumen' };

type Row = {
  id: string; registration_no: string; document_number: string | null; type_code: string; type_name: string;
  department_code: string; section_code: string | null; title: string; status: string; access_class: string;
  effective_revision: number | null; current_revision: number | null; effective_date: string | null; next_review_at: string | null;
  owner_name: string | null;
};

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('document_register')
    .select('id, registration_no, document_number, type_code, type_name, department_code, section_code, title, status, access_class, effective_revision, current_revision, effective_date, next_review_at, owner_name')
    .order('updated_at', { ascending: false }).limit(300);
  if (sp.jenis) q = q.eq('type_code', sp.jenis);
  if (sp.dept) q = q.eq('department_code', sp.dept);
  if (sp.status) q = q.eq('status', sp.status);
  if (sp.q) q = q.or(`title.ilike.%${sp.q.replace(/[%,()]/g, ' ')}%,document_number.ilike.%${sp.q.replace(/[%,()]/g, ' ')}%`);

  const [{ data: rows }, { data: types }, { data: depts }] = await Promise.all([
    q.returns<Row[]>(),
    supabase.from('document_types').select('code, name').order('sort_order'),
    supabase.from('departments').select('code, name').order('sort_order'),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader eyebrow="Document Control" title="Register dokumen">
        <ExportLinks dataset="dokumen" />
        <Link href="/dokumen/ajukan" className={btnPrimary}>Ajukan dokumen</Link>
      </PageHeader>
      <form className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <input id="q" name="q" defaultValue={sp.q} placeholder="Cari judul atau nomor" className={input} />
        <select id="jenis" name="jenis" defaultValue={sp.jenis ?? ''} className={input}>
          <option value="">Semua jenis</option>
          {(types ?? []).map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
        <select id="dept" name="dept" defaultValue={sp.dept ?? ''} className={input}>
          <option value="">Semua departemen</option>
          {(depts ?? []).map(d => <option key={d.code} value={d.code}>{d.code} · {d.name}</option>)}
        </select>
        <select id="status" name="status" defaultValue={sp.status ?? ''} className={input}>
          <option value="">Semua status</option>
          {Object.entries(DOC_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className={btnGhost}>Saring</button>
      </form>
      {rows?.length ? (
        <Table head={['Nomor', 'Judul', 'Jenis', 'Dept', 'Rev', 'Berlaku', 'Tinjau ulang', 'Status']}>
          {rows.map(r => {
            const [tone, label] = DOC_STATUS[r.status] ?? ['muted', r.status];
            const overdue = r.next_review_at && r.next_review_at < today;
            return (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-mono text-xs">
                  <Link href={`/dokumen/${r.id}`} className="font-medium text-ink hover:text-accent">{r.document_number ?? r.registration_no}</Link>
                  {!r.document_number && <div className="text-xs text-muted">belum bernomor resmi</div>}
                </td>
                <td className="min-w-64"><Link href={`/dokumen/${r.id}`} className="hover:text-accent">{r.title}</Link>
                  {r.access_class !== 'internal' && <span className="ml-2"><Pill tone="crit">{r.access_class === 'restricted' ? 'Terbatas' : 'Rahasia'}</Pill></span>}
                </td>
                <td className="text-xs">{r.type_name}</td>
                <td className="font-mono text-xs">{r.department_code}{r.section_code ? `-${r.section_code}` : ''}</td>
                <td className="font-mono text-xs">{rev(r.effective_revision ?? r.current_revision)}</td>
                <td className="tabular whitespace-nowrap text-xs">{fmtDate(r.effective_date)}</td>
                <td className={`tabular whitespace-nowrap text-xs ${overdue ? 'font-medium text-crit' : ''}`}>{fmtDate(r.next_review_at)}</td>
                <td><Pill tone={tone}>{label}</Pill></td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <div className="rounded-md border border-dashed border-line p-8 text-center text-sm text-muted">
          Belum ada dokumen yang cocok. <Link href="/dokumen/ajukan" className="text-accent">Ajukan dokumen pertama</Link> atau ubah saringan.
        </div>
      )}
    </>
  );
}
