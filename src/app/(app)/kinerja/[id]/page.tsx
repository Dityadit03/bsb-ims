import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { CYCLE_STATUS, GRADE, PERF_STATUS, SCORE_LABEL } from '@/lib/hrga';
import { acknowledge, calibrate, decideGoals, deleteGoal, managerReview, saveGoal, selfReview, submitGoals } from '../../hrga/kinerja/actions';
import { GradePill, type ReviewRow } from '../../hrga/kinerja/parts';

export const metadata = { title: 'Penilaian kinerja' };

type Goal = { id: string; title: string; measure: string | null; target: string; weight: number; actual: string | null };
type Rating = { rater: 'self' | 'manager'; kind: 'goal' | 'behavior'; item_id: string; score: number; note: string | null };
type Result = { kpi_score: number | null; behavior_score: number | null; final_score: number; computed_grade: string; calibrated_grade: string | null;
  calibration_note: string | null; manager_comment: string | null; development_plan: string | null };
type Evidence = Record<'hadir' | 'terlambat' | 'alpa' | 'pelanggaran' | 'hazard' | 'observasi' | 'inspeksi' | 'sertifikat', number>;

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const isHr = session.canIn('hr.manage', 'HRGA');
  const supabase = await createClient();
  const { data: r } = await supabase.from('perf_review_register').select('*').eq('id', id).maybeSingle<ReviewRow>();
  if (!r) notFound();
  const [{ data: goals }, { data: ratings }, { data: result }, { data: behaviors }, { data: ev }, { data: extra }] = await Promise.all([
    supabase.from('perf_goals').select('id, title, measure, target, weight, actual').eq('review_id', id).order('sort_order').returns<Goal[]>(),
    supabase.from('perf_ratings').select('rater, kind, item_id, score, note').eq('review_id', id).returns<Rating[]>(),
    supabase.from('perf_results').select('*').eq('review_id', id).maybeSingle<Result>(),
    supabase.from('perf_behaviors').select('id, name, description').eq('active', true).order('sort_order'),
    supabase.rpc('perf_evidence', { p_review: id }),
    supabase.from('perf_reviews').select('self_comment, employee_comment').eq('id', id).maybeSingle(),
  ]);
  const gs = goals ?? [], bs = behaviors ?? [];
  const rate = (rater: string, kind: string, item: string) => (ratings ?? []).find(x => x.rater === rater && x.kind === kind && x.item_id === item);
  const h = { review: id };
  const phase = r.cycle_status;
  const editGoals = ['goal_setting', 'review'].includes(phase) && ['goal_draft', 'goal_submitted'].includes(r.status) && (r.is_self || r.is_manager || (isHr && !r.is_self));
  const canSelf = r.is_self && phase === 'review' && ['goal_approved', 'self_done'].includes(r.status);
  const canMgr = r.is_manager && ['review', 'calibration'].includes(phase) && ['goal_approved', 'self_done', 'manager_done'].includes(r.status)
    && !(r.status === 'goal_approved' && r.has_account && phase === 'review');
  const evidence = ev as Evidence | null;

  return (
    <>
      <PageHeader eyebrow={`Penilaian kinerja · ${r.cycle_name}`} title={r.full_name}>
        <Link href={r.is_self ? '/saya?tab=kinerja' : `/hrga/kinerja?siklus=${r.cycle_id}`} className="text-sm text-muted hover:text-accent">← Kembali</Link>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm [&_dt]:text-muted">
            <dt>Status</dt><dd className="flex flex-wrap items-center gap-2"><Pill tone={PERF_STATUS[r.status]?.[0]}>{PERF_STATUS[r.status]?.[1]}</Pill>
              <span className="text-xs text-muted">siklus: {CYCLE_STATUS[phase]?.[1]}</span></dd>
            <dt>Karyawan</dt><dd>{r.nrp} · {r.department_code}{r.position_name ? ` · ${r.position_name}` : ''}</dd>
            <dt>Atasan</dt><dd>{r.supervisor_name ?? 'atasan departemen'}</dd>
            <dt>Periode</dt><dd>{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</dd>
            <dt>Komposisi</dt><dd>KPI {r.kpi_weight}% + perilaku kerja {100 - r.kpi_weight}%</dd>
            {r.final_grade && <><dt>Hasil</dt><dd className="flex items-center gap-2"><span className="tabular font-semibold">{Number(r.final_score).toFixed(2)}</span><GradePill grade={r.final_grade} /></dd></>}
          </dl>
          {r.return_note && r.status === 'goal_draft' && <p className="rounded-lg bg-warn/10 p-3 text-sm text-warn">Dikembalikan atasan: {r.return_note}</p>}
        </Panel>
        {evidence && (
          <Panel title="Data pendukung periode ini" sub="Dari absensi, SHE dan HRGA; bahan diskusi, tidak dihitung otomatis.">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm [&_dd]:tabular [&_dd]:text-right [&_dt]:text-muted">
              <dt>Hadir</dt><dd>{evidence.hadir} hari</dd>
              <dt>Terlambat</dt><dd className={evidence.terlambat ? 'text-warn' : ''}>{evidence.terlambat}</dd>
              <dt>Alpa</dt><dd className={evidence.alpa ? 'text-crit' : ''}>{evidence.alpa}</dd>
              <dt>Pelanggaran K3</dt><dd className={evidence.pelanggaran ? 'text-crit' : ''}>{evidence.pelanggaran}</dd>
              <dt>Hazard dilaporkan</dt><dd>{evidence.hazard}</dd>
              <dt>Observasi / inspeksi</dt><dd>{evidence.observasi} / {evidence.inspeksi}</dd>
              <dt>Sertifikat baru</dt><dd>{evidence.sertifikat}</dd>
            </dl>
          </Panel>
        )}
      </div>

      <Panel title={`Sasaran kerja (KPI) · total bobot ${r.weight_total}%`} sub="Nilai 1 = jauh di bawah target, 3 = sesuai target, 5 = jauh di atas target.">
        {gs.length ? (
          <Table head={['KPI', 'Target', 'Bobot', 'Realisasi', 'Nilai diri', ...(result ? ['Nilai atasan'] : []), ...(editGoals ? [''] : [])]}>
            {gs.map(g => (
              <tr key={g.id}>
                <td><span className="grid"><span className="text-sm font-semibold">{g.title}</span>{g.measure && <span className="text-xs text-muted">{g.measure}</span>}</span></td>
                <td className="text-sm">{g.target}</td>
                <td className="tabular text-sm">{g.weight}%</td>
                <td className="text-sm">{g.actual ?? '–'}</td>
                <td className="tabular text-sm">{rate('self', 'goal', g.id)?.score ?? '–'}</td>
                {result && <td className="tabular text-sm font-semibold">{rate('manager', 'goal', g.id)?.score ?? '–'}</td>}
                {editGoals && <td><ActionForm action={deleteGoal} label="Hapus" hidden={{ ...h, goal: g.id }} /></td>}
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada KPI.</p>}
        {editGoals && (
          <>
            <ActionForm action={saveGoal} label="Tambah KPI" hidden={h} className="md:grid-cols-[2fr_2fr_1.5fr_6rem] md:items-end">
              <label className="grid gap-1 text-sm">KPI<input name="title" required placeholder="Ritase DT tercapai" className={input} /></label>
              <label className="grid gap-1 text-sm">Indikator / cara ukur<input name="measure" placeholder="Laporan hauling harian" className={input} /></label>
              <label className="grid gap-1 text-sm">Target<input name="target" required placeholder="≥ 95% target" className={input} /></label>
              <label className="grid gap-1 text-sm">Bobot %<input type="number" name="weight" required min={1} max={100} defaultValue={Math.max(1, 100 - r.weight_total)} className={input} /></label>
            </ActionForm>
            <div className="flex flex-wrap items-start gap-2">
              {r.is_self && r.status === 'goal_draft' && <ActionForm action={submitGoals} label="Kirim KPI ke atasan" primary hidden={h} />}
              {r.is_manager && (
                <>
                  <ActionForm action={decideGoals} label="Setujui KPI" primary hidden={{ ...h, approve: '1' }} />
                  {r.status === 'goal_submitted' && (
                    <details className="text-sm"><summary className="cursor-pointer rounded-lg border border-line px-3.5 py-2 hover:border-crit/60">Kembalikan</summary>
                      <ActionForm action={decideGoals} label="Kembalikan ke karyawan" hidden={{ ...h, approve: '0' }} className="mt-2 w-72">
                        <textarea name="note" required rows={2} placeholder="Apa yang perlu diperbaiki" className={input} />
                      </ActionForm>
                    </details>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </Panel>

      {(canSelf || canMgr) && (
        <Panel title={canMgr ? 'Nilai atasan' : 'Penilaian diri'}
          sub={canMgr ? 'Nilai diri karyawan ditampilkan sebagai acuan. Nilai akhir dihitung otomatis; HRGA dapat mengkalibrasi predikat.' : 'Isi realisasi dan nilai untuk setiap KPI dan perilaku kerja. Bisa diubah sampai atasan menilai.'}>
          <ActionForm action={canMgr ? managerReview : selfReview} label={canMgr ? 'Simpan nilai atasan' : 'Kirim penilaian diri'} primary hidden={h}>
            <div className="grid gap-3">
              {gs.map(g => {
                const mine = rate(canMgr ? 'manager' : 'self', 'goal', g.id), self = rate('self', 'goal', g.id);
                return (
                  <fieldset key={g.id} className="grid gap-2 rounded-xl border border-line p-3 md:grid-cols-[2fr_1.5fr_11rem_1.5fr] md:items-end">
                    <legend className="px-1 text-sm font-semibold">{g.title} <span className="font-normal text-muted">· target {g.target} · {g.weight}%</span></legend>
                    <label className="grid gap-1 text-sm">Realisasi<input name={`ga:${g.id}`} defaultValue={g.actual ?? ''} className={input} /></label>
                    <span className="text-xs text-muted">{canMgr && self ? `Nilai diri: ${self.score} (${SCORE_LABEL[self.score]})${self.note ? ` · ${self.note}` : ''}` : ''}</span>
                    <ScoreSelect name={`g:${g.id}`} value={mine?.score} />
                    <label className="grid gap-1 text-sm">Catatan<input name={`gn:${g.id}`} defaultValue={mine?.note ?? ''} className={input} /></label>
                  </fieldset>
                );
              })}
              <fieldset className="grid gap-2 rounded-xl border border-line p-3">
                <legend className="px-1 text-sm font-semibold">Perilaku kerja</legend>
                {bs.map(b => {
                  const mine = rate(canMgr ? 'manager' : 'self', 'behavior', b.id), self = rate('self', 'behavior', b.id);
                  return (
                    <div key={b.id} className="grid gap-2 md:grid-cols-[2fr_11rem_1.5fr] md:items-center">
                      <span className="grid text-sm"><span className="font-semibold">{b.name}</span><span className="text-xs text-muted">{b.description}{canMgr && self ? ` · nilai diri ${self.score}` : ''}</span></span>
                      <ScoreSelect name={`b:${b.id}`} value={mine?.score} />
                      <input name={`bn:${b.id}`} aria-label={`Catatan ${b.name}`} placeholder="Catatan" defaultValue={mine?.note ?? ''} className={input} />
                    </div>
                  );
                })}
              </fieldset>
              {canMgr ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {extra?.self_comment && <p className="rounded-lg bg-line/40 p-3 text-sm md:col-span-2">Catatan karyawan: {extra.self_comment}</p>}
                  <label className="grid gap-1 text-sm">Catatan atasan<textarea name="comment" required rows={3} defaultValue={result?.manager_comment ?? ''} className={input} /></label>
                  <label className="grid gap-1 text-sm">Rencana pengembangan<textarea name="development" rows={3} placeholder="Pelatihan, coaching, target perbaikan" defaultValue={result?.development_plan ?? ''} className={input} /></label>
                </div>
              ) : (
                <label className="grid gap-1 text-sm">Catatan untuk atasan<textarea name="comment" rows={3} defaultValue={extra?.self_comment ?? ''} className={input} /></label>
              )}
            </div>
          </ActionForm>
        </Panel>
      )}

      {result && (
        <Panel title="Hasil penilaian">
          <div className="grid gap-3 sm:grid-cols-4">
            <Score label="KPI" value={result.kpi_score} />
            <Score label="Perilaku kerja" value={result.behavior_score} />
            <Score label="Nilai akhir" value={result.final_score} strong />
            <div className="grid content-start gap-1 rounded-xl border border-line p-3">
              <span className="text-xs text-muted">Predikat</span>
              <GradePill grade={result.calibrated_grade ?? result.computed_grade} />
              {result.calibrated_grade && <span className="text-xs text-muted">dikalibrasi dari {result.computed_grade}</span>}
            </div>
          </div>
          {result.calibration_note && <p className="text-sm"><span className="text-muted">Alasan kalibrasi:</span> {result.calibration_note}</p>}
          {result.manager_comment && <p className="text-sm"><span className="text-muted">Catatan atasan:</span> {result.manager_comment}</p>}
          {result.development_plan && <p className="text-sm"><span className="text-muted">Rencana pengembangan:</span> {result.development_plan}</p>}
          {extra?.employee_comment && <p className="text-sm"><span className="text-muted">Tanggapan karyawan:</span> {extra.employee_comment}</p>}
          {isHr && !r.is_self && phase === 'calibration' && r.status === 'manager_done' && (
            <ActionForm action={calibrate} label="Simpan kalibrasi" hidden={h} className="md:grid-cols-[12rem_1fr] md:items-end">
              <label className="grid gap-1 text-sm">Predikat kalibrasi
                <select name="grade" defaultValue={result.calibrated_grade ?? ''} className={input}>
                  <option value="">Sesuai hitungan ({result.computed_grade})</option>
                  {Object.entries(GRADE).map(([g, v]) => <option key={g} value={g}>{g} · {v[1]}</option>)}
                </select></label>
              <label className="grid gap-1 text-sm">Alasan (wajib bila diubah)<input name="note" defaultValue={result.calibration_note ?? ''} className={input} /></label>
            </ActionForm>
          )}
          {r.is_self && r.status === 'done' && (
            <ActionForm action={acknowledge} label="Konfirmasi sudah membaca hasil" primary hidden={h}>
              <label className="grid gap-1 text-sm">Tanggapan (opsional)<textarea name="comment" rows={2} className={input} /></label>
            </ActionForm>
          )}
        </Panel>
      )}
    </>
  );
}

function ScoreSelect({ name, value }: { name: string; value?: number }) {
  return (
    <label className="grid gap-1 text-sm">Nilai
      <select name={name} required defaultValue={value ?? ''} className={input}>
        <option value="" disabled>Pilih 1-5</option>
        {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} · {SCORE_LABEL[n]}</option>)}
      </select>
    </label>
  );
}

function Score({ label, value, strong = false }: { label: string; value: number | null; strong?: boolean }) {
  return (
    <div className="grid content-start gap-1 rounded-xl border border-line p-3">
      <span className="text-xs text-muted">{label}</span>
      <span className={`tabular ${strong ? 'text-2xl font-extrabold' : 'text-xl font-semibold'}`}>{value == null ? '–' : Number(value).toFixed(2)}</span>
    </div>
  );
}
