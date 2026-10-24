'use client';
import { useActionState, useMemo, useState } from 'react';
import { btnPrimary, input } from '@/components/ui';
import { SMKP_ELEMENTS } from '@/lib/documents';
import { requestDocument } from '../actions';

type Type = { code: string; name: string; category: string; workflow_code: string | null; needs_section: boolean; parent_types: string[] | null };
type Dept = { id: string; code: string; name: string; sections: { id: string; code: string; name: string }[] };
type Parent = { id: string; document_number: string; title: string; type_code: string };

export function RequestForm({ types, departments, parents, defaultDepartment }: {
  types: Type[]; departments: Dept[]; parents: Parent[]; defaultDepartment: string | null;
}) {
  const [state, action, pending] = useActionState(requestDocument, {});
  const [typeCode, setTypeCode] = useState('SOP');
  const [deptId, setDeptId] = useState(defaultDepartment ?? departments[0]?.id ?? '');
  const type = types.find(t => t.code === typeCode);
  const dept = departments.find(d => d.id === deptId);
  const parentOptions = useMemo(() => parents.filter(p => type?.parent_types?.includes(p.type_code)), [parents, type]);
  const idem = useMemo(() => crypto.randomUUID(), []);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="idem" value={idem} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Jenis dokumen
          <select id="type" name="type" value={typeCode} onChange={e => setTypeCode(e.target.value)} className={input}>
            {types.map(t => <option key={t.code} value={t.code}>{t.code} · {t.name}{t.workflow_code ? '' : ' (registrasi)'}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">Departemen pemilik
          <select id="department" name="department" value={deptId} onChange={e => setDeptId(e.target.value)} className={input}>
            {departments.map(d => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
          </select>
        </label>
        {type?.needs_section && (
          <label className="grid gap-1 text-sm">Seksi
            <select id="section" name="section" className={input} required>
              {dept?.sections.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          </label>
        )}
        {type?.parent_types && (
          <label className="grid gap-1 text-sm">Dokumen induk
            <select id="parent" name="parent" className={input} required>
              <option value="">Pilih dokumen induk yang sudah terbit</option>
              {parentOptions.map(p => <option key={p.id} value={p.id}>{p.document_number} · {p.title}</option>)}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-sm sm:col-span-2">Judul
          <input id="title" name="title" required minLength={5} className={input} placeholder="mis. Prosedur Pengelolaan Limbah B3" />
        </label>
        {!type?.workflow_code && (
          <>
            <label className="grid gap-1 text-sm">Tanggal dokumen<input id="date" type="date" name="date" className={input} /></label>
            {typeCode === 'IZN' && <label className="grid gap-1 text-sm">Berlaku sampai<input id="valid_until" type="date" name="valid_until" className={input} /></label>}
            {['EXT', 'SRM', 'IZN'].includes(typeCode) && (
              <label className="grid gap-1 text-sm">{typeCode === 'SRM' ? 'Pengirim' : 'Penerbit'}<input id="issuer" name="issuer" className={input} /></label>
            )}
          </>
        )}
        <label className="grid gap-1 text-sm">Klasifikasi akses
          <select id="access" name="access" className={input} defaultValue="internal">
            <option value="internal">Internal · semua pengguna</option>
            <option value="restricted">Terbatas · pemilik, penerima & pejabat</option>
            <option value="confidential">Rahasia</option>
          </select>
        </label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm">Elemen SMKP Minerba terkait</legend>
        <div className="flex flex-wrap gap-2">
          {SMKP_ELEMENTS.map(([n, label]) => (
            <label key={n} className="flex items-center gap-2 rounded border border-line px-2 py-1 text-sm has-checked:border-accent has-checked:bg-accent-soft">
              <input type="checkbox" name="smkp" value={n} id={`smkp-${n}`} className="accent-accent" /> E{n} {label}
            </label>
          ))}
        </div>
      </fieldset>
      {state.error && <p role="alert" className="text-sm text-crit">{state.error}</p>}
      <div><button className={btnPrimary} disabled={pending}>{type?.workflow_code ? 'Buat pengajuan' : 'Registrasi & terbitkan nomor'}</button></div>
    </form>
  );
}
