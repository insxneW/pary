-- ============================================================
--  Пары — напоминания о парах
--  Выполните в SQL Editor после основного schema.sql
-- ============================================================

-- Флаг: присылать ли студенту напоминания (по умолчанию включено)
alter table public.students
  add column if not exists reminders boolean not null default true;

-- Журнал отправленных напоминаний — защита от дублей
create table if not exists public.reminders (
  id          bigserial primary key,
  tg_id       bigint not null,
  lesson_key  text not null,          -- 20261109T0940
  title       text,
  sent_at     timestamptz not null default now(),
  unique (tg_id, lesson_key)
);

create index if not exists reminders_tg_idx on public.reminders (tg_id);

alter table public.reminders enable row level security;

-- читать можно, писать — только service_role (из Edge Function)
drop policy if exists "reminders readable" on public.reminders;
create policy "reminders readable" on public.reminders for select using (true);

revoke insert, update, delete on public.reminders from anon, authenticated;
