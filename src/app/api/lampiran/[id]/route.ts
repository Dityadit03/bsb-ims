import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Lampiran rekaman operasional (SHE, action plan). Dokumen terkendali tetap lewat /api/dokumen agar dicap "tidak terkendali".
const OWNERS = ['hazard_reports', 'observations', 'inspections', 'inspection_findings', 'p2h_checks', 'incidents', 'corrective_actions', 'work_orders', 'course_materials'];

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: a } = await supabase.from('attachments').select('storage_path, file_name, mime_type, owner_table')
    .eq('id', id).maybeSingle<{ storage_path: string; file_name: string; mime_type: string; owner_table: string | null }>();
  if (!a || !OWNERS.includes(a.owner_table ?? '')) return new NextResponse('Lampiran tidak ditemukan atau tidak berwenang', { status: 404 });
  const { data: blob, error } = await supabase.storage.from('records').download(a.storage_path);
  if (error || !blob) return new NextResponse('Berkas tidak bisa diambil', { status: 502 });
  return new NextResponse(blob, {
    headers: {
      'Content-Type': a.mime_type,
      'Content-Disposition': `inline; filename="${encodeURIComponent(a.file_name)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
