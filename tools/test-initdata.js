// Проверка алгоритма подписи Telegram initData (та же логика, что в Edge Function)
// Запуск: node tools/test-initdata.js
const crypto = require('crypto');

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/** Собирает data_check_string: все поля кроме hash, отсортированные по ключу */
function dataCheckString(params) {
  return Object.keys(params)
    .filter((k) => k !== 'hash' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('\n');
}

/** Проверка подписи: hash = HMAC_SHA256(HMAC_SHA256("WebAppData", token), data_check_string) */
function verifyInitData(initData, botToken) {
  const params = {};
  for (const pair of initData.split('&')) {
    const i = pair.indexOf('=');
    if (i < 0) continue;
    params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  }
  const hash = params.hash;
  if (!hash) return { ok: false, reason: 'нет hash' };

  const secret = hmac('WebAppData', botToken);
  const computed = hmac(secret, dataCheckString(params)).toString('hex');

  if (computed !== hash) return { ok: false, reason: 'подпись не совпала' };

  const authDate = Number(params.auth_date || 0);
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (!authDate) return { ok: false, reason: 'нет auth_date' };
  if (ageSec > 86400) return { ok: false, reason: 'данные старше суток' };

  return { ok: true, user: JSON.parse(params.user || '{}') };
}

/** Генерация корректного initData для теста */
function makeInitData(botToken, user, authDate) {
  const params = {
    auth_date: String(authDate || Math.floor(Date.now() / 1000)),
    query_id: 'AAH' + Math.random().toString(36).slice(2, 10),
    user: JSON.stringify(user),
  };
  const dcs = dataCheckString(params);
  const secret = hmac('WebAppData', botToken);
  const hash = hmac(secret, dcs).toString('hex');
  const qs = Object.keys(params).map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
  return qs + '&hash=' + hash;
}

/* ---------------- тесты ---------------- */
const BOT_TOKEN = '123456789:AAHfake_token_for_tests_only_xxxxxxxxx';
const USER = { id: 777000111, first_name: 'Дмитрий', last_name: 'Поздняков', username: 'insxnew' };

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log('✓ ' + name); pass++; } else { console.log('✗ ' + name); fail++; }
}

const valid = makeInitData(BOT_TOKEN, USER);
const r1 = verifyInitData(valid, BOT_TOKEN);
check('корректная подпись принимается', r1.ok === true);
check('id пользователя извлекается', r1.ok && r1.user.id === USER.id);
check('имя извлекается', r1.ok && r1.user.first_name === 'Дмитрий');

const r2 = verifyInitData(valid, '999:другой_токен');
check('чужой токен отвергается', r2.ok === false);

const tampered = valid.replace('777000111', '777000112');
const r3 = verifyInitData(tampered, BOT_TOKEN);
check('подмена id ломает подпись', r3.ok === false);

const old = makeInitData(BOT_TOKEN, USER, Math.floor(Date.now() / 1000) - 90000);
const r4 = verifyInitData(old, BOT_TOKEN);
check('старые данные (2 суток) отвергаются', r4.ok === false);

const r5 = verifyInitData('auth_date=1&user=%7B%7D', BOT_TOKEN);
check('данные без hash отвергаются', r5.ok === false);

console.log(`\nИтого: ${pass} успешно, ${fail} провалено`);
console.log(fail === 0 ? 'ИТОГ: алгоритм подписи работает корректно' : 'ИТОГ: есть ошибки');
process.exit(fail === 0 ? 0 : 1);
