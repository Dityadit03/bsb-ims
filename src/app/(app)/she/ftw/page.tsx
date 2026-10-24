import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { CONCLUSION } from '@/lib/she';
import { checkFtw, submitFtw } from '../actions';
import { DeptSelect, SheTabs, sheMasters, today } from '../fields';

export const metadata = { title: 'Fit to work' };

type Row = {
  id: string; shift: number; worker_id: string; sleep_hours: number; drowsy_medication: boolean; complaint: string | null;
  blood_pressure: string | null; conclusion: string; checker_note: string | null; checked_at: string | null;
  worker: { full_name: string | null } | null; dept: { code: string } | null;
};

// RLS: pekerja hanya melihat datanya sendiri; pengawas (she.followup) melihat departemennya.
export default async function FtwPage() {
  const s = await getSession();
  const supabase = await createClient();
  const d = today();
  const [{ data: rows }, { depts }] = await Promise.all([
    supabase.from('fit_to_work').select('id, shift, worker_id, sleep_hours, drowsy_medication, complaint, blood_pressure, conclusion, checker_note, checked_at, worker:worker_id(full_name), dept:department_id(code)')
      .eq('check_date', d).order('conclusion', { ascending: false }).returns<Row[]>(),
    sheMasters(),
  ]);
  const mine = (rows ?? []).filter(r => r.worker_id === s.profile.id);

  return (
    <>
      <PageHeader eyebrow="SMKP 4.3 · Pengelolaan kesehatan kerja" title="Fit to work" />
      <SheTabs active="/she/ftw" />
      {s.can('she.report') && (
        <Panel title="Pernyataan hari ini">
          {mine.map(m => <p key={m.id} className="text-sm">Shift {m.shift}: <Pill tone={CONCLUSION[m.conclusion][0]}>{CONCLUSION[m.conclusion][1]}</Pill></p>)}
          <ActionForm action={submitFtw} label="Kirim fit to work" primary hidden={{ date: d }} className="max-w-2xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Shift<select name="shift" className={input}><option value="1">Shift 1</option><option value="2">Shift 2</option></select></label>
              <DeptSelect depts={depts} value={s.profile.department_id} />
              <label className="grid gap-1 text-sm">Jam tidur 24 jam terakhir<input type="number" name="sleep" required min={0} max={24} step="0.5" className={input} /></label>
              <label className="grid gap-1 text-sm">Minum obat penyebab kantuk?<select name="medication" className={input}><option value="no">Tidak</option><option value="yes">Ya</option></select></label>
              <label className="grid gap-1 text-sm">Tekanan darah (opsional)<input name="bp" className={input} placeholder="120/80" /></label>
              <label className="grid gap-1 text-sm">Kesimpulan
                <select name="conclusion" className={input}>{Object.entries(CONCLUSION).map(([k, [, l]]) => <option key={k} value={k}>{l.replace('Layak / ', '').replace('Tidak layak / ', '')}</option>)}</select>
              </label>
            </div>
            <label className="grid gap-1 text-sm">Keluhan kesehatan<input name="complaint" className={input} /></label>
            <p className="text-xs text-muted">Tidur kurang dari 6 jam atau minum obat penyebab kantuk tidak bisa dinyatakan fit; pengawas akan memeriksa.</p>
          </ActionForm>
        </Panel>
      )}
      {s.can('she.followup') && (
        <Panel title="Pemeriksaan hari ini">
          {rows?.length ? (
            <Table head={['Pekerja', 'Shift', 'Tidur', 'Obat', 'Keluhan / tensi', 'Kesimpulan', 'Pemeriksaan']}>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="text-xs">{r.worker?.full_name}<div className="text-muted">{r.dept?.code}</div></td>
                  <td className="text-xs">{r.shift}</td>
                  <td className={`tabular text-xs ${r.sleep_hours < 6 ? 'font-medium text-crit' : ''}`}>{r.sleep_hours} jam</td>
                  <td className="text-xs">{r.drowsy_medication ? 'Ya' : 'Tidak'}</td>
                  <td className="text-xs">{r.complaint}{r.blood_pressure && <div className="text-muted">{r.blood_pressure}</div>}</td>
                  <td><Pill tone={CONCLUSION[r.conclusion][0]}>{CONCLUSION[r.conclusion][1]}</Pill></td>
                  <td className="min-w-56 text-xs">
                    {r.checked_at ? r.checker_note : r.conclusion !== 'fit' && r.worker_id !== s.profile.id ? (
                      <ActionForm action={checkFtw} label="Simpan" hidden={{ id: r.id }}>
                        <select name="conclusion" className={input} defaultValue={r.conclusion}>
                          {Object.entries(CONCLUSION).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                        <input name="note" required className={input} placeholder="Catatan pemeriksa" />
                      </ActionForm>
                    ) : '–'}
                  </td>
                </tr>
              ))}
            </Table>
          ) : <p className="text-sm text-muted">Belum ada pernyataan fit to work hari ini.</p>}
        </Panel>
      )}
    </>
  );
}
