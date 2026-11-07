/* Пары — Mini App. Работает на реальном расписании ЛГПУ (schedule.js). */

const S = window.SCHEDULE || { group: 'Группа', days: [] };
let KI = window.KIIMO || null;

/** расписание колледжа грузим только если оно выбрано */
function ensureKiimo() {
  return new Promise((res) => {
    if (KI) return res(true);
    const s = document.createElement('script');
    s.src = 'schedule-kiimo.js?v=15';
    s.onload = () => { KI = window.KIIMO || null; res(!!KI); };
    s.onerror = () => res(false);
    document.head.appendChild(s);
  });
}
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DAYS_ALL = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DAY_NAME = { Вс: 'воскресенье', Пн: 'понедельник', Вт: 'вторник', Ср: 'среда', Чт: 'четверг', Пт: 'пятница', Сб: 'суббота' };
const DAY_PREP = { Пн: 'в понедельник', Вт: 'во вторник', Ср: 'в среду', Чт: 'в четверг', Пт: 'в пятницу', Сб: 'в субботу', Вс: 'в воскресенье' };
const STORE_BASE = 'pary.user.v4';
const CLOUD_BASE = 'pary_user_v4';
const VER = 'v15';
const CONTACT = 'honness';

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const cfg = window.PARY_CONFIG || null;

/* ---------- сервер ---------- */
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((res) => setTimeout(() => res(fallback), ms)),
  ]);
}

let lastApi = null;   // для диагностики в профиле

async function api(action, payload) {
  if (!cfg || !cfg.apiUrl) { lastApi = { action, status: 'нет config.js' }; return null; }
  if (!tg || !tg.initData) { lastApi = { action, status: 'нет initData (вне Telegram)' }; return null; }

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;

  try {
    const res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey || '' },
      body: JSON.stringify({ initData: tg.initData, action, payload: payload || {} }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const text = await res.text();
    lastApi = { action, status: res.status + (text ? ' ' + text.slice(0, 90) : '') };
    if (!res.ok) return null;
    try { return JSON.parse(text); } catch (_) { return null; }
  } catch (e) {
    lastApi = { action, status: 'сеть: ' + (e && e.name ? e.name : 'ошибка') };
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let me = null;                                   // пользователь Telegram
let storeKey = STORE_BASE + '.local';
let cloudKey = CLOUD_BASE + '.local';

let user = { students: [], notes: {}, custom: {}, attendance: {}, subgroup: 0, role: 'student', me: null, savedAt: 0 };

let roster = [];              // список студентов группы (для старосты)
let starostaMarks = {};       // { tg_id: present }
let starostaTime = '';        // выбранная пара
let currentTab = 'home';
let currentDate = '';
let currentDay = 'Пн';          // выбранный день недели (для КИИМО)
let schedSeg = 'days';
let editingId = null;
let notesKey = '';

/* ---------- даты ---------- */
function dateStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function todayStr() { return dateStr(new Date()); }
function nowHHMM() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function weekdayOf(s) { return DAYS_ALL[parseDate(s).getDay()]; }
function fmtDate(s) { const d = parseDate(s); return d.getDate() + ' ' + ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'][d.getMonth()]; }
function fmtShort(s) { const d = parseDate(s); return d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0'); }

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + mins;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

/* ---------- данные ---------- */
function scheduleDay(date) { return (S.days || []).find((d) => d.date === date) || null; }

/* пара подходит под выбранную подгруппу (0 = показывать все) */
function matchesSubgroup(l) {
  if (!user.subgroup) return true;
  if (!l.subgroup) return true;
  return String(l.subgroup).indexOf(String(user.subgroup)) === 0;
}

function lessonsForDate(date) {
  const rec = scheduleDay(date);
  const base = rec ? rec.lessons.map((l) => ({ ...l, id: l.time + '|' + l.subject })).filter(matchesSubgroup) : [];
  const extra = (user.custom[date] || []).map((l) => ({ ...l, custom: true }));
  return base.concat(extra).sort((a, b) => a.time.localeCompare(b.time));
}

function sortedDays() { return (S.days || []).slice().sort((a, b) => a.date.localeCompare(b.date)); }

function upcomingDates(limit) {
  const today = todayStr();
  const list = sortedDays().filter((d) => d.date >= today).map((d) => d.date);
  return list.slice(0, limit || 10);
}

function nextLesson() {
  const today = todayStr();
  const now = nowHHMM();
  for (const d of sortedDays()) {
    if (d.date < today) continue;
    for (const l of lessonsForDate(d.date)) {
      if (d.date === today && l.time <= now) continue;
      return { date: d.date, lesson: l };
    }
  }
  return null;
}

function nextForSubject(name) {
  const today = todayStr();
  for (const d of sortedDays()) {
    if (d.date < today) continue;
    const l = d.lessons.find((x) => x.subject === name);
    if (l) return { date: d.date, time: l.time };
  }
  return null;
}

function subjectStats() {
  const map = new Map();
  const today = todayStr();
  for (const d of sortedDays()) {
    for (const l of d.lessons) {
      if (!map.has(l.subject)) map.set(l.subject, { name: l.subject, teachers: new Set(), total: 0, done: 0 });
      const s = map.get(l.subject);
      s.total++;
      if (d.date < today) s.done++;
      if (l.teacher) s.teachers.add(l.teacher);
    }
  }
  return [...map.values()].map((s) => ({
    name: s.name,
    teacher: [...s.teachers].map(shortTeacher).join(', '),
    total: s.total,
    done: s.done,
    next: (() => { const n = nextForSubject(s.name); return n ? dayPrep(n.date) + ', ' + n.time : ''; })(),
  })).sort((a, b) => b.total - a.total);
}

function teacherStats() {
  const map = new Map();
  for (const d of sortedDays()) {
    for (const l of d.lessons) {
      if (!l.teacher) continue;
      if (!map.has(l.teacher)) map.set(l.teacher, { name: l.teacher, subjects: new Set(), total: 0 });
      const t = map.get(l.teacher);
      t.total++;
      t.subjects.add(l.subject);
    }
  }
  return [...map.values()]
    .map((t) => ({ name: shortTeacher(t.name), subjects: [...t.subjects].join(', '), total: t.total }))
    .sort((a, b) => b.total - a.total);
}

function semesterStats() {
  const days = sortedDays();
  const today = todayStr();
  let total = 0, done = 0, daysLeft = 0;
  for (const d of days) {
    total += d.lessons.length;
    if (d.date < today) done += d.lessons.length;
    if (d.date >= today) daysLeft++;
  }
  return { total, done, left: total - done, daysLeft, percent: total ? Math.round((done / total) * 100) : 0 };
}

function weekCounts() {
  const today = parseDate(todayStr());
  const dow = (today.getDay() + 6) % 7; // Пн = 0
  const monday = new Date(today); monday.setDate(today.getDate() - dow);
  const res = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const ds = dateStr(d);
    const rec = scheduleDay(ds);
    res.push({ label: ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][i], count: rec ? rec.lessons.length : 0, date: ds });
  }
  return res;
}

/* ---------- форматирование ---------- */
function shortTeacher(full) {
  if (!full) return '';
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return capitalize(parts[0]);
  const surname = capitalize(parts[0]);
  const initials = parts.slice(1).map((p) => capitalize(p)[0] + '.').join('');
  return surname + ' ' + initials;
}
function capitalize(w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }

function shortType(t) {
  if (!t) return '';
  const s = t.toUpperCase();
  if (s.includes('ЛЕКЦИ')) return 'Лекция';
  if (s.includes('ЛАБОРАТОР')) return 'Лабораторная';
  if (s.includes('ЗАЧЁТ') || s.includes('ЗАЧЕТ')) return 'Зачёт';
  if (s.includes('ЭКЗАМЕН')) return 'Экзамен';
  if (s.includes('СЕМИНАР/ПРАКТ')) return 'Практика';
  if (s.includes('ПРАКТИЧЕСК')) return 'Практика';
  if (s.includes('СЕМИНАР')) return 'Семинар';
  return t;
}

function dayPrep(date) {
  const wd = weekdayOf(date);
  return DAY_PREP[wd] + ', ' + fmtDate(date);
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- хранение ---------- */
/* CloudStorage: 4 КБ на ключ, поэтому посещаемость кладём частями */
const CLOUD_CHUNK = 3500;

function saveUser() {
  user.savedAt = Date.now();
  try { localStorage.setItem(storeKey, JSON.stringify(user)); } catch (_) {}
  if (!tg || !tg.CloudStorage) return;

  try {
    const att = Object.keys(user.attendance || {}).filter((k) => user.attendance[k]);
    const light = Object.assign({}, user, { attendance: {} });
    tg.CloudStorage.setItem(cloudKey, JSON.stringify(light));

    const payload = att.join(',');
    const parts = [];
    for (let i = 0; i < payload.length; i += CLOUD_CHUNK) parts.push(payload.slice(i, i + CLOUD_CHUNK));
    if (!parts.length) parts.push('');

    parts.forEach((p, i) => { try { tg.CloudStorage.setItem(cloudKey + '.a' + i, p); } catch (_) {} });
    for (let i = parts.length; i < parts.length + 3; i++) {
      try { tg.CloudStorage.removeItem(cloudKey + '.a' + i); } catch (_) {}
    }
  } catch (_) {}
}

function loadUserLocal() { try { const r = localStorage.getItem(storeKey); return r ? JSON.parse(r) : null; } catch (_) { return null; } }

function loadUserCloud() {
  return new Promise((res) => {
    if (!tg || !tg.CloudStorage) return res(null);
    try {
      tg.CloudStorage.getItem(cloudKey, (e, v) => {
        if (e || !v) return res(null);
        let base;
        try { base = JSON.parse(v); } catch (_) { return res(null); }

        const parts = [];
        let i = 0;
        const finish = () => {
          if (parts.length) {
            const att = {};
            parts.join('').split(',').filter(Boolean).forEach((k) => { att[k] = true; });
            base.attendance = att;
          }
          res(base);
        };
        const next = () => {
          if (i >= 8) return finish();
          tg.CloudStorage.getItem(cloudKey + '.a' + i, (e2, v2) => {
            if (e2 || v2 === null || v2 === undefined) return finish();
            parts.push(v2); i++; next();
          });
        };
        next();
      });
    } catch (_) { res(null); }
  });
}

/* ---------- КИИМО: недельное расписание ---------- */
const KI_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];

function isKiimo() { return user.institution === 'kiimo' && !!KI; }

/** цвет текущей недели: зелёная / белая (чередуются от опорной даты) */
function weekColor(dateStrValue) {
  const anchorStr = (KI && KI.weekAnchor && KI.weekAnchor.date) || '2026-11-02';
  const greenAtAnchor = (KI && KI.weekAnchor && KI.weekAnchor.color) === 'green';
  const d = parseDate(dateStrValue || todayStr());
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const weeks = Math.round((monday - parseDate(anchorStr)) / (7 * 86400000));
  const even = (((weeks % 2) + 2) % 2) === 0;
  const isGreen = even ? greenAtAnchor : !greenAtAnchor;
  return isGreen ? 'green' : 'white';
}

/** пары КИИМО на день недели с учётом цвета недели и подгруппы */
function kiimoLessons(day, dateStrValue) {
  if (!KI) return [];
  const color = weekColor(dateStrValue);
  const out = [];
  for (const p of (KI.days[day] || [])) {
    const entries = (p.entries || []).filter((e) =>
      (e.week === 'both' || e.week === color) &&
      (!e.subgroup || !user.subgroup || e.subgroup === user.subgroup));
    for (const e of entries) {
      out.push({ time: p.start, end: p.end, subject: e.subject, teacher: e.teacher, room: e.room, pair: p.pair });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/** дата указанного дня недели в текущей неделе */
function dateForDay(day) {
  const idx = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'].indexOf(day);
  const today = parseDate(todayStr());
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const d = new Date(monday);
  d.setDate(monday.getDate() + Math.max(idx, 0));
  return dateStr(d);
}

/* ---------- ГЛАВНАЯ ---------- */
function renderHome() {
  if (isKiimo()) return renderHomeKiimo();
  return renderHomeDefault();
}

function renderHomeKiimo() {
  const today = todayStr();
  const wd = weekdayOf(today);
  const color = weekColor(today);
  document.getElementById('homeDate').textContent =
    capitalize(DAY_NAME[wd]) + ', ' + fmtDate(today) + ' · ' + (color === 'green' ? 'зелёная' : 'белая') + ' неделя';

  const todayList = KI_DAYS.includes(wd) ? kiimoLessons(wd, today) : [];
  const now = nowHHMM();
  const left = todayList.filter((l) => (l.end || l.time) > now);

  const h = document.getElementById('homeHeadline');
  if (!KI_DAYS.includes(wd)) h.textContent = 'Выходной';
  else if (!todayList.length) h.textContent = 'Пар на сегодня нет';
  else if (!left.length) h.textContent = 'Пары на сегодня\nзакончились';
  else h.textContent = 'Пары на сегодня';
  h.style.whiteSpace = 'pre-line';

  let nx = null, nxDay = null;
  if (left.length) { nx = left[0]; nxDay = today; }
  else {
    for (let step = 1; step <= 7 && !nx; step++) {
      const d = new Date(parseDate(today));
      d.setDate(d.getDate() + step);
      const w = DAYS_ALL[d.getDay()];
      if (!KI_DAYS.includes(w)) continue;
      const list = kiimoLessons(w, dateStr(d));
      if (list.length) { nx = list[0]; nxDay = w; }
    }
  }

  const box = document.getElementById('homeNext');
  if (nx) {
    const when = nxDay === today ? 'Сегодня в ' + nx.time : capitalize(DAY_PREP[weekdayOf(nxDay === today ? today : dateForDay(nxDay))]) + ' в ' + nx.time;
    box.innerHTML = `<div class="next-card">
      <div class="next-when">${escapeHtml(when)}</div>
      <div class="next-subject">${escapeHtml(nx.subject)}</div>
      <div class="next-row"><span class="ico">⌖</span>${escapeHtml(nx.room ? 'ауд. ' + nx.room : 'аудитория не указана')}</div>
      <div class="next-row"><span class="ico">☺</span>${escapeHtml(shortTeacher(nx.teacher) || '—')}</div>
    </div>`;
  } else {
    box.innerHTML = '<div class="next-card"><div class="next-when">Расписание закончилось</div><div class="next-subject">Выходные</div></div>';
  }

  const planDay = left.length ? wd : (nx ? (nxDay === today ? wd : nxDay) : wd);
  const planList = KI_DAYS.includes(planDay) ? kiimoLessons(planDay, dateForDay(planDay)) : [];
  document.getElementById('planTitle').textContent = 'План на ' + DAY_PREP[planDay].replace('в ', '');
  document.getElementById('planMeta').textContent = planList.length
    ? `${planList.length} ${plural(planList.length, 'пара', 'пары', 'пар')} · ${planList[0].time}-${planList[planList.length - 1].end}`
    : '';
  document.getElementById('planList').innerHTML = planList.length
    ? planList.map((l) => lessonRow(l, dateForDay(planDay))).join('')
    : '<div class="hint">Пар нет</div>';
}

/* ---------- РЕНДЕР ГЛАВНОЙ ---------- */
function renderHomeDefault() {
  const today = todayStr();
  const todayLessons = lessonsForDate(today);
  const now = nowHHMM();
  const leftToday = todayLessons.filter((l) => l.time > now);

  document.getElementById('homeDate').textContent = capitalize(DAY_NAME[weekdayOf(today)]) + ', ' + fmtDate(today);

  const h = document.getElementById('homeHeadline');
  if (!todayLessons.length) h.textContent = 'Пар на сегодня нет';
  else if (!leftToday.length) h.textContent = 'Пары на сегодня\nзакончились';
  else h.textContent = 'Пары на сегодня';
  h.style.whiteSpace = 'pre-line';

  const nx = nextLesson();
  const box = document.getElementById('homeNext');
  if (nx) {
    const l = nx.lesson;
    const when = nx.date === today ? 'Сегодня в ' + l.time : (capitalize(dayPrep(nx.date)) + ' в ' + l.time);
    box.innerHTML = `<div class="next-card">
      <div class="next-when">${escapeHtml(when)}</div>
      <div class="next-subject">${escapeHtml(l.subject)}</div>
      <div class="next-row"><span class="ico">⌖</span>${escapeHtml(l.room ? 'ауд. ' + l.room : 'аудитория не указана')}</div>
      <div class="next-row"><span class="ico">☺</span>${escapeHtml(shortTeacher(l.teacher) || '—')}</div>
    </div>`;
  } else {
    box.innerHTML = '<div class="next-card"><div class="next-when">Расписание закончилось</div><div class="next-subject">Сессия</div></div>';
  }

  const planDate = leftToday.length ? today : (nx ? nx.date : today);
  const planLessons = lessonsForDate(planDate);
  document.getElementById('planTitle').textContent = 'План на ' + DAY_PREP[weekdayOf(planDate)].replace('в ', '');
  const first = planLessons[0], last = planLessons[planLessons.length - 1];
  document.getElementById('planMeta').textContent = planLessons.length
    ? `${planLessons.length} ${plural(planLessons.length, 'пара', 'пары', 'пар')} · ${first.time}-${addMinutes(last.time, 90)}`
    : '';
  document.getElementById('planList').innerHTML = planLessons.length
    ? planLessons.map((l) => lessonRow(l, planDate)).join('')
    : '<div class="hint">Пар нет</div>';
}

/* компактный ключ отметки: 20261105T0940 (экономит место в CloudStorage) */
function attKey(date, time) { return date.replace(/-/g, '') + 'T' + String(time).replace(/:/g, ''); }

function lessonRow(l, date) {
  const endTime = l.end || addMinutes(l.time, 90);
  const past = date < todayStr() || (date === todayStr() && endTime < nowHHMM());
  const bits = [shortType(l.type), l.room ? 'ауд. ' + l.room : '', l.subgroup || ''].filter(Boolean);
  const key = attKey(date, l.time);
  const marked = !!(user.attendance && user.attendance[key]);
  const canMark = past && !l.custom;
  return `<div class="lesson${past ? ' past' : ''}">
    <div class="bar"></div>
    <div class="time">${escapeHtml(l.time)}</div>
    <div class="info">
      <div class="subj">${escapeHtml(l.subject)}</div>
      <div class="sub">${escapeHtml(bits.join(' · '))}</div>
    </div>
    ${canMark ? `<button class="att${marked ? ' on' : ''}" data-att="${escapeHtml(key)}" title="Отметить посещение">${marked ? '✓' : '○'}</button>` : ''}
    ${l.custom ? `<button class="del" data-del="${l.id}" data-date="${date}">✕</button>` : ''}
  </div>`;
}

/* посещаемость: считаем прошедшие пары, отмеченные вручную */
function attendanceStats() {
  const today = todayStr();
  let total = 0, marked = 0;
  for (const d of sortedDays()) {
    if (d.date >= today) continue;
    for (const l of lessonsForDate(d.date)) {
      if (l.custom) continue;
      total++;
      if (user.attendance && user.attendance[attKey(d.date, l.time)]) marked++;
    }
  }
  return { total, marked, percent: total ? Math.round((marked / total) * 100) : 0 };
}

/* статистика по всей группе с сервера */
async function loadGroupStats() {
  const res = await api('group');
  const meta = document.getElementById('grpMeta');
  const text = document.getElementById('grpText');
  if (!meta || !text) return;

  if (!res || !res.students) {
    meta.textContent = '';
    text.textContent = 'Общая статистика появится, когда приложение откроют из Telegram.';
    return;
  }
  const rows = res.students;
  const count = rows.length;
  const marks = rows.reduce((n, r) => n + Number(r.marked_count || 0), 0);
  const present = rows.reduce((n, r) => n + Number(r.present_count || 0), 0);
  const avg = marks ? Math.round((present / marks) * 100) : 0;

  meta.textContent = count ? count + ' чел.' : '';
  text.textContent = count
    ? 'Средняя посещаемость по группе: ' + avg + '%. Всего отметок: ' + marks + '.'
    : 'Пока никого нет — откройте приложение из Telegram, и вы появитесь в списке.';
}

/* ---------- РАСПИСАНИЕ ---------- */
function renderSchedule() {
  document.querySelectorAll('#schedSegs .seg').forEach((b) => b.classList.toggle('active', b.dataset.seg === schedSeg));

  // даже если отрисовка упадёт — переключение разделов сработает
  try {
    renderDaysTab();
    renderSubjectsTab();
    renderTeachersTab();
    renderSessionTab();
  } finally {
    ['subjects', 'teachers', 'session'].forEach((s) => {
      const el = document.getElementById('seg' + s[0].toUpperCase() + s.slice(1));
      if (el) el.classList.toggle('hidden', s !== schedSeg);
    });
    const days = document.getElementById('segDays');
    if (days) days.classList.toggle('hidden', schedSeg !== 'days');
  }
}

function renderDaysTab() {
  if (isKiimo()) return renderDaysTabKiimo();
  return renderDaysTabDefault();
}

function renderDaysTabKiimo() {
  if (!KI_DAYS.includes(currentDay)) currentDay = 'Пн';
  const today = todayStr();

  document.getElementById('dayChips').innerHTML = KI_DAYS.map((d) =>
    `<button class="day-btn${d === currentDay ? ' active' : ''}${d === today ? ' today' : ''}" data-day="${d}">
      <span>${d}</span><small>${fmtShort(dateForDay(d))}</small>
    </button>`).join('');

  const date = dateForDay(currentDay);
  const list = kiimoLessons(currentDay, date);
  const color = weekColor(date);
  const meta = `<div class="card-meta" style="margin-bottom:10px">${color === 'green' ? 'зелёная' : 'белая'} неделя</div>`;
  const content = document.getElementById('dayContent');

  content.innerHTML = list.length
    ? `<div class="card">${meta}${list.map((l) => lessonRow(l, date)).join('')}</div>`
    : `<div class="card">${meta}<div class="hint">Пар нет</div></div>`;
}

function renderDaysTabDefault() {
  const dates = upcomingDates(10);
  if (!currentDate || !dates.includes(currentDate)) currentDate = dates[0] || todayStr();

  document.getElementById('dayChips').innerHTML = dates.map((d) => {
    const wd = weekdayOf(d);
    return `<button class="day-btn${d === currentDate ? ' active' : ''}${d === todayStr() ? ' today' : ''}" data-date="${d}">
      <span>${wd}</span><small>${fmtShort(d)}</small>
    </button>`;
  }).join('');

  const list = lessonsForDate(currentDate);
  const rec = scheduleDay(currentDate);
  const content = document.getElementById('dayContent');
  const meta = rec ? `<div class="card-meta" style="margin-bottom:10px">${rec.weekType === 'num' ? 'числитель' : 'знаменатель'}</div>` : '';
  if (!list.length) {
    content.innerHTML = `<div class="card">${meta}<div class="hint">Пар нет</div>
      <div class="row-buttons"><button class="ghost" id="addLessonBtn">+ Своя пара</button></div></div>`;
  } else {
    content.innerHTML = `<div class="card">${meta}${list.map((l) => lessonRow(l, currentDate)).join('')}
      <div class="row-buttons"><button class="ghost" id="addLessonBtn">+ Своя пара</button></div></div>`;
  }
}

function kiimoAllWeek() {
  const out = [];
  KI_DAYS.forEach((d) => kiimoLessons(d, dateForDay(d)).forEach((l) => out.push(Object.assign({ day: d }, l))));
  return out;
}

function renderSubjectsTabKiimo() {
  const map = new Map();
  kiimoAllWeek().forEach((l) => {
    if (!map.has(l.subject)) map.set(l.subject, { name: l.subject, teachers: new Set(), total: 0 });
    const s = map.get(l.subject);
    s.total++;
    if (l.teacher) s.teachers.add(l.teacher);
  });
  const rows = [...map.values()].sort((a, b) => b.total - a.total);
  document.getElementById('segSubjects').innerHTML = '<div class="card">' + (rows.length ? rows.map((s) => `
    <div class="subject-row">
      <div class="sr-main">
        <div class="sr-name">${escapeHtml(s.name)}</div>
        <div class="sr-teacher">${escapeHtml([...s.teachers].map(shortTeacher).join(', '))}</div>
      </div>
      <div class="sr-count">${s.total} в неделю</div>
    </div>`).join('') : '<div class="hint">Нет данных</div>') + '</div>';
}

function renderTeachersTabKiimo() {
  const map = new Map();
  kiimoAllWeek().forEach((l) => {
    if (!l.teacher) return;
    if (!map.has(l.teacher)) map.set(l.teacher, { name: l.teacher, subjects: new Set(), total: 0 });
    const t = map.get(l.teacher);
    t.total++;
    t.subjects.add(l.subject);
  });
  const rows = [...map.values()].sort((a, b) => b.total - a.total);
  document.getElementById('segTeachers').innerHTML = '<div class="card">' + (rows.length ? rows.map((t) => `
    <div class="teacher-row">
      <div class="sr-main">
        <div class="sr-name">${escapeHtml(shortTeacher(t.name))}</div>
        <div class="sr-teacher">${escapeHtml([...t.subjects].join(', '))} · ${t.total} ${plural(t.total, 'пара', 'пары', 'пар')}</div>
      </div><div class="chev">›</div>
    </div>`).join('') : '<div class="hint">Нет данных</div>') + '</div>';
}

function renderSubjectsTab() {
  if (isKiimo()) return renderSubjectsTabKiimo();
  const stats = subjectStats();
  document.getElementById('segSubjects').innerHTML = '<div class="card">' + (stats.length ? stats.map((s) => {
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    return `<div class="subject-row">
      <div class="sr-main">
        <div class="sr-name">${escapeHtml(s.name)}</div>
        <div class="sr-teacher">${escapeHtml(s.teacher)}</div>
        <div class="progress${pct < 50 ? ' orange' : ''}"><i style="width:${pct}%"></i></div>
        <div class="sr-next">${s.next ? 'Следующая: ' + escapeHtml(s.next) : 'Больше не будет'}</div>
      </div>
      <div class="sr-count">${s.done} из ${s.total}</div>
    </div>`;
  }).join('') : '<div class="hint">Нет данных</div>') + '</div>';
}

function renderTeachersTab() {
  if (isKiimo()) return renderTeachersTabKiimo();
  const stats = teacherStats();
  document.getElementById('segTeachers').innerHTML = '<div class="card">' + (stats.length ? stats.map((t) => `
    <div class="teacher-row">
      <div class="sr-main">
        <div class="sr-name">${escapeHtml(t.name)}</div>
        <div class="sr-teacher">${escapeHtml(t.subjects)} · ${t.total} ${plural(t.total, 'пара', 'пары', 'пар')}</div>
      </div><div class="chev">›</div>
    </div>`).join('') : '<div class="hint">Нет данных</div>') + '</div>';
}

function renderSessionTab() {
  if (isKiimo()) {
    document.getElementById('segSession').innerHTML = '<div class="card"><div class="hint">Сессия колледжа в этом расписании не публикуется — только занятия на семестр.</div></div>';
    return;
  }
  const exams = [];
  for (const d of sortedDays()) {
    for (const l of d.lessons) {
      if (/ЗАЧЁТ|ЗАЧЕТ|ЭКЗАМЕН|КОНСУЛЬТАЦИЯ/i.test(l.type || '')) exams.push({ ...l, date: d.date });
    }
  }
  document.getElementById('segSession').innerHTML = '<div class="card">' + (exams.length
    ? exams.map((e) => `<div class="lesson"><div class="bar"></div><div class="time">${escapeHtml(e.time)}</div>
        <div class="info"><div class="subj">${escapeHtml(e.subject)}</div>
        <div class="sub">${escapeHtml(shortType(e.type))} · ${escapeHtml(fmtShort(e.date))}</div></div></div>`).join('')
    : '<div class="hint">Зачёты и экзамены ещё не назначены — в текущем расписании до 25 декабря их нет.</div>') + '</div>';
}

/* ---------- УЧЁБА ---------- */
function renderStudy() {
  if (isKiimo()) return renderStudyKiimo();
  return renderStudyDefault();
}

function renderStudyKiimo() {
  const counts = KI_DAYS.map((d) => kiimoLessons(d, dateForDay(d)).length);
  const total = counts.reduce((a, b) => a + b, 0);
  document.getElementById('weekTotal').textContent = `${total} ${plural(total, 'пара', 'пары', 'пар')}`;
  document.getElementById('tileWeekCount').textContent = `${total} ${plural(total, 'пара', 'пары', 'пар')}`;

  const max = Math.max(1, ...counts);
  document.getElementById('weekChart').innerHTML = KI_DAYS.map((d, i) => `
    <div class="chart-col">
      <div class="chart-val">${counts[i] || ''}</div>
      <div class="chart-bar${counts[i] ? ' has' : ''}" style="height:${counts[i] ? Math.round((counts[i] / max) * 100) : 4}%"></div>
      <div class="chart-day">${d}</div>
    </div>`).join('');

  document.getElementById('ringLabel').textContent = '—';
  document.getElementById('semStats').innerHTML = 'Семестр считается только для ЛГПУ';

  let totalL = 0, marked = 0;
  const today = todayStr();
  KI_DAYS.forEach((d) => {
    const date = dateForDay(d);
    if (date > today) return;
    kiimoLessons(d, date).forEach((l) => {
      totalL++;
      if (user.attendance && user.attendance[attKey(date, l.time)]) marked++;
    });
  });
  const pct = totalL ? Math.round((marked / totalL) * 100) : 0;
  document.getElementById('attMeta').textContent = totalL ? pct + '%' : '';
  document.getElementById('attBar').style.width = pct + '%';
  document.getElementById('attText').textContent = totalL
    ? 'На этой неделе отмечено ' + marked + ' из ' + totalL + ' пар.'
    : 'На этой неделе прошедших пар пока нет.';

  loadGroupStats();
}

function renderStudyDefault() {
  const counts = weekCounts();
  const total = counts.reduce((a, b) => a + b.count, 0);
  document.getElementById('weekTotal').textContent = `${total} ${plural(total, 'пара', 'пары', 'пар')}`;
  document.getElementById('tileWeekCount').textContent = `${total} ${plural(total, 'пара', 'пары', 'пар')}`;
  const max = Math.max(1, ...counts.map((c) => c.count));
  document.getElementById('weekChart').innerHTML = counts.map((c) => `
    <div class="chart-col">
      <div class="chart-val">${c.count || ''}</div>
      <div class="chart-bar${c.count ? ' has' : ''}" style="height:${c.count ? Math.round((c.count / max) * 100) : 4}%"></div>
      <div class="chart-day">${c.label}</div>
    </div>`).join('');

  const sem = semesterStats();
  document.getElementById('ringLabel').textContent = sem.percent + '%';
  const C = 2 * Math.PI * 42;
  const ring = document.getElementById('ringFg');
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C - (C * sem.percent) / 100;
  document.getElementById('semStats').innerHTML =
    `${sem.done} ${plural(sem.done, 'пара', 'пары', 'пар')} прошли, ${sem.left} впереди<br>${sem.daysLeft} учебных дней до конца`;

  const att = attendanceStats();
  document.getElementById('attMeta').textContent = att.total ? att.percent + '%' : '';
  document.getElementById('attBar').style.width = att.percent + '%';
  document.getElementById('attText').textContent = att.total
    ? 'Отмечено ' + att.marked + ' из ' + att.total + ' прошедших пар. Нажмите ○ у пары, чтобы отметить посещение.'
    : 'Прошедших пар пока нет — посещаемость начнёт считаться после первых занятий.';

  loadGroupStats();
}

/* ---------- ПРОФИЛЬ ---------- */
function renderProfile() {
  const nameEl = document.getElementById('profileName');
  if (me) {
    const full = [me.first_name, me.last_name].filter(Boolean).join(' ');
    nameEl.textContent = full || 'Студент';
  } else {
    nameEl.textContent = 'Студент (браузер)';
  }
  document.getElementById('profileGroup').textContent =
    (isKiimo() ? (KI.name + ' · ' + KI.group) : (S.group || 'Группа')) + ' · ' + VER +
    (user.role === 'starosta' ? ' · староста' : '') +
    (me && me.username ? ' · @' + me.username : '');

  const sub = user.subgroup || 0;
  document.getElementById('sub1').style.boxShadow = sub === 1 ? 'inset 0 0 0 1.5px var(--accent)' : '';
  document.getElementById('sub2').style.boxShadow = sub === 2 ? 'inset 0 0 0 1.5px var(--accent)' : '';
  document.getElementById('subHint').textContent = sub
    ? 'Показаны пары подгруппы ' + sub + ' и общие. Нажмите ещё раз, чтобы показать все.'
    : 'Показаны все пары. Выберите подгруппу, чтобы скрыть чужие.';

  const n = user.students.length;
  document.getElementById('studentsCount').textContent = n ? `${n} ${plural(n, 'студент', 'студента', 'студентов')}` : '';
  document.getElementById('studentsList').innerHTML = n
    ? user.students.map((s, i) => `<div class="student-row"><span class="num">${i + 1}</span><span>${escapeHtml(s.name)}</span>${s.zachetka ? `<span class="grp">${escapeHtml(s.zachetka)}</span>` : ''}</div>`).join('')
    : '<div class="hint">База пуста. Импортируйте список студентов или добавьте вручную.</div>';

  const diag = document.getElementById('diagText');
  if (diag) {
    const idLen = tg && tg.initData ? tg.initData.length : 0;
    diag.innerHTML = 'Версия: <b>' + VER + '</b><br>' +
      'Заведение: ' + (isKiimo() ? 'КИИМО' : 'ЛГПУ') + '<br>' + 'initData: ' + (idLen ? idLen + ' симв.' : 'пусто (открыто вне Telegram)') + '<br>' +
      'Сервер: ' + (lastApi ? escapeHtml(lastApi.action + ' → ' + lastApi.status) : 'запрос ещё не выполнялся') +
      (renderErrors.length ? '<br><span style="color:#ff8080">Сбой: ' + escapeHtml(renderErrors.join(' | ')) + '</span>' : '');
  }
}

/* ошибки отрисовки — показываем в диагностике, а не молча */
let renderErrors = [];

function safeRender(name, fn) {
  try { fn(); }
  catch (e) {
    renderErrors.push(name + ': ' + (e && e.message ? e.message : String(e)));
    console.error('render ' + name, e);
  }
}

function render() {
  renderErrors = [];
  document.getElementById('groupLabel').textContent = isKiimo()
    ? (KI.name + ' · ' + KI.group)
    : (S.group || 'Группа').replace('03-ОФО-ЕМТ-', '');
  safeRender('home', renderHome);
  safeRender('schedule', renderSchedule);
  safeRender('study', renderStudy);
  safeRender('profile', renderProfile);
  safeRender('starosta', renderStarosta);

  const banner = document.getElementById('errBanner');
  if (banner) {
    if (renderErrors.length) {
      banner.textContent = 'Сбой: ' + renderErrors.slice(0, 2).join(' | ');
      banner.classList.remove('hidden');
    } else {
      banner.textContent = '';
      banner.classList.add('hidden');
    }
  }
}

/* ---------- шторки ---------- */
function showSheet(id) { document.getElementById(id).classList.remove('hidden'); }
function closeSheets() { document.querySelectorAll('.sheet').forEach((s) => s.classList.add('hidden')); }

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.dataset.screen !== tab));
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  window.scrollTo(0, 0);
}

/* ---------- события ---------- */
function initEvents() {
  document.querySelectorAll('.tab').forEach((b) => { if (b.dataset.tab) b.onclick = () => switchTab(b.dataset.tab); });

  document.getElementById('micBtn').onclick = () => {
    notesKey = todayStr();
    document.getElementById('notesHint').textContent = 'Заметка на ' + fmtDate(notesKey);
    document.getElementById('notesArea').value = user.notes[notesKey] || '';
    showSheet('notesSheet');
  };
  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = closeSheets; });
  document.querySelectorAll('.sheet').forEach((s) => { s.onclick = (e) => { if (e.target === s) closeSheets(); }; });
  document.getElementById('saveNotes').onclick = () => {
    user.notes[notesKey] = document.getElementById('notesArea').value;
    saveUser(); closeSheets();
  };

  document.getElementById('schedSegs').onclick = (e) => {
    const b = e.target.closest('.seg'); if (!b) return;
    schedSeg = b.dataset.seg; renderSchedule();
  };

  document.getElementById('dayChips').onclick = (e) => {
    const b = e.target.closest('.day-btn'); if (!b) return;
    if (b.dataset.day) { currentDay = b.dataset.day; } else { currentDate = b.dataset.date; }
    renderSchedule();
  };

  const deleteCustom = (btn) => {
    const date = btn.dataset.date, id = btn.dataset.del;
    user.custom[date] = (user.custom[date] || []).filter((l) => l.id !== id);
    saveUser(); render();
  };
  document.getElementById('dayContent').onclick = (e) => {
    if (e.target.id === 'addLessonBtn') return openEditor(null);
    const del = e.target.closest('[data-del]');
    if (del) deleteCustom(del);
  };

  document.getElementById('groupChip').onclick = () => showSheet('instSheet');

  const pickInst = (value) => {
    user.institution = value;
    user.onboarded = true;
    saveUser();
    document.getElementById('instSheet').classList.add('hidden');
    if (value === 'kiimo') ensureKiimo().then(() => render());
    else render();
  };
  const iL = document.getElementById('instLgpu');
  if (iL) iL.onclick = () => pickInst('lgpu');
  const iK = document.getElementById('instKiimo');
  if (iK) iK.onclick = () => pickInst('kiimo');

  // при первом входе — обязательный выбор заведения
  document.getElementById('groupChip').onclick = () => {
    const closeRow = document.getElementById('instCloseRow');
    if (closeRow) closeRow.classList.toggle('hidden', !user.onboarded);
    showSheet('instSheet');
  };
  document.getElementById('themeBtn').onclick = () => document.body.classList.toggle('light');

  document.querySelectorAll('.tile').forEach((t) => {
    t.onclick = () => {
      const a = t.dataset.act;
      if (a === 'notes') document.getElementById('micBtn').click();
      else if (a === 'week') switchTab('schedule');
      else if (a === 'builds') alert('Аудитории с пометкой ТУПК — в другом корпусе (408(1), 317(1)).');
      else if (a === 'ask') alert('Раздел «Спросить» — чат по лекциям. Не подключён.');
    };
  });

  document.getElementById('addStudentBtn').onclick = () => {
    const name = prompt('ФИО студента'); if (!name) return;
    user.students.push({ name: name.trim(), zachetka: '' }); saveUser(); render();
  };
  document.getElementById('importStudentsBtn').onclick = () => document.getElementById('studentsFile').click();
  document.getElementById('pasteStudentsBtn').onclick = () => { document.getElementById('studentsArea').value = ''; showSheet('studentSheet'); };
  document.getElementById('studentsFile').onchange = handleStudentsFile;
  document.getElementById('doStudentsImport').onclick = () => importStudents(document.getElementById('studentsArea').value);

  document.getElementById('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(user, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pary-user.json'; a.click();
  };
  document.getElementById('resetBtn').onclick = () => {
    if (!confirm('Очистить личные данные (студенты, заметки, свои пары)?')) return;
    user = { students: [], notes: {}, custom: {}, savedAt: Date.now() };
    saveUser(); render();
  };

  document.getElementById('saveLesson').onclick = saveLesson;

  // проверка связи из профиля
  const diagBtn = document.getElementById('diagBtn');
  if (diagBtn) {
    diagBtn.onclick = () => {
      lastApi = { action: 'me', status: 'запрос отправлен…' };
      render();
      syncFromServer();
    };
  }

  // контакт для связи
  const contactBtn = document.getElementById('contactBtn');
  if (contactBtn) {
    contactBtn.onclick = () => {
      const url = 'https://t.me/' + CONTACT;
      try {
        if (tg && tg.openTelegramLink) { tg.openTelegramLink(url); return; }
        if (tg && tg.openLink) { tg.openLink(url); return; }
      } catch (_) {}
      window.open(url, '_blank');
    };
  }

  // староста
  const selLesson = document.getElementById('starostaLesson');
  if (selLesson) selLesson.onchange = () => { starostaTime = selLesson.value; };
  const sList = document.getElementById('starostaList');
  if (sList) {
    sList.onclick = (e) => {
      const b = e.target.closest('[data-sm]');
      if (!b) return;
      const id = b.dataset.sm;
      starostaMarks[id] = starostaMarks[id] === false;
      renderStarosta();
    };
  }
  const sAll = document.getElementById('starostaAll');
  if (sAll) sAll.onclick = () => { roster.forEach((s) => { starostaMarks[s.tg_id] = true; }); renderStarosta(); };
  const sSave = document.getElementById('starostaSave');
  if (sSave) sSave.onclick = saveStarosta;

  // подгруппа
  document.getElementById('sub1').onclick = () => { user.subgroup = user.subgroup === 1 ? 0 : 1; saveUser(); api('subgroup', { subgroup: user.subgroup }); render(); };
  document.getElementById('sub2').onclick = () => { user.subgroup = user.subgroup === 2 ? 0 : 2; saveUser(); api('subgroup', { subgroup: user.subgroup }); render(); };

  // отметка посещения (делегирование на весь документ)
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-att]');
    if (!b) return;
    const k = b.dataset.att;
    user.attendance[k] = !user.attendance[k];
    saveUser();

    // отправляем на сервер: 20261105T0940 -> 2026-11-05 / 09:40
    const date = k.slice(0, 4) + '-' + k.slice(4, 6) + '-' + k.slice(6, 8);
    const time = k.slice(9, 11) + ':' + k.slice(11, 13);
    api('mark', { lessonKey: k, date, time, present: !!user.attendance[k] });

    render();
  });
}

function openEditor() {
  document.getElementById('editorTitle').textContent = 'Своя пара · ' + fmtShort(currentDate);
  document.getElementById('fStart').value = '';
  document.getElementById('fEnd').value = '';
  document.getElementById('fSubject').value = '';
  document.getElementById('fRoom').value = '';
  document.getElementById('fTeacher').value = '';
  showSheet('editorSheet');
}

function saveLesson() {
  const subject = document.getElementById('fSubject').value.trim();
  const time = document.getElementById('fStart').value;
  if (!subject || !time) return alert('Нужны минимум время и название предмета');
  user.custom[currentDate] = user.custom[currentDate] || [];
  user.custom[currentDate].push({
    id: 'c' + Date.now(), time, subject,
    type: document.getElementById('fType').value,
    room: document.getElementById('fRoom').value.trim(),
    teacher: document.getElementById('fTeacher').value.trim(),
    custom: true,
  });
  saveUser(); closeSheets(); render();
}

function importStudents(text) {
  const rows = String(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return importFromRows(rows.map((r) => r.split(/[;\t|]/).map((s) => s.trim())));
}

/* Импорт из Excel/CSV: ищем строку-заголовок с ФИО и колонки */
function importFromRows(rows) {
  if (!rows || !rows.length) return alert('Файл пустой');

  const norm = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
  const isNameCol = (v) => /фио|фамилия|студент|обучающ|name/.test(norm(v));
  const isGroupCol = (v) => /групп|group/.test(norm(v));
  const isZachCol = (v) => /зач[её]т|номер|№|id|код|шифр/.test(norm(v));

  let headerIdx = -1, nameCol = 0, groupCol = -1, zachCol = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(norm);
    const ni = cells.findIndex(isNameCol);
    if (ni >= 0) {
      headerIdx = i; nameCol = ni;
      groupCol = cells.findIndex(isGroupCol);
      zachCol = cells.findIndex(isZachCol);
      break;
    }
  }

  let added = 0, skipped = 0;
  const start = headerIdx >= 0 ? headerIdx + 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const name = String(r[nameCol] == null ? '' : r[nameCol]).trim();
    if (!name || name.length < 4 || isNameCol(name)) { skipped++; continue; }
    if (/^\d+$/.test(name)) { skipped++; continue; }
    if (user.students.some((s) => s.name === name)) continue;
    user.students.push({
      name,
      zachetka: zachCol >= 0 ? String(r[zachCol] || '').trim() : '',
      group: groupCol >= 0 ? String(r[groupCol] || '').trim() : '',
    });
    added++;
  }
  saveUser(); closeSheets(); render();
  alert('Добавлено студентов: ' + added + (skipped ? '\nПропущено строк: ' + skipped : ''));
}

function handleStudentsFile(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const isExcel = /\.(xlsx|xls)$/i.test(f.name);

  if (isExcel) {
    if (typeof XLSX === 'undefined') {
      alert('Библиотека для Excel не загрузилась. Сохраните файл как CSV или вставьте список через «…или вставить списком».');
      return;
    }
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(fr.result), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        importFromRows(rows);
      } catch (err) { alert('Не удалось прочитать Excel: ' + err.message); }
    };
    fr.readAsArrayBuffer(f);
  } else {
    const fr = new FileReader();
    fr.onload = () => {
      const text = String(fr.result);
      // CSV с разделителями ; или ,
      const rows = text.split(/\r?\n/).filter(Boolean).map((line) => line.split(/[;\t]|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '').trim()));
      importFromRows(rows);
    };
    fr.readAsText(f);
  }
}

const DEFAULTS = { students: [], notes: {}, custom: {}, attendance: {}, subgroup: 0, role: 'student', institution: 'lgpu', onboarded: false };

function showFatal(msg) {
  const h = document.getElementById('homeHeadline');
  if (h) h.textContent = 'Не удалось запустить';
  const box = document.getElementById('homeNext');
  if (box) {
    box.innerHTML = '<div class="next-card"><div class="next-when">Ошибка</div>' +
      '<div class="next-subject" style="font-size:15px;line-height:1.4">' + escapeHtml(msg) + '</div></div>';
  }
}

/* догрузка с сервера — в фоне, чтобы не блокировать интерфейс */
async function syncFromServer() {
  try {
    const srv = await api('me');
    if (srv && srv.student) {
      if (srv.student.subgroup) user.subgroup = srv.student.subgroup;
      if (srv.student.role) user.role = srv.student.role;
      (srv.attendance || []).forEach((a) => { if (a.present) user.attendance[a.lesson_key] = true; });
      saveUser();
      if (user.role === 'starosta') loadRoster();
    }
  } finally {
    render();   // в любом случае обновляем диагностику
  }
}

/* ---------- староста ---------- */
async function loadRoster() {
  const res = await api('roster');
  if (res && res.students) { roster = res.students; renderStarosta(); }
}

function renderStarosta() {
  const card = document.getElementById('starostaCard');
  if (!card) return;

  const isStar = user.role === 'starosta';
  card.classList.toggle('hidden', !isStar);
  if (!isStar) return;

  document.getElementById('starostaDate').textContent = fmtShort(currentDate);
  document.getElementById('starostaHint').textContent = roster.length
    ? 'Отметьте, кто был на паре, и нажмите «Сохранить». Отметки уйдут в базу для всех.'
    : 'Список пуст — студенты появятся после первого входа в бота (/start).';

  const lessons = lessonsForDate(currentDate);
  const sel = document.getElementById('starostaLesson');
  const keep = starostaTime || (lessons[0] ? lessons[0].time : '');
  sel.innerHTML = lessons.length
    ? lessons.map((l) => `<option value="${escapeHtml(l.time)}"${l.time === keep ? ' selected' : ''}>${escapeHtml(l.time)} — ${escapeHtml(l.subject)}</option>`).join('')
    : '<option value="">пар нет</option>';
  starostaTime = sel.value;

  document.getElementById('starostaList').innerHTML = roster.length
    ? roster.map((s) => {
        const on = starostaMarks[s.tg_id] !== false;
        return `<div class="student-row">
          <span>${escapeHtml(s.full_name)}${s.subgroup ? ' · ' + s.subgroup + ' подгр.' : ''}${s.role === 'starosta' ? ' ★' : ''}</span>
          <button class="att${on ? ' on' : ''}" data-sm="${s.tg_id}">${on ? '✓' : '○'}</button>
        </div>`;
      }).join('')
    : '';
}

async function saveStarosta() {
  const lesson = lessonsForDate(currentDate).find((l) => l.time === starostaTime);
  if (!lesson) return alert('Выберите пару');
  if (!roster.length) return alert('Список студентов пуст');

  const key = attKey(currentDate, lesson.time);
  let ok = 0;
  for (const s of roster) {
    const res = await api('starosta_mark', {
      tgId: s.tg_id,
      lessonKey: key,
      date: currentDate,
      time: lesson.time,
      subject: lesson.subject,
      present: starostaMarks[s.tg_id] !== false,
    });
    if (res && res.ok) ok++;
  }
  alert('Отмечено: ' + ok + ' из ' + roster.length);
}

async function init() {
  try {
    if (tg) { try { tg.ready(); tg.expand(); if (tg.setHeaderColor) tg.setHeaderColor('#0b1113'); } catch (_) {} }

    // Telegram-идентификация: id пользователя + отдельное хранилище
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      me = tg.initDataUnsafe.user;
      storeKey = STORE_BASE + '.' + me.id;
      cloudKey = CLOUD_BASE + '.' + me.id;
    }

    // 1. СНАЧАЛА рисуем интерфейс на локальных данных — без ожиданий
    const local = loadUserLocal();
    if (local) user = Object.assign({}, DEFAULTS, local);
    if (me) user.me = me.id;

    // данные выбранного заведения
    if (user.institution === 'kiimo') await withTimeout(ensureKiimo(), 5000, false);

    currentDate = upcomingDates(1)[0] || todayStr();
    initEvents();
    render();
    switchTab('home');

    // первый вход: спрашиваем учебное заведение
    if (!user.onboarded) {
      const closeRow = document.getElementById('instCloseRow');
      if (closeRow) closeRow.classList.add('hidden');
      showSheet('instSheet');
    }

    // 2. Потом догружаем облако Telegram (не дольше 2.5 с)
    const cloud = await withTimeout(loadUserCloud(), 2500, null);
    if (cloud && (cloud.savedAt || 0) > (user.savedAt || 0)) {
      user = Object.assign({}, DEFAULTS, cloud);
      if (me) user.me = me.id;
      render();
    }

    // 3. Сервер — в фоне, интерфейс уже работает
    if (me) syncFromServer();
  } catch (e) {
    showFatal(e && e.message ? e.message : String(e));
  }
}

window.addEventListener('error', (e) => {
  if (e && e.message) showFatal(e.message);
});

init();
