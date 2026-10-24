import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { input } from '@/components/ui';
import { HIERARCHY } from '@/lib/compliance';
import { CATEGORY, CONDITION, LIKELIHOOD, SEVERITY } from '@/lib/she';
import { saveRisk } from '../actions';
import { AreaSelect, DeptSelect, type Opt } from '../fields';

export type RiskValues = Partial<{
  id: string; department_id: string; work_area_id: string | null; activity: string; condition: string; category: string; hazard: string;
  risk: string; existing_controls: string | null; additional_controls: string | null; control_hierarchy: string | null;
  initial_likelihood: number; initial_severity: number; residual_likelihood: number; residual_severity: number;
  legal_requirement_id: string | null; owner_id: string;
}>;

function Scale({ name, label, labels, value }: { name: string; label: string; labels: string[]; value?: number }) {
  return (
    <label className="grid gap-1 text-sm">{label}
      <select name={name} required className={input} defaultValue={value ?? ''}>
        <option value="" disabled>Pilih</option>
        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} · {labels[n]}</option>)}
      </select>
    </label>
  );
}

export function RiskForm({ v = {}, depts, areas, legal, people, label }: {
  v?: RiskValues; depts: Opt[]; areas: Opt[]; legal: { id: string; register_no: string | null; title: string }[];
  people: { id: string; full_name: string | null; email: string }[]; label: string;
}) {
  return (
    <ActionForm action={saveRisk} label={label} primary hidden={v.id ? { id: v.id, department: v.department_id! } : { idem: randomUUID() }} className="max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-3">
        {v.id ? null : <DeptSelect depts={depts} value={v.department_id} />}
        <AreaSelect areas={areas} value={v.work_area_id} />
        <label className="grid gap-1 text-sm">Kondisi
          <select name="condition" className={input} defaultValue={v.condition ?? 'routine'}>{Object.entries(CONDITION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label className="grid gap-1 text-sm">Kategori
          <select name="category" className={input} defaultValue={v.category ?? 'safety'}>{Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
      </div>
      <label className="grid gap-1 text-sm">Aktivitas / pekerjaan<input name="activity" required className={input} defaultValue={v.activity} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Bahaya<textarea name="hazard" required rows={2} className={input} defaultValue={v.hazard} /></label>
        <label className="grid gap-1 text-sm">Risiko / dampak<textarea name="risk" required rows={2} className={input} defaultValue={v.risk} /></label>
      </div>
      <label className="grid gap-1 text-sm">Pengendalian yang ada<textarea name="existing" rows={2} className={input} defaultValue={v.existing_controls ?? ''} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Scale name="il" label="Kemungkinan awal" labels={LIKELIHOOD} value={v.initial_likelihood} />
        <Scale name="is" label="Keparahan awal" labels={SEVERITY} value={v.initial_severity} />
      </div>
      <label className="grid gap-1 text-sm">Pengendalian tambahan<textarea name="additional" rows={2} className={input} defaultValue={v.additional_controls ?? ''} /></label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">Hierarki pengendalian
          <select name="hierarchy" className={input} defaultValue={v.control_hierarchy ?? ''}><option value="">–</option>
            {Object.entries(HIERARCHY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <Scale name="rl" label="Kemungkinan residual" labels={LIKELIHOOD} value={v.residual_likelihood} />
        <Scale name="rs" label="Keparahan residual" labels={SEVERITY} value={v.residual_severity} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Pemilik risiko
          <select name="owner" className={input} defaultValue={v.owner_id ?? ''}><option value="">Saya</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}</select>
        </label>
        <label className="grid gap-1 text-sm">Peraturan terkait
          <select name="legal" className={input} defaultValue={v.legal_requirement_id ?? ''}><option value="">–</option>
            {legal.map(l => <option key={l.id} value={l.id}>{l.register_no} · {l.title}</option>)}</select>
        </label>
      </div>
      <p className="text-xs text-muted">Skor = kemungkinan × keparahan: 1–4 rendah, 5–9 sedang, 10–16 tinggi, 20–25 ekstrem. Residual tinggi/ekstrem wajib punya pengendalian tambahan; residual ekstrem tidak bisa disetujui.</p>
    </ActionForm>
  );
}
