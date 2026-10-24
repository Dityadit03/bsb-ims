import { NextResponse, type NextRequest } from 'next/server';
import { dataset, tableOf, toCsv } from '@/lib/datasets';
import { env } from '@/lib/env';

// Feed untuk Google Sheets: =IMPORTDATA("https://…/api/feed/<token>/<dataset>")
// Tanpa sesi login; token pribadi diperiksa oleh fungsi database feed_rows dan bisa dicabut kapan saja.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; dataset: string }> }) {
  const { token, dataset: key } = await params;
  const d = dataset(key.replace(/\.csv$/, ''));
  if (!d?.feed) return new NextResponse('Dataset tidak tersedia untuk feed', { status: 404 });
  const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/feed_rows`, {
    method: 'POST', cache: 'no-store',
    headers: { apikey: env.supabaseAnonKey, Authorization: `Bearer ${env.supabaseAnonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token, p_dataset: d.key }),
  });
  if (!res.ok) {
    const msg = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'Gagal mengambil data';
    return new NextResponse(msg, { status: res.status === 400 || res.status === 401 || res.status === 403 ? 403 : 502 });
  }
  const rows = (await res.json()) as Record<string, unknown>[];
  const table = tableOf(d, rows);
  if (req.nextUrl.searchParams.get('format') === 'json') return NextResponse.json(table);
  return new NextResponse(toCsv(table), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
}
