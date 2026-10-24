'use client';
import { useEffect, useRef, useState } from 'react';

// Kotak unggah: seret & lepas berkas atau ketuk untuk memilih/memotret. Daftar berkas terpilih bisa dihapus satu per satu.
export function DropZone({ name = 'files', label = 'Foto / lampiran', hint = 'Seret berkas ke sini atau ketuk untuk memilih', multiple = true,
  accept, required = false, capture }: {
  name?: string; label?: string; hint?: string; multiple?: boolean; accept?: string; required?: boolean; capture?: 'environment' | 'user';
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    const clear = () => setFiles([]);
    form?.addEventListener('reset', clear);
    return () => form?.removeEventListener('reset', clear);
  }, []);

  const apply = (list: File[]) => {
    const dt = new DataTransfer();
    (multiple ? list : list.slice(0, 1)).forEach(f => dt.items.add(f));
    if (ref.current) ref.current.files = dt.files;
    setFiles([...dt.files]);
  };
  const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  return (
    <div className="grid gap-1 text-sm">
      <span>{label}</span>
      <label
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); apply([...files, ...e.dataTransfer.files]); }}
        className={`relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
          over ? 'border-accent bg-accent-soft' : 'border-line bg-panel hover:border-accent'}`}>
        <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-muted">{hint}</span>
        <input ref={ref} type="file" name={name} multiple={multiple} accept={accept} required={required && !files.length} capture={capture}
          onChange={e => setFiles([...(e.target.files ?? [])])} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      {files.length > 0 && (
        <ul className="grid gap-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2 py-1.5 text-xs">
              {f.type.startsWith('image/')
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={URL.createObjectURL(f)} alt="" className="h-8 w-8 rounded object-cover" />
                : <span className="grid h-8 w-8 place-items-center rounded bg-accent-soft font-mono text-[10px] text-accent">{f.name.split('.').pop()?.slice(0, 4).toUpperCase()}</span>}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-muted">{size(f.size)}</span>
              <button type="button" onClick={() => apply(files.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-crit" aria-label={`Hapus ${f.name}`}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
