import Link from 'next/link';
import { Tabs } from '@/components/tabs';
import { input } from '@/components/ui';
import { RISK } from '@/lib/compliance';
import { createClient } from '@/lib/supabase/server';

export type Opt = { id: string; code: string; name: string };

// Master yang dipakai hampir semua formulir SHE
export async function sheMasters() {
  const supabase = await createClient();
  const [{ data: depts }, { data: areas }] = await Promise.all([
    supabase.from('departments').select('id, code, name').eq('active', true).order('sort_order'),
    supabase.from('work_areas').select('id, code, name').eq('active', true).order('name'),
  ]);
  return { depts: (depts ?? []) as Opt[], areas: (areas ?? []) as Opt[] };
}

export const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

export function DeptSelect({ name = 'department', label = 'Departemen', depts, value }: { name?: string; label?: string; depts: Opt[]; value?: string | null }) {
  return (
    <label className="grid gap-1 text-sm">{label}
      <select name={name} required className={input} defaultValue={value ?? ''}>
        <option value="" disabled>Pilih</option>
        {depts.map(d => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
      </select>
    </label>
  );
}

export function AreaSelect({ areas, value }: { areas: Opt[]; value?: string | null }) {
  return (
    <label className="grid gap-1 text-sm">Lokasi
      <select name="area" className={input} defaultValue={value ?? ''}>
        <option value="">–</option>
        {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  );
}

export function RiskSelect({ name = 'risk', value = 'medium' }: { name?: string; value?: string }) {
  return (
    <label className="grid gap-1 text-sm">Tingkat risiko
      <select name={name} className={input} defaultValue={value}>
        {Object.entries(RISK).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
}

export function Files({ label = 'Foto / lampiran' }: { label?: string }) {
  return <label className="grid gap-1 text-sm">{label}<input type="file" name="files" multiple accept="image/*,application/pdf" capture="environment" className={input} /></label>;
}

const TABS = [
  ['/she', 'Ringkasan'], ['/she/hazard', 'Hazard'], ['/she/observasi', 'Observasi'], ['/she/inspeksi', 'Inspeksi'],
  ['/she/p2h', 'P2H'], ['/she/ftw', 'Fit to work'], ['/she/insiden', 'Insiden'], ['/she/risiko', 'Risk register'], ['/she/sap', 'SAP'],
] as const;

export function SheTabs({ active }: { active: string }) {
  return <Tabs items={TABS} active={active} />;
}

export async function AttachmentList({ table, ids }: { table: string; ids: string[] }) {
  const supabase = await createClient();
  const { data } = await supabase.from('attachments').select('id, file_name').eq('owner_table', table).in('owner_id', ids);
  if (!data?.length) return null;
  return (
    <ul className="flex flex-wrap gap-2 text-xs">
      {data.map(a => <li key={a.id}><a href={`/api/lampiran/${a.id}`} target="_blank" className="rounded border border-line px-2 py-1 font-mono hover:border-accent">📎 {a.file_name}</a></li>)}
    </ul>
  );
}

// Tautan membuat action plan yang terhubung ke rekaman SHE + daftar action plan terkait
export async function LinkedCapa({ table, id, sourceType, refNo, clauseCode, canCreate }: {
  table: string; id: string; sourceType: string; refNo: string; clauseCode: string; canCreate: boolean;
}) {
  const supabase = await createClient();
  const [{ data: rows }, { data: clause }] = await Promise.all([
    supabase.from('corrective_actions').select('id, action_no, title, status').eq('source_table', table).eq('source_id', id),
    supabase.from('compliance_clauses').select('id').eq('framework_code', 'SMKP').eq('code', clauseCode).maybeSingle(),
  ]);
  const qs = new URLSearchParams({ sumber: sourceType, ref: refNo, tabel: table, sid: id, ...(clause ? { clause: clause.id } : {}) });
  return (
    <div className="grid gap-2">
      {rows?.length ? (
        <ul className="grid gap-1 text-sm">
          {rows.map(a => <li key={a.id}><Link href={`/capa/${a.id}`} className="font-mono text-xs hover:text-accent">{a.action_no}</Link> {a.title} <span className="text-xs text-muted">({a.status})</span></li>)}
        </ul>
      ) : <p className="text-sm text-muted">Belum ada action plan.</p>}
      {canCreate && <Link href={`/capa/baru?${qs}`} className="text-sm text-accent hover:underline">+ Buat action plan dari rekaman ini</Link>}
    </div>
  );
}
