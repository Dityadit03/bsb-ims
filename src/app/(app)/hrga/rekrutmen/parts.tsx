import { ActionForm } from '@/components/action-form';
import { DropZone } from '@/components/drop-zone';
import { input } from '@/components/ui';
import { CAND_SOURCE } from '@/lib/hrga';

export type ReqRow = { id: string; req_no: string; department_code: string; position_name: string; level: string; headcount: number; employment_type: string;
  reason: string; replaced_name: string | null; needed_by: string; requirements: string; justification: string | null; status: string; mpp_planned: number | null;
  mpp_actual: number | null; decision_note: string | null; requester_name: string | null; verifier_name: string | null; approver_name: string | null;
  applicants: number; in_process: number; hired: number; overdue: boolean; can_decide: boolean; created_at: string; created_by: string };

// isian kandidat; dipakai juga saat menambah pelamar langsung ke FPTK
export function CandidateFields({ action, label, hidden }: { action: Parameters<typeof ActionForm>[0]['action']; label: string; hidden?: Record<string, string> }) {
  return (
    <ActionForm action={action} label={label} primary hidden={hidden} className="md:grid-cols-4 md:items-end">
      <label className="grid gap-1 text-sm md:col-span-2">Nama lengkap<input name="full_name" required className={input} /></label>
      <label className="grid gap-1 text-sm">NIK<input name="nik" inputMode="numeric" maxLength={16} className={input} /></label>
      <label className="grid gap-1 text-sm">No. HP<input name="phone" inputMode="tel" className={input} /></label>
      <label className="grid gap-1 text-sm">Jenis kelamin<select name="gender" className={input}><option value="">–</option><option value="L">Laki-laki</option><option value="P">Perempuan</option></select></label>
      <label className="grid gap-1 text-sm">Pendidikan<select name="education_level" className={input}><option value="">–</option>
        {['SD', 'SMP', 'SMA', 'D3', 'D4', 'S1', 'S2'].map(e => <option key={e} value={e}>{e === 'SMA' ? 'SMA/SMK' : e}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Jurusan<input name="education_major" className={input} /></label>
      <label className="grid gap-1 text-sm">Pengalaman (tahun)<input name="experience_years" inputMode="decimal" className={input} /></label>
      <label className="grid gap-1 text-sm">Perusahaan terakhir<input name="last_employer" className={input} /></label>
      <label className="grid gap-1 text-sm">Domisili<input name="domicile" className={input} /></label>
      <label className="grid gap-1 text-sm">Sumber<select name="source" className={input}>{Object.entries(CAND_SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="is_local" /> Tenaga kerja lokal (ring 1)</label>
      <div className="md:col-span-4"><DropZone label="CV / berkas lamaran" accept="image/*,application/pdf" /></div>
    </ActionForm>
  );
}
