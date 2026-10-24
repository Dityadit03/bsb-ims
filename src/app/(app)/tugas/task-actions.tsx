'use client';
import { useActionState, useState } from 'react';
import { btn, btnGhost, btnPrimary, input } from '@/components/ui';
import { actOnTask } from './actions';

const APPROVE_LABEL: Record<string, string> = { review: 'Setujui review', verify: 'Lolos verifikasi', approve: 'Setujui dokumen' };

export function TaskActions({ taskId, subjectHash, kind }: { taskId: string; subjectHash: string; kind: string }) {
  const [state, action, pending] = useActionState(actOnTask, {});
  const [mode, setMode] = useState<'approve' | 'return' | 'reject'>('approve');
  return (
    <form action={action} className="grid gap-2 border-t border-line pt-3">
      <input type="hidden" name="task" value={taskId} />
      <input type="hidden" name="hash" value={subjectHash} />
      <input type="hidden" name="decision" value={mode} />
      {mode !== 'approve' && (
        <textarea id={`comment-${taskId}`} name="comment" required rows={2} className={input}
          placeholder={mode === 'return' ? 'Apa yang perlu diperbaiki pemohon?' : 'Alasan penolakan'} />
      )}
      {mode === 'approve' && <input type="hidden" name="comment" value="" />}
      <div className="flex flex-wrap items-center gap-2">
        {mode === 'approve' ? (
          <>
            <button className={btnPrimary} disabled={pending}>{pending ? 'Memproses…' : APPROVE_LABEL[kind] ?? 'Setujui'}</button>
            <button type="button" className={btnGhost} onClick={() => setMode('return')}>Kembalikan untuk revisi</button>
            <button type="button" className={`${btn} text-crit hover:underline`} onClick={() => setMode('reject')}>Tolak</button>
          </>
        ) : (
          <>
            <button className={mode === 'reject' ? `${btn} bg-crit text-white` : btnPrimary} disabled={pending}>
              {mode === 'return' ? 'Kirim kembali ke pemohon' : 'Tolak pengajuan'}
            </button>
            <button type="button" className={btnGhost} onClick={() => setMode('approve')}>Batal</button>
          </>
        )}
        {state.error && <span role="alert" className="text-sm text-crit">{state.error}</span>}
      </div>
    </form>
  );
}
