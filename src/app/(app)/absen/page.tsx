import Link from 'next/link';
import { PageHeader, Panel, Pill } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { ATT_SOURCE, ATT_STATUS, ROSTER, fmtTime, siteToday } from '@/lib/hrga';
import { ClockForm } from './clock-form';

export const metadata = { title: 'Absen' };

type Log = { id: string; at: string; kind: string; source: string; in_geofence: boolean | null; distance_m: number | null; location_id: string | null };

export default async function AbsenPage() {
  const { profile } = await getSession();
  const supabase = await createClient();
  const today = siteToday();
  const { data: me } = await supabase.from('employees').select('id, nrp, full_name').eq('profile_id', profile.id).eq('status', 'active').maybeSingle();
  if (!me) {
    return (
      <>
        <PageHeader eyebrow="Kehadiran" title="Absen" />
        <Panel><p className="text-sm">Akun Anda belum ditautkan ke data karyawan. Minta HRGA mengisi email akun Anda di data karyawan.</p></Panel>
      </>
    );
  }
  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const [{ data: day }, { data: logs }, { data: setting }, { data: locs }] = await Promise.all([
    supabase.from('attendance_daily').select('work_date, roster_code, start_at, end_at, clock_in, clock_out, status, late_minutes')
      .eq('employee_id', me.id).lte('work_date', today).order('work_date', { ascending: false }).limit(2),
    supabase.from('attendance_logs').select('id, at, kind, source, in_geofence, distance_m, location_id').eq('employee_id', me.id)
      .gte('at', since).order('at', { ascending: false }).returns<Log[]>(),
    supabase.from('app_settings').select('value').eq('key', 'attendance_require_photo').maybeSingle(),
    supabase.from('attendance_locations').select('id, name').eq('active', true),
  ]);
  // shift malam kemarin yang belum pulang tetap jadi hari kerja aktif
  const cur = (day ?? []).find(d => d.work_date === today) ?? null;
  const prev = (day ?? []).find(d => d.work_date !== today && d.roster_code === 'N' && d.clock_in && !d.clock_out) ?? null;
  const active = prev ?? cur;
  const next = active?.clock_in && !active.clock_out ? 'out' : 'in';
  const locName = new Map((locs ?? []).map(l => [l.id, l.name]));

  return (
    <>
      <PageHeader eyebrow="Kehadiran" title="Absen" />
      <div className="mx-auto grid w-full max-w-md gap-4">
        <Panel>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">{me.full_name}</div>
              <div className="font-mono text-xs text-muted">{me.nrp}</div>
            </div>
            <div className="text-right text-sm">
              <div>{fmtDate(active?.work_date ?? today)}</div>
              {active?.roster_code ? <Pill tone={ROSTER[active.roster_code]?.[0] ?? 'muted'}>{ROSTER[active.roster_code]?.[1] ?? active.roster_code}
                {active.start_at && ` · ${fmtTime(active.start_at)}–${fmtTime(active.end_at)}`}</Pill>
                : <span className="text-xs text-muted">Belum ada roster</span>}
            </div>
          </div>
          {active?.clock_in && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-lg bg-ground p-2"><div className="text-xs text-muted">Masuk</div><div className="tabular font-semibold">{fmtTime(active.clock_in)}</div></div>
              <div className="rounded-lg bg-ground p-2"><div className="text-xs text-muted">Pulang</div><div className="tabular font-semibold">{fmtTime(active.clock_out)}</div></div>
              <div className="rounded-lg bg-ground p-2"><div className="text-xs text-muted">Status</div>
                <Pill tone={ATT_STATUS[active.status]?.[0] ?? 'muted'}>{ATT_STATUS[active.status]?.[1] ?? active.status}</Pill></div>
            </div>
          )}
        </Panel>
        <Panel><ClockForm next={next} requirePhoto={setting?.value !== false} /></Panel>
        <Panel title="Riwayat 36 jam terakhir">
          {logs?.length ? (
            <ul className="grid gap-2 text-sm">
              {logs.map(l => (
                <li key={l.id} className="flex items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
                  <span><span className="tabular font-semibold">{fmtTime(l.at)}</span> · {l.kind === 'in' ? 'Masuk' : l.kind === 'out' ? 'Pulang' : 'Sentuh'}
                    <span className="block text-xs text-muted">{ATT_SOURCE[l.source]}{l.location_id && ` · ${locName.get(l.location_id) ?? ''} (${l.distance_m} m)`}</span></span>
                  {l.in_geofence === false && <Pill tone="warn">Di luar radius</Pill>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Belum ada absen.</p>}
          <Link href="/saya?tab=absen" className="mt-3 inline-block text-sm text-violet underline underline-offset-2">Lihat rekap kehadiran saya</Link>
        </Panel>
      </div>
    </>
  );
}
