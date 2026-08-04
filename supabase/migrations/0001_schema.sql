-- ============================================================
-- MEQ Exam Platform : core schema
-- ============================================================
-- Run order: 0001_schema -> 0002_functions -> 0003_rls -> 0004_seed (optional)
--
-- Design notes:
--  * All exam timing is SERVER-AUTHORITATIVE. Clients never decide when a
--    question opens/closes; they read exams.current_question_index and
--    exams.current_started_at, and the server clock via server_now().
--  * "Cannot go back / cannot edit past questions" is enforced by a trigger
--    on the answers table, not by the UI.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------
do $$ begin
  create type user_role as enum ('student', 'lecturer', 'guest', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type exam_status as enum ('draft', 'scheduled', 'live', 'closed', 'released');
exception when duplicate_object then null; end $$;

do $$ begin
  create type grade_status as enum ('pending', 'ai_graded', 'confirmed');
exception when duplicate_object then null; end $$;

-- ---------- profiles ----------
-- One row per authenticated user, created automatically on sign-up.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text,
  student_code text,
  role         user_role not null default 'guest',
  created_at   timestamptz not null default now()
);

-- ---------- courses ----------
create table if not exists public.courses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  title       text not null,
  description text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- Membership: a user is either a 'lecturer' (can edit) or 'student'
-- (can sit exams) within a given course. Supports co-teaching and enrolment.
create table if not exists public.course_members (
  course_id      uuid not null references public.courses(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  role_in_course text not null check (role_in_course in ('lecturer', 'student')),
  created_at     timestamptz not null default now(),
  primary key (course_id, user_id)
);

-- ---------- exams ----------
create table if not exists public.exams (
  id                     uuid primary key default gen_random_uuid(),
  course_id              uuid not null references public.courses(id) on delete cascade,
  title                  text not null,
  description            text,
  status                 exam_status not null default 'draft',
  scheduled_start        timestamptz,
  buffer_seconds         int not null default 5,       -- grace gap between questions
  -- Live lockstep control (server-owned):
  current_question_index int not null default -1,      -- -1 = not started
  current_started_at     timestamptz,                  -- when the current question opened
  created_by             uuid references public.profiles(id),
  created_at             timestamptz not null default now()
);

-- ---------- questions ----------
create table if not exists public.questions (
  id                uuid primary key default gen_random_uuid(),
  exam_id           uuid not null references public.exams(id) on delete cascade,
  order_index       int not null,                      -- 0-based position
  stem              text not null default '',
  image_url         text,                              -- optional clinical image / lab result
  answer_key        text not null default '',
  rubric            jsonb not null default '[]'::jsonb, -- [{criterion, points, notes}]
  max_score         numeric not null default 10,
  time_limit_seconds int not null default 300,
  created_at        timestamptz not null default now(),
  unique (exam_id, order_index)
);

-- ---------- attempts ----------
-- One per student per exam, created when the student joins the live sitting.
create table if not exists public.attempts (
  id           uuid primary key default gen_random_uuid(),
  exam_id      uuid not null references public.exams(id) on delete cascade,
  student_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  submitted_at timestamptz,
  unique (exam_id, student_id)
);

-- ---------- answers ----------
create table if not exists public.answers (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  answer_text text not null default '',
  updated_at  timestamptz not null default now(),
  unique (attempt_id, question_id)
);

-- ---------- grades ----------
create table if not exists public.grades (
  id            uuid primary key default gen_random_uuid(),
  answer_id     uuid not null unique references public.answers(id) on delete cascade,
  ai_score      numeric,
  ai_confidence text,                       -- 'high' | 'medium' | 'low'
  ai_breakdown  jsonb,                       -- per-rubric-criterion scoring
  ai_rationale  text,
  final_score   numeric,                     -- lecturer-confirmed score
  status        grade_status not null default 'pending',
  graded_by     uuid references public.profiles(id),
  updated_at    timestamptz not null default now()
);

-- ---------- audit log ----------
-- Immutable trail for exam integrity / appeals.
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid,
  action     text not null,
  entity     text,
  entity_id  uuid,
  meta       jsonb,
  created_at timestamptz not null default now()
);

-- ---------- indexes ----------
create index if not exists idx_questions_exam on public.questions(exam_id, order_index);
create index if not exists idx_attempts_exam on public.attempts(exam_id);
create index if not exists idx_answers_attempt on public.answers(attempt_id);
create index if not exists idx_course_members_user on public.course_members(user_id);
create index if not exists idx_exams_course on public.exams(course_id);
