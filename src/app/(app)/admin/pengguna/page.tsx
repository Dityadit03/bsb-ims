import { PageHeader, Panel, Pill, Table } from '@/components/ui';
import { requirePermission } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { ActivateForm } from './activate-form';

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
  const [{ data: users }, { data: roles }, { data: depts }] = await Promise.all([
    supabase.from('profiles')
      .select('id, email, full_name, status, created_at, departments(code), user_roles!user_roles_user_id_fkey(role_code, valid_until, departments(code))')
      .order('status').order('email').returns<Row[]>(),
    supabase.from('roles').select('code, name').order('code'),
    supabase.from('departments').select('id, code, name').order('sort_order'),
  ]);
  const pending = (users ?? []).filter(u => u.status === 'pending');

  return (
    <>
      <PageHeader eyebrow="Administrasi" title="Pengguna & peran" />
      {pending.length > 0 && (
        <Panel title={`Menunggu aktivasi (${pending.length})`}>
          <ul className="grid gap-3">
            {pending.map(u => (
              <li key={u.id} className="grid gap-2 border-b border-line pb-3 last:border-0">
                <div><b>{u.full_name}</b> <span className="text-sm text-muted">{u.email}</span></div>
                {u.id === s.profile.id
                  ? <p className="text-sm text-muted">Akun sendiri harus diaktifkan administrator lain.</p>
                  : <ActivateForm userId={u.id} roles={roles ?? []} departments={depts ?? []} />}
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
                <td className="text-sm">{u.email}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.user_roles.length ? u.user_roles.map(r => (
                      <span key={r.role_code + (r.departments?.code ?? '')} className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px]">
                        {r.role_code}{r.departments ? `·${r.departments.code}` : ''}
                      </span>
                    )) : <span className="text-xs text-muted">Belum ada</span>}
                  </div>
                  {u.status === 'active' && u.id !== s.profile.id && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-accent">Tambah peran</summary>
                      <div className="mt-2"><ActivateForm userId={u.id} roles={roles ?? []} departments={depts ?? []} label="Tambah peran" /></div>
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
