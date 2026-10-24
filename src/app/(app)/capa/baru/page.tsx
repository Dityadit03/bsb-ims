import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, input } from '@/components/ui';
import { requirePermission } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { ACTION_TYPE, HIERARCHY, RISK, SOURCE_TYPE, byCode } from '@/lib/compliance';
import { createAction } from '../actions';

export const metadata = { title: 'Buat action plan' };

export default async function NewCapaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePermission('capa.create');
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: clauses }, { data: depts }, { data: people }, { data: limits }] = await Promise.all([
    supabase.from('compliance_clauses').select('id, framework_code, code, title, level').eq('active', true).neq('level', 'element'),
    supabase.from('departments').select('id, code, name').order('sort_order'),
    supabase.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name'),
    supabase.from('app_settings').select('value').eq('key', 'capa_max_days').maybeSingle(),
  ]);
  const max = (limits?.value ?? {}) as Record<string, number>;
  const person = (p: { full_name: string | null; email: string }) => p.full_name ?? p.email;

  return (
    <>
      <PageHeader eyebrow="Action plan" title="Buat action plan" />
      <Panel>
        <ActionForm action={createAction} label="Simpan dan terbitkan nomor ACT" primary hidden={{ idem: randomUUID(), ...(sp.tabel && sp.sid ? { source_table: sp.tabel, source_id: sp.sid } : {}) }} className="max-w-3xl">
          <label className="grid gap-1 text-sm">Judul tindakan<input name="title" required className={input} placeholder="mis. Pasang rambu batas kecepatan KM 12" /></label>
          <label className="grid gap-1 text-sm">Uraian masalah dan tindakan<textarea name="description" required rows={4} className={input} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">Sumber
              <select name="source_type" className={input} defaultValue={sp.sumber ?? 'inspection'}>
                {Object.entries(SOURCE_TYPE).filter(([k]) => k !== 'effectiveness').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">Referensi sumber<input name="source_ref" className={input} placeholder="mis. nomor inspeksi / temuan audit" defaultValue={sp.ref} /></label>
          </div>
          <label className="grid gap-1 text-sm">Persyaratan SMKP / ISO
            <select name="clause" required className={input} defaultValue={sp.clause ?? ''}>
              <option value="" disabled>Pilih persyaratan</option>
              {[...(clauses ?? [])].sort(byCode).map(c => <option key={c.id} value={c.id}>{c.framework_code} {c.code} · {c.title}</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm">Tingkat risiko
              <select name="risk" className={input} defaultValue="medium">
                {Object.entries(RISK).map(([k, [, l]]) => <option key={k} value={k}>{l}{max[k] ? ` (maks. ${max[k]} hari)` : ''}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">Jenis tindakan
              <select name="action_type" className={input} defaultValue="corrective">
                {Object.entries(ACTION_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">Hierarki pengendalian
              <select name="hierarchy" className={input} defaultValue=""><option value="">–</option>
                {Object.entries(HIERARCHY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">Departemen penanggung jawab
              <select name="department" required className={input} defaultValue={sp.dept ?? s.profile.department_id ?? ''}>
                <option value="" disabled>Pilih</option>
                {(depts ?? []).map(d => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">Target selesai<input type="date" name="due" required className={input} /></label>
            <label className="grid gap-1 text-sm">PIC
              <select name="pic" required className={input} defaultValue=""><option value="" disabled>Pilih PIC</option>
                {(people ?? []).map(p => <option key={p.id} value={p.id}>{person(p)}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">Verifikator independen
              <select name="verifier" required className={input} defaultValue=""><option value="" disabled>Pilih verifikator</option>
                {(people ?? []).map(p => <option key={p.id} value={p.id}>{person(p)}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted">Verifikator harus orang lain selain PIC dan memiliki kewenangan verifikasi di departemen tersebut.</p>
        </ActionForm>
      </Panel>
    </>
  );
}
