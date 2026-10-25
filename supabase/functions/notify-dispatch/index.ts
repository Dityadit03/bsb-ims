// Edge Function: menguras antrean notification_outbox untuk kanal push dan WhatsApp (Meta Cloud API).
// Dipicu trigger database (pg_net) dan pg_cron tiap menit; aman dipanggil berulang (klaim memakai skip locked).
// Kunci service-role dan VAPID privat hanya ada di lingkungan fungsi ini, tidak di aplikasi Next.js maupun git.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type Sub = { endpoint: string; p256dh: string; auth: string };
type Job = { id: string; title: string; body: string; link: string | null; subs: Sub[] };

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return new Response(JSON.stringify({ error: 'VAPID belum diatur' }), { status: 500 });
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@bsb.co.id', pub, priv);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let done = 0, failed = 0;
  for (let round = 0; round < 5; round++) {
    const { data, error } = await db.rpc('dispatch_claim_push', { p_limit: 50 });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    const jobs = (data ?? []) as Job[];
    if (!jobs.length) break;
    await Promise.all(jobs.map(async j => {
      const dead: string[] = [];
      let ok = false, err: string | null = j.subs.length ? null : 'Tidak ada perangkat';
      // isi minimal: judul, cuplikan pendek, tautan; rincian dibuka di aplikasi setelah masuk
      const payload = JSON.stringify({ title: j.title, body: j.body, link: j.link ?? '/tugas', tag: j.id });
      await Promise.all(j.subs.map(async s => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' });
          ok = true;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) dead.push(s.endpoint);
          else err = `HTTP ${code ?? '?'} ${(e as Error).message}`.slice(0, 200);
        }
      }));
      // seluruh langganan sudah mati = tidak ada yang perlu dicoba lagi
      if (!ok && dead.length === j.subs.length && j.subs.length) { ok = true; err = 'Semua langganan sudah tidak berlaku'; }
      await db.rpc('dispatch_complete_push', { p_id: j.id, p_ok: ok, p_error: err, p_dead: dead });
      ok ? done++ : failed++;
    }));
  }

  // WhatsApp: hanya berjalan bila rahasia Meta sudah diisi. Token tidak pernah di database atau aplikasi.
  const waToken = Deno.env.get('WA_TOKEN'), waPhone = Deno.env.get('WA_PHONE_ID');
  let waDone = 0, waFailed = 0;
  if (waToken && waPhone) {
    const tpl = Deno.env.get('WA_TEMPLATE') ?? 'notifikasi_bsb', lang = Deno.env.get('WA_LANG') ?? 'id';
    for (let round = 0; round < 5; round++) {
      const { data, error } = await db.rpc('dispatch_claim_whatsapp', { p_limit: 30 });
      if (error) break;
      const jobs = (data ?? []) as { id: string; title: string; phone: string | null }[];
      if (!jobs.length) break;
      for (const j of jobs) {
        if (!j.phone) { await db.rpc('dispatch_complete_whatsapp', { p_id: j.id, p_ok: false, p_error: 'Tidak ada nomor / tidak ikut lagi', p_skip: true }); continue; }
        try {
          const r = await fetch(`https://graph.facebook.com/v21.0/${waPhone}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messaging_product: 'whatsapp', to: j.phone, type: 'template',
              // parameter template tidak boleh berisi baris baru; hanya judul pendek
              template: { name: tpl, language: { code: lang }, components: [{ type: 'body', parameters: [{ type: 'text', text: j.title.replace(/\s+/g, ' ').slice(0, 100) }] }] },
            }),
          });
          const body = await r.json().catch(() => ({}));
          const ok = r.ok;
          await db.rpc('dispatch_complete_whatsapp', { p_id: j.id, p_ok: ok, p_error: ok ? null : `HTTP ${r.status} ${body?.error?.message ?? ''}`.slice(0, 200), p_provider_id: body?.messages?.[0]?.id ?? null });
          ok ? waDone++ : waFailed++;
        } catch (e) {
          await db.rpc('dispatch_complete_whatsapp', { p_id: j.id, p_ok: false, p_error: (e as Error).message.slice(0, 200) });
          waFailed++;
        }
      }
    }
  }
  return new Response(JSON.stringify({ done, failed, waDone, waFailed }), { headers: { 'Content-Type': 'application/json' } });
});
