'use client';
import { clock } from '@/app/(app)/hrga/waktu-actions';
import { reportBreakdown } from '@/app/(app)/plant/actions';
import { reportHazard, submitP2h } from '@/app/(app)/she/actions';
import { fieldsToForm, listQueue, removeItem, updateItem, type QueueKind } from './queue';

type Result = { error?: string; ok?: string };
export const ACTIONS: Record<QueueKind, (s: Result, f: FormData) => Promise<Result>> = { p2h: submitP2h, hazard: reportHazard, absen: clock, breakdown: reportBreakdown };

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
      let fd: FormData;
      try { fd = await fieldsToForm(item.fields); } catch {
        await updateItem({ ...item, tries: MAX_TRIES, error: 'Foto di antrean tidak bisa dibaca lagi oleh ponsel. Hapus butir ini lalu isi ulang laporannya.' });
        continue;
      }
      fd.set('queued', '1');
      try {
        const r = await ACTIONS[item.kind]({}, fd);
        if (saved(r)) { await removeItem(item.id); sent++; }
        else await updateItem({ ...item, tries: item.tries + 1, error: r.error });
      } catch (e) {
        // galat jaringan/sesi: catat agar terlihat, dan jangan biarkan satu butir menahan butir lain selamanya
        await updateItem({ ...item, tries: item.tries + 1, error: `Gagal terkirim (${(e as Error)?.message || 'jaringan'})` });
        if (!navigator.onLine) break;
      }
    }
  } finally { running = false; }
  return { sent, left: (await listQueue()).length };
}
