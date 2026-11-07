// ============================================================
//  Edge Function: tg-broadcast
//  Рассылка сообщения всем студентам из базы.
//
//  Вызов: POST с заголовком x-cron-secret
//  Тело:  {"text": "текст сообщения"}
//
//  Секреты: BOT_TOKEN, CRON_SECRET (уже заданы)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const BOT_TOKEN = Deno.env.get('BOT_TOKEN');
    const CRON_SECRET = Deno.env.get('CRON_SECRET');
    if (!BOT_TOKEN) return json({ error: 'no_bot_token' }, 500);
    if (!CRON_SECRET) return json({ error: 'no_cron_secret' }, 500);
    if (req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'forbidden' }, 403);

    const body = await req.json().catch(() => ({}));
    const text = String(body.text || '').trim();
    if (!text) return json({ error: 'no_text' }, 400);
    if (text.length > 4000) return json({ error: 'text_too_long' }, 400);

    const db = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    const { data: students, error } = await db.from('students').select('tg_id, full_name');
    if (error) return json({ error: error.message }, 500);

    const list = students || [];
    if (!list.length) return json({ ok: true, total: 0, sent: 0, failed: 0 });

    let sent = 0;
    const failed = [];

    for (const st of list) {
      try {
        const r = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: st.tg_id, text }),
        });
        const res = await r.json();
        if (res.ok) sent++;
        else failed.push({ tg_id: st.tg_id, error: res.description || 'unknown' });
      } catch (e) {
        failed.push({ tg_id: st.tg_id, error: String(e) });
      }
      await sleep(60);   // Telegram: не больше ~30 сообщений в секунду
    }

    return json({ ok: true, total: list.length, sent, failed: failed.length, details: failed });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
