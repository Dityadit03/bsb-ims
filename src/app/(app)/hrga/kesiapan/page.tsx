import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { PageHeader, Pager, Panel, Pill, Stat, Table, input, paginate } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { CARD_STATUS, CONTRACT, CONTRACT_STATUS, EMPLOYMENT, FITNESS, MOB, ROSTER } from '@/lib/hrga';
import { HrTabs } from '../tabs';

export const metadata = { title: 'Kesiapan tenaga kerja' };

type Row = { employee_id: string; nrp: string; full_name: string; department_code: string; position_name: string | null; employment_type: string;
  company: string | null; induction_ok: boolean; medical_ok: boolean; fitness: string | null; required: number | null; compliant: number | null;
  compliance_pct: number | null; id_card_ok: boolean; roster_today: string | null; unit_types: string[]; ready: boolean };
type Avail = { unit_type: string; units_total: number; units_ready: number; authorized: number; operators_ready: number; on_shift_today: number };

const Check = ({ ok }: { ok: boolean }) => <span className={`font-bold ${ok ? 'text-ok' : 'text-crit'}`}>{ok ? '✓' : '✗'}</span>;

export default async function ReadinessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data }, { data: avail }, { data: mobs }, { data: cards }, { data: contracts }] = await Promise.all([
    supabase.from('workforce_readiness').select('*').order('full_name').limit(5000).returns<Row[]>(),
    supabase.from('operator_availability').select('*').order('unit_type').returns<Avail[]>(),
    supabase.from('mobilization_register').select('id, employee_id, full_name, nrp, kind, planned_date, done_items, total_items, auto').eq('status', 'open').order('planned_date'),
    supabase.from('id_card_register').select('id, employee_id, full_name, card_no, status, status_note').in('status', ['suspended', 'expired', 'lost']).limit(200),
    supabase.from('contract_register').select('id, employee_id, full_name, contract_type, end_date, contract_status').in('contract_status', ['expired', 'expiring']).order('end_date'),
  ]);
  const all = data ?? [];
  let rows = all;
  if (sp.dept) rows = rows.filter(r => r.department_code === sp.dept);
  if (sp.vendor === '1') rows = rows.filter(r => r.employment_type === 'subcon');
  if (sp.vendor === '0') rows = rows.filter(r => r.employment_type !== 'subcon');
  if (sp.belum) rows = rows.filter(r => !r.ready);
  const pg = paginate(rows, sp.hal);
  const ready = all.filter(r => r.ready).length;
  const depts = [...new Set(all.map(r => r.department_code))].sort();
  const vendors = all.filter(r => r.employment_type === 'subcon');

  return (
    <>
      <PageHeader eyebrow="Workforce readiness · SMKP 3.5" title="Kesiapan tenaga kerja"><ExportLinks dataset="kesiapan" /></PageHeader>
      <HrTabs active="/hrga/kesiapan" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Siap kerja" value={all.length ? `${Math.round((ready / all.length) * 100)}%` : '–'} note={`${ready} dari ${all.length} karyawan aktif`}
          tone={all.length && ready / all.length < 0.9 ? 'warn' : 'ok'} />
        <Stat label="Induksi tidak berlaku" value={all.filter(r => !r.induction_ok).length} tone={all.some(r => !r.induction_ok) ? 'crit' : undefined} />
        <Stat label="MCU tidak berlaku / unfit" value={all.filter(r => !r.medical_ok).length} tone={all.some(r => !r.medical_ok) ? 'crit' : undefined} />
        <Stat label="Tanpa ID card aktif" value={all.filter(r => !r.id_card_ok).length} tone={all.some(r => !r.id_card_ok) ? 'warn' : undefined} />
        <Stat label="Mob/demob berjalan" value={mobs?.length ?? 0} />
        <Stat label="Karyawan vendor" value={vendors.length} note={`${vendors.filter(r => r.ready).length} siap kerja`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Panel title="Ketersediaan operator per jenis unit" sub="Operator = punya SIMPER berlaku; siap = induksi, MCU fit, ID card & kompetensi wajib lengkap; on shift = roster hari ini D/N">
          {avail?.length ? (
            <Table head={['Unit', 'Unit siap', 'Operator ber-SIMPER', 'Siap', 'On shift hari ini', 'Rasio']}>
              {avail.map(a => {
                const ratio = a.units_ready ? a.on_shift_today / a.units_ready : null;
                return (
                  <tr key={a.unit_type}>
                    <td className="font-mono text-xs font-semibold">{a.unit_type}</td>
                    <td className="tabular text-sm">{a.units_ready} / {a.units_total}</td>
                    <td className="tabular text-sm">{a.authorized}</td>
                    <td className="tabular text-sm">{a.operators_ready}</td>
                    <td className="tabular text-sm">{a.on_shift_today}</td>
                    <td>{ratio == null ? <span className="text-xs text-muted">–</span>
                      : <Pill tone={ratio >= 1 ? 'ok' : ratio >= 0.8 ? 'warn' : 'crit'}>{ratio.toFixed(2)} op/unit</Pill>}</td>
                  </tr>
                );
              })}
            </Table>
          ) : <p className="text-sm text-muted">Belum ada unit atau SIMPER tercatat.</p>}
        </Panel>
        <Panel title="Perlu tindak lanjut">
          <ul className="grid gap-2 text-sm">
            {(mobs ?? []).map(m => {
              const auto = Object.values(m.auto as Record<string, boolean>);
              return (
                <li key={m.id}><Link href={`/hrga/${m.employee_id}?tab=akses`} className="flex justify-between gap-2 rounded-lg border border-line px-3 py-2 hover:border-violet/50">
                  <span>{MOB[m.kind]} · {m.full_name}<span className="block text-xs text-muted">{fmtDate(m.planned_date)}</span></span>
                  <Pill tone="warn">{m.done_items + auto.filter(Boolean).length}/{m.total_items + auto.length}</Pill></Link></li>
              );
            })}
            {(cards ?? []).map(c => (
              <li key={c.id}><Link href={`/hrga/${c.employee_id}?tab=akses`} className="flex justify-between gap-2 rounded-lg border border-line px-3 py-2 hover:border-violet/50">
                <span>ID {c.card_no} · {c.full_name}<span className="block text-xs text-muted">{c.status_note ?? ''}</span></span>
                <Pill tone={CARD_STATUS[c.status][0]}>{CARD_STATUS[c.status][1]}</Pill></Link></li>
            ))}
            {(contracts ?? []).map(c => (
              <li key={c.id}><Link href={`/hrga/${c.employee_id}?tab=kontrak`} className="flex justify-between gap-2 rounded-lg border border-line px-3 py-2 hover:border-violet/50">
                <span>Kontrak · {c.full_name}<span className="block text-xs text-muted">{CONTRACT[c.contract_type]} s.d. {fmtDate(c.end_date)}</span></span>
                <Pill tone={CONTRACT_STATUS[c.contract_status][0]}>{CONTRACT_STATUS[c.contract_status][1]}</Pill></Link></li>
            ))}
            {!mobs?.length && !cards?.length && !contracts?.length && <li className="text-muted">Tidak ada.</li>}
          </ul>
        </Panel>
      </div>

      <form className="flex flex-wrap items-center gap-2">
        <select name="dept" defaultValue={sp.dept ?? ''} className={`${input} max-w-60`} aria-label="Departemen">
          <option value="">Semua departemen</option>{depts.map(d => <option key={d}>{d}</option>)}</select>
        <select name="vendor" defaultValue={sp.vendor ?? ''} className={`${input} max-w-60`} aria-label="Asal tenaga kerja">
          <option value="">BSB & vendor</option><option value="0">Karyawan BSB</option><option value="1">Karyawan vendor</option></select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="belum" value="1" defaultChecked={!!sp.belum} /> Hanya yang belum siap</label>
        <button className="text-sm text-accent">Saring</button>
      </form>
      <Table head={['Karyawan', 'Jabatan', 'Induksi', 'MCU', 'Kompetensi', 'ID card', 'SIMPER', 'Hari ini', 'Status']}>
        {pg.rows.map(r => (
          <tr key={r.employee_id}>
            <td className="min-w-44 text-sm"><Link href={`/hrga/${r.employee_id}`} className="hover:text-accent">{r.full_name}</Link>
              <div className="font-mono text-[11px] text-muted">{r.nrp} · {r.department_code}{r.employment_type === 'subcon' ? ` · ${r.company ?? EMPLOYMENT.subcon}` : ''}</div></td>
            <td className="text-xs">{r.position_name ?? '–'}</td>
            <td><Check ok={r.induction_ok} /></td>
            <td><Check ok={r.medical_ok} />{r.fitness && r.fitness !== 'fit' && <div className="text-[11px] text-warn">{FITNESS[r.fitness][1]}</div>}</td>
            <td className="tabular text-xs">{r.required ? `${r.compliant}/${r.required}` : '–'}</td>
            <td><Check ok={r.id_card_ok} /></td>
            <td className="font-mono text-xs">{r.unit_types.join(', ') || '–'}</td>
            <td>{r.roster_today ? <Pill tone={ROSTER[r.roster_today][0]}>{ROSTER[r.roster_today][1]}</Pill> : <span className="text-xs text-muted">–</span>}</td>
            <td><Pill tone={r.ready ? 'ok' : 'crit'}>{r.ready ? 'Siap' : 'Belum siap'}</Pill></td>
          </tr>
        ))}
      </Table>
      <Pager {...pg} params={sp} />
    </>
  );
}
