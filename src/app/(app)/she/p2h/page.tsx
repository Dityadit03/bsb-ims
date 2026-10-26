import { OfflineForm } from '@/components/offline-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { CONCLUSION, UNIT_TYPE } from '@/lib/she';
import { submitP2h } from '../actions';
import { DeptSelect, Files, SheTabs, sheMasters, today } from '../fields';

export const metadata = { title: 'P2H unit' };

type Row = {
  id: string; p2h_no: string; check_date: string; shift: number; unit_no: string; unit_type: string; hour_meter: number | null;
  conclusion: string; notes: string | null; operator: { full_name: string | null } | null;
};

// Pilihan checklist dibuat sebagai tombol besar agar mudah ditekan dengan jari / sarung tangan
const CHOICES = [
  ['ok', 'OK', 'peer-checked:border-ok peer-checked:bg-ok peer-checked:text-white'],
  ['not_ok', 'Tidak OK', 'peer-checked:border-crit peer-checked:bg-crit peer-checked:text-white'],
  ['na', 'N/A', 'peer-checked:border-muted peer-checked:bg-muted peer-checked:text-white'],
] as const;

export default async function P2hPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const date = sp.tanggal ?? today();
  const [{ data: items }, { data: rows }, { depts }, { data: units }] = await Promise.all([
    supabase.from('p2h_items').select('code, label, is_critical').eq('active', true).order('sort_order'),
    supabase.from('p2h_checks').select('id, p2h_no, check_date, shift, unit_no, unit_type, hour_meter, conclusion, notes, operator:operator_id(full_name)')
      .eq('check_date', date).order('conclusion', { ascending: false }).order('unit_no').returns<Row[]>(),
    sheMasters(),
    supabase.from('units').select('unit_no, unit_type').neq('status', 'retired').order('unit_no'),
  ]);

  return (
    <>
      <PageHeader eyebrow="SMKP 4.4 · 5.2 · Pemeriksaan harian" title="P2H unit" />
      <SheTabs active="/she/p2h" />
      {s.can('she.report') && (
        <Panel title="Isi P2H">
          <OfflineForm action={submitP2h} kind="p2h" queueTitle="P2H" queueField="unit" draftKey="p2h" label="Simpan P2H" className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Tanggal<input type="date" name="date" required defaultValue={today()} max={today()} className={input} /></label>
              <label className="grid gap-1 text-sm">Shift<select name="shift" className={input}><option value="1">Shift 1</option><option value="2">Shift 2</option></select></label>
              <DeptSelect depts={depts} value={s.profile.department_id} />
              <label className="grid gap-1 text-sm">No. lambung unit<input name="unit" required list="unit-list" autoComplete="off" defaultValue={(sp.unit ?? '').toUpperCase()} className={`${input} uppercase`} placeholder="mis. DTS-7011" />
                <datalist id="unit-list">{(units ?? []).map(u => <option key={u.unit_no} value={u.unit_no}>{u.unit_type}</option>)}</datalist></label>
              <label className="grid gap-1 text-sm">Jenis unit
                <select name="unit_type" defaultValue={(units ?? []).find(u => u.unit_no === (sp.unit ?? '').toUpperCase())?.unit_type ?? 'DT'} className={input}>{Object.entries(UNIT_TYPE).map(([k, l]) => <option key={k} value={k}>{k} · {l}</option>)}</select>
              </label>
              <label className="grid gap-1 text-sm">HM / KM<input type="number" name="hm" min={0} step="0.1" className={input} /></label>
            </div>
            <fieldset className="grid gap-1 rounded border border-line p-3">
              <legend className="px-1 text-sm font-medium">Checklist</legend>
              {(items ?? []).map(it => (
                <div key={it.code} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 text-sm last:border-0">
                  <span>{it.label}{it.is_critical && <span className="ml-2 font-mono text-[10px] uppercase text-crit">kritis</span>}</span>
                  <span className="grid w-full grid-cols-3 gap-1 sm:w-auto">
                    {CHOICES.map(([v, l, on]) => (
                      <label key={v} className="cursor-pointer">
                        <input type="radio" name={`item_${it.code}`} value={v} required defaultChecked={v === 'ok'} className="peer sr-only" />
                        <span className={`block rounded-md border border-line px-3 py-2 text-center peer-focus-visible:outline-2 peer-focus-visible:outline-accent ${on}`}>{l}</span>
                      </label>
                    ))}
                  </span>
                </div>
              ))}
            </fieldset>
            <label className="grid gap-1 text-sm">Temuan / catatan<textarea name="notes" rows={2} className={input} /></label>
            <label className="grid gap-1 text-sm">Kesimpulan operator
              <select name="conclusion" className={input}>{Object.entries(CONCLUSION).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <Files label="Foto temuan" />
            <p className="text-xs text-muted">Item kritis yang tidak OK otomatis membuat unit tidak layak, dan pengawas serta Plant diberi tahu.</p>
          </OfflineForm>
        </Panel>
      )}
      <Panel title={`P2H ${fmtDate(date)}`} action={
        <form className="flex gap-2"><input type="date" name="tanggal" defaultValue={date} className={input} aria-label="Tanggal" /><button className="text-sm text-accent">Tampilkan</button></form>}>
        {rows?.length ? (
          <Table head={['Nomor', 'Shift', 'Unit', 'HM', 'Operator', 'Catatan', 'Kesimpulan']}>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-mono text-xs">{r.p2h_no}</td>
                <td className="text-xs">{r.shift}</td>
                <td className="font-mono text-xs">{r.unit_no}<div className="text-muted">{r.unit_type}</div></td>
                <td className="tabular text-xs">{r.hour_meter ?? '–'}</td>
                <td className="text-xs">{r.operator?.full_name}</td>
                <td className="min-w-48 text-xs">{r.notes}</td>
                <td><Pill tone={CONCLUSION[r.conclusion][0]}>{CONCLUSION[r.conclusion][1]}</Pill></td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada P2H pada tanggal ini.</p>}
      </Panel>
    </>
  );
}
