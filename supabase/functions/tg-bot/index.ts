// ============================================================
//  Edge Function: tg-bot
//  Обработчик сообщений бота (webhook).
//  Отвечает на /start приветствием с кнопкой запуска приложения.
//
//  Секреты: BOT_TOKEN, CRON_SECRET (уже заданы)
//  Webhook проверяет заголовок X-Telegram-Bot-Api-Secret-Token
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const APP_URL = 'https://insxnew.github.io/pary/?start=1';
const GROUP = '03-ОФО-ЕМТ-ПЕД(мф)-2026';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sendMessage(token, chatId, text, extra) {
  const payload = Object.assign({ chat_id: chatId, text, parse_mode: 'HTML' }, extra || {});
  const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

Deno.serve(async (req) => {
  try {
    const BOT_TOKEN = Deno.env.get('BOT_TOKEN');
    const SECRET = Deno.env.get('CRON_SECRET');
    if (!BOT_TOKEN) return json({ error: 'no_bot_token' }, 500);
    if (!SECRET) return json({ error: 'no_cron_secret' }, 500);

    // Telegram разрешает в secret_token только A-Za-z0-9_- (до 64 символов),
    // поэтому вместо самого секрета используем его SHA-256
    const hookSecret = await sha256hex(SECRET);

    // --- режим регистрации: вызывается вручную с x-cron-secret ---
    // Telegram API недоступен из российских сетей, поэтому setWebhook
    // выполняем отсюда — с серверов Supabase.
    let body = {};
    try { body = await req.json(); } catch (_) {}

    if (body && body.register === true) {
      if (req.headers.get('x-cron-secret') !== SECRET) return json({ error: 'forbidden' }, 403);

      const selfUrl = Deno.env.get('SUPABASE_URL') + '/functions/v1/tg-bot';
      const results = {};

      const hook = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/setWebhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: selfUrl,
          secret_token: hookSecret,
          allowed_updates: ['message'],
          drop_pending_updates: true,
        }),
      }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
      results.setWebhook = hook;

      const cmds = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/setMyCommands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: [
            { command: 'start', description: 'Открыть расписание' },
            { command: 'help', description: 'Что умеет бот' },
            { command: 'id', description: 'Мой Telegram ID' },
          ],
        }),
      }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
      results.setMyCommands = cmds;

      const short = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/setMyShortDescription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_description: 'Расписание, посещаемость и напоминания о парах' }),
      }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
      results.setMyShortDescription = short;

      const desc = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/setMyDescription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description:
            'Расписание группы ' + GROUP + '\n\n' +
            'Пары на любой день, аудитории и преподаватели, отметка посещаемости ' +
            'и напоминание за 20 минут до занятия.\n\n' +
            'Нажмите «Начать», чтобы открыть приложение.',
        }),
      }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
      results.setMyDescription = desc;

      // кнопка «Пары» с меткой времени — обходит кэш Telegram
      const appUrl = 'https://insxnew.github.io/pary/?t=' + Date.now();
      const menu = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/setChatMenuButton', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menu_button: { type: 'web_app', text: 'Пары', web_app: { url: appUrl } },
        }),
      }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
      results.setChatMenuButton = menu;
      results.appUrl = appUrl;

      return json({ ok: true, registered: true, url: selfUrl, results });
    }

    // Telegram присылает этот заголовок, если webhook зарегистрирован с secret_token
    if (req.headers.get('x-telegram-bot-api-secret-token') !== hookSecret) {
      return json({ error: 'forbidden' }, 403);
    }

    const update = body;
    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) return json({ ok: true });

    const chatId = msg.chat.id;
    const from = msg.from || {};
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'друг';
    const text = String(msg.text).trim();

    // регистрируем в базе сразу — человек появится до первого открытия приложения
    try {
      const db = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
      await db.from('students').upsert(
        { tg_id: from.id, full_name: name, username: from.username || null, updated_at: new Date().toISOString() },
        { onConflict: 'tg_id' }
      );
    } catch (_) {}

    const openButton = {
      inline_keyboard: [[{ text: '📚 Открыть расписание', web_app: { url: APP_URL } }]],
    };

    if (/^\/start/.test(text)) {
      await sendMessage(
        BOT_TOKEN,
        chatId,
        'Привет, <b>' + esc(name) + '</b>! 👋\n\n' +
        'Это <b>Пары</b> — расписание группы <b>' + esc(GROUP) + '</b>.\n\n' +
        'Внутри: пары на любой день, аудитории и преподаватели, отметка посещаемости и напоминание за 20 минут до занятия.\n\n' +
        'Нажмите кнопку ниже 👇',
        { reply_markup: openButton }
      );
      return json({ ok: true });
    }

    if (/^\/help/.test(text)) {
      await sendMessage(
        BOT_TOKEN,
        chatId,
        '<b>Что умеет бот</b>\n\n' +
        '/start — открыть приложение\n' +
        '/help — эта справка\n\n' +
        'За 20 минут до пары придёт напоминание с предметом, временем и аудиторией.\n' +
        'Расписание и посещаемость — в приложении по кнопке ниже.',
        { reply_markup: openButton }
      );
      return json({ ok: true });
    }

    if (/^\/id/.test(text)) {
      await sendMessage(BOT_TOKEN, chatId, 'Ваш Telegram ID: <code>' + from.id + '</code>');
      return json({ ok: true });
    }

    // любое другое сообщение — мягко направляем в приложение
    await sendMessage(
      BOT_TOKEN,
      chatId,
      'Я понимаю только команды 🙂\nНажмите кнопку, чтобы открыть расписание.',
      { reply_markup: openButton }
    );
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
