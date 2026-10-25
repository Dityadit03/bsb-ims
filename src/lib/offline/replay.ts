'use client';
import { clock } from '@/app/(app)/hrga/waktu-actions';
import { reportHazard, submitP2h } from '@/app/(app)/she/actions';
import { fieldsToForm, listQueue, removeItem, updateItem, type QueueKind } from './queue';

type Result = { error?: string; ok?: string };
export const ACTIONS: Record<QueueKind, (s: Result, f: FormData) => Promise<Result>> = { p2h: submitP2h, hazard: reportHazard, absen: clock };

// P2H "tidak layak" mengembalikan error bernada peringatan padahal datanya sudah tersimpan
const saved = (r: Result) => !r.error || /tersimpan/i.test(r.error);

export const MAX_TRIES = 3; // galat dari server dicoba ulang beberapa kali (bisa sementara) sebelum dianggap ditolak
let running = false;

// Kirim antrean berurutan. Berhenti di kegagalan jaringan (dicoba lagi nanti); kegagalan validasi ditandai agar dikoreksi/dihapus pengguna.
export async function flushQueue(): Promise<{ sent: number; left: number }> {
  if (running || typeof navigator === 'undefined' || !navigator.onLine) return { sent: 0, left: (await listQueue()).length };
  running = true;
  let sent = 0;
  try {
    for (const item of await listQueue()) {
      if (item.error && item.tries >= MAX_TRIES) continue;
      const fd = fieldsToForm(item.fields);
      fd.set('queued', '1');
      try {
        const r = await ACTIONS[item.kind]({}, fd);
        if (saved(r)) { await removeItem(item.id); sent++; }
        else await updateItem({ ...item, tries: item.tries + 1, error: r.error });
      } catch {
        await updateItem({ ...item, tries: item.tries + 1 });
        break; // jaringan/sesi bermasalah: coba lagi nanti
      }
    }
  } finally { running = false; }
  return { sent, left: (await listQueue()).length };
}
