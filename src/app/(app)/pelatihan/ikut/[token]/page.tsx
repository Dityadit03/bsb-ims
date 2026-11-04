import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { checkinTraining, submitFeedback, submitTest } from '../../../hrga/actions';
import { input } from '@/components/ui';

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
  const { data: pg } = await supabase.rpc('training_my_progress', { p_token: token });
  const prog = ((pg ?? []) as { kind: string; attended: boolean; questions: number; pre_score: number | null; post_score: number | null; feedback_done: boolean }[])[0];
  const internal = prog?.kind === 'internal';
  const { data: qd } = internal && t.joined ? await supabase.rpc('training_test_questions', { p_token: token }) : { data: [] };
  const questions = (qd ?? []) as { id: string; question: string; options: string[] }[];
  const phase = prog && prog.questions > 0 ? (prog.pre_score == null ? 'pre' : prog.post_score == null ? 'post' : null) : null;
  const feedbackReady = internal && t.joined && !prog.feedback_done && (prog.questions === 0 || prog.post_score != null);
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
      {internal && t.joined && phase && questions.length > 0 && (
        <Panel title={phase === 'pre' ? 'Pra-tes' : 'Pasca-tes'} sub={phase === 'pre' ? 'Kerjakan sebelum materi dimulai. Hasil tidak mempengaruhi kelulusan.' : 'Kerjakan setelah materi selesai. Satu kali kirim.'}>
          <ActionForm action={submitTest} label="Kirim jawaban" primary hidden={{ token, phase }}>
            {questions.map((q, i) => (
              <fieldset key={q.id} className="grid gap-1 text-sm">
                <legend className="font-medium">{i + 1}. {q.question}</legend>
                {q.options.map((o, k) => <label key={k} className="flex items-center gap-2 py-1"><input type="radio" name={`q_${q.id}`} value={k} required className="size-4" />{o}</label>)}
              </fieldset>
            ))}
          </ActionForm>
        </Panel>
      )}
      {internal && t.joined && prog.questions > 0 && (prog.pre_score != null || prog.post_score != null) && (
        <p className="text-sm text-muted">Nilai Anda: pra-tes {prog.pre_score ?? '–'}{prog.post_score != null ? ` · pasca-tes ${prog.post_score}` : ''}</p>
      )}
      {feedbackReady && (
        <Panel title="Umpan balik" sub="Nilai 1 (kurang) sampai 5 (sangat baik).">
          <ActionForm action={submitFeedback} label="Kirim umpan balik" primary hidden={{ token }}>
            <div className="grid gap-3 sm:grid-cols-3">
              {[['material', 'Materi'], ['speaker', 'Narasumber'], ['organization', 'Penyelenggaraan']].map(([k, l]) => (
                <label key={k} className="grid gap-1 text-sm">{l}
                  <select name={k} required defaultValue="" className={input}><option value="" disabled>Pilih</option>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
              ))}
            </div>
            <label className="grid gap-1 text-sm">Saran / komentar<textarea name="comment" rows={3} className={input} /></label>
          </ActionForm>
        </Panel>
      )}
      {internal && prog.feedback_done && <Pill tone="ok">Umpan balik sudah dikirim. Terima kasih.</Pill>}
    </>
  );
}
