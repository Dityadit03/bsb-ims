import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stampUncontrolled } from '@/lib/pdf-stamp';

// Unduhan PDF versi terbit. Pengguna biasa menerima salinan berlabel "tidak terkendali";
// Document Controller menerima berkas asli agar hash-nya bisa dicocokkan.
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse('Tidak masuk', { status: 401 });

  const { data: v } = await supabase.from('document_versions')
    .select('id, status, final:final_attachment_id(storage_path, file_name)')
    .eq('id', id).maybeSingle<{ id: string; status: string; final: { storage_path: string; file_name: string } | null }>();
  if (!v?.final) return new NextResponse('Berkas tidak ditemukan atau tidak berwenang', { status: 404 });

  const { data: blob, error } = await supabase.storage.from('records').download(v.final.storage_path);
  if (error || !blob) return new NextResponse('Berkas tidak bisa diambil', { status: 502 });
  let bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer());

  const { data: perms } = await supabase.rpc('my_permissions');
  const isDc = (perms ?? []).some((p: { permission_code: string }) => p.permission_code === 'document.release');
  if (!isDc) bytes = await stampUncontrolled(bytes, auth.user.email ?? auth.user.id);
  await supabase.rpc('log_download', { p_version: id }).then(() => undefined, () => undefined);

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(v.final.file_name)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
