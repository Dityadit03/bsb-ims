import { ActionForm } from '@/components/action-form';
import { DropZone } from '@/components/drop-zone';
import { input } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { siteToday } from '@/lib/hrga';
import { EmployeeDatalist, EmployeeInput } from '../she/fields';
import { createLeave, createOvertime } from './waktu-actions';

// Form pengajuan cuti: untuk diri sendiri (ESS) atau oleh atasan/HRGA atas nama karyawan
export async function LeaveForm({ forOther = false }: { forOther?: boolean }) {
  const supabase = await createClient();
  const { data: types } = await supabase.from('leave_types').select('code, name, quota_days, max_days, requires_attachment')
    .eq('active', true).order('sort_order');
  return (
    <>
      {forOther && <EmployeeDatalist />}
      <ActionForm action={createLeave} label="Ajukan cuti" primary hidden={{ idem: crypto.randomUUID() }} className="md:grid-cols-2 md:items-end">
        {forOther && <EmployeeInput required />}
        <label className="grid gap-1 text-sm">Jenis
          <select name="type" required className={input}>
            {(types ?? []).map(t => <option key={t.code} value={t.code}>{t.name}{t.max_days ? ` (maks ${t.max_days} hari)` : ''}{t.requires_attachment ? ' · wajib lampiran' : ''}</option>)}
          </select></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm">Mulai<input type="date" name="start" required defaultValue={siteToday()} className={input} /></label>
          <label className="grid gap-1 text-sm">Sampai<input type="date" name="end" required defaultValue={siteToday()} className={input} /></label>
        </div>
        <label className="grid gap-1 text-sm md:col-span-2">Keterangan<input name="reason" required placeholder="mis. pulang kampung, acara keluarga" className={input} /></label>
        <div className="md:col-span-2"><DropZone label="Lampiran (surat dokter, undangan, dll.)" accept="image/*,application/pdf" /></div>
      </ActionForm>
      <p className="text-xs text-muted">Hari cuti dihitung dari roster (hari OFF dan hari libur tidak dihitung). Persetujuan: atasan langsung, lalu HRGA.</p>
    </>
  );
}

export function OvertimeForm({ forOther = false }: { forOther?: boolean }) {
  return (
    <>
      {forOther && <EmployeeDatalist />}
      <ActionForm action={createOvertime} label="Kirim SPL" primary hidden={{ idem: crypto.randomUUID() }} className="md:grid-cols-4 md:items-end">
        {forOther && <EmployeeInput />}
        <label className="grid gap-1 text-sm">Tanggal<input type="date" name="date" required defaultValue={siteToday()} className={input} /></label>
        <label className="grid gap-1 text-sm">Mulai<input type="time" name="start" required defaultValue="18:00" className={input} /></label>
        <label className="grid gap-1 text-sm">Selesai<input type="time" name="end" required defaultValue="20:00" className={input} /></label>
        <label className={`grid gap-1 text-sm ${forOther ? 'md:col-span-4' : ''}`}>Pekerjaan<input name="reason" required placeholder="mis. perbaikan unit DT-12" className={input} /></label>
      </ActionForm>
      <p className="text-xs text-muted">Batas: 4 jam/hari kerja, 18 jam/minggu, 11 jam di hari istirahat/libur (PP 35/2021). Jam aktual dicocokkan dengan absensi.</p>
    </>
  );
}
