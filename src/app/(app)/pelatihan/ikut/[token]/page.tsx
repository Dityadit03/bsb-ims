import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { checkinTraining } from '../../../hrga/actions';

export const metadata = { title: 'Kehadiran pelatihan' };

type T = { id: string; title: string; held_on: string; start_time: string | null; hours: number; location: string | null; description: string | null; trainer: string;
  speaker_org: string | null; speaker_bio: string | null; status: string; qr_open: boolean; joined: boolean };

// Halaman tujuan QR: peserta (sudah login) melihat info pelatihan lalu menekan Hadir. Kehadiran dicatat atas nama akunnya sendiri.
export default async function TrainingCheckin({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc('training_by_token', { p_token: token });
  const t = ((data ?? []) as T[])[0];
  if (!t) return <p className="text-sm text-muted">QR pelatihan tidak dikenal.</p>;
  const closed = t.status !== 'planned' || !t.qr_open;

  return (
    <>
      <PageHeader eyebrow={`Pelatihan · ${fmtDate(t.held_on)}${t.start_time ? ` · ${t.start_time.slice(0, 5)}` : ''} · ${t.hours} jam`} title={t.title} />
      <Panel title="Narasumber">
        <p className="text-sm font-medium">{t.trainer}{t.speaker_org ? ` · ${t.speaker_org}` : ''}</p>
        {t.speaker_bio && <p className="whitespace-pre-line text-sm text-muted">{t.speaker_bio}</p>}
        {t.location && <p className="text-sm">Lokasi: {t.location}</p>}
        {t.description && <p className="whitespace-pre-line text-sm">{t.description}</p>}
      </Panel>
      <Panel title="Kehadiran">
        {t.joined ? <Pill tone="ok">Kehadiran Anda sudah tercatat</Pill>
          : closed ? <p className="text-sm text-warn">Kehadiran untuk pelatihan ini sudah ditutup.</p>
          : <ActionForm action={checkinTraining} label="Hadir" primary hidden={{ token }}>
              <p className="text-sm text-muted">Dengan menekan Hadir, Anda mencatat kehadiran atas nama akun Anda sendiri.</p>
            </ActionForm>}
      </Panel>
    </>
  );
}
