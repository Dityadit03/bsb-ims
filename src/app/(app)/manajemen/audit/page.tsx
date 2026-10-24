import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { AUDIT_STATUS } from '@/lib/management';
import { planAudit } from '../actions';
import { MgmtTabs } from '../tabs';
import { sheMasters, today } from '../../she/fields';

export const metadata = { title: 'Audit internal' };

type Row = { id: string; audit_no: string; title: string; department_code: string | null; planned_start: string; planned_end: string; status: string;
  lead_name: string; major: number; minor: number; observations: number; without_capa: number };

export default async function AuditPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: rows }, { depts }, { data: people }] = await Promise.all([
    supabase.from('audit_register').select('*').order('planned_start', { ascending: false }).limit(200).returns<Row[]>(),
    sheMasters(),
    supabase.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name'),
  ]);

  return (
    <>
      <PageHeader eyebrow="SMKP 5.6 · Audit internal" title="Audit internal" />
      <MgmtTabs active="/manajemen/audit" />
      {rows?.length ? (
        <Table head={['Nomor', 'Judul', 'Auditee', 'Jadwal', 'Ketua tim', 'Temuan', 'Status']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs"><Link href={`/manajemen/audit/${r.id}`} className="font-medium hover:text-accent">{r.audit_no}</Link></td>
              <td className="text-sm"><Link href={`/manajemen/audit/${r.id}`} className="hover:text-accent">{r.title}</Link></td>
              <td className="text-xs">{r.department_code ?? 'Seluruh site'}</td>
              <td className="whitespace-nowrap text-xs">{fmtDate(r.planned_start)} – {fmtDate(r.planned_end)}</td>
              <td className="text-xs">{r.lead_name}</td>
              <td className="text-xs">{r.major} mayor · {r.minor} minor · {r.observations} lain
                {r.without_capa > 0 && <div className="text-crit">{r.without_capa} tanpa action plan</div>}</td>
              <td><Pill tone={AUDIT_STATUS[r.status][0]}>{AUDIT_STATUS[r.status][1]}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada audit internal.</p>}
      {s.can('ia.manage') && (
        <Panel title="Rencanakan audit">
          <ActionForm action={planAudit} label="Simpan & terbitkan nomor AUD" primary hidden={{ idem: randomUUID() }} className="max-w-4xl">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">Judul<input name="title" required className={input} placeholder="mis. Audit SMKP semester II – Produksi" /></label>
              <label className="grid gap-1 text-sm">Departemen auditee
                <select name="department" className={input} defaultValue=""><option value="">Seluruh site</option>{depts.map(d => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}</select></label>
            </div>
            <label className="grid gap-1 text-sm">Lingkup & kriteria<textarea name="scope" required rows={2} className={input} placeholder="Elemen/sub-elemen SMKP, lokasi, proses" /></label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Mulai<input type="date" name="start" required defaultValue={today()} className={input} /></label>
              <label className="grid gap-1 text-sm">Selesai<input type="date" name="end" required defaultValue={today()} className={input} /></label>
              <label className="grid gap-1 text-sm">Ketua tim
                <select name="lead" required className={input} defaultValue=""><option value="" disabled>Pilih</option>{(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}</select></label>
            </div>
            <label className="grid gap-1 text-sm">Anggota tim (tahan Ctrl / ⌘ untuk memilih banyak)
              <select name="members" multiple size={6} className={input}>{(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}</select></label>
            <p className="text-xs text-muted">Auditor harus berwenang (auditor internal, HSE Manager, Dept Head, Superintendent) dan tidak memegang peran di departemen auditee.</p>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
