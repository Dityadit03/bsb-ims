'use client';
import { useActionState } from 'react';
import { btnGhost, input } from '@/components/ui';
import { previewNumber, type PreviewState } from './actions';

type Scheme = { code: string; name: string; pattern: string };

export function PreviewForm({ schemes }: { schemes: Scheme[] }) {
  const [state, action, pending] = useActionState<PreviewState, FormData>(previewNumber, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_2fr_auto] sm:items-end">
      <label className="grid gap-1 text-sm">Skema
        <select id="scheme" name="scheme" className={input} defaultValue="SOP">
          {schemes.map(s => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Dept {'{D}'}<input id="D" name="D" className={`${input} font-mono uppercase`} placeholder="HSE" /></label>
      <label className="grid gap-1 text-sm">Seksi {'{S}'}<input id="S" name="S" className={`${input} font-mono uppercase`} placeholder="SFT" /></label>
      <label className="grid gap-1 text-sm">Induk {'{P}'}<input id="P" name="P" className={`${input} font-mono uppercase`} placeholder="SOP-BSB-HSE-SFT-018" /></label>
      <button className={btnGhost} disabled={pending}>Pratinjau</button>
      <output className="font-mono text-sm sm:col-span-5" aria-live="polite">
        {state.number && <>Nomor berikutnya: <b className="text-accent">{state.number}</b> <span className="text-muted">(belum dialokasikan)</span></>}
        {state.error && <span className="text-crit">{state.error}</span>}
      </output>
    </form>
  );
}
