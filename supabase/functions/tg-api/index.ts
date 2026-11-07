import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const enc = new TextEncoder();
const hex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

async function verify(initData, botToken) {
  const p = {};
  initData.split('&').forEach((pair) => {
    const i = pair.indexOf('=');
    if (i > 0) p[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  });
  const fields = Object.keys(p).sort();
  if (!p.hash) return { fail: { error: 'no_hash', fields } };

  const secret = await hmac(enc.encode('WebAppData'), botToken);

  // Telegram в разных клиентах считает хэш по-разному: с полем signature или без.
  // Пробуем оба варианта — это совместимо со старыми и новыми данными.
  const variants = [
    fields.filter((k) => k !== 'hash'),
    fields.filter((k) => k !== 'hash' && k !== 'signature'),
  ];

  let matched = null;
  let lastComputed = '';
  for (const v of variants) {
    const dcs = v.map((k) => k + '=' + p[k]).join('\n');
    const computed = hex(await hmac(secret, dcs));
    lastComputed = computed;
    if (computed === p.hash) { matched = v.length; break; }
  }

  if (matched === null) {
    return { fail: {
      error: 'hash_mismatch',
      fields,
      hasSignature: 'signature' in p,
      expectedPrefix: lastComputed.slice(0, 8),
      gotPrefix: String(p.hash).slice(0, 8),
    } };
  }

  if (!p.auth_date) return { fail: { error: 'no_auth_date', fields } };
  const age = Math.floor(Date.now() / 1000) - Number(p.auth_date);
  if (age > 86400) return { fail: { error: 'expired', age, fields } };
  if (!p.user) return { fail: { error: 'no_user', fields } };

  try {
    const u = JSON.parse(p.user);
    if (!u || !u.id) return { fail: { error: 'user_without_id', fields } };
    return { user: u, variant: matched };
  } catch (e) {
    return { fail: { error: 'user_parse_failed', fields } };
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const BOT_TOKEN = Deno.env.get('BOT_TOKEN');
    if (!BOT_TOKEN) return json({ error: 'no_bot_token' }, 500);

    const db = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    const body = await req.json();
    if (!body.initData) return json({ error: 'no_init_data' }, 400);

    const res = await verify(body.initData, BOT_TOKEN);
    if (res.fail) {
      console.log('AUTH FAIL ' + JSON.stringify(res.fail));
      return json(res.fail, 401);
    }

    const u = res.user;
    const tgId = u.id;
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Student';

    await db.from('students').upsert(
      { tg_id: tgId, full_name: fullName, username: u.username || null, updated_at: new Date().toISOString() },
      { onConflict: 'tg_id' }
    );

    const action = body.action;
    const pl = body.payload || {};

    if (action === 'me') {
      const student = (await db.from('students').select('*').eq('tg_id', tgId).single()).data;
      const attendance = (await db.from('attendance').select('lesson_key, present').eq('tg_id', tgId)).data;
      return json({ student: student, attendance: attendance || [] });
    }

    if (action === 'mark') {
      const w = await db.from('attendance').upsert({
        tg_id: tgId,
        lesson_key: pl.lessonKey,
        lesson_date: pl.date,
        lesson_time: pl.time,
        subject: pl.subject || null,
        present: pl.present !== false,
        marked_by: tgId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tg_id,lesson_key' });
      return w.error ? json({ error: w.error.message }, 500) : json({ ok: true });
    }

    if (action === 'subgroup') {
      const w = await db.from('students').update({ subgroup: Number(pl.subgroup) || null }).eq('tg_id', tgId);
      return w.error ? json({ error: w.error.message }, 500) : json({ ok: true });
    }

    if (action === 'group') {
      const w = await db.from('group_attendance').select('*');
      return w.error ? json({ error: w.error.message }, 500) : json({ students: w.data || [] });
    }

    if (action === 'roster') {
      const w = await db.from('students').select('tg_id, full_name, subgroup, role').order('full_name');
      return w.error ? json({ error: w.error.message }, 500) : json({ students: w.data || [] });
    }

    if (action === 'starosta_mark') {
      const meRow = (await db.from('students').select('role').eq('tg_id', tgId).single()).data;
      if (!meRow || meRow.role !== 'starosta') return json({ error: 'not_starosta' }, 403);
      if (!pl.tgId || !pl.lessonKey) return json({ error: 'need_tgId_and_lessonKey' }, 400);

      const w = await db.from('attendance').upsert({
        tg_id: pl.tgId,
        lesson_key: pl.lessonKey,
        lesson_date: pl.date,
        lesson_time: pl.time,
        subject: pl.subject || null,
        present: pl.present !== false,
        marked_by: tgId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tg_id,lesson_key' });
      return w.error ? json({ error: w.error.message }, 500) : json({ ok: true });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
