import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input, Clamp, Pager, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { COMP_CATEGORY, LEVEL, VALIDITY } from '@/lib/hrga';
import { UNIT_TYPE } from '@/lib/she';
import { saveCompetency, savePosition, setRequirement } from '../actions';
import { HrTabs } from '../tabs';
import { DeptSelect, sheMasters } from '../../she/fields';

export const metadata = { title: 'Kompetensi & SIMPER' };

export default async function KompetensiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: gaps, count: gapCount }, { data: expiring }, { data: simper }, { data: comps }, { data: positions }, { data: reqs }, { depts }] = await Promise.all([
    supabase.from('competency_matrix').select('employee_id, nrp, full_name, department_code, competency_code, status', { count: 'exact' })
      .in('status', ['missing', 'expired', 'revoked']).order('department_code').limit(300),
    supabase.from('employee_competency_view').select('id, employee_id, full_name, department_code, competency_code, valid_until, days_left')
      .eq('validity', 'expiring').order('valid_until').limit(200),
    supabase.from('authorization_register').select('id, employee_id, nrp, full_name, department_code, competency_code, unit_type, cert_no, valid_until, validity')
      .order('unit_type').order('full_name'),
    supabase.from('competencies').select('id, code, name, category, validity_months, unit_type, active').order('code'),
    supabase.from('positions').select('id, code, name, level, department_id').eq('active', true).order('name'),
    supabase.from('competency_requirements').select('position_id, competency_id'),
    sheMasters(),
  ]);
  const sim = paginate(simper ?? [], sp.hal);
  const hr = s.canIn('hr.manage', 'HRGA');
  const req = new Set((reqs ?? []).map(r => `${r.position_id}:${r.competency_id}`));
  const name = (e: { employee_id: string; full_name: string }) => <Link href={`/hrga/${e.employee_id}`} className="hover:text-accent">{e.full_name}</Link>;

  return (
    <>
      <PageHeader eyebrow="SMKP 3.5 · Kompetensi" title="Kompetensi & SIMPER"><ExportLinks dataset="kompetensi" /></PageHeader>
      <HrTabs active="/hrga/kompetensi" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Kompetensi wajib belum terpenuhi (${gapCount ?? gaps?.length ?? 0})`}>
          {gaps?.length ? <Clamp className="grid gap-1 text-sm" items={gaps.map(g => (
            <li key={`${g.employee_id}${g.competency_code}`} className="flex justify-between gap-2 border-b border-line py-1">
              <span>{name(g)} <span className="text-xs text-muted">· {g.department_code}</span></span>
              <span><span className="font-mono text-xs">{g.competency_code}</span> <Pill tone={VALIDITY[g.status][0]}>{VALIDITY[g.status][1]}</Pill></span></li>))} />
            : <p className="text-sm text-muted">Semua karyawan memenuhi kompetensi wajib jabatannya.</p>}
        </Panel>
        <Panel title={`Segera habis masa berlaku (${expiring?.length ?? 0})`}>
          {expiring?.length ? <Clamp className="grid gap-1 text-sm" items={expiring.map(x => (
            <li key={x.id} className="flex justify-between gap-2 border-b border-line py-1">
              <span>{name(x)} <span className="text-xs text-muted">· {x.department_code}</span></span>
              <span className="text-xs"><span className="font-mono">{x.competency_code}</span> · {fmtDate(x.valid_until)} <span className="text-warn">({x.days_left} hari)</span></span></li>))} />
            : <p className="text-sm text-muted">Tidak ada yang segera habis.</p>}
        </Panel>
      </div>
      <Panel title="Register otorisasi (SIMPER) berlaku">
        {simper?.length ? (
          <Table head={['Unit', 'NRP', 'Nama', 'Dept', 'No. SIMPER', 'Berlaku s.d.']}>
            {sim.rows.map(x => (
              <tr key={x.id}>
                <td className="text-xs">{UNIT_TYPE[x.unit_type] ?? x.unit_type}</td>
                <td className="font-mono text-xs">{x.nrp}</td>
                <td className="text-sm">{name(x)}</td>
                <td className="text-xs">{x.department_code}</td>
                <td className="font-mono text-xs">{x.cert_no ?? '–'}</td>
                <td><Pill tone={VALIDITY[x.validity][0]}>{fmtDate(x.valid_until)}</Pill></td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada SIMPER berlaku.</p>}
        <Pager {...sim} params={sp} />
      </Panel>
      <Panel title="Matriks kompetensi jabatan">
        {positions?.length && comps?.length ? (
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead><tr><th className="p-1 text-left">Jabatan</th>{comps.filter(c => c.active).map(c => <th key={c.id} className="p-1 font-mono" title={c.name}>{c.code}</th>)}</tr></thead>
              <tbody>{positions.map(p => (
                <tr key={p.id} className="border-t border-line">
                  <td className="sticky left-0 whitespace-nowrap bg-panel p-1">{p.name} <span className="text-muted">({depts.find(d => d.id === p.department_id)?.code ?? '–'})</span></td>
                  {comps.filter(c => c.active).map(c => <td key={c.id} className="p-1 text-center">{req.has(`${p.id}:${c.id}`) ? '●' : ''}</td>)}
                </tr>))}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted">Belum ada jabatan.</p>}
        {hr && (
          <ActionForm action={setRequirement} label="Perbarui matriks" className="max-w-2xl">
            <div className="grid gap-2 sm:grid-cols-3">
              <select name="position" required className={input} aria-label="Jabatan">{(positions ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <select name="competency" required className={input} aria-label="Kompetensi">{(comps ?? []).filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.code}</option>)}</select>
              <select name="required" className={input} aria-label="Wajib"><option value="true">Wajibkan</option><option value="false">Hapus dari matriks</option></select>
            </div>
          </ActionForm>
        )}
      </Panel>
      {hr && (
        <details className="group rounded-md border border-line bg-panel">
        <summary className="cursor-pointer p-4 font-display text-xl font-semibold">Pengaturan master kompetensi & jabatan</summary>
        <div className="grid gap-4 p-4 pt-0 lg:grid-cols-2">
          <Panel title="Master kompetensi">
            <ul className="grid gap-1 text-xs">{(comps ?? []).map(c => <li key={c.id} className={c.active ? '' : 'opacity-50'}>
              <span className="font-mono">{c.code}</span> · {c.name} · {COMP_CATEGORY[c.category]} · {c.validity_months ? `${c.validity_months} bln` : 'seumur hidup'}{c.unit_type ? ` · ${c.unit_type}` : ''}</li>)}</ul>
            <ActionForm action={saveCompetency} label="Simpan kompetensi">
              <div className="grid grid-cols-2 gap-2">
                <input name="code" required className={`${input} uppercase`} placeholder="Kode, mis. SIMPER-WT" />
                <input name="name" required className={input} placeholder="Nama" />
                <select name="category" className={input} aria-label="Kategori">{Object.entries(COMP_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input type="number" name="validity" min={1} className={input} placeholder="Masa berlaku (bulan)" />
                <select name="unit_type" className={input} aria-label="Jenis unit (untuk SIMPER)" defaultValue=""><option value="">Jenis unit (untuk SIMPER)</option>
                  {Object.entries(UNIT_TYPE).map(([k, l]) => <option key={k} value={k}>{k} · {l}</option>)}</select>
                <select name="active" className={input} aria-label="Aktif"><option value="true">Aktif</option><option value="false">Tidak aktif</option></select>
              </div>
            </ActionForm>
          </Panel>
          <Panel title="Jabatan">
            <ActionForm action={savePosition} label="Simpan jabatan">
              <div className="grid grid-cols-2 gap-2">
                <DeptSelect depts={depts} />
                <label className="grid gap-1 text-sm">Level<select name="level" className={input}>{Object.entries(LEVEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <input name="code" required className={`${input} uppercase`} placeholder="Kode, mis. OPR-WT" />
                <input name="name" required className={input} placeholder="Nama jabatan" />
              </div>
            </ActionForm>
          </Panel>
        </div>
        </details>
      )}
    </>
  );
}
