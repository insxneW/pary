// Сравнение двух файлов расписания: node tools/compare-schedule.js old.js new.js
const fs = require('fs');

function load(p) {
  const t = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  const json = t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

const [, , oldPath, newPath] = process.argv;
const a = load(oldPath);
const b = load(newPath);

const total = (x) => x.days.reduce((n, d) => n + d.lessons.length, 0);
console.log('было: ' + a.days.length + ' дней, ' + total(a) + ' пар');
console.log('стало: ' + b.days.length + ' дней, ' + total(b) + ' пар');

const key = (l) => [l.time, l.subject, l.room, l.teacher, l.subgroup].join(' | ');
let diffs = 0;

for (const d of b.days) {
  const o = a.days.find((x) => x.date === d.date);
  if (!o) { console.log('НОВЫЙ ДЕНЬ: ' + d.date); diffs++; continue; }
  const A = o.lessons.map(key).join(';');
  const B = d.lessons.map(key).join(';');
  if (A !== B) {
    diffs++;
    console.log('ИЗМЕНЕНИЕ ' + d.date + ' (' + d.weekday + '):');
    const sa = new Set(o.lessons.map(key));
    const sb = new Set(d.lessons.map(key));
    for (const x of sb) if (!sa.has(x)) console.log('  + ' + x);
    for (const x of sa) if (!sb.has(x)) console.log('  - ' + x);
  }
}
for (const d of a.days) {
  if (!b.days.find((x) => x.date === d.date)) { console.log('ИСЧЕЗ ДЕНЬ: ' + d.date); diffs++; }
}

console.log(diffs ? 'ИТОГО изменений: ' + diffs : 'СОДЕРЖИМОЕ ИДЕНТИЧНО (отличаются только метаданные)');
