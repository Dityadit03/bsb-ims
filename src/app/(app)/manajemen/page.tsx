import Link from 'next/link';
import { PageHeader, Panel, Pill, Stat, Table } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { ton } from '@/lib/production';
import { MgmtTabs } from './tabs';

export const metadata = { title: 'Dashboard eksekutif' };

type Kpi = Record<string, number | string | boolean | null>;
type El = { code: string; title: string; requirements: number; with_evidence: number; coverage_pct: number | null; capa_open: number; capa_overdue: number };

const tone = (p: number | null) => (p == null ? 'muted' : p >= 80 ? 'ok' : p >= 50 ? 'warn' : 'crit');

export default async function DashboardPage() {
  const supabase = await createClient();
  const [{ data: k }, { data: els }] = await Promise.all([
    supabase.from('executive_kpi').select('*').single<Kpi>(),
    supabase.from('smkp_element_status').select('*').order('sort_order').returns<El[]>(),
  ]);
  const n = (key: string) => Number(k?.[key] ?? 0);
  const target = n('tonnage_target');

  return (
    <>
      <PageHeader eyebrow="SMKP elemen 7 · Tinjauan manajemen" title="Dashboard eksekutif" />
      <MgmtTabs active="/manajemen" />
      {k?.review_overdue ? (
        <p className="rounded border border-crit/40 bg-crit/10 p-3 text-sm">Tinjauan manajemen terakhir: {k.last_review_date ? fmtDate(String(k.last_review_date)) : 'belum pernah'}. Wajib minimal sekali setahun. <Link href="/manajemen/tinjauan" className="text-accent">Jadwalkan →</Link></p>
      ) : null}
      <h2 className="text-sm font-medium text-muted">Keselamatan</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Insiden tahun ini" value={n('incidents_ytd')} note={`LTI/fatal ${n('lti_ytd')} · nearmiss ${n('nearmiss_ytd')}`} href="/she/insiden" />
        <Stat label="Hazard terbuka" value={n('hazards_open')} href="/she/hazard" />
        <Stat label="Inspeksi 30 hari" value={n('inspections_30d')} href="/she/inspeksi" />
        <Stat label="P2H 30 hari" value={n('p2h_30d')} note={`${n('p2h_unfit_30d')} tidak layak`} href="/she/p2h" />
      </div>
      <h2 className="text-sm font-medium text-muted">Operasional</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Tonase bulan ini (disetujui)" value={ton(n('tonnage_mtd'))} note={target ? `${((n('tonnage_mtd') / target) * 100).toFixed(1)}% dari ${ton(target)}` : 'Target belum ditetapkan'} href="/produksi" />
        <Stat label="PA rata-rata 30 hari" value={k?.pa_avg == null ? '–' : `${k.pa_avg}%`} note={`${n('wo_open')} WO terbuka`} href="/plant" />
        <Stat label="Stok di bawah minimum" value={n('low_stock')} note={`${n('mr_pending')} MR menunggu persetujuan`} href="/logistik?rendah=1" />
        <Stat label="Kompetensi wajib belum terpenuhi" value={n('competency_gaps')} note={`${n('competency_expiring')} segera habis`} href="/hrga/kompetensi" />
      </div>
      <h2 className="text-sm font-medium text-muted">Sistem manajemen</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Bukti SMKP (12 bulan)" value={k?.smkp_coverage_pct == null ? '–' : `${k.smkp_coverage_pct}%`} note="Persyaratan dengan bukti diterima" href="/smkp" />
        <Stat label="Action plan terbuka" value={n('capa_open')} note={`${n('capa_overdue')} lewat target`} href="/capa" />
        <Stat label="Audit internal tahun ini" value={n('audits_ytd')} note={`${n('findings_without_capa')} temuan tanpa action plan`} href="/manajemen/audit" />
        <Stat label="Dokumen lewat jadwal tinjau" value={n('documents_review_overdue')} href="/dokumen" />
      </div>
      <Panel title="Capaian elemen SMKP">
        {els?.length ? (
          <Table head={['Elemen', 'Persyaratan', 'Ada bukti', 'Cakupan', 'Action plan terbuka', 'Lewat target']}>
            {els.map(e => (
              <tr key={e.code}>
                <td className="text-sm"><span className="font-mono text-xs">E{e.code}</span> · {e.title}</td>
                <td className="tabular text-xs">{e.requirements}</td>
                <td className="tabular text-xs">{e.with_evidence}</td>
                <td><Pill tone={tone(e.coverage_pct)}>{e.coverage_pct == null ? '–' : `${e.coverage_pct}%`}</Pill></td>
                <td className="tabular text-xs">{e.capa_open}</td>
                <td className="tabular text-xs">{e.capa_overdue ? <span className="font-medium text-crit">{e.capa_overdue}</span> : 0}</td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">Master SMKP belum terisi.</p>}
        <p className="text-xs text-muted">Cakupan = persyaratan terbawah yang berlaku dengan bukti diterima dalam 12 bulan terakhir. Ini bukan nilai audit resmi; bobot penilaian mengikuti pedoman yang dikonfirmasi.</p>
      </Panel>
    </>
  );
}
