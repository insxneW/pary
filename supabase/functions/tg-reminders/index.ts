// ============================================================
//  Edge Function: tg-reminders
//  Раз в 10 минут находит пары, до которых ~20 минут,
//  и пишет студентам в Telegram.
//
//  Секреты (Project Settings → Edge Functions → Secrets):
//    BOT_TOKEN    — токен бота (уже есть)
//    CRON_SECRET  — любой длинный пароль для защиты вызова
//
//  Расписание читается с опубликованного сайта, поэтому
//  после обновления расписания ничего пересылать не нужно.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SCHEDULE_URL = 'https://insxnew.github.io/pary/schedule.js';
const MSK_OFFSET_MIN = 180;     // Москва UTC+3
const WINDOW_FROM = 15;         // напоминаем за 15–25 минут
const WINDOW_TO = 25;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function mskNow() {
  const d = new Date(Date.now() + MSK_OFFSET_MIN * 60000);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function minutesUntil(lessonTime, nowTime) {
  const [lh, lm] = lessonTime.split(':').map(Number);
  const [nh, nm] = nowTime.split(':').map(Number);
  return (lh * 60 + lm) - (nh * 60 + nm);
}

/** schedule.js → объект расписания */
async function loadSchedule() {
  const res = await fetch(SCHEDULE_URL, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error('schedule fetch ' + res.status);
  const text = await res.text();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return JSON.parse(text.slice(start, end + 1));
}

Deno.serve(async (req) => {
  try {
    const BOT_TOKEN = Deno.env.get('BOT_TOKEN');
    const CRON_SECRET = Deno.env.get('CRON_SECRET');
    if (!BOT_TOKEN) return json({ error: 'no_bot_token' }, 500);
    if (!CRON_SECRET) return json({ error: 'no_cron_secret' }, 500);
    if (req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'forbidden' }, 403);

    const db = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

    const body = await req.json().catch(() => ({}));

    // Тестовый режим: body = {"test": true} — отправить проверочное сообщение всем
    if (body && body.test) {
      const { data: all } = await db.from('students').select('tg_id, full_name').eq('reminders', true);
      let n = 0;
      for (const st of all || []) {
        await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: st.tg_id,
            text: '✅ Проверка напоминаний\n\nВсё работает. За 20 минут до пары придёт сообщение с предметом, временем и аудиторией.',
          }),
        });
        n++;
      }
      return json({ ok: true, test: true, sent: n });
    }

    const schedule = await loadSchedule();
    const now = mskNow();
    const day = (schedule.days || []).find((d) => d.date === now.date);
    if (!day) return json({ ok: true, note: 'no lessons today', date: now.date });

    const upcoming = day.lessons.filter((l) => {
      const left = minutesUntil(l.time, now.time);
      return left >= WINDOW_FROM && left <= WINDOW_TO;
    });
    if (!upcoming.length) return json({ ok: true, note: 'nothing soon', date: now.date, time: now.time });

    const { data: students, error } = await db
      .from('students')
      .select('tg_id, full_name, subgroup, reminders')
      .eq('reminders', true);
    if (error) return json({ error: error.message }, 500);

    const sent = [];
    for (const lesson of upcoming) {
      const lessonKey = now.date.replace(/-/g, '') + 'T' + lesson.time.replace(':', '');

      for (const st of students || []) {
        // подгруппа: общие пары видит каждый, «чужие» — нет
        if (lesson.subgroup && st.subgroup && !String(lesson.subgroup).startsWith(String(st.subgroup))) continue;

        const ins = await db.from('reminders').insert({
          tg_id: st.tg_id,
          lesson_key: lessonKey,
          title: lesson.subject,
        });
        if (ins.error) {
          if (ins.error.code === '23505') continue;  // уже отправляли
          continue;
        }

        const text =
          '🔔 Через 20 минут пара\n\n' +
          '📚 ' + lesson.subject + '\n' +
          '🕒 ' + lesson.time + '\n' +
          (lesson.room ? '⌖ ауд. ' + lesson.room + '\n' : '') +
          (lesson.teacher ? '☺ ' + lesson.teacher + '\n' : '');

        await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: st.tg_id, text }),
        });

        sent.push({ tg_id: st.tg_id, subject: lesson.subject });
      }
    }

    return json({ ok: true, date: now.date, time: now.time, upcoming: upcoming.length, sent: sent.length, details: sent });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
