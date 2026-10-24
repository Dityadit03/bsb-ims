import Link from 'next/link';
import { ExportLinks } from '@/components/export-links';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Stat, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/documents';
import { INCIDENT_CLASS, INCIDENT_STATUS } from '@/lib/she';
import { reportIncident } from '../actions';
import { AreaSelect, DeptSelect, Files, SheTabs, sheMasters } from '../fields';

export const metadata = { title: 'Insiden' };

type Row = {
  id: string; incident_no: string; occurred_at: string; classification: string; status: string; chronology: string; unit_no: string | null;
  work_area_name: string | null; location_note: string | null; department_code: string; late_report: boolean; capa_count: number;
};

export default async function IncidentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const year = new Date().getFullYear();
  let q = supabase.from('incident_register').select('*').order('occurred_at', { ascending: false }).limit(200);
  if (!sp.semua) q = q.neq('status', 'closed');
  const [{ data: rows }, { data: ytd }, { depts, areas }] = await Promise.all([
    q.returns<Row[]>(),
    supabase.from('incidents').select('classification').gte('occurred_at', `${year}-01-01`).returns<{ classification: string }[]>(),
    sheMasters(),
  ]);
  const n = (c: string[]) => (ytd ?? []).filter(x => c.includes(x.classification)).length;
  const nowLocal = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16);

  return (
    <>
      <PageHeader eyebrow="SMKP 5.4 · Penyelidikan kecelakaan" title="Insiden"><ExportLinks dataset="insiden" /></PageHeader>
      <SheTabs active="/she/insiden" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={`Nearmiss ${year}`} value={n(['nearmiss'])} />
        <Stat label={`First aid / MTI ${year}`} value={n(['first_aid', 'mti'])} />
        <Stat label={`LTI / fatality ${year}`} value={n(['lti', 'fatality'])} />
        <Stat label={`Property / lingkungan ${year}`} value={n(['property_damage', 'environmental'])} />
      </div>
      {s.can('she.report') && (
        <Panel title="Lapor insiden & nearmiss">
          <ActionForm action={reportIncident} label="Kirim laporan awal" primary hidden={{ idem: randomUUID() }} className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Waktu kejadian (WITA)<input type="datetime-local" name="occurred" required max={nowLocal} className={input} /></label>
              <label className="grid gap-1 text-sm">Klasifikasi awal
                <select name="classification" className={input}>{Object.entries(INCIDENT_CLASS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <DeptSelect label="Departemen terlibat" depts={depts} value={s.profile.department_id} />
              <AreaSelect areas={areas} />
              <label className="grid gap-1 text-sm">Detail lokasi<input name="location" className={input} /></label>
              <label className="grid gap-1 text-sm">Unit terlibat<input name="unit" className={input} /></label>
            </div>
            <label className="grid gap-1 text-sm">Karyawan terlibat<input name="involved" className={input} placeholder="Nama, NIK" /></label>
            <label className="grid gap-1 text-sm">Kronologi<textarea name="chronology" required rows={4} className={input} /></label>
            <label className="grid gap-1 text-sm">Tindakan segera<textarea name="immediate" rows={2} className={input} /></label>
            <label className="grid gap-1 text-sm">Alasan keterlambatan (jika lebih dari 24 jam)<input name="late_reason" className={input} /></label>
            <Files label="Foto / dokumen" />
          </ActionForm>
        </Panel>
      )}
      <div className="flex gap-3 text-sm"><Link href="/she/insiden" className={sp.semua ? 'text-muted' : 'font-medium text-accent'}>Belum ditutup</Link>
        <Link href="/she/insiden?semua=1" className={sp.semua ? 'font-medium text-accent' : 'text-muted'}>Semua</Link></div>
      {rows?.length ? (
        <Table head={['Nomor', 'Waktu', 'Klasifikasi', 'Kronologi', 'Lokasi', 'Dept', 'Action plan', 'Status']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs"><Link href={`/she/insiden/${r.id}`} className="font-medium hover:text-accent">{r.incident_no}</Link>
                {r.late_report && <div className="text-crit">terlambat</div>}</td>
              <td className="tabular whitespace-nowrap text-xs">{fmtDateTime(r.occurred_at)}</td>
              <td><Pill tone={INCIDENT_CLASS[r.classification][0]}>{INCIDENT_CLASS[r.classification][1]}</Pill></td>
              <td className="min-w-64"><Link href={`/she/insiden/${r.id}`} className="line-clamp-2 hover:text-accent">{r.chronology}</Link></td>
              <td className="text-xs">{r.work_area_name}{r.location_note ? ` · ${r.location_note}` : ''}{r.unit_no && <div className="text-muted">{r.unit_no}</div>}</td>
              <td className="font-mono text-xs">{r.department_code}</td>
              <td className="tabular text-xs">{r.capa_count}</td>
              <td><Pill tone={INCIDENT_STATUS[r.status][0]}>{INCIDENT_STATUS[r.status][1]}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Tidak ada insiden untuk saringan ini.</p>}
    </>
  );
}
