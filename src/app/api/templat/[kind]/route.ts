import { NextResponse, type NextRequest } from 'next/server';
import { importKind } from '@/lib/datasets';
import { spreadsheetResponse } from '@/lib/export';

// Templat impor: baris judul + satu contoh, dan lembar petunjuk.
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const k = importKind((await params).kind);
  if (!k) return new NextResponse('Templat tidak ditemukan', { status: 404 });
  return spreadsheetResponse(`templat-${k.key}`, [
    { name: k.label, rows: [k.fields.map(f => f.label), k.fields.map(f => f.example)] },
    { name: 'Petunjuk', rows: [['Kolom', 'Wajib', 'Contoh', 'Judul lain yang juga dikenali'],
      ...k.fields.map(f => [f.label, f.required ? 'Ya' : '', f.example, f.aliases.join(', ')]), [], [k.note],
      ['Tanggal boleh ditulis 2026-10-24, 24/10/2026 atau 24 Okt 2026. Hapus baris contoh sebelum mengimpor.']] },
  ], req.nextUrl.searchParams.get('format') ?? 'xlsx');
}
