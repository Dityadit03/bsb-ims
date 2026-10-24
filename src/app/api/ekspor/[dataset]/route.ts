import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { dataset } from '@/lib/datasets';
import { datasetSheet, spreadsheetResponse } from '@/lib/export';

// Unduh register ke Excel/CSV dengan hak akses pengguna yang mengunduh (RLS tetap berlaku).
export async function GET(req: NextRequest, { params }: { params: Promise<{ dataset: string }> }) {
  const d = dataset((await params).dataset);
  if (!d) return new NextResponse('Data tidak ditemukan', { status: 404 });
  const supabase = await createClient();
  const rows: Record<string, unknown>[] = [];
  // API membatasi 1000 baris per permintaan
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.from(d.view).select(d.columns.map(c => c[0]).join(','))
      .order(d.order, { ascending: !d.desc }).range(from, from + 999);
    if (error) return new NextResponse(error.message, { status: 400 });
    rows.push(...(data as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return spreadsheetResponse(`bsb-${d.key}`, [datasetSheet(d, rows)], req.nextUrl.searchParams.get('format') ?? 'xlsx');
}
