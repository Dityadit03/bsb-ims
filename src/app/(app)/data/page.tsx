import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, btnGhost } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/documents';
import { DATASETS } from '@/lib/datasets';
import { revokeFeedToken } from './actions';
import { FeedTokens } from './feed-tokens';
import { DataTabs } from './tabs';

export const metadata = { title: 'Laporan & data' };

type Token = { id: string; label: string; hint: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

export default async function DataPage() {
  const supabase = await createClient();
  const { data: tokens } = await supabase.from('feed_tokens').select('*').order('created_at', { ascending: false }).returns<Token[]>();
  const groups = [...new Set(DATASETS.map(d => d.group))];
  const feeds = DATASETS.filter(d => d.feed).map(({ key, label, group }) => ({ key, label, group }));

  return (
    <>
      <PageHeader eyebrow="Laporan & data" title="Tarik data ke Excel & Google Sheets" />
      <DataTabs active="/data" />
      <Panel title="Hubungkan ke Google Sheets">
        <p className="text-sm text-muted">Seperti laporan Portal SHE lama, tetapi tanpa Apps Script: buat link sekali, tempel rumus
          <code className="mx-1 rounded bg-ground px-1 font-mono text-xs">=IMPORTDATA(…)</code> di Google Sheets, lalu pivot/grafik di spreadsheet ikut
          diperbarui otomatis. Link bersifat pribadi; jangan bagikan spreadsheet ke luar perusahaan dan cabut link yang tidak dipakai.</p>
        <FeedTokens feeds={feeds} />
        {tokens?.length ? (
          <Table head={['Spreadsheet', 'Token', 'Dibuat', 'Terakhir dipakai', '']}>
            {tokens.map(t => (
              <tr key={t.id}>
                <td className="text-sm">{t.label}</td>
                <td className="font-mono text-xs">…{t.hint}</td>
                <td className="text-xs">{fmtDateTime(t.created_at)}</td>
                <td className="text-xs">{t.last_used_at ? fmtDateTime(t.last_used_at) : 'Belum'}</td>
                <td>{t.revoked_at ? <Pill>Dicabut</Pill> : <ActionForm action={revokeFeedToken} label="Cabut" confirm="Cabut token ini? Spreadsheet yang memakainya akan berhenti." hidden={{ id: t.id }} />}</td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Panel>
      {groups.map(g => (
        <Panel key={g} title={`Unduh · ${g}`}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {DATASETS.filter(d => d.group === g).map(d => (
              <li key={d.key} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="text-sm">{d.label}{d.feed && <span className="ml-2 text-[11px] text-accent">Sheets</span>}</span>
                <span className="flex shrink-0 gap-1.5">
                  <a href={`/api/ekspor/${d.key}`} className={`${btnGhost} px-2.5 py-1 text-xs`}>Excel</a>
                  <a href={`/api/ekspor/${d.key}?format=csv`} className={`${btnGhost} px-2.5 py-1 text-xs`}>CSV</a>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </>
  );
}
