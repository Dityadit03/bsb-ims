import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { FLOWS, ROLE_LABEL } from '@/lib/approval';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { designate, fillSupervisors, undesignate } from './actions';

export const metadata = { title: 'Alur persetujuan' };

type Chain = { id: string; role_code: string; department: string | null; employee_id: string; nrp: string; full_name: string; position: string | null; has_account: boolean };

export default async function AlurPersetujuanPage() {
  const s = await getSession();
  const admin = s.can('user.manage');
  const supabase = await createClient();
  const [{ data: chain }, { data: depts }, { data: emps }, { count: noSup }] = await Promise.all([
    supabase.from('approval_chain').select('*').order('role_code').order('department').returns<Chain[]>(),
    supabase.from('departments').select('id, code, name').order('sort_order'),
    admin ? supabase.from('employees').select('id, nrp, full_name, departments(code), positions(name)').eq('status', 'active').order('full_name').limit(500) : Promise.resolve({ data: [] }),
    supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'active').is('supervisor_id', null),
  ]);
  const rows = chain ?? [];
  const holders = (role?: string, dept?: string) => rows.filter(r => r.role_code === role && (!dept || r.department === dept));

  const who = (role?: string, dept?: string) => {
    if (!role) return <span className="text-muted">—</span>;
    const list = holders(role, dept);
    if (list.length === 0) return <Pill tone="crit">Belum ditunjuk</Pill>;
    return (
      <ul className="grid gap-0.5">
        {list.map(r => (
          <li key={r.id}>{r.full_name} <span className="text-xs text-muted">{r.position ?? ''}</span>
            {!r.has_account && <> <Pill tone="warn">Belum punya akun</Pill></>}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <>
      <PageHeader eyebrow="Administrasi" title="Alur persetujuan" />
      <p className="max-w-3xl text-sm text-muted">
        Siapa yang menyetujui tiap langkah, menurut penunjukan pejabat pada data manpower. Peran diberikan ke karyawan; begitu karyawan punya akun,
        perannya aktif otomatis, dan dicabut bila penunjukan dihapus atau karyawan keluar.
      </p>

      {FLOWS.map(f => (
        <Panel key={f.name} title={f.name}>
          <Table head={['Langkah', 'Peran', 'Pejabat']}>
            {f.steps.map((st, i) => {
              const dept = st.dept === 'own' ? undefined : st.dept;
              return (
                <tr key={i}>
                  <td>{i + 1}. {st.label}{st.note && <span className="block text-xs text-muted">{st.note}</span>}</td>
                  <td>{st.role ? <>{ROLE_LABEL[st.role] ?? st.role}{st.dept === 'own' ? <span className="text-xs text-muted"> · departemen peminta</span> : st.dept ? <span className="text-xs text-muted"> · {st.dept}</span> : null}</> : '—'}</td>
                  <td>{st.dept === 'own'
                    ? <span className="text-xs text-muted">Sesuai departemen (lihat daftar di bawah)</span>
                    : who(st.role, dept)}</td>
                </tr>
              );
            })}
          </Table>
        </Panel>
      ))}

      <Panel title="Daftar pejabat yang ditunjuk" sub={`${(noSup ?? 0)} karyawan aktif belum punya atasan langsung`}>
        <Table head={['Peran', 'Departemen', 'Pejabat', 'Akun', admin ? 'Aksi' : '']}>
          {rows.length === 0 && <tr><td colSpan={5} className="text-muted">Belum ada penunjukan.</td></tr>}
          {rows.map(r => (
            <tr key={r.id}>
              <td>{ROLE_LABEL[r.role_code] ?? r.role_code}</td>
              <td>{r.department ?? 'Semua'}</td>
              <td>{r.full_name}<span className="block text-xs text-muted">{r.nrp} · {r.position ?? '—'}</span></td>
              <td>{r.has_account ? <Pill tone="ok">Aktif</Pill> : <Pill tone="warn">Belum ada</Pill>}</td>
              <td>{admin && <ActionForm action={undesignate} label="Cabut" hidden={{ id: r.id }} confirm={`Cabut penunjukan ${r.full_name}?`} />}</td>
            </tr>
          ))}
        </Table>
      </Panel>

      {admin && (
        <>
          <Panel title="Tunjuk pejabat">
            <ActionForm action={designate} label="Simpan penunjukan" primary className="sm:grid-cols-2">
              <label className="grid gap-1 text-sm">Karyawan
                <select id="ap-employee" name="employee" className={input} required defaultValue="">
                  <option value="" disabled>Pilih karyawan</option>
                  {(emps ?? []).map((e: { id: string; nrp: string; full_name: string; departments: { code: string } | { code: string }[] | null; positions: { name: string } | { name: string }[] | null }) => {
                    const d = Array.isArray(e.departments) ? e.departments[0] : e.departments;
                    const p = Array.isArray(e.positions) ? e.positions[0] : e.positions;
                    return <option key={e.id} value={e.id}>{e.full_name} · {d?.code ?? '—'} · {p?.name ?? '—'}</option>;
                  })}
                </select>
              </label>
              <label className="grid gap-1 text-sm">Peran
                <select id="ap-role" name="role" className={input} required defaultValue="DEPT_HEAD">
                  {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">Departemen (kosongkan untuk PJO / Management / Document Controller)
                <select id="ap-dept" name="department" className={input} defaultValue="">
                  <option value="">Semua</option>
                  {(depts ?? []).map(d => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">Dasar penunjukan
                <input id="ap-basis" name="basis" className={input} placeholder="mis. SK No. 012/BSB/2026" />
              </label>
            </ActionForm>
          </Panel>
          <Panel title="Atasan langsung" sub="Mengisi atasan yang masih kosong: SPV / Foreman / Suptend ke Kepala Departemen, Kepala Departemen ke PJO. Operator dan staf diatur HRGA per orang.">
            <ActionForm action={fillSupervisors} label="Isi atasan langsung otomatis" confirm="Isi atasan langsung yang masih kosong dari penunjukan pejabat?" />
          </Panel>
        </>
      )}
    </>
  );
}
