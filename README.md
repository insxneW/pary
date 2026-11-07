# Пары — Telegram Mini App для группы ЛГПУ

Работающее приложение: расписание, посещаемость, напоминания, рассылка.

| Что | Где |
|---|---|
| Приложение | https://insxnew.github.io/pary/ |
| Бот | [@LGPUedubot](https://t.me/LGPUedubot) |
| База | Supabase, проект `bfpazddbjnarywofzadv` |
| Репозиторий | https://github.com/insxnew/pary |

## Данные

Расписание группы **03-ОФО-ЕМТ-ПЕД(мф)-2026** (44.03.05, Математика и физика),
1 семестр 2026/27: 60 дней, 213 пар, 01.10.2026 — 25.12.2026.

Источник — [сайт ЛГПУ](https://lspu-lipetsk.ru/modules.php?name=Raspisite&page=2&kodgruppi=1030266420).
Хранится в `schedule.js`, обновляется скриптом.

## Экраны

| Вкладка | Что внутри |
|---|---|
| Главная | Статус дня, следующая пара, план на день |
| Расписание | По дням (с отметками ○/✓), Предметы, Преподаватели, Сессия |
| 🎙 | Заметка на дату |
| Учёба | График недели, семестр, посещаемость, статистика группы |
| Профиль | Имя из Telegram, подгруппа, база студентов, диагностика |

## Сервер

### Таблицы
- `students` — кто зашёл (tg_id, имя, подгруппа, роль, флаг напоминаний)
- `attendance` — отметки посещаемости
- `reminders` — журнал отправленных напоминаний (защита от дублей)
- `schedule_overrides` — правки расписания (пока не используется)
- view `group_attendance` — сводка по группе

### Edge Functions

| Функция | Назначение |
|---|---|
| `tg-api` | Авторизация по initData, профиль, отметки, подгруппа, статистика |
| `tg-reminders` | Напоминания за 20 минут до пары (вызов по cron) |
| `tg-broadcast` | Рассылка сообщения всем студентам |

У всех трёх **выключена** проверка JWT Supabase. Защита — подпись Telegram и секрет `CRON_SECRET`.

### Секреты (Supabase → Settings → Edge Functions → Secrets)
- `BOT_TOKEN` — токен бота
- `CRON_SECRET` — общий секрет для cron и рассылки (тот же в GitHub)

### Расписание (GitHub Actions)
`.github/workflows/reminders.yml` — каждые 10 минут дёргает `tg-reminders`.

## Обслуживание

### Обновить расписание

```powershell
# 1. скачать страницу вуза (PowerShell)
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36"
Invoke-WebRequest "https://lspu-lipetsk.ru/modules.php?name=Raspisite&page=2&kodgruppi=1030266420" `
  -UseBasicParsing -UserAgent $ua -OutFile "$env:TEMP\lgpu.html"

# 2. разобрать и сравнить
node telegram-pary\tools\refresh-schedule.js --file "$env:TEMP\lgpu.html"

# 3. если изменилось — записать
node telegram-pary\tools\refresh-schedule.js --file "$env:TEMP\lgpu.html" --write
```

Затем «1. Развернуть Пары» — залить на сайт.

> Сайт вуза не открывается через VPN. Выключите его перед обновлением.

### Рассылка
Ярлык **«Отправить всем.bat»** в папке «Пары - Supabase».

### Проверка напоминаний
Ярлык **«Проверить напоминания.bat»**.

### Тесты
```bash
node test-render.js      # интерфейс
node test-students.js    # импорт Excel
node tools/test-initdata.js  # алгоритм подписи
node tools/test-verify.js    # валидация initData
node tools/compare-schedule.js old.js new.js
```

## Роли

```sql
update public.students set role = 'starosta' where tg_id = 1324431006;
```

Староста сможет отмечать посещаемость за других (действие `starosta_mark` в `tg-api`).
Интерфейс пока не сделан.

## Ограничения

- Бот не может писать первым: студент должен один раз нажать `/start`.
- GitHub Actions может задерживать запуск на 5–15 минут.
- После 60 дней без активности в репозитории GitHub отключает cron.
- CloudStorage в Telegram ограничен 4 КБ на ключ — посещаемость хранится частями.
