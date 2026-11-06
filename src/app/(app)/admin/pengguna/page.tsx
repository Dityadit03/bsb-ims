import { PageHeader, Panel, Pill, Table } from '@/components/ui';
import { requirePermission } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { ActivateForm, PositionForm, type AccessInfo, type PositionOption } from './activate-form';
import { RejectForm, ResetPasswordForm } from './nik-panel';

export const metadata = { title: 'Pengguna & peran' };

type Row = {
  id: string; email: string; full_name: string | null; status: string; created_at: string;
  departments: { code: string } | null;
  user_roles: { role_code: string; departments: { code: string } | null; valid_until: string | null }[];
};

const STATUS = { active: ['ok', 'Aktif'], pending: ['warn', 'Menunggu'], suspended: ['crit', 'Ditangguhkan'], exited: ['muted', 'Keluar'] } as const;

export default async function PenggunaPage() {
  const s = await requirePermission('user.manage');
  const supabase = await createClient();
  const [{ data: users }, { data: roles }, { data: depts }, { data: poss }, { data: acc }] = await Promise.all([
    supabase.from('profiles')
      .select('id, email, full_name, status, created_at, departments(code), user_roles!user_roles_user_id_fkey(role_code, valid_until, departments(code))')
      .order('status').order('email').returns<Row[]>(),
    supabase.from('roles').select('code, name').order('code'),
    supabase.from('departments').select('id, code, name').order('sort_order'),
    supabase.from('positions').select('id, name, level, department_id').eq('active', true).order('name').returns<{ id: string; name: string; level: string; department_id: string | null }[]>(),
    supabase.rpc('position_access'),
  ]);
  const deptById = new Map((depts ?? []).map(d => [d.id, d]));
  const roleName = new Map((roles ?? []).map(r => [r.code, r.name]));
  const positions: PositionOption[] = (poss ?? []).map(p => ({ id: p.id, name: p.name, level: p.level, group: p.department_id ? `${deptById.get(p.department_id)?.code} · ${deptById.get(p.department_id)?.name}` : 'Kantor pusat (HO)' }))
    .sort((a, b) => (a.group === 'Kantor pusat (HO)' ? 1 : 0) - (b.group === 'Kantor pusat (HO)' ? 1 : 0) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const access: AccessInfo = Object.fromEntries(((acc ?? []) as { position_id: string; role_code: string; role_name: string; department_id: string | null }[])
    .map(a => [a.position_id, { role: a.role_name ?? roleName.get(a.role_code) ?? a.role_code, scope: a.department_id ? (deptById.get(a.department_id)?.name ?? '') : 'semua departemen' }]));
  const isNik = (email: string) => email.endsWith('@nrp.bsb.local');
  const pending = (users ?? []).filter(u => u.status === 'pending' && !isNik(u.email));
  const { data: nikPending } = await supabase.rpc('nik_pending');
  const nikRaw = (nikPending ?? []) as {
    user_id: string; nrp: string; typed_name: string | null; registered_at: string; employee_id: string | null; employee_name: string | null;
    department: string | null; employee_status: string | null; already_linked: boolean; birth_match: boolean; birth_known: boolean;
  }[];
  const { data: empPos } = nikRaw.length
    ? await supabase.from('employees').select('id, position_id').in('id', nikRaw.map(r => r.employee_id).filter((x): x is string => !!x))
    : { data: [] as { id: string; position_id: string | null }[] };
  const posOf = new Map((empPos ?? []).map(e => [e.id, e.position_id]));
  const nik = nikRaw;

  return (
    <>
      <PageHeader eyebrow="Administrasi" title="Pengguna & peran" />
      {nik.length > 0 && (
        <Panel title={`Pendaftar NIK (${nik.length})`}>
          <p className="mb-3 text-xs text-muted">
            Aktifkan hanya jika NIK ditemukan, tanggal lahir cocok, dan Anda yakin yang mendaftar adalah orang yang bersangkutan (konfirmasi langsung bila ragu).
            Aktivasi otomatis menautkan akun ke data karyawan.
          </p>
          <ul className="grid gap-4">
            {nik.map(r => {
              const okAll = !!r.employee_id && r.employee_status === 'active' && !r.already_linked && r.birth_match;
              return (
                <li key={r.user_id} className="grid gap-2 border-b border-line pb-4 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{r.nrp}</span>
                    <span className="text-sm">mengaku <b>{r.typed_name}</b></span>
                    <Pill tone={r.employee_id ? 'ok' : 'crit'}>{r.employee_id ? `Data: ${r.employee_name} · ${r.department ?? '–'}` : 'NIK tidak ada di data karyawan'}</Pill>
                    {r.employee_id && <Pill tone={r.birth_match ? 'ok' : 'crit'}>{!r.birth_known ? 'Tgl lahir belum diisi HRGA' : r.birth_match ? 'Tgl lahir cocok' : 'Tgl lahir TIDAK cocok'}</Pill>}
                    {r.already_linked && <Pill tone="crit">NIK sudah tertaut akun lain</Pill>}
                    {r.employee_status && r.employee_status !== 'active' && <Pill tone="crit">Karyawan tidak aktif</Pill>}
                  </div>
                  {r.user_id === s.profile.id ? <p className="text-sm text-muted">Akun sendiri harus diaktifkan administrator lain.</p> : (
                    <>
                      {okAll && (
                        <>
                          <PositionForm nik userId={r.user_id} positions={positions} access={access} defaultPosition={r.employee_id ? posOf.get(r.employee_id) : null} />
                          <details><summary className="cursor-pointer text-xs text-accent">Peran khusus (manual)</summary>
                            <div className="mt-2"><ActivateForm nik userId={r.user_id} roles={roles ?? []} departments={depts ?? []} /></div></details>
                        </>
                      )}
                      <RejectForm userId={r.user_id} />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      {pending.length > 0 && (
        <Panel title={`Menunggu aktivasi (${pending.length})`}>
          <ul className="grid gap-3">
            {pending.map(u => (
              <li key={u.id} className="grid gap-2 border-b border-line pb-3 last:border-0">
                <div><b>{u.full_name}</b> <span className="text-sm text-muted">{u.email}</span></div>
                {u.id === s.profile.id
                  ? <p className="text-sm text-muted">Akun sendiri harus diaktifkan administrator lain.</p>
                  : (
                    <>
                      <PositionForm userId={u.id} positions={positions} access={access} />
                      <details><summary className="cursor-pointer text-xs text-accent">Peran khusus (manual)</summary>
                        <div className="mt-2"><ActivateForm userId={u.id} roles={roles ?? []} departments={depts ?? []} /></div></details>
                    </>
                  )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title="Semua pengguna">
        <Table head={['Nama', 'Email', 'Peran', 'Status']}>
          {(users ?? []).map(u => {
            const [tone, label] = STATUS[u.status as keyof typeof STATUS] ?? ['muted', u.status];
            return (
              <tr key={u.id}>
                <td>{u.full_name ?? '–'}</td>
                <td className="text-sm">{isNik(u.email) ? `NIK ${u.email.split('@')[0].toUpperCase()}` : u.email}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.user_roles.length ? u.user_roles.map(r => (
                      <span key={r.role_code + (r.departments?.code ?? '')} className="rounded border border-line px-1.5 py-0.5 font-mono text-xs">
                        {r.role_code}{r.departments ? `·${r.departments.code}` : ''}
                      </span>
                    )) : <span className="text-xs text-muted">Belum ada</span>}
                  </div>
                  {u.status === 'active' && u.id !== s.profile.id && isNik(u.email) && <div className="mt-2"><ResetPasswordForm userId={u.id} /></div>}
                  {u.status === 'active' && u.id !== s.profile.id && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-accent">Tambah akses</summary>
                      <div className="mt-2 grid gap-3">
                        <PositionForm userId={u.id} positions={positions} access={access} label="Tambah akses" />
                        <details><summary className="cursor-pointer text-xs text-muted">Peran khusus (manual)</summary>
                          <div className="mt-2"><ActivateForm userId={u.id} roles={roles ?? []} departments={depts ?? []} label="Tambah peran" /></div></details>
                      </div>
                    </details>
                  )}
                </td>
                <td><Pill tone={tone}>{label}</Pill></td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </>
  );
}
