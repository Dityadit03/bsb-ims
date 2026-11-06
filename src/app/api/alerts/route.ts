import { NextResponse } from 'next/server';
import { getAlerts } from '@/lib/alerts';

// Peringatan untuk lonceng dan menu samping. Dimuat setelah halaman tampil agar halaman tidak menunggu puluhan kueri peringatan.
export async function GET() {
  const { items, total } = await getAlerts();
  return NextResponse.json({ items, total }, { headers: { 'Cache-Control': 'private, max-age=20' } });
}
