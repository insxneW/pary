// Обновление расписания с сайта ЛГПУ → telegram-pary/schedule.js
// Запуск: node tools/refresh-schedule.js [--file путь.html] [--write]
const fs = require('fs');
const path = require('path');

const SITE = 'https://lspu-lipetsk.ru/modules.php?name=Raspisite&page=2&kodgruppi=1030266420';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const OUT = path.join(__dirname, '..', 'schedule.js');

const TYPES = [
  'СЕМИНАР/ПРАКТИЧЕСКОЕ ЗАНЯТИЕ', 'ЛАБОРАТОРНОЕ/ПРАКТИЧЕСКОЕ ЗАНЯТИЕ', 'ЛАБОРАТОРНОЕ ЗАНЯТИЕ',
  'ПРАКТИЧЕСКОЕ ЗАНЯТИЕ', 'СЕМИНАРСКОЕ ЗАНЯТИЕ', 'КОНСУЛЬТАЦИЯ', 'ЛЕКЦИЯ', 'СЕМИНАР', 'ЗАЧЁТ', 'ЗАЧЕТ', 'ЭКЗАМЕН',
];
const WD = { 'ПОНЕДЕЛЬНИК': 'Пн', 'ВТОРНИК': 'Вт', 'СРЕДА': 'Ср', 'ЧЕТВЕРГ': 'Чт', 'ПЯТНИЦА': 'Пт', 'СУББОТА': 'Сб' };

function parseLesson(rest) {
  let subgroup = '';
  const sg = rest.match(/^(\d)\s*подгр\.\s*/);
  if (sg) { subgroup = sg[1] + ' подгр.'; rest = rest.slice(sg[0].length); }

  let typeIdx = -1, typeStr = '';
  for (const t of TYPES) {
    const i = rest.toUpperCase().indexOf(t);
    if (i >= 0 && (typeIdx < 0 || i < typeIdx)) { typeIdx = i; typeStr = rest.substr(i, t.length); }
  }
  if (typeIdx < 0) return null;

  const subject = rest.slice(0, typeIdx).trim();
  const after = rest.slice(typeIdx + typeStr.length).trim();

  let teacher = after, room = '', note = '';
  const m = after.match(/(\d{1,3}[А-Яа-я]?\(\d\))/);
  if (m) {
    teacher = after.slice(0, m.index).trim();
    room = m[0];
    note = after.slice(m.index + m[0].length).trim();
  }
  return { subject, type: typeStr, teacher, room, note, subgroup };
}

function parsePage(html) {
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
  if (tables.length < 5) throw new Error('не найдена таблица расписания (таблиц: ' + tables.length + ')');

  const raw = tables[4][1]
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&amp;/g, '&');

  const lines = raw.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const days = [];
  let cur = null;

  for (let line of lines) {
    const dm = line.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*,\s*([А-ЯЁа-яё]+)\s*\((ЧИСЛИТЕЛЬ|ЗНАМЕНАТЕЛЬ)\)/);
    if (dm) {
      cur = {
        date: dm[3] + '-' + dm[2] + '-' + dm[1],
        weekday: WD[dm[4].toUpperCase()],
        weekType: dm[5] === 'ЧИСЛИТЕЛЬ' ? 'num' : 'denom',
        lessons: [],
      };
      days.push(cur);
      line = line.slice(dm[0].length).trim();
      if (!line) continue;
    }
    if (!cur) continue;

    const tm = line.match(/^(\d{1,2}:\d{2})\s*(.*)$/);
    if (!tm) continue;
    const p = parseLesson(tm[2]);
    if (!p) continue;
    cur.lessons.push({ time: tm[1], subject: p.subject, type: p.type, teacher: p.teacher, room: p.room, note: p.note, subgroup: p.subgroup });
  }

  return days.filter((d) => d.lessons.length);
}

// сигнатура содержимого: даты и пары, без метаданных
function signature(obj) {
  return obj.days
    .map((d) => d.date + ':' + d.lessons.map((l) => [l.time, l.subject, l.room, l.teacher, l.subgroup].join('|')).join(';'))
    .join('\n');
}

(async () => {
  const fileArg = process.argv.indexOf('--file');
  let html;

  if (fileArg > 0 && process.argv[fileArg + 1]) {
    html = fs.readFileSync(process.argv[fileArg + 1], 'utf8');
    console.log('источник: файл');
  } else {
    const res = await fetch(SITE, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    html = await res.text();
    console.log('источник: сайт');
  }

  const days = parsePage(html);
  const lessons = days.reduce((n, d) => n + d.lessons.length, 0);

  const data = {
    group: '03-ОФО-ЕМТ-ПЕД(мф)-2026',
    program: '44.03.05 ПЕДАГОГИЧЕСКОЕ ОБРАЗОВАНИЕ, профиль: Математика и физика',
    institute: 'Институт естественных, математических и технических наук',
    semester: '1-й семестр, 2026/27',
    source: SITE,
    days,
  };

  const fresh = 'window.SCHEDULE = ' + JSON.stringify(data) + ';';
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';

  let oldData = null;
  if (old) {
    try { oldData = JSON.parse(old.slice(old.indexOf('{'), old.lastIndexOf('}') + 1)); } catch (_) {}
  }

  console.log('дней: ' + days.length + ', пар: ' + lessons);
  console.log('диапазон: ' + days[0].date + ' — ' + days[days.length - 1].date);

  if (oldData && signature(oldData) === signature(data)) {
    console.log('РАСПИСАНИЕ НЕ ИЗМЕНИЛОСЬ');
    process.exit(0);          // 0 = без изменений
  }

  if (oldData) {
    const oldLessons = oldData.days.reduce((n, d) => n + d.lessons.length, 0);
    console.log('было: ' + oldData.days.length + ' дней, ' + oldLessons + ' пар');
    const added = days.filter((d) => !oldData.days.some((o) => o.date === d.date)).map((d) => d.date);
    const removed = oldData.days.filter((o) => !days.some((d) => d.date === o.date)).map((d) => d.date);
    if (added.length) console.log('новые дни: ' + added.join(', '));
    if (removed.length) console.log('исчезли: ' + removed.join(', '));
  }

  if (process.argv.includes('--write')) {
    fs.writeFileSync(OUT, fresh, 'utf8');
    console.log('ЗАПИСАНО: ' + OUT);
    process.exit(0);          // 0 = записали
  } else {
    console.log('изменения есть. Запустите с --write, чтобы сохранить');
    process.exit(2);          // 2 = есть изменения, файл не тронут
  }
})().catch((e) => { console.error('ОШИБКА: ' + e.message); process.exit(1); });
