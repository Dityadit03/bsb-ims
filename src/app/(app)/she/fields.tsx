import Link from 'next/link';
import { DropZone } from '@/components/drop-zone';
import { Tabs } from '@/components/tabs';
import { ActionForm } from '@/components/action-form';
import { input } from '@/components/ui';
import { setPicPartner } from './actions';
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
  return <DropZone label={label} accept="image/*,application/pdf" hint="Ketuk untuk memotret / memilih, atau seret berkas ke sini" />;
}

const TABS = [
  ['/she', 'Ringkasan'], ['/she/hazard', 'Hazard'], ['/she/observasi', 'Observasi'], ['/she/inspeksi', 'Inspeksi'],
  ['/she/p2h', 'P2H'], ['/she/ftw', 'Fit to work'], ['/she/insiden', 'Insiden'], ['/she/risiko', 'Risk register'], ['/she/sap', 'SAP'],
  ['/she/toolbox', 'Toolbox talk'], ['/she/serah-terima', 'Serah terima'], ['/she/pelanggaran', 'Pelanggaran'], ['/she/induksi', 'Induksi'], ['/she/izin', 'Izin area'],
] as const;

// Daftar karyawan aktif untuk isian "NRP · Nama" (dipakai bersama EmployeeInput)
export async function EmployeeDatalist() {
  const supabase = await createClient();
  const { data } = await supabase.from('employees').select('nrp, full_name').eq('status', 'active').order('full_name');
  return <datalist id="emp-list">{(data ?? []).map(e => <option key={e.nrp} value={`${e.nrp} · ${e.full_name}`} />)}</datalist>;
}

export function EmployeeInput({ name = 'employee', label = 'Karyawan', required = false, hint }: { name?: string; label?: string; required?: boolean; hint?: string }) {
  return (
    <label className="grid gap-1 text-sm">{label}
      <input name={name} list="emp-list" required={required} autoComplete="off" placeholder="Ketik nama atau NRP" className={input} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

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

// PIC perbaikan dari mitra kerja (kontraktor). Tampil sebagai teks bila tidak boleh diubah.
export async function PicPartner({ table, id, path, current, currentId, canEdit }: {
  table: string; id: string; path: string; current: string | null; currentId: string | null; canEdit: boolean;
}) {
  if (!canEdit) return <span>{current ?? '–'}</span>;
  const supabase = await createClient();
  const { data: partners } = await supabase.from('partners').select('id, name').eq('active', true).order('name');
  return (
    <ActionForm action={setPicPartner} label="Simpan" hidden={{ table, id, path }}>
      <select name="partner" defaultValue={currentId ?? ''} className={input} aria-label="Mitra kerja">
        <option value="">– tanpa mitra kerja</option>
        {(partners ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input name="new" className={input} placeholder="atau tambah mitra baru" />
    </ActionForm>
  );
}
