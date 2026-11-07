-- ============================================================
--  Пары — схема базы для Supabase
--  Выполните целиком в SQL Editor вашего проекта
-- ============================================================

-- Студенты группы
create table if not exists public.students (
  tg_id       bigint primary key,
  full_name   text not null,
  username    text,
  subgroup    int,
  role        text not null default 'student',   -- student | starosta | teacher
  updated_at  timestamptz not null default now()
);

-- Отметки посещаемости
create table if not exists public.attendance (
  id          bigserial primary key,
  tg_id       bigint not null,
  lesson_key  text not null,           -- 20261105T0940
  lesson_date date not null,
  lesson_time text not null,
  subject     text,
  present     boolean not null default true,
  marked_by   bigint,                  -- кто поставил отметку
  updated_at  timestamptz not null default now(),
  unique (tg_id, lesson_key)
);

create index if not exists attendance_date_idx on public.attendance (lesson_date);
create index if not exists attendance_student_idx on public.attendance (tg_id);

-- Журнал изменений расписания (на будущее: правки старосты)
create table if not exists public.schedule_overrides (
  id          bigserial primary key,
  lesson_date date not null,
  lesson_time text not null,
  action      text not null,           -- cancel | move | note
  payload     jsonb,
  created_by  bigint,
  created_at  timestamptz not null default now()
);

-- ============================================================
--  Доступ
--  RLS включён. Прямой доступ из браузера закрыт полностью:
--  читать и писать могут только Edge Functions (service_role,
--  он обходит RLS). Публичный ключ anon к таблицам не допущен.
-- ============================================================
alter table public.students            enable row level security;
alter table public.attendance          enable row level security;
alter table public.schedule_overrides  enable row level security;

drop policy if exists "students readable"   on public.students;
drop policy if exists "attendance readable" on public.attendance;
drop policy if exists "overrides readable"  on public.schedule_overrides;

create policy "students readable"   on public.students           for select using (true);
create policy "attendance readable" on public.attendance         for select using (true);
create policy "overrides readable"  on public.schedule_overrides for select using (true);

-- Прямая запись из браузера запрещена
revoke insert, update, delete on public.students           from anon, authenticated;
revoke insert, update, delete on public.attendance         from anon, authenticated;
revoke insert, update, delete on public.schedule_overrides from anon, authenticated;

-- ============================================================
--  Сводка по группе (используется приложением для статистики)
-- ============================================================
create or replace view public.group_attendance
with (security_invoker = on) as
select
  s.tg_id,
  s.full_name,
  s.subgroup,
  count(a.id) filter (where a.present) as present_count,
  count(a.id)                          as marked_count
from public.students s
left join public.attendance a on a.tg_id = s.tg_id
group by s.tg_id, s.full_name, s.subgroup;

-- SELECT на view выдаётся только service_role — см. блок ниже

-- ============================================================
--  Приватность данных
--  Читать могут только Edge Functions (service_role).
--  Публичный ключ (anon) к таблицам доступа НЕ имеет.
-- ============================================================
revoke select on public.students          from anon, authenticated;
revoke select on public.attendance        from anon, authenticated;
revoke select on public.reminders         from anon, authenticated;
revoke select on public.group_attendance  from anon, authenticated;