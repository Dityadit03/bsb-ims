'use client';
import { useActionState, useState } from 'react';
import { DropZone } from '@/components/drop-zone';
import { Pill, btnGhost, btnPrimary, input } from '@/components/ui';
import { runImport, type ImportState } from '../actions';

type Kind = { key: string; label: string; note: string; fields: { key: string; label: string; required?: boolean }[] };

export function ImportForm({ kinds, initial }: { kinds: Kind[]; initial?: string }) {
  const [state, run, pending] = useActionState<ImportState, FormData>(runImport, {});
  const [kind, setKind] = useState(initial ?? kinds[0]?.key ?? '');
  const [paste, setPaste] = useState(false);
  const k = kinds.find(x => x.key === kind);
  const label = (f: string | null) => k?.fields.find(x => x.key === f)?.label;
  const result = state.done ?? state.checked;
  const preview = state.rows?.slice(0, 8) ?? [];
  const cols = k?.fields.filter(x => state.columns?.some(c => c.field === x.key)) ?? [];

  return (
    <div className="grid gap-4">
      <form action={run} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="grid gap-1 text-sm">Jenis data
            <select name="kind" value={kind} onChange={e => setKind(e.target.value)} className={input}>
              {kinds.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select></label>
          <a href={`/api/templat/${kind}`} className={btnGhost}>Unduh templat Excel</a>
        </div>
        {k && <p className="text-xs text-muted">{k.note} Kolom wajib: {k.fields.filter(x => x.required).map(x => x.label).join(', ')}.</p>}
        {paste
          ? <label className="grid gap-1 text-sm">Tempel tabel dari Excel / Google Sheets (termasuk baris judul)
              <textarea name="paste" rows={6} className={`${input} font-mono text-xs`} placeholder={k?.fields.map(x => x.label).join('\t')} /></label>
          : <DropZone name="file" label="Berkas Excel / CSV" multiple={false} accept=".xlsx,.csv,.txt"
              hint="Seret berkas .xlsx / .csv ke sini atau ketuk untuk memilih" />}
        <div className="flex flex-wrap items-center gap-3">
          <button className={btnPrimary} disabled={pending}>{pending && !state.rows ? 'Memeriksa…' : 'Periksa data'}</button>
          <button type="button" onClick={() => setPaste(!paste)} className="text-sm text-accent">
            {paste ? 'Unggah berkas saja' : 'Atau tempel dari Excel'}</button>
          {state.error && <span role="alert" className="text-sm text-crit">{state.error}</span>}
        </div>
      </form>

      {state.columns && (
        <div className="grid gap-3 rounded-xl border border-line p-3">
          <div className="flex flex-wrap gap-1.5 text-xs">
            {state.columns.map((c, i) => c.field
              ? <Pill key={i} tone="ok">{c.header} → {label(c.field)}</Pill>
              : c.header ? <Pill key={i}>{c.header} (diabaikan)</Pill> : null)}
          </div>
          {!!state.missing?.length && <p className="text-sm text-crit">Kolom wajib tidak ditemukan: {state.missing.join(', ')}. Ganti judul kolom sesuai templat.</p>}
          {preview.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted">{['#', ...cols.map(c => c.label)].map(h => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}</tr></thead>
                <tbody>{preview.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-2 py-1 text-muted">{i + 1}</td>
                    {cols.map(c => <td key={c.key} className="max-w-48 truncate px-2 py-1">{r[c.key]}</td>)}
                  </tr>))}
                </tbody>
              </table>
              {(state.rows?.length ?? 0) > preview.length && <p className="px-2 pt-1 text-xs text-muted">… dan {(state.rows?.length ?? 0) - preview.length} baris lagi</p>}
            </div>
          )}
          {result && (
            <div className="grid gap-2">
              <p className="text-sm">
                {state.done
                  ? <><b className="text-ok">{result.ok} baris tersimpan.</b>{result.errors.length > 0 && ` ${result.errors.length} baris dilewati.`}</>
                  : <><b>{result.ok} dari {state.rows?.length} baris siap diimpor.</b>{result.errors.length > 0 && <span className="text-crit"> {result.errors.length} baris bermasalah:</span>}</>}
              </p>
              {result.errors.length > 0 && (
                <ul className="grid max-h-48 gap-0.5 overflow-y-auto text-xs">
                  {result.errors.map(e => <li key={e.row}><span className="font-mono text-muted">Baris {e.row}</span> · {e.error}</li>)}
                </ul>
              )}
              {!state.done && result.ok > 0 && (
                <form action={run}>
                  <input type="hidden" name="commit" value="1" />
                  <button className={btnPrimary} disabled={pending}>{pending ? 'Mengimpor…' : `Impor ${result.ok} baris sekarang`}</button>
                  {result.errors.length > 0 && <span className="ml-3 text-xs text-muted">Baris bermasalah dilewati; perbaiki lalu impor ulang.</span>}
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
