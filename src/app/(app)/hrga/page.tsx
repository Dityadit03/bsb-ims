import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Pager, Panel, Pill, Stat, Table, input, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { EMPLOYMENT, pctTone } from '@/lib/hrga';
import { saveEmployee } from './actions';
import { HrTabs } from './tabs';
import { DeptSelect, sheMasters } from '../she/fields';

export const metadata = { title: 'Karyawan' };

type Row = { id: string; nrp: string; full_name: string; department_code: string; position_name: string | null; employment_type: string;
  company: string | null; status: string; email: string | null; required: number; compliant: number; expiring: number; compliance_pct: number | null };

export default async function HrgaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('employee_register').select('*').eq('status', sp.keluar ? 'exited' : 'active').order('full_name').limit(500);
  if (sp.dept) q = q.eq('department_code', sp.dept);
  if (sp.cari) q = q.or(`full_name.ilike.%${sp.cari.replace(/[,()%]/g, '')}%,nrp.ilike.%${sp.cari.replace(/[,()%]/g, '')}%`);
  const [{ data: rows }, { depts }, { data: positions }, { count: expired }] = await Promise.all([
    q.returns<Row[]>(), sheMasters(),
    supabase.from('positions').select('id, code, name, department_id').eq('active', true).order('name'),
    supabase.from('competency_matrix').select('*', { count: 'exact', head: true }).in('status', ['expired', 'missing', 'revoked']),
  ]);
  const all = rows ?? [];
  const req = all.filter(r => r.required > 0);
  const pg = paginate(all, sp.hal);
  const avg = req.length ? req.reduce((t, r) => t + Number(r.compliance_pct), 0) / req.length : null;

  return (
    <>
      <PageHeader eyebrow="SMKP 3.5 · Kompetensi, pendidikan & pelatihan" title="HRGA"><ExportLinks dataset="karyawan" />{s.canIn('hr.manage', 'HRGA') && <ExportLinks dataset="profil_karyawan" />}</PageHeader>
      <HrTabs active="/hrga" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={sp.keluar ? 'Karyawan keluar' : 'Karyawan aktif'} value={all.length} />
        <Stat label="Kepatuhan kompetensi" value={avg == null ? '–' : `${avg.toFixed(0)}%`} />
        <Stat label="Segera habis" value={all.reduce((t, r) => t + r.expiring, 0)} href="/hrga/kompetensi" />
        <Stat label="Kompetensi wajib belum terpenuhi" value={expired ?? 0} href="/hrga/kompetensi" />
      </div>
      <form className="flex flex-wrap gap-2">
        <input name="cari" defaultValue={sp.cari ?? ''} className={`${input} w-48`} placeholder="Nama / NRP" />
        <select name="dept" defaultValue={sp.dept ?? ''} className={`${input} w-auto`} aria-label="Departemen">
          <option value="">Semua departemen</option>{depts.map(d => <option key={d.id} value={d.code}>{d.code}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="keluar" value="1" defaultChecked={!!sp.keluar} /> Karyawan keluar</label>
        <button className="text-sm text-accent">Saring</button>
      </form>
      {all.length ? (
        <Table head={['NRP', 'Nama', 'Dept', 'Jabatan', 'Status kerja', 'Akun', 'Kompetensi wajib']}>
          {pg.rows.map(r => (
            <tr key={r.id}>
              <td className="font-mono text-xs"><Link href={`/hrga/${r.id}`} className="font-medium hover:text-accent">{r.nrp}</Link></td>
              <td className="text-sm"><Link href={`/hrga/${r.id}`} className="hover:text-accent">{r.full_name}</Link></td>
              <td className="text-xs">{r.department_code}</td>
              <td className="text-xs">{r.position_name ?? '–'}</td>
              <td className="text-xs">{EMPLOYMENT[r.employment_type]}{r.company ? ` · ${r.company}` : ''}</td>
              <td className="text-xs">{r.email ?? '–'}</td>
              <td>{r.required ? <Pill tone={pctTone(r.compliance_pct)}>{r.compliant}/{r.required} · {r.compliance_pct}%</Pill> : <span className="text-xs text-muted">–</span>}
                {r.expiring > 0 && <span className="ml-1 text-xs text-warn">{r.expiring} segera habis</span>}</td>
            </tr>
          ))}
        </Table>
      ) : null}
      {all.length ? (
        <Pager {...pg} params={sp} />
      ) : <p className="text-sm text-muted">Belum ada data karyawan.</p>}
      {s.canIn('hr.manage', 'HRGA') && (
        <Panel title="Tambah / perbarui karyawan">
          <ActionForm action={saveEmployee} label="Simpan karyawan" primary className="max-w-4xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">NIK karyawan (NRP)<input name="nrp" className={`${input} uppercase`} placeholder="Kosongkan = dibuat otomatis" /></label>
              <label className="grid gap-1 text-sm">Nama lengkap<input name="name" required className={input} /></label>
              <DeptSelect depts={depts} />
              <label className="grid gap-1 text-sm">Jabatan
                <select name="position" className={input} defaultValue=""><option value="">–</option>
                  {(positions ?? []).map(p => <option key={p.id} value={p.id}>{p.name} ({depts.find(d => d.id === p.department_id)?.code ?? 'semua'})</option>)}</select></label>
              <label className="grid gap-1 text-sm">Status kerja
                <select name="type" className={input}>{Object.entries(EMPLOYMENT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="grid gap-1 text-sm">Perusahaan (subkon)<input name="company" className={input} /></label>
              <label className="grid gap-1 text-sm">Tanggal masuk<input type="date" name="join_date" className={input} /></label>
              <label className="grid gap-1 text-sm sm:col-span-2">Email akun aplikasi (opsional)<input type="email" name="email" className={input} placeholder="Akun harus sudah pernah login" /></label>
            </div>
            <p className="text-xs text-muted">NIK dibuat otomatis (format tahun.bulan masuk.nomor urut, mis. 24.05.064) dan tidak pernah sama. Isi hanya untuk memperbarui karyawan yang sudah ada.</p>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
