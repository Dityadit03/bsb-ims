import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';

// Lampiran rekaman operasional (SHE, action plan). Dokumen terkendali tetap lewat /api/dokumen agar dicap "tidak terkendali".
const OWNERS = ['hazard_reports', 'observations', 'inspections', 'inspection_findings', 'p2h_checks', 'incidents', 'corrective_actions', 'work_orders', 'course_materials', 'material_requests', 'purchase_requisitions', 'purchase_orders', 'breakdown_reports', 'attendance_logs', 'spip_inspections'];

const INLINE = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: a } = await supabase.from('attachments').select('storage_path, file_name, mime_type, owner_table, uploaded_by')
    .eq('id', id).maybeSingle<{ storage_path: string; file_name: string; mime_type: string; owner_table: string | null; uploaded_by: string }>();
  if (!a || !OWNERS.includes(a.owner_table ?? '')) return new NextResponse('Lampiran tidak ditemukan atau tidak berwenang', { status: 404 });
  // Selfie absensi: hanya pemilik foto dan HRGA
  if (a.owner_table === 'attendance_logs') {
    const s = await getSession();
    if (a.uploaded_by !== s.profile.id && !s.canIn('hr.manage', 'HRGA')) return new NextResponse('Tidak berwenang', { status: 403 });
  }
  const { data: blob, error } = await supabase.storage.from('records').download(a.storage_path);
  if (error || !blob) return new NextResponse('Berkas tidak bisa diambil', { status: 502 });
  // Hanya gambar dan PDF yang dibuka di browser; jenis lain selalu diunduh agar tidak dijalankan di domain aplikasi
  const inline = INLINE.includes(a.mime_type);
  return new NextResponse(blob, {
    headers: {
      'Content-Type': inline ? a.mime_type : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(a.file_name)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
