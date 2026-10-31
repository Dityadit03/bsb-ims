import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { sha256 } from '@/lib/pdf-stamp';

type Client = Awaited<ReturnType<typeof createClient>>;
export const MAX_BYTES = 25 * 1024 * 1024;

// Jenis berkas yang boleh diunggah. Tipe MIME ditentukan dari ekstensi, bukan dari klaim browser, dan HTML/SVG/skrip
// tidak diizinkan karena bisa dijalankan di domain aplikasi saat dibuka (XSS tersimpan).
export const ALLOWED_TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain',
};
export function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const mime = ALLOWED_TYPES[ext];
  if (!mime) throw new Error(`${name}: jenis berkas tidak diizinkan (boleh PDF, gambar, Word, Excel, PowerPoint, CSV, TXT)`);
  return mime;
}

// Unggah ke bucket privat lalu catat di attachments beserta SHA-256 untuk bukti keaslian.
export async function uploadAttachment(supabase: Client, path: string, bytes: Uint8Array, name: string, _claimedMime?: string) {
  const mime = mimeFor(name);
  const { error: upErr } = await supabase.storage.from('records').upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) throw new Error(`Gagal mengunggah berkas: ${upErr.message}`);
  const { data, error } = await supabase.from('attachments')
    .insert({ bucket: 'records', storage_path: path, file_name: name, mime_type: mime, size_bytes: bytes.byteLength, sha256: sha256(bytes) })
    .select('id, sha256').single();
  if (error) throw new Error(error.message);
  return data as { id: string; sha256: string };
}

// Berkas dari form (input type=file) ke folder draf milik pengguna.
export async function uploadFormFiles(supabase: Client, userId: string, folder: string, files: FormDataEntryValue[]) {
  const ids: string[] = [];
  for (const f of files) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > MAX_BYTES) throw new Error(`${f.name}: ukuran maksimal 25 MB`);
    mimeFor(f.name);
    const safe = f.name.replace(/[^\w.-]+/g, '_').slice(-80);
    const att = await uploadAttachment(supabase, `drafts/${userId}/${folder}/${crypto.randomUUID()}-${safe}`,
      new Uint8Array(await f.arrayBuffer()), f.name);
    ids.push(att.id);
  }
  return ids;
}
