import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { LEGAL_STATUS, REG_TYPES } from '@/lib/compliance';
import { fmtDate } from '@/lib/documents';
import { registerLegal } from '../smkp/actions';

export const metadata = { title: 'Legal register' };

type Row = {
  id: string; register_no: string; title: string; regulation_no: string; regulation_type: string; status: string; next_review_at: string | null;
  departments: { code: string } | null; legal_obligations: { compliance_status: string }[];
};

export default async function LegalPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: rows }, { data: depts }] = await Promise.all([
    supabase.from('legal_requirements').select('id, register_no, title, regulation_no, regulation_type, status, next_review_at, departments:owner_department_id(code), legal_obligations(compliance_status)')
      .order('register_no').returns<Row[]>(),
    supabase.from('departments').select('id, code, name').order('sort_order'),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader eyebrow="SMKP 2.3 · 5.3" title="Legal register" />
      {rows?.length ? (
        <Table head={['No.', 'Regulasi', 'Judul', 'Dept', 'Kewajiban', 'Tinjau ulang', 'Status']}>
          {rows.map(r => {
            const ob = r.legal_obligations;
            const bad = ob.filter(o => o.compliance_status === 'non_compliant' || o.compliance_status === 'partial').length;
            const todo = ob.filter(o => o.compliance_status === 'not_evaluated').length;
            return (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-mono text-xs"><Link href={`/legal/${r.id}`} className="hover:text-accent">{r.register_no}</Link></td>
                <td className="whitespace-nowrap text-xs"><span className="font-mono text-muted">{r.regulation_type}</span> {r.regulation_no}</td>
                <td className="min-w-64"><Link href={`/legal/${r.id}`} className="hover:text-accent">{r.title}</Link></td>
                <td className="font-mono text-xs">{r.departments?.code}</td>
                <td className="text-xs">{ob.length}{bad ? <span className="ml-1 text-crit">· {bad} belum patuh</span> : ''}{todo ? <span className="ml-1 text-muted">· {todo} belum dievaluasi</span> : ''}</td>
                <td className={`whitespace-nowrap text-xs ${r.next_review_at && r.next_review_at < today ? 'font-medium text-crit' : ''}`}>{fmtDate(r.next_review_at)}</td>
                <td><Pill tone={LEGAL_STATUS[r.status][0]}>{LEGAL_STATUS[r.status][1]}</Pill></td>
              </tr>
            );
          })}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada regulasi terdaftar.</p>}
      {s.can('legal.manage') && (
        <Panel title="Daftarkan regulasi">
          <ActionForm action={registerLegal} label="Daftarkan (nomor LGL otomatis)" primary className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <label className="grid gap-1 text-sm">Jenis
                <select name="regulation_type" className={input} defaultValue="PERMEN">{REG_TYPES.map(t => <option key={t}>{t}</option>)}</select>
              </label>
              <label className="grid gap-1 text-sm">Nomor regulasi<input name="regulation_no" required className={input} placeholder="Kepmen ESDM 1827 K/30/MEM/2018" /></label>
            </div>
            <label className="grid gap-1 text-sm">Judul / tentang<input name="title" required className={input} /></label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Penerbit<input name="issuer" className={input} /></label>
              <label className="grid gap-1 text-sm">Tanggal terbit<input type="date" name="issued_date" className={input} /></label>
              <label className="grid gap-1 text-sm">Pemilik
                <select name="department" required className={input} defaultValue={depts?.find(d => d.code === 'HSE')?.id}>
                  {(depts ?? []).map(d => <option key={d.id} value={d.id}>{d.code}</option>)}
                </select>
              </label>
            </div>
            <label className="grid gap-1 text-sm">Tautan sumber (JDIH)<input type="url" name="source_url" className={input} placeholder="https://jdih.esdm.go.id/..." /></label>
            <label className="grid gap-1 text-sm">Ringkasan<textarea name="summary" rows={2} className={input} /></label>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
