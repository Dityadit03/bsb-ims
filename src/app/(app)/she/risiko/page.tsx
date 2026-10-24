import Link from 'next/link';
import { PageHeader, Panel, Pill, Table, btnGhost, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { RISK } from '@/lib/compliance';
import { fmtDate } from '@/lib/documents';
import { CATEGORY, RISK_STATUS } from '@/lib/she';
import { SheTabs, sheMasters } from '../fields';
import { RiskForm } from './risk-form';

export const metadata = { title: 'Risk register' };

type Row = {
  id: string; risk_no: string; revision: number; activity: string; hazard: string; category: string; status: string;
  initial_score: number; initial_level: string; residual_score: number; residual_level: string; department_code: string;
  work_area_name: string | null; owner_name: string | null; review_due: string | null; review_overdue: boolean;
};

export default async function RiskPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('risk_register_view').select('*').order('residual_score', { ascending: false }).order('risk_no').limit(500);
  if (sp.status) q = q.eq('status', sp.status); else q = q.neq('status', 'retired');
  if (sp.dept) q = q.eq('department_code', sp.dept);
  const [{ data: rows }, { depts, areas }, { data: legal }, { data: people }] = await Promise.all([
    q.returns<Row[]>(), sheMasters(),
    supabase.from('legal_requirements').select('id, register_no, title').order('register_no'),
    supabase.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name'),
  ]);

  return (
    <>
      <PageHeader eyebrow="SMKP 2.2 · Manajemen risiko (IBPR)" title="Risk register" />
      <SheTabs active="/she/risiko" />
      <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <select name="status" defaultValue={sp.status ?? ''} className={input} aria-label="Status">
          <option value="">Berlaku (draft & disetujui)</option>
          {Object.entries(RISK_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="dept" defaultValue={sp.dept ?? ''} className={input} aria-label="Departemen">
          <option value="">Semua departemen</option>
          {depts.map(d => <option key={d.id} value={d.code}>{d.code} · {d.name}</option>)}
        </select>
        <button className={btnGhost}>Saring</button>
      </form>
      {rows?.length ? (
        <Table head={['Nomor', 'Aktivitas / bahaya', 'Kategori', 'Dept', 'Awal', 'Residual', 'Pemilik', 'Tinjau ulang', 'Status']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs"><Link href={`/she/risiko/${r.id}`} className="font-medium hover:text-accent">{r.risk_no}</Link>
                <div className="text-muted">Rev.{String(r.revision).padStart(2, '0')}</div></td>
              <td className="min-w-64"><Link href={`/she/risiko/${r.id}`} className="hover:text-accent">{r.activity}</Link>
                <div className="text-xs text-muted">{r.hazard}{r.work_area_name ? ` · ${r.work_area_name}` : ''}</div></td>
              <td className="text-xs">{CATEGORY[r.category]}</td>
              <td className="font-mono text-xs">{r.department_code}</td>
              <td><Pill tone={RISK[r.initial_level][0]}>{r.initial_score} {RISK[r.initial_level][1]}</Pill></td>
              <td><Pill tone={RISK[r.residual_level][0]}>{r.residual_score} {RISK[r.residual_level][1]}</Pill></td>
              <td className="text-xs">{r.owner_name}</td>
              <td className={`tabular whitespace-nowrap text-xs ${r.review_overdue ? 'font-medium text-crit' : ''}`}>{fmtDate(r.review_due)}</td>
              <td><Pill tone={RISK_STATUS[r.status][0]}>{RISK_STATUS[r.status][1]}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada risiko untuk saringan ini.</p>}
      {s.can('risk.manage') && (
        <Panel title="Tambah risiko">
          <RiskForm depts={depts} areas={areas} legal={legal ?? []} people={people ?? []} v={{ department_id: s.profile.department_id ?? undefined }}
            label="Simpan sebagai draft" />
        </Panel>
      )}
    </>
  );
}
