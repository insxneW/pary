# Подключение Supabase (общая статистика группы)

Пошагово, ~15 минут. Платить не нужно — бесплатного тарифа хватает с запасом
(500 МБ базы, 500 000 вызовов функций в месяц).

---

## Шаг 1. Проект

1. Откройте [supabase.com](https://supabase.com) → **Start your project** → вход через GitHub
2. **New project**
   - Name: `pary`
   - Database Password: придумайте и сохраните
   - Region: ближайший (например, `Frankfurt` или `Stockholm`)
3. Подождите 1–2 минуты, пока проект поднимется

---

## Шаг 2. Таблицы

1. Слева **SQL Editor** → **New query**
2. Скопируйте всё содержимое файла [`supabase/schema.sql`](schema.sql) и вставьте
3. **Run**

Проверка: слева **Table Editor** → должны появиться `students`, `attendance`,
`schedule_overrides` и view `group_attendance`.

---

## Шаг 3. Функция проверки подписи

1. Слева **Edge Functions** → **Deploy a new function**
2. Выберите **Via editor**
3. Имя функции: **`tg-api`** (важно, ровно так)
4. Удалите шаблон и вставьте содержимое [`supabase/functions/tg-api/index.ts`](functions/tg-api/index.ts)
5. **Deploy**

После деплоя:

6. Откройте функцию → **Settings** (или значок шестерёнки)
7. **Выключите** «Enforce JWT verification» — иначе браузер получит `401`.
   Функция защищена подписью Telegram, а не JWT Supabase.

---

## Шаг 4. Токен бота

1. **Project Settings** → **Edge Functions** → **Secrets** (или **Manage secrets**)
2. **Add new secret**
   - Name: `BOT_TOKEN`
   - Value: токен вашего бота от [@BotFather](https://t.me/BotFather)
3. **Save**

Без этого секрета функция вернёт `BOT_TOKEN не задан в Secrets`.

---

## Шаг 5. Ключи для приложения

1. **Project Settings** → **API**
2. Скопируйте два значения:
   - **Project URL** — вида `https://abcdefgh.supabase.co`
   - **anon public** — длинная строка, начинается с `eyJ...`

Это **публичные** данные: они всё равно уходят в браузер. Присылать можно.

> **Важно:** ключ `service_role` **не присылайте никому** и не вставляйте в
> `index.html`. Он даёт полный доступ к базе. Он нужен только Edge Function —
> Supabase подставляет его автоматически.

---

## Шаг 6. Подключение

Пришлите мне **Project URL** и **anon key** — я:

- впишу их в `config.js`
- добавлю в приложение общую статистику группы и синхронизацию отметок
- перезалью на GitHub Pages
- проверю на живом проекте

---

## Как это будет работать

```
Telegram (initData, подпись)
        │
        ▼
Mini App ──► Edge Function tg-api ──► проверка HMAC ──► PostgreSQL
        │            (service_role, только на сервере)
        │
        └──► чтение статистики по anon-ключу (только SELECT, RLS)
```

- Подпись проверяется **на сервере** — подделать `tg_id` нельзя
- В браузере нет ни токена бота, ни service-ключа
- Чтение — публичное (в рамках группы), запись — только через функцию

## Роли

В таблице `students` есть поле `role`: `student` (по умолчанию), `starosta`, `teacher`.
Старосте можно выдать права запросом:

```sql
update public.students set role = 'starosta' where tg_id = 123456789;
```

Тогда ему станет доступно действие `starosta_mark` — отметка посещаемости за других.
