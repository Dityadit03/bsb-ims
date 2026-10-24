import Link from 'next/link';
import { PageHeader, Panel, Stat, btnGhost } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { SheTabs, today } from './fields';

export const metadata = { title: 'SHE' };

const FORMS = [
  ['/she/p2h', 'P2H unit', 'Pemeriksaan harian unit sebelum dioperasikan'],
  ['/she/ftw', 'Fit to work', 'Kondisi fisik & mental sebelum bekerja'],
  ['/she/hazard', 'Hazard report', 'Kondisi & tindakan tidak aman (KTA/TTA)'],
  ['/she/observasi', 'Observasi PTO', 'Observasi perilaku kerja oleh pengawas'],
  ['/she/inspeksi', 'Inspeksi', 'Inspeksi terencana area, unit dan fasilitas'],
  ['/she/insiden', 'Lapor insiden', 'Laporan awal maksimal 1x24 jam'],
] as const;

export default async function ShePage() {
  const s = await getSession();
  const supabase = await createClient();
  const count = (q: PromiseLike<{ count: number | null }>) => q.then(r => r.count ?? 0);
  const head = { count: 'exact' as const, head: true };
  const d = today();
  const [hzOpen, hzLate, fdOpen, fdLate, incOpen, unfit, riskDraft, riskReview] = await Promise.all([
    count(supabase.from('she_hazard_register').select('*', head).eq('status', 'open')),
    count(supabase.from('she_hazard_register').select('*', head).eq('is_overdue', true)),
    count(supabase.from('she_finding_register').select('*', head).eq('status', 'open')),
    count(supabase.from('she_finding_register').select('*', head).eq('is_overdue', true)),
    count(supabase.from('incidents').select('*', head).neq('status', 'closed')),
    count(supabase.from('p2h_checks').select('*', head).eq('check_date', d).eq('conclusion', 'unfit')),
    count(supabase.from('risk_register').select('*', head).eq('status', 'draft')),
    count(supabase.from('risk_register_view').select('*', head).eq('review_overdue', true)),
  ]);

  return (
    <>
      <PageHeader eyebrow="SMKP 2.2 · 4 · 5.2 · 5.4" title="SHE" />
      <SheTabs active="/she" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Hazard open" value={hzOpen} note={`${hzLate} lewat due date`} href="/she/hazard" />
        <Stat label="Temuan inspeksi open" value={fdOpen} note={`${fdLate} lewat due date`} href="/she/inspeksi" />
        <Stat label="Insiden belum ditutup" value={incOpen} href="/she/insiden" />
        <Stat label="Unit tidak layak hari ini" value={unfit} href="/she/p2h" />
      </div>
      {s.can('she.report') && (
        <Panel title="Formulir harian">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FORMS.map(([href, t, desc]) => (
              <li key={href}>
                <Link href={href} className="grid gap-1 rounded-md border border-line p-3 hover:border-accent">
                  <span className="font-medium">{t}</span><span className="text-xs text-muted">{desc}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title="Risk register / IBPR" action={<Link href="/she/risiko" className={btnGhost}>Buka</Link>}>
        <p className="text-sm">{riskDraft} risiko menunggu persetujuan · {riskReview} lewat jadwal tinjauan ulang.</p>
      </Panel>
    </>
  );
}
