import 'server-only';
import type { createClient } from '@/lib/supabase/server';

type Client = Awaited<ReturnType<typeof createClient>>;

// Isian karyawan memakai datalist "NRP · Nama"; ambil NRP-nya lalu cari id karyawan.
export async function employeeIdFrom(supabase: Client, text: string | null) {
  const nrp = text?.split(' · ')[0]?.trim().toUpperCase();
  if (!nrp) return null;
  const { data } = await supabase.from('employees').select('id').eq('nrp', nrp).maybeSingle();
  if (!data) throw new Error(`Karyawan dengan NRP ${nrp} tidak ditemukan. Pilih dari daftar.`);
  return data.id as string;
}
