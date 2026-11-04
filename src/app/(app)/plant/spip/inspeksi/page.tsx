import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { PlantTabs } from '../../tabs';
import { PageHeader, Panel, Pill, Stat, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { OBJECT_TYPE } from '@/lib/she';
import { inspectSpip, saveSpipItem } from '../../../she/portal-actions';
import { Files } from '../../../she/fields';

export const metadata = { title: 'Inspeksi SPIP mingguan' };

type W = { record_id: string; object_type: string; ref_code: string; name: string; this_week_on: string | null; this_week_result: string | null; last_inspected_on: string | null; due: boolean };
type Item = { id: string; object_type: string | null; text: string; sort_order: number; active: boolean };

export default async function SpipWeekly() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: weekly }, { data: items }] = await Promise.all([
    supabase.from('spip_weekly').select('*').order('ref_code').returns<W[]>(),
    supabase.from('spip_check_items').select('*').order('sort_order').returns<Item[]>(),
  ]);
  const rows = weekly ?? [];
  const write = s.canIn('spip.manage', 'PLT') || s.canIn('spip.manage', 'HSE');
  const due = rows.filter(r => r.due), attention = rows.filter(r => r.this_week_result === 'attention');
  const itemsFor = (t: string) => (items ?? []).filter(i => i.active && (i.object_type == null || i.object_type === t));

  return (
    <>
      <PageHeader eyebrow="SMKP 4.4 · Inspeksi mingguan" title="Inspeksi SPIP mingguan">
        <Link href="/plant/spip" className="text-sm text-accent hover:underline">← Register komisioning</Link>
      </PageHeader>
      <PlantTabs active="/plant/spip" />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Belum diinspeksi minggu ini" value={due.length} />
        <Stat label="Sudah diinspeksi" value={rows.length - due.length} />
        <Stat label="Ada temuan" value={attention.length} />
      </div>
      <Panel title="Daftar inspeksi" sub="Satu inspeksi per objek per minggu (Senin–Minggu). Butir yang tidak sesuai wajib diberi catatan dan memberi tahu Plant.">
        {rows.length ? (
          <ul className="grid gap-2">
            {rows.map(r => (
              <li key={r.record_id} className="rounded-lg border border-line px-3 py-2">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-mono text-xs">{r.ref_code}</span><span>{r.name}</span>
                    <span className="text-xs text-muted">{OBJECT_TYPE[r.object_type]}</span>
                    {r.due ? <Pill tone="warn">Belum minggu ini</Pill> : <Pill tone={r.this_week_result === 'attention' ? 'crit' : 'ok'}>{r.this_week_result === 'attention' ? 'Ada temuan' : 'Sesuai'} · {fmtDate(r.this_week_on)}</Pill>}
                    <span className="text-xs text-muted">terakhir {r.last_inspected_on ? fmtDate(r.last_inspected_on) : 'belum pernah'}</span>
                  </summary>
                  {write && r.due && (
                    <ActionForm action={inspectSpip} label="Simpan inspeksi" primary hidden={{ record: r.record_id }} className="mt-3 max-w-3xl">
                      {itemsFor(r.object_type).map((i, n) => (
                        <div key={i.id} className="grid gap-1 rounded border border-line p-2 text-sm sm:grid-cols-[2fr_auto_2fr] sm:items-center">
                          <input type="hidden" name="t" value={i.text} />
                          <span>{i.text}</span>
                          <span className="flex gap-3">
                            {[['ok', 'Sesuai'], ['tidak', 'Tidak'], ['na', 'N/A']].map(([v, l]) => (
                              <label key={v} className="flex items-center gap-1"><input type="radio" name={`r_${n}`} value={v} defaultChecked={v === 'ok'} />{l}</label>))}
                          </span>
                          <input name={`n_${n}`} className={input} placeholder="Catatan (wajib bila tidak sesuai)" aria-label="Catatan" />
                        </div>))}
                      <label className="grid gap-1 text-sm">Catatan umum<input name="note" className={input} /></label>
                      <Files label="Foto inspeksi" />
                    </ActionForm>
                  )}
                </details>
              </li>))}
          </ul>
        ) : <p className="text-sm text-muted">Belum ada objek di register komisioning.</p>}
      </Panel>
      <Panel title="Butir pemeriksaan" sub="Butir awal bersifat umum. Plant dan HSE dapat menambah atau menonaktifkan sesuai prosedur SPIP BSB.">
        <ul className="mb-3 grid gap-1 text-sm">
          {(items ?? []).map(i => (
            <li key={i.id} className={`flex flex-wrap gap-x-3 rounded-lg border border-line px-3 py-2 ${i.active ? '' : 'opacity-50'}`}>
              <span>{i.text}</span><span className="text-xs text-muted">{i.object_type ? OBJECT_TYPE[i.object_type] : 'Semua jenis'}{i.active ? '' : ' · nonaktif'}</span>
              {write && <ActionForm action={saveSpipItem} label={i.active ? 'Nonaktifkan' : 'Aktifkan'} hidden={{ id: i.id, text: i.text, object_type: i.object_type ?? '', sort: String(i.sort_order), active: i.active ? 'no' : 'yes' }} />}
            </li>))}
        </ul>
        {write && (
          <ActionForm action={saveSpipItem} label="Tambah butir" primary className="max-w-3xl sm:grid-cols-3 sm:items-end">
            <label className="grid gap-1 text-sm sm:col-span-2">Butir pemeriksaan<input name="text" required className={input} /></label>
            <label className="grid gap-1 text-sm">Untuk jenis
              <select name="object_type" className={input}><option value="">Semua jenis</option>{Object.entries(OBJECT_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <input type="hidden" name="sort" value="10" />
          </ActionForm>
        )}
      </Panel>
    </>
  );
}
