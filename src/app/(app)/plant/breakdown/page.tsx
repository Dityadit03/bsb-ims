import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { OfflineForm } from '@/components/offline-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { fmtDateTime } from '@/lib/documents';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { Files } from '../../she/fields';
import { PlantTabs } from '../tabs';
import { reportBreakdown, verifyBreakdown } from '../actions';
import { GpsFields } from './gps-fields';

export const metadata = { title: 'Breakdown di lapangan' };

type Row = { id: string; report_no: string; unit_id: string; unit_no: string; unit_type: string; wo_id: string | null; wo_no: string | null; wo_status: string | null;
  reported_at: string; reported_by: string; reporter_name: string | null; lat: number | null; lng: number | null; accuracy_m: number | null; location_note: string | null;
  hm: number; km: number | null; description: string; need_tow: boolean; status: 'reported' | 'verified' | 'rejected';
  verifier_name: string | null; verify_note: string | null; photos: { id: string; name: string }[] };

const STATUS = { reported: ['warn', 'Menunggu verifikasi'], verified: ['ok', 'Terverifikasi'], rejected: ['crit', 'Ditolak'] } as const;

export default async function BreakdownPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const s = await getSession();
  const supabase = await createClient();
  let q = supabase.from('breakdown_report_view').select('*').order('reported_at', { ascending: false }).limit(200);
  if (!sp.semua) q = q.eq('status', 'reported');
  const [{ data: rows }, { data: units }] = await Promise.all([
    q.returns<Row[]>(),
    supabase.from('units').select('unit_no, unit_type, current_hm').neq('status', 'retired').order('unit_no'),
  ]);
  const canReport = s.can('plant.report') || s.can('she.report');
  const canVerify = s.can('plant.work');

  return (
    <>
      <PageHeader eyebrow="Plant · Maintenance" title="Breakdown di lapangan">
        <Link href="/plant/wo" className="text-sm text-accent hover:underline">Work order →</Link>
      </PageHeader>
      <PlantTabs active="/plant/breakdown" />
      {canReport && (
        <Panel title="Lapor breakdown unscheduled" sub="Untuk unit yang rusak di jalan atau area kerja. Work order breakdown langsung terbuka dan tim Plant diberi tahu. Bisa dikirim saat sinyal lemah.">
          <OfflineForm action={reportBreakdown} kind="breakdown" queueTitle="Breakdown" queueField="unit" draftKey="breakdown" label="Kirim laporan" className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">No. lambung unit
                <input name="unit" required list="bd-units" autoComplete="off" className={`${input} uppercase`} placeholder="mis. DT-21" />
                <datalist id="bd-units">{(units ?? []).map(u => <option key={u.unit_no} value={u.unit_no}>{u.unit_type} · HM {u.current_hm}</option>)}</datalist></label>
              <label className="grid gap-1 text-sm">HM unit<input type="number" name="hm" required min={0} step="0.1" className={input} /></label>
              <label className="grid gap-1 text-sm">KM unit<input type="number" name="km" min={0} step="0.1" className={input} placeholder="bila ada odometer" /></label>
            </div>
            <GpsFields />
            <label className="grid gap-1 text-sm">Keterangan lokasi<input name="location_note" className={input} placeholder="mis. KM 12 jalan hauling, dekat pos 3 (wajib bila GPS belum terbaca)" /></label>
            <label className="grid gap-1 text-sm">Kerusakan / gejala<textarea name="description" required rows={3} className={input} placeholder="Apa yang terjadi, suara / indikator, sejak kapan" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="need_tow" className="size-4" /> Unit tidak bisa jalan, perlu ditarik</label>
            <Files label="Foto kerusakan (wajib)" />
          </OfflineForm>
        </Panel>
      )}
      <Panel title={sp.semua ? 'Semua laporan' : 'Menunggu verifikasi Plant'} action={
        <Link href={sp.semua ? '/plant/breakdown' : '/plant/breakdown?semua=1'} className="text-sm text-accent hover:underline">{sp.semua ? 'Hanya yang menunggu' : 'Lihat semua'}</Link>}>
        {rows?.length ? (
          <Table head={['Laporan', 'Unit', 'Kerusakan', 'Lokasi', 'HM / KM', 'Foto', 'Status', '']}>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-mono text-xs">{r.report_no}<div className="text-muted">{fmtDateTime(r.reported_at)}</div><div className="text-muted">{r.reporter_name}</div></td>
                <td className="font-mono text-xs"><Link href={`/plant/${r.unit_id}`} className="hover:text-accent">{r.unit_no}</Link>{r.wo_id && <div><Link href={`/plant/wo/${r.wo_id}`} className="text-accent">{r.wo_no}</Link></div>}</td>
                <td className="max-w-xs text-sm">{r.description}{r.need_tow && <div><Pill tone="crit">Perlu ditarik</Pill></div>}</td>
                <td className="text-xs">{r.location_note}
                  {r.lat != null && r.lng != null && <div><a href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">Buka peta ↗</a>{r.accuracy_m != null && <span className="text-muted"> ±{Math.round(r.accuracy_m)} m</span>}</div>}</td>
                <td className="tabular text-xs">{r.hm}{r.km != null && <> / {r.km}</>}</td>
                <td className="text-xs">{r.photos.map(f => <a key={f.id} href={`/api/lampiran/${f.id}`} target="_blank" className="mr-1 rounded border border-line px-1.5 hover:border-accent">Foto</a>)}</td>
                <td><Pill tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Pill>{r.verifier_name && <div className="mt-1 text-xs text-muted">{r.verifier_name}{r.verify_note && ` · ${r.verify_note}`}</div>}</td>
                <td>
                  {r.status === 'reported' && canVerify && r.reported_by !== s.profile.id && (
                    <div className="grid gap-2">
                      <ActionForm action={verifyBreakdown} label="Verifikasi" primary hidden={{ id: r.id, decision: 'ok' }}>
                        <input name="note" className={input} placeholder="Catatan (opsional)" />
                      </ActionForm>
                      <ActionForm action={verifyBreakdown} label="Tolak" hidden={{ id: r.id, decision: 'reject' }}>
                        <input name="note" required className={input} placeholder="Alasan penolakan" />
                      </ActionForm>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">{sp.semua ? 'Belum ada laporan breakdown.' : 'Tidak ada laporan yang menunggu verifikasi.'}</p>}
      </Panel>
    </>
  );
}
