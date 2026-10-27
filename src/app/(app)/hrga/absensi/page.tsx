import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { ExportLinks } from '@/components/export-links';
import { Tabs } from '@/components/tabs';
import { PageHeader, Pager, Panel, Pill, Stat, Table, input, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { ATT_STATUS, ROSTER, fmtTime, siteToday } from '@/lib/hrga';
import { EmployeeDatalist, EmployeeInput } from '../../she/fields';
import { manualAttendance, saveLocation, saveShift, setHoliday } from '../waktu-actions';
import { HrTabs } from '../tabs';

export const metadata = { title: 'Absensi' };

type Day = { employee_id: string; nrp: string; full_name: string; department_code: string; work_date: string; roster_code: string | null;
  holiday_name: string | null; start_at: string | null; clock_in: string | null; clock_out: string | null; punches: number | null;
  outside_geofence: boolean; late_minutes: number; early_minutes: number; worked_hours: number | null; missing_out: boolean; status: string };

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export default async function AbsensiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const isHr = session.canIn('hr.manage', 'HRGA');
  const supabase = await createClient();
  const tab = sp.tab === 'rekap' || sp.tab === 'pengaturan' ? sp.tab : 'harian';
  const date = sp.tgl && /^\d{4}-\d{2}-\d{2}$/.test(sp.tgl) ? sp.tgl : siteToday();
  const month = sp.bln && /^\d{4}-\d{2}$/.test(sp.bln) ? sp.bln : siteToday().slice(0, 7);
  const base = (p: Record<string, string>) => `/hrga/absensi?${new URLSearchParams({ tab, ...(sp.dept ? { dept: sp.dept } : {}), ...p })}`;

  return (
    <>
      <PageHeader eyebrow="Time management" title="Absensi"><ExportLinks dataset="absensi" /></PageHeader>
      <HrTabs active="/hrga/absensi" />
      <Tabs items={[[`/hrga/absensi?tab=harian&tgl=${date}`, 'Harian'], [`/hrga/absensi?tab=rekap&bln=${month}`, 'Rekap bulanan'], ['/hrga/absensi?tab=pengaturan', 'Lokasi, shift & libur']]}
        active={tab === 'harian' ? `/hrga/absensi?tab=harian&tgl=${date}` : tab === 'rekap' ? `/hrga/absensi?tab=rekap&bln=${month}` : '/hrga/absensi?tab=pengaturan'} />
      {tab === 'harian' && <Daily date={date} sp={sp} base={base} supabase={supabase} />}
      {tab === 'rekap' && <Monthly month={month} sp={sp} supabase={supabase} />}
      {tab === 'pengaturan' && <Settings isHr={isHr} supabase={supabase} />}
    </>
  );
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function Daily({ date, sp, base, supabase }: { date: string; sp: Record<string, string | undefined>; base: (p: Record<string, string>) => string; supabase: Client }) {
  const { data } = await supabase.from('attendance_daily').select('*').eq('work_date', date).order('full_name').limit(5000).returns<Day[]>();
  const all = data ?? [];
  let rows = all;
  if (sp.dept) rows = rows.filter(r => r.department_code === sp.dept);
  if (sp.status) rows = rows.filter(r => r.status === sp.status);
  const pg = paginate(rows, sp.hal);
  const depts = [...new Set(all.map(r => r.department_code))].sort();
  const n = (s: string) => all.filter(r => r.status === s).length;
  const scheduled = all.filter(r => r.roster_code === 'D' || r.roster_code === 'N');
  const present = scheduled.filter(r => r.clock_in).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={base({ tgl: addDays(date, -1) })} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-violet/60" aria-label="Hari sebelumnya">‹</Link>
        <form className="flex gap-2"><input type="hidden" name="tab" value="harian" />
          <input type="date" name="tgl" defaultValue={date} className={`${input} !w-auto`} />
          <select name="dept" defaultValue={sp.dept ?? ''} className={`${input} max-w-40`}><option value="">Semua dept</option>{depts.map(d => <option key={d}>{d}</option>)}</select>
          <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Lihat</button></form>
        <Link href={base({ tgl: addDays(date, 1) })} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-violet/60" aria-label="Hari berikutnya">›</Link>
        <span className="text-sm text-muted">{fmtDate(date)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Kehadiran terjadwal" value={scheduled.length ? `${Math.round((present / scheduled.length) * 100)}%` : '–'} note={`${present} dari ${scheduled.length} roster D/N`}
          tone={scheduled.length && present / scheduled.length < 0.9 ? 'warn' : 'ok'} />
        <Stat label="Terlambat" value={n('terlambat')} tone={n('terlambat') ? 'warn' : undefined} href={base({ tgl: date, status: 'terlambat' })} />
        <Stat label="Alpa" value={n('alpa')} tone={n('alpa') ? 'crit' : undefined} href={base({ tgl: date, status: 'alpa' })} />
        <Stat label="Cuti / sakit / izin" value={n('cuti') + n('sakit') + n('izin')} />
        <Stat label="Lupa absen pulang" value={all.filter(r => r.missing_out).length} tone={all.some(r => r.missing_out) ? 'warn' : undefined} />
        <Stat label="Di luar radius" value={all.filter(r => r.outside_geofence).length} tone={all.some(r => r.outside_geofence) ? 'warn' : undefined} />
      </div>
      <Panel title={sp.status ? `Status: ${ATT_STATUS[sp.status]?.[1] ?? sp.status}` : 'Kehadiran harian'}
        action={sp.status ? <Link href={base({ tgl: date })} className="text-sm text-violet underline">Semua status</Link> : undefined}>
        {rows.length ? (
          <>
            <Table head={['Karyawan', 'Dept', 'Roster', 'Masuk', 'Pulang', 'Jam kerja', 'Status']}>
              {pg.rows.map(r => (
                <tr key={r.employee_id}>
                  <td><Link href={`/hrga/${r.employee_id}`} className="font-medium hover:text-accent">{r.full_name}</Link><span className="block font-mono text-xs text-muted">{r.nrp}</span></td>
                  <td className="text-xs">{r.department_code}</td>
                  <td>{r.roster_code ? <Pill tone={ROSTER[r.roster_code]?.[0] ?? 'muted'}>{ROSTER[r.roster_code]?.[1] ?? r.roster_code}</Pill> : <span className="text-xs text-muted">{r.holiday_name ?? '–'}</span>}</td>
                  <td className="tabular text-sm">{fmtTime(r.clock_in)}{r.late_minutes > 0 && <span className="block text-xs text-warn">+{r.late_minutes} mnt</span>}</td>
                  <td className="tabular text-sm">{fmtTime(r.clock_out)}{r.early_minutes > 0 && <span className="block text-xs text-warn">−{r.early_minutes} mnt</span>}
                    {r.missing_out && <span className="block text-xs text-crit">belum pulang</span>}</td>
                  <td className="tabular text-sm">{r.worked_hours ?? '–'}</td>
                  <td className="whitespace-nowrap"><Pill tone={ATT_STATUS[r.status]?.[0] ?? 'muted'}>{ATT_STATUS[r.status]?.[1] ?? r.status}</Pill>
                    {r.outside_geofence && <span className="ml-1"><Pill tone="warn">luar radius</Pill></span>}</td>
                </tr>
              ))}
            </Table>
            <Pager {...pg} params={{ tab: 'harian', tgl: date, dept: sp.dept, status: sp.status }} />
          </>
        ) : <p className="text-sm text-muted">Belum ada roster atau absen pada tanggal ini. Isi roster di tab Roster, atau impor data mesin fingerprint lewat <Link href="/data/impor" className="text-violet underline">Impor data</Link>.</p>}
      </Panel>
      <Panel title="Koreksi absen" sub="Lupa absen atau mesin rusak. Oleh atasan langsung, atasan departemen, atau HRGA; keterangan wajib dan tercatat di audit trail.">
        <EmployeeDatalist />
        <ActionForm action={manualAttendance} label="Catat koreksi" className="md:grid-cols-4 md:items-end">
          <EmployeeInput required />
          <label className="grid gap-1 text-sm">Waktu<input type="datetime-local" name="at" required defaultValue={`${date}T06:00`} className={input} /></label>
          <label className="grid gap-1 text-sm">Jenis<select name="kind" className={input}><option value="in">Masuk</option><option value="out">Pulang</option></select></label>
          <label className="grid gap-1 text-sm">Keterangan<input name="note" required placeholder="mis. mesin fingerprint mati" className={input} /></label>
        </ActionForm>
      </Panel>
    </>
  );
}

async function Monthly({ month, sp, supabase }: { month: string; sp: Record<string, string | undefined>; supabase: Client }) {
  const from = `${month}-01`;
  const to = addDays(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10), -1);
  const { data } = await supabase.from('attendance_daily').select('employee_id, nrp, full_name, department_code, status, late_minutes, worked_hours, roster_code')
    .gte('work_date', from).lte('work_date', to < siteToday() ? to : siteToday()).limit(20000).returns<Day[]>();
  type Agg = { id: string; nrp: string; name: string; dept: string; sched: number; c: Record<string, number>; late: number; hours: number };
  const map = new Map<string, Agg>();
  for (const r of data ?? []) {
    const a = map.get(r.employee_id) ?? { id: r.employee_id, nrp: r.nrp, name: r.full_name, dept: r.department_code, sched: 0, c: {}, late: 0, hours: 0 };
    a.c[r.status] = (a.c[r.status] ?? 0) + 1;
    if (r.roster_code === 'D' || r.roster_code === 'N') a.sched++;
    a.late += r.late_minutes ?? 0; a.hours += Number(r.worked_hours ?? 0);
    map.set(r.employee_id, a);
  }
  let rows = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  const depts = [...new Set(rows.map(r => r.dept))].sort();
  if (sp.dept) rows = rows.filter(r => r.dept === sp.dept);
  const pg = paginate(rows, sp.hal);
  const att = (a: Agg) => (a.sched ? Math.round((((a.c.hadir ?? 0) + (a.c.terlambat ?? 0)) / a.sched) * 100) : null);

  return (
    <Panel title={`Rekap ${new Date(`${from}T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`}
      sub="Dasar perhitungan payroll: hari hadir, alpa, cuti, dan total menit terlambat per karyawan"
      action={<form className="flex gap-2"><input type="hidden" name="tab" value="rekap" />
        <input type="month" name="bln" defaultValue={month} className={`${input} !w-auto`} />
        <select name="dept" defaultValue={sp.dept ?? ''} className={`${input} max-w-36`}><option value="">Semua dept</option>{depts.map(d => <option key={d}>{d}</option>)}</select>
        <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Lihat</button></form>}>
      {rows.length ? (
        <>
          <Table head={['Karyawan', 'Dept', 'Jadwal', 'Hadir', 'Terlambat', 'Alpa', 'Cuti', 'Sakit', 'Izin', 'Menit telat', 'Jam kerja', 'Kehadiran']}>
            {pg.rows.map(a => {
              const p = att(a);
              return (
                <tr key={a.id}>
                  <td><Link href={`/hrga/${a.id}`} className="font-medium hover:text-accent">{a.name}</Link><span className="block font-mono text-xs text-muted">{a.nrp}</span></td>
                  <td className="text-xs">{a.dept}</td>
                  {[a.sched, a.c.hadir, a.c.terlambat, a.c.alpa, a.c.cuti, a.c.sakit, a.c.izin, a.late, Math.round(a.hours)].map((v, i) => (
                    <td key={i} className={`tabular text-sm ${i === 3 && v ? 'font-semibold text-crit' : ''}`}>{v || '–'}</td>
                  ))}
                  <td>{p == null ? '–' : <Pill tone={p >= 95 ? 'ok' : p >= 85 ? 'warn' : 'crit'}>{p}%</Pill>}</td>
                </tr>
              );
            })}
          </Table>
          <Pager {...pg} params={{ tab: 'rekap', bln: month, dept: sp.dept }} />
        </>
      ) : <p className="text-sm text-muted">Belum ada data absensi pada bulan ini.</p>}
    </Panel>
  );
}

async function Settings({ isHr, supabase }: { isHr: boolean; supabase: Client }) {
  const year = siteToday().slice(0, 4);
  const [{ data: locs }, { data: shifts }, { data: hols }] = await Promise.all([
    supabase.from('attendance_locations').select('*').order('name'),
    supabase.from('work_shifts').select('*').order('code'),
    supabase.from('holidays').select('*').gte('holiday_date', `${year}-01-01`).order('holiday_date'),
  ]);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Lokasi absen (geofence)" sub="Absen dari aplikasi dibandingkan dengan lokasi aktif terdekat. Ambil koordinat dari Google Maps (klik kanan → salin koordinat).">
        {locs?.length ? (
          <Table head={['Lokasi', 'Koordinat', 'Radius', 'Status']}>
            {locs.map(l => (
              <tr key={l.id}>
                <td className="font-medium">{l.name}</td>
                <td className="tabular text-xs"><a href={`https://maps.google.com/?q=${l.lat},${l.lng}`} target="_blank" rel="noreferrer" className="hover:text-accent">{l.lat}, {l.lng}</a></td>
                <td className="tabular text-sm">{l.radius_m} m</td>
                <td>{isHr ? <ActionForm action={saveLocation} label={l.active ? 'Nonaktifkan' : 'Aktifkan'}
                  hidden={{ id: l.id, name: l.name, lat: String(l.lat), lng: String(l.lng), radius: String(l.radius_m), active: String(!l.active) }} />
                  : <Pill tone={l.active ? 'ok' : 'muted'}>{l.active ? 'Aktif' : 'Nonaktif'}</Pill>}</td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada lokasi; absen aplikasi tetap tercatat tanpa pengecekan radius.</p>}
        {isHr && (
          <ActionForm action={saveLocation} label="Tambah lokasi" className="mt-3 md:grid-cols-4 md:items-end">
            <label className="grid gap-1 text-sm">Nama<input name="name" required placeholder="Office BDA" className={input} /></label>
            <label className="grid gap-1 text-sm">Latitude<input name="lat" required inputMode="decimal" placeholder="-1.234567" className={input} /></label>
            <label className="grid gap-1 text-sm">Longitude<input name="lng" required inputMode="decimal" placeholder="116.123456" className={input} /></label>
            <label className="grid gap-1 text-sm">Radius (m)<input name="radius" type="number" defaultValue={300} className={input} /></label>
          </ActionForm>
        )}
      </Panel>
      <Panel title="Shift kerja" sub="Toleransi terlambat dihitung dari jam mulai shift">
        <div className="grid gap-3">
          {(shifts ?? []).map(s => isHr ? (
            <ActionForm key={s.code} action={saveShift} label="Simpan" hidden={{ code: s.code }} className="grid-cols-2 md:grid-cols-5 md:items-end">
              <label className="grid gap-1 text-sm">Shift {s.code}<input name="name" defaultValue={s.name} className={input} /></label>
              <label className="grid gap-1 text-sm">Mulai<input type="time" name="start" defaultValue={s.start_time.slice(0, 5)} className={input} /></label>
              <label className="grid gap-1 text-sm">Selesai<input type="time" name="end" defaultValue={s.end_time.slice(0, 5)} className={input} /></label>
              <label className="grid gap-1 text-sm">Toleransi (mnt)<input type="number" name="grace" defaultValue={s.grace_minutes} className={input} /></label>
              <label className="grid gap-1 text-sm">Istirahat (mnt)<input type="number" name="break" defaultValue={s.break_minutes} className={input} /></label>
            </ActionForm>
          ) : (
            <p key={s.code} className="text-sm"><b>{s.code}</b> {s.name}: {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}, toleransi {s.grace_minutes} menit</p>
          ))}
        </div>
      </Panel>
      <Panel title={`Hari libur ${year}`} sub="Dipakai menghitung hari cuti dan jenis hari lembur. Isi nama kosong untuk menghapus.">
        {hols?.length ? (
          <ul className="grid gap-1 text-sm">
            {hols.map(h => <li key={h.holiday_date} className="flex justify-between gap-2 border-b border-line py-1 last:border-0">
              <span>{h.name}</span><span className="tabular text-muted">{fmtDate(h.holiday_date)}</span></li>)}
          </ul>
        ) : <p className="text-sm text-muted">Belum ada hari libur.</p>}
        {isHr && (
          <ActionForm action={setHoliday} label="Simpan" className="mt-3 md:grid-cols-3 md:items-end">
            <label className="grid gap-1 text-sm">Tanggal<input type="date" name="date" required className={input} /></label>
            <label className="grid gap-1 text-sm">Nama<input name="name" placeholder="Hari Raya Idulfitri" className={input} /></label>
            <label className="grid gap-1 text-sm">Jenis<select name="kind" className={input}><option value="national">Libur nasional</option><option value="collective">Cuti bersama</option><option value="company">Libur perusahaan</option></select></label>
          </ActionForm>
        )}
      </Panel>
    </div>
  );
}
