import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { ExportLinks } from '@/components/export-links';
import { PageHeader, Pager, Panel, Pill, Stat, input, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { CYCLE_NEXT, CYCLE_STATUS, GRADE, PERF_STATUS } from '@/lib/hrga';
import { HrTabs } from '../tabs';
import { advanceCycle, enrollCycle, saveCycle } from './actions';
import { ReviewTable, type ReviewRow } from './parts';

export const metadata = { title: 'Penilaian kinerja' };

type Cycle = { id: string; name: string; period_start: string; period_end: string; kpi_weight: number; goal_due: string | null; review_due: string | null; status: string };

export default async function KinerjaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const isHr = session.canIn('hr.manage', 'HRGA');
  const supabase = await createClient();
  const [{ data: cycles }, { data: behaviors }] = await Promise.all([
    supabase.from('perf_cycles').select('*').order('period_start', { ascending: false }).returns<Cycle[]>(),
    supabase.from('perf_behaviors').select('code, name, description').eq('active', true).order('sort_order'),
  ]);
  const cyc = (cycles ?? []).find(c => c.id === sp.siklus) ?? (cycles ?? []).find(c => c.status !== 'closed') ?? cycles?.[0];
  const { data: rv } = cyc
    ? await supabase.from('perf_review_register').select('*').eq('cycle_id', cyc.id).order('department_code').order('full_name').limit(3000).returns<ReviewRow[]>()
    : { data: [] as ReviewRow[] };
  const all = rv ?? [];
  let rows = sp.status ? all.filter(r => r.status === sp.status) : all;
  if (sp.dept) rows = rows.filter(r => r.department_code === sp.dept);
  const pg = paginate(rows, sp.hal);
  const approved = all.filter(r => !['goal_draft', 'goal_submitted'].includes(r.status)).length;
  const scored = all.filter(r => r.final_score != null).length;
  const grades = Object.keys(GRADE).map(g => [g, all.filter(r => r.final_grade === g).length] as const);
  const maxG = Math.max(1, ...grades.map(g => g[1]));

  return (
    <>
      <PageHeader eyebrow="HRGA" title="Penilaian kinerja">{cyc && <ExportLinks dataset="kinerja" params={{ siklus: cyc.id }} />}</PageHeader>
      <HrTabs active="/hrga/kinerja" />
      {!!cycles?.length && (
        <nav className="flex flex-wrap gap-2" aria-label="Siklus">
          {cycles.map(c => (
            <Link key={c.id} href={`/hrga/kinerja?siklus=${c.id}`}
              className={`rounded-full border px-3 py-1 text-sm ${c.id === cyc?.id ? 'border-violet bg-violet text-white' : 'border-line hover:border-violet/60'}`}>
              {c.name}
            </Link>
          ))}
        </nav>
      )}
      {cyc ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Peserta" value={all.length} note={isHr ? 'seluruh karyawan dalam siklus' : 'tim Anda'} />
            <Stat label="KPI disetujui" value={`${all.length ? Math.round((100 * approved) / all.length) : 0}%`} note={`${approved} dari ${all.length}`}
              tone={approved === all.length ? 'ok' : 'warn'} />
            <Stat label="Sudah dinilai atasan" value={scored} note={`${all.length - scored} belum`} tone={cyc.status === 'review' && scored < all.length ? 'warn' : undefined} />
            <Stat label="Perlu tindakan Anda" value={all.filter(r => r.my_action && !r.is_self).length} href="/tugas" />
          </div>
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Panel title={cyc.name} sub={`Periode ${fmtDate(cyc.period_start)} – ${fmtDate(cyc.period_end)} · KPI ${cyc.kpi_weight}% + perilaku kerja ${100 - cyc.kpi_weight}%`}
              action={<Pill tone={CYCLE_STATUS[cyc.status][0]}>{CYCLE_STATUS[cyc.status][1]}</Pill>}>
              <ol className="grid gap-1 text-sm sm:grid-cols-5">
                {Object.entries(CYCLE_STATUS).map(([k, v], i) => {
                  const idx = Object.keys(CYCLE_STATUS).indexOf(cyc.status);
                  return <li key={k} className={`rounded-lg border px-2 py-1.5 ${i === idx ? 'border-violet bg-violet/5 font-semibold' : i < idx ? 'border-line text-muted line-through' : 'border-line text-muted'}`}>{i + 1}. {v[1]}</li>;
                })}
              </ol>
              <p className="text-sm text-muted">
                {cyc.goal_due && <>Batas KPI {fmtDate(cyc.goal_due)}. </>}{cyc.review_due && <>Batas penilaian {fmtDate(cyc.review_due)}. </>}
                {cyc.status === 'calibration' && 'Hasil belum terlihat karyawan sampai siklus ditutup.'}
              </p>
              {isHr && cyc.status !== 'closed' && (
                <div className="flex flex-wrap items-start gap-2">
                  <ActionForm action={advanceCycle} label={CYCLE_NEXT[cyc.status]} primary hidden={{ id: cyc.id }} />
                  {['goal_setting', 'review'].includes(cyc.status) && <ActionForm action={enrollCycle} label="Tambah karyawan baru ke siklus" hidden={{ id: cyc.id }} />}
                </div>
              )}
            </Panel>
            <Panel title="Sebaran predikat" sub="Setelah kalibrasi">
              <ul className="grid gap-1.5">
                {grades.map(([g, n]) => (
                  <li key={g} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2 text-sm">
                    <span>{g} · {GRADE[g][1]}</span>
                    <span className="h-2.5 rounded-full bg-line/60"><span className="block h-full rounded-full bg-violet" style={{ width: `${(100 * n) / maxG}%` }} /></span>
                    <span className="tabular text-right">{n}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
          <Panel title="Peserta" action={
            <form className="flex gap-2">
              <input type="hidden" name="siklus" value={cyc.id} />
              <select name="status" defaultValue={sp.status ?? ''} className={`${input} max-w-48`}><option value="">Semua status</option>
                {Object.entries(PERF_STATUS).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
              <select name="dept" defaultValue={sp.dept ?? ''} className={`${input} max-w-32`}><option value="">Semua dept</option>
                {[...new Set(all.map(r => r.department_code))].sort().map(d => <option key={d}>{d}</option>)}</select>
              <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Saring</button>
            </form>
          }>
            {rows.length ? <><ReviewTable rows={pg.rows} /><Pager {...pg} params={{ siklus: cyc.id, status: sp.status, dept: sp.dept }} /></>
              : <p className="text-sm text-muted">{cyc.status === 'draft' ? 'Peserta dibuat otomatis saat penyusunan KPI dimulai.' : 'Tidak ada peserta yang bisa Anda lihat.'}</p>}
          </Panel>
        </>
      ) : (
        <Panel><p className="text-sm text-muted">Belum ada siklus penilaian{isHr ? '. Buat siklus pertama di bawah.' : '.'}</p></Panel>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {isHr && (
          <Panel title={cyc && cyc.status !== 'closed' ? `Ubah siklus ${cyc.name}` : 'Siklus baru'} sub="Peserta: karyawan aktif (bukan subkon) yang bergabung sebelum akhir periode.">
            <ActionForm action={saveCycle} label="Simpan siklus" primary hidden={cyc && cyc.status !== 'closed' ? { id: cyc.id } : {}} className="sm:grid-cols-2">
              {(() => { const c = cyc && cyc.status !== 'closed' ? cyc : null; return (<>
                <label className="grid gap-1 text-sm sm:col-span-2">Nama<input name="name" required defaultValue={c?.name ?? `Penilaian ${new Date().getFullYear()}`} className={input} /></label>
                <label className="grid gap-1 text-sm">Periode mulai<input type="date" name="start" required defaultValue={c?.period_start ?? `${new Date().getFullYear()}-01-01`} className={input} /></label>
                <label className="grid gap-1 text-sm">Periode selesai<input type="date" name="end" required defaultValue={c?.period_end ?? `${new Date().getFullYear()}-12-31`} className={input} /></label>
                <label className="grid gap-1 text-sm">Bobot KPI (%)<input type="number" name="kpi_weight" min={0} max={100} defaultValue={c?.kpi_weight ?? 70} disabled={!!c && c.status !== 'draft'} className={input} /></label>
                <span className="self-end pb-2 text-xs text-muted">Sisanya untuk perilaku kerja. Terkunci setelah siklus dimulai.</span>
                <label className="grid gap-1 text-sm">Batas susun KPI<input type="date" name="goal_due" defaultValue={c?.goal_due ?? ''} className={input} /></label>
                <label className="grid gap-1 text-sm">Batas penilaian<input type="date" name="review_due" defaultValue={c?.review_due ?? ''} className={input} /></label>
              </>); })()}
            </ActionForm>
          </Panel>
        )}
        <Panel title="Perilaku kerja yang dinilai" sub="Skala 1-5 bersama KPI. Predikat: A ≥ 4,5 · B ≥ 3,5 · C ≥ 2,5 · D ≥ 1,5 · E di bawahnya.">
          <ul className="grid gap-2">
            {(behaviors ?? []).map(b => (
              <li key={b.code} className="grid text-sm"><span className="font-semibold">{b.name}</span><span className="text-xs text-muted">{b.description}</span></li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
