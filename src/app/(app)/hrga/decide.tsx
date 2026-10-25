import { ActionForm } from '@/components/action-form';
import { input } from '@/components/ui';
import type { ActionState } from './waktu-actions';

type Act = (s: ActionState, f: FormData) => Promise<ActionState>;

// Setujui / tolak (alasan wajib) untuk cuti dan SPL; pengecekan wewenang tetap di database.
export function Decide({ id, action, approveLabel = 'Setujui' }: { id: string; action: Act; approveLabel?: string }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionForm action={action} label={approveLabel} primary hidden={{ id, approve: '1' }} />
      <details className="text-sm">
        <summary className="cursor-pointer rounded-lg border border-line px-3.5 py-2 hover:border-crit/60">Tolak</summary>
        <ActionForm action={action} label="Kirim penolakan" hidden={{ id, approve: '0' }} className="mt-2 w-64">
          <input name="note" required placeholder="Alasan penolakan" className={input} />
        </ActionForm>
      </details>
    </div>
  );
}
