import Image from 'next/image';
import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { PageHeader } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { PlantTabs } from '../tabs';
import { PrintButton } from './print-button';

export const metadata = { title: 'Stiker QR unit' };

// Stiker QR per unit: scan dari HP operator langsung membuka form P2H unit itu (login dulu bila belum masuk).
export default async function UnitQrPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const s = await getSession();
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const supabase = await createClient();
  let q = supabase.from('units').select('unit_no, unit_type').neq('status', 'retired').order('unit_no');
  if (sp.unit) q = q.eq('unit_no', sp.unit.toUpperCase());
  const { data: units } = await q.returns<{ unit_no: string; unit_type: string }[]>();
  const items = await Promise.all((units ?? []).map(async u => ({
    ...u, png: await QRCode.toDataURL(`${origin}/she/p2h?unit=${encodeURIComponent(u.unit_no)}`, { margin: 1, width: 240, errorCorrectionLevel: 'M' }),
  })));
  if (!s.can('plant.manage') && !s.can('plant.work')) return <p className="text-sm text-muted">Hanya Plant yang mencetak stiker unit.</p>;

  return (
    <>
      <div className="print:hidden">
        <PageHeader eyebrow="SMKP 4.4 · Sarana & peralatan" title="Stiker QR unit"><PrintButton /></PageHeader>
        <PlantTabs active="/plant" />
        <p className="mt-2 text-sm text-muted">Tempel di dasbor kabin. Operator memindai dengan kamera HP, masuk dengan NIK, lalu form P2H unit itu langsung terbuka. Cetak di kertas stiker tahan air; pakai laminasi bila di luar kabin.</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
        {items.map(u => (
          <div key={u.unit_no} className="break-inside-avoid rounded-xl border border-line bg-white p-3 text-center text-black">
            <div className="flex items-center justify-center gap-1.5 text-xs font-bold tracking-wide"><Image src="/logo.png" alt="" width={18} height={18} /> BSB · P2H</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u.png} alt={`QR ${u.unit_no}`} className="mx-auto my-1 h-32 w-32" />
            <div className="font-mono text-lg font-bold leading-tight">{u.unit_no}</div>
            <div className="text-xs text-neutral-600">Scan untuk isi P2H</div>
          </div>
        ))}
      </div>
    </>
  );
}
