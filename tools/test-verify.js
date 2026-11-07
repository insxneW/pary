// Проверка устойчивой валидации initData (две стратегии хэша)
const crypto = require('crypto');

const enc = (s) => Buffer.from(s, 'utf8');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
const hex = (b) => b.toString('hex');

function makeInitData(token, params, signMode) {
  // signMode: 'no_sig' | 'sig_in_hash' | 'sig_out_hash'
  const p = Object.assign({}, params);
  if (signMode !== 'no_sig') p.signature = 'abc123def456';
  const keys = Object.keys(p).filter((k) => k !== 'hash').sort();
  const use = signMode === 'sig_out_hash' ? keys.filter((k) => k !== 'signature') : keys;
  const dcs = use.map((k) => k + '=' + p[k]).join('\n');
  const secret = hmac(enc('WebAppData'), token);
  p.hash = hex(hmac(secret, dcs));
  return Object.keys(p).map((k) => k + '=' + encodeURIComponent(p[k])).join('&');
}

// Логика из Edge Function
function verify(initData, botToken) {
  const p = {};
  initData.split('&').forEach((pair) => {
    const i = pair.indexOf('=');
    if (i > 0) p[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  });
  const fields = Object.keys(p).sort();
  if (!p.hash) return { fail: 'no_hash' };

  const secret = hmac(enc('WebAppData'), botToken);
  const variants = [
    fields.filter((k) => k !== 'hash'),
    fields.filter((k) => k !== 'hash' && k !== 'signature'),
  ];
  let matched = null;
  for (const v of variants) {
    const dcs = v.map((k) => k + '=' + p[k]).join('\n');
    if (hex(hmac(secret, dcs)) === p.hash) { matched = v.length; break; }
  }
  if (matched === null) return { fail: 'hash_mismatch' };

  const age = Math.floor(Date.now() / 1000) - Number(p.auth_date || 0);
  if (age > 86400) return { fail: 'expired' };
  return { ok: true, matched };
}

const TOKEN = '8687407867:AAGyU6X31OT014Fn2g4OtRjG6h35C6OQyEc';
const base = {
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: 'AAHtest',
  user: JSON.stringify({ id: 999000111, first_name: 'TEST' }),
};

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log('✓ ' + name); pass++; } else { console.log('✗ ' + name); fail++; }
}

for (const mode of ['no_sig', 'sig_in_hash', 'sig_out_hash']) {
  const data = makeInitData(TOKEN, base, mode);
  const r = verify(data, TOKEN);
  check(`${mode}: принимается`, r.ok === true);
}

const wrong = makeInitData('999:другой', base, 'sig_in_hash');
check('чужой токен отвергается', verify(wrong, TOKEN).ok !== true);

const tampered = makeInitData(TOKEN, base, 'sig_in_hash').replace('999000111', '999000112');
check('подмена id отвергается', verify(tampered, TOKEN).ok !== true);

console.log(`\nИтого: ${pass} успешно, ${fail} провалено`);
process.exit(fail === 0 ? 0 : 1);
