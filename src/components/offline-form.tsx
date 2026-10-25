'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { btnGhost, btnPrimary } from '@/components/ui';
import { enqueue, formToFields, queueSupported, type QueueKind } from '@/lib/offline/queue';
import { flushQueue } from '@/lib/offline/replay';

type State = { error?: string; ok?: string };

const TIMEOUT_MS = 25000;
const DRAFT_TTL = 12 * 3600 * 1000;

// Seperti ActionForm, tetapi aman untuk sinyal buruk: bila tidak ada jaringan (atau kiriman macet > 25 dtk) isian disimpan di
// perangkat dan dikirim otomatis nanti. Isian juga disimpan sebagai draf sehingga tidak hilang saat halaman tertutup.
export function OfflineForm({ action, kind, queueTitle, queueField, label, children, draftKey, hidden = {}, className = '' }: {
  action: (s: State, f: FormData) => Promise<State>;
  kind: QueueKind;
  queueTitle: string; // judul di daftar antrean, mis. "P2H"
  queueField?: string; // isian yang ditambahkan ke judul, mis. nomor unit
  label: string;
  children?: React.ReactNode;
  draftKey: string;
  hidden?: Record<string, string>;
  className?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<State>({});
  const [pending, start] = useTransition();
  const [cid, setCid] = useState(() => crypto.randomUUID());
  const [restored, setRestored] = useState(false);
  const key = `bsb-draft:${draftKey}`;

  // pulihkan draf
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const d = JSON.parse(raw) as { at: number; v: Record<string, string[]> };
      if (Date.now() - d.at > DRAFT_TTL) return void localStorage.removeItem(key);
      const form = ref.current; if (!form) return;
      for (const el of Array.from(form.elements) as HTMLInputElement[]) {
        const vals = d.v[el.name]; if (!el.name || !vals || el.type === 'file' || el.type === 'hidden') continue;
        if (el.type === 'radio' || el.type === 'checkbox') el.checked = vals.includes(el.value);
        else el.value = vals[0];
      }
      setRestored(true);
    } catch { /* penyimpanan tidak tersedia */ }
  }, [key]);

  // simpan draf saat mengetik
  useEffect(() => {
    const form = ref.current; if (!form) return;
    let t: ReturnType<typeof setTimeout>;
    const save = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        try {
          const v: Record<string, string[]> = {};
          for (const el of Array.from(form.elements) as HTMLInputElement[]) {
            if (!el.name || el.type === 'file' || el.type === 'hidden' || el.type === 'submit') continue;
            if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) continue;
            (v[el.name] ??= []).push(el.value);
          }
          localStorage.setItem(key, JSON.stringify({ at: Date.now(), v }));
        } catch { /* abaikan */ }
      }, 400);
    };
    form.addEventListener('input', save); form.addEventListener('change', save);
    return () => { clearTimeout(t); form.removeEventListener('input', save); form.removeEventListener('change', save); };
  }, [key]);

  const done = () => {
    try { localStorage.removeItem(key); } catch { /* abaikan */ }
    ref.current?.reset(); setRestored(false); setCid(crypto.randomUUID());
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('cid', cid);
    if (fd.has('idem')) fd.set('idem', cid); // satu kiriman = satu kunci, termasuk saat form dipakai lagi
    setState({});
    const queue = async () => {
      if (!queueSupported()) return setState({ error: 'Tidak ada jaringan. Coba lagi saat sinyal ada.' });
      await enqueue(kind, `${queueTitle}${queueField ? ' ' + String(fd.get(queueField) ?? '').slice(0, 40) : ''}`.trim(), formToFields(fd));
      done();
      setState({ ok: 'Tersimpan di perangkat. Akan dikirim otomatis saat ada sinyal.' });
    };
    start(async () => {
      if (!navigator.onLine) return queue();
      try {
        const r = await Promise.race([
          action({}, fd),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
        ]);
        setState(r);
        if (!r.error || /tersimpan/i.test(r.error)) done();
      } catch {
        await queue(); // jaringan putus / macet; cid mencegah data ganda bila kiriman pertama ternyata sampai
        void flushQueue();
      }
    });
  };

  return (
    <form ref={ref} onSubmit={submit} className={`grid gap-2 ${className}`}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {restored && (
        <p className="flex items-center justify-between gap-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
          Draf terakhir dipulihkan.
          <button type="button" className="underline" onClick={done}>Mulai baru</button>
        </p>
      )}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className={kind === 'p2h' || kind === 'hazard' ? btnPrimary : btnGhost} disabled={pending}>{pending ? 'Mengirim…' : label}</button>
        {state.error && <span role="alert" className="text-sm text-crit">{state.error}</span>}
        {state.ok && <span className="text-sm text-ok">{state.ok}</span>}
      </div>
    </form>
  );
}
