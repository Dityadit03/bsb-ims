import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { PageHeader, Pill, Stat, Table, btnGhost, btnPrimary, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { CAPA_STATUS, RISK, SOURCE_TYPE } from '@/lib/compliance';
import { fmtDate } from '@/lib/documents';

export const metadata = { title: 'Action plan' };

type Row = {
  id: string; action_no: string; title: string; status: string; risk_level: string; due_date: string; is_overdue: boolean;
  source_type: string; clause_code: string; department_code: string; pic_name: string | null; verifier_name: string | null; pic_id: string;
};

export default async function CapaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('capa_register')
    .select('id, action_no, title, status, risk_level, due_date, is_overdue, source_type, clause_code, department_code, pic_name, verifier_name, pic_id')
    .order('due_date').limit(300);
  if (sp.status) q = q.eq('status', sp.status); else if (!sp.semua) q = q.in('status', ['open', 'in_progress', 'submitted']);
  if (sp.dept) q = q.eq('department_code', sp.dept);
  if (sp.terlambat) q = q.eq('is_overdue', true);
  if (sp.saya) q = q.or(`pic_id.eq.${s.profile.id},verifier_id.eq.${s.profile.id}`);

  const count = (b: PromiseLike<{ count: number | null }>) => b.then(r => r.count ?? 0);
  const base = () => supabase.from('capa_register').select('*', { count: 'exact', head: true });
  const [{ data: rows }, { data: depts }, open, overdue, toVerify, mine] = await Promise.all([
    q.returns<Row[]>(),
    supabase.from('departments').select('code, name').order('sort_order'),
    count(base().in('status', ['open', 'in_progress'])),
    count(base().eq('is_overdue', true)),
    count(base().eq('status', 'submitted')),
    count(base().eq('pic_id', s.profile.id).in('status', ['open', 'in_progress'])),
  ]);

  return (
    <>
      <PageHeader eyebrow="SMKP Elemen 5.7 · Tindak lanjut" title="Action plan">
        <ExportLinks dataset="capa" />
        {s.can('capa.create') && <Link href="/capa/baru" className={btnPrimary}>Buat action plan</Link>}
      </PageHeader>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Terbuka" value={open} href="/capa" />
        <Stat label="Lewat target" value={overdue} href="/capa?terlambat=1" />
        <Stat label="Menunggu verifikasi" value={toVerify} href="/capa?status=submitted" />
        <Stat label="Tugas saya" value={mine} href="/capa?saya=1" />
      </div>
      <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <select name="status" defaultValue={sp.status ?? ''} className={input} aria-label="Status">
          <option value="">Belum selesai</option>
          {Object.entries(CAPA_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="dept" defaultValue={sp.dept ?? ''} className={input} aria-label="Departemen">
          <option value="">Semua departemen</option>
          {(depts ?? []).map(d => <option key={d.code} value={d.code}>{d.code} · {d.name}</option>)}
        </select>
        <button className={btnGhost}>Saring</button>
      </form>
      {rows?.length ? (
        <Table head={['Nomor', 'Judul', 'Sumber', 'SMKP', 'Dept', 'Risiko', 'Target', 'PIC / verifikator', 'Status']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs"><Link href={`/capa/${r.id}`} className="font-medium hover:text-accent">{r.action_no}</Link></td>
              <td className="min-w-64"><Link href={`/capa/${r.id}`} className="hover:text-accent">{r.title}</Link></td>
              <td className="text-xs">{SOURCE_TYPE[r.source_type]}</td>
              <td className="font-mono text-xs">{r.clause_code}</td>
              <td className="font-mono text-xs">{r.department_code}</td>
              <td><Pill tone={RISK[r.risk_level][0]}>{RISK[r.risk_level][1]}</Pill></td>
              <td className={`tabular whitespace-nowrap text-xs ${r.is_overdue ? 'font-medium text-crit' : ''}`}>{fmtDate(r.due_date)}</td>
              <td className="text-xs">{r.pic_name}<div className="text-muted">{r.verifier_name}</div></td>
              <td><Pill tone={CAPA_STATUS[r.status][0]}>{CAPA_STATUS[r.status][1]}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Tidak ada action plan untuk saringan ini.</p>}
    </>
  );
}
