import { input } from '@/components/ui';

export type CourseRow = { id: string; code: string; title: string; description: string | null; department_id: string; department_code: string;
  competency_id: string | null; competency_code: string | null; competency_name: string | null; pass_score: number; question_count: number | null;
  max_attempts: number | null; duration_minutes: number | null; open_enroll: boolean; status: string; materials: number; can_manage: boolean;
  assigned: number; completed: number; overdue: number; my_assigned: boolean; my_due_on: string | null; my_completed_at: string | null;
  my_materials_done: number; my_best_score: number | null; my_passed: boolean | null };

type Opt = { id: string; code: string; name: string };

// isian kursus; dipakai saat membuat dan mengubah
export function CourseFields({ c, departments, competencies }: { c?: CourseRow; departments: Opt[]; competencies: Opt[] }) {
  return (
    <>
      <label className="grid gap-1 text-sm">Kode<input name="code" required defaultValue={c?.code} disabled={!!c} placeholder="K3-DASAR" className={input} /></label>
      <label className="grid gap-1 text-sm md:col-span-2">Judul<input name="title" required defaultValue={c?.title} placeholder="Induksi K3 dasar" className={input} /></label>
      <label className="grid gap-1 text-sm">Departemen pemilik
        <select name="department" required defaultValue={c?.department_id ?? ''} className={input}><option value="" disabled>Pilih</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm md:col-span-4">Deskripsi<textarea name="description" rows={2} defaultValue={c?.description ?? ''} className={input} /></label>
      <label className="grid gap-1 text-sm md:col-span-2">Lulus → kompetensi
        <select name="competency" defaultValue={c?.competency_id ?? ''} className={input}><option value="">Tidak menerbitkan kompetensi</option>
          {competencies.map(k => <option key={k.id} value={k.id}>{k.code} · {k.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Nilai lulus<input type="number" name="pass_score" min={1} max={100} defaultValue={c?.pass_score ?? 70} className={input} /></label>
      <label className="grid gap-1 text-sm">Soal per kuis<input type="number" name="question_count" min={1} defaultValue={c?.question_count ?? ''} placeholder="semua" className={input} /></label>
      <label className="grid gap-1 text-sm">Maks. percobaan<input type="number" name="max_attempts" min={1} defaultValue={c?.max_attempts ?? ''} placeholder="tanpa batas" className={input} /></label>
      <label className="grid gap-1 text-sm">Durasi kuis (menit)<input type="number" name="duration" min={1} defaultValue={c?.duration_minutes ?? ''} placeholder="bebas" className={input} /></label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm md:col-span-2"><input type="checkbox" name="open_enroll" defaultChecked={c?.open_enroll ?? true} /> Terbuka untuk semua karyawan (tanpa penugasan)</label>
    </>
  );
}
