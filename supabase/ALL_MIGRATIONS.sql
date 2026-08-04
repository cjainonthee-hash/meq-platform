-- MEQ Platform - combined migrations. Order 0001 -> 0018. Regenerated 2026-08-04.
-- Run this ONCE, top to bottom, in the Supabase SQL editor of a NEW project.
-- An existing database should run only the individual files it is missing.

-- >>>>>>>>>>>>>>>>>>>> 0001_schema.sql <<<<<<<<<<<<<<<<<<<<

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

-- >>>>>>>>>>>>>>>>>>>> 0002_functions.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- MEQ Exam Platform : functions, triggers, and lockstep RPCs
-- ============================================================

-- ---------- server clock ----------
-- Clients call this to sync against the server, so a student cannot cheat the
-- timer by changing their device clock.
create or replace function public.server_now()
returns timestamptz
language sql stable
as $$ select now() $$;

-- ---------- role helpers ----------
create or replace function public.current_role()
returns user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) $$;

-- Is the current user a lecturer for this course (or an admin)?
create or replace function public.is_course_staff(p_course_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or exists (
        select 1 from public.course_members
        where course_id = p_course_id
          and user_id = auth.uid()
          and role_in_course = 'lecturer'
      )
$$;

-- Is the current user enrolled as a student in this course?
create or replace function public.is_course_student(p_course_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.course_members
    where course_id = p_course_id
      and user_id = auth.uid()
      and role_in_course = 'student'
  )
$$;

-- ---------- new user -> profile ----------
-- Runs when Supabase Auth creates a user (after Microsoft Entra SSO).
-- Assigns a default role based on the email domain policy.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_default_role user_role := 'guest';
begin
  -- The first user to ever sign up becomes admin (bootstrap).
  if not exists (select 1 from public.profiles) then
    v_default_role := 'admin';
  else
    v_default_role := coalesce(
      nullif(current_setting('app.default_new_user_role', true), '')::user_role,
      'student'
    );
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    v_default_role
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- answer write window (the "no going back" rule) ----------
-- A student may only write to the answer of the CURRENTLY OPEN question while
-- the exam is live. Past questions (order_index < current) and future ones are
-- rejected at the database level, so the UI cannot be bypassed.
create or replace function public.enforce_answer_window()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_exam   public.exams%rowtype;
  v_qindex int;
  v_owner  uuid;
begin
  select a.student_id into v_owner
  from public.attempts a where a.id = new.attempt_id;

  -- Staff/admin edits (e.g. data fixes) bypass the window.
  if public.is_admin() then
    return new;
  end if;

  if v_owner is distinct from auth.uid() then
    raise exception 'You can only write your own answers';
  end if;

  select q.order_index into v_qindex
  from public.questions q where q.id = new.question_id;

  select * into v_exam
  from public.exams e
  where e.id = (select exam_id from public.attempts where id = new.attempt_id);

  if v_exam.status <> 'live' then
    raise exception 'The exam is not live';
  end if;

  if v_qindex is distinct from v_exam.current_question_index then
    raise exception 'This question is locked (only the current question can be answered)';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_answer_window on public.answers;
create trigger trg_answer_window
  before insert or update on public.answers
  for each row execute function public.enforce_answer_window();

-- ---------- join a live exam ----------
-- Creates the student's attempt (idempotent). Also pre-creates a blank answer
-- row for the current question so autosave has a target.
create or replace function public.join_exam(p_exam_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_exam    public.exams%rowtype;
  v_attempt uuid;
begin
  select * into v_exam from public.exams where id = p_exam_id;
  if not found then raise exception 'Exam not found'; end if;

  if not public.is_course_student(v_exam.course_id) and not public.is_admin() then
    raise exception 'You are not enrolled in this course';
  end if;

  if v_exam.status not in ('live') then
    raise exception 'Exam is not open for joining';
  end if;

  insert into public.attempts (exam_id, student_id)
  values (p_exam_id, auth.uid())
  on conflict (exam_id, student_id) do update set exam_id = excluded.exam_id
  returning id into v_attempt;

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'join_exam', 'exam', p_exam_id);

  return v_attempt;
end $$;

-- ---------- lecturer: start the exam ----------
create or replace function public.start_exam(p_exam_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_course uuid;
begin
  select course_id into v_course from public.exams where id = p_exam_id;
  if not public.is_course_staff(v_course) then
    raise exception 'Not authorised';
  end if;

  update public.exams
     set status = 'live',
         current_question_index = 0,
         current_started_at = now()
   where id = p_exam_id;

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'start_exam', 'exam', p_exam_id);
end $$;

-- ---------- advance to the next question (unconditional) ----------
-- Lecturer override, or the internal engine. Locks the current question and
-- opens the next. When past the last question the exam closes.
create or replace function public.advance_exam(p_exam_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_exam  public.exams%rowtype;
  v_count int;
begin
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then raise exception 'Exam not found'; end if;

  if not public.is_course_staff(v_exam.course_id) then
    raise exception 'Not authorised';
  end if;

  select count(*) into v_count from public.questions where exam_id = p_exam_id;

  if v_exam.current_question_index + 1 >= v_count then
    update public.exams
       set status = 'closed'
     where id = p_exam_id;
  else
    update public.exams
       set current_question_index = v_exam.current_question_index + 1,
           current_started_at = now()
     where id = p_exam_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'advance_exam', 'exam', p_exam_id,
          jsonb_build_object('from_index', v_exam.current_question_index));

  return (select current_question_index from public.exams where id = p_exam_id);
end $$;

-- ---------- advance IF the current question's time is up ----------
-- Callable by ANY participant (students included). It is guarded and atomic:
-- whoever calls first at the deadline advances the exam; everyone else's call
-- is a no-op. Combined with Realtime, this keeps all students in lockstep
-- WITHOUT needing an always-on server process.
create or replace function public.advance_if_due(p_exam_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_exam     public.exams%rowtype;
  v_limit    int;
  v_deadline timestamptz;
  v_count    int;
begin
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found or v_exam.status <> 'live' then
    return coalesce(v_exam.current_question_index, -1);
  end if;

  select time_limit_seconds into v_limit
  from public.questions
  where exam_id = p_exam_id and order_index = v_exam.current_question_index;

  if v_limit is null then
    return v_exam.current_question_index;
  end if;

  v_deadline := v_exam.current_started_at
              + make_interval(secs => v_limit + v_exam.buffer_seconds);

  if now() < v_deadline then
    return v_exam.current_question_index;   -- not due yet
  end if;

  select count(*) into v_count from public.questions where exam_id = p_exam_id;

  if v_exam.current_question_index + 1 >= v_count then
    update public.exams set status = 'closed' where id = p_exam_id;
  else
    update public.exams
       set current_question_index = v_exam.current_question_index + 1,
           current_started_at = now()
     where id = p_exam_id;
  end if;

  return (select current_question_index from public.exams where id = p_exam_id);
end $$;

-- ---------- release results ----------
create or replace function public.release_results(p_exam_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_course uuid;
begin
  select course_id into v_course from public.exams where id = p_exam_id;
  if not public.is_course_staff(v_course) then
    raise exception 'Not authorised';
  end if;
  update public.exams set status = 'released' where id = p_exam_id;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'release_results', 'exam', p_exam_id);
end $$;

-- ---------- admin: set a user's global role ----------
create or replace function public.set_user_role(p_user_id uuid, p_role user_role)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'set_user_role', 'profile', p_user_id,
          jsonb_build_object('role', p_role));
end $$;

-- >>>>>>>>>>>>>>>>>>>> 0003_rls.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- MEQ Exam Platform : Row Level Security
-- ============================================================
-- Roles: student / lecturer / guest / admin.
-- Server API routes that must cross students (AI grading, exports) use the
-- Supabase service-role key and bypass RLS by design.
-- ============================================================

alter table public.profiles       enable row level security;
alter table public.courses        enable row level security;
alter table public.course_members enable row level security;
alter table public.exams          enable row level security;
alter table public.questions      enable row level security;
alter table public.attempts       enable row level security;
alter table public.answers        enable row level security;
alter table public.grades         enable row level security;
alter table public.audit_log      enable row level security;

-- ---------- profiles ----------
create policy "read own profile" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
-- Admins manage everyone (role changes go through set_user_role()).
create policy "admin manage profiles" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- courses ----------
create policy "read courses you belong to" on public.courses
  for select using (
    public.is_admin()
    or public.is_course_staff(id)
    or public.is_course_student(id)
  );
create policy "lecturers create courses" on public.courses
  for insert with check (public.current_role() in ('lecturer', 'admin'));
create policy "staff edit their courses" on public.courses
  for update using (public.is_course_staff(id)) with check (public.is_course_staff(id));

-- ---------- course_members ----------
create policy "read memberships of your courses" on public.course_members
  for select using (
    user_id = auth.uid() or public.is_course_staff(course_id)
  );
create policy "staff manage memberships" on public.course_members
  for all using (public.is_course_staff(course_id))
  with check (public.is_course_staff(course_id));

-- ---------- exams ----------
-- Students only see exams that are live/closed/released (not drafts).
create policy "read exams" on public.exams
  for select using (
    public.is_course_staff(course_id)
    or (public.is_course_student(course_id)
        and status in ('scheduled', 'live', 'closed', 'released'))
  );
create policy "staff write exams" on public.exams
  for all using (public.is_course_staff(course_id))
  with check (public.is_course_staff(course_id));

-- ---------- questions ----------
-- Staff: full read. Students: read only questions at/behind the current index
-- of a live exam, or all questions once results are released. This is the
-- second guard behind "one question per page, no peeking ahead".
create policy "staff read questions" on public.questions
  for select using (
    exists (select 1 from public.exams e
            where e.id = exam_id and public.is_course_staff(e.course_id))
  );
create policy "students read open questions" on public.questions
  for select using (
    exists (
      select 1 from public.exams e
      where e.id = exam_id
        and public.is_course_student(e.course_id)
        and (
          e.status = 'released'
          or (e.status = 'live' and questions.order_index <= e.current_question_index)
        )
    )
  );
create policy "staff write questions" on public.questions
  for all using (
    exists (select 1 from public.exams e
            where e.id = exam_id and public.is_course_staff(e.course_id))
  ) with check (
    exists (select 1 from public.exams e
            where e.id = exam_id and public.is_course_staff(e.course_id))
  );

-- ---------- attempts ----------
create policy "read own or staff attempts" on public.attempts
  for select using (
    student_id = auth.uid()
    or exists (select 1 from public.exams e
               where e.id = exam_id and public.is_course_staff(e.course_id))
  );
-- Students update their own attempt only to mark submission time.
create policy "student submit own attempt" on public.attempts
  for update using (student_id = auth.uid()) with check (student_id = auth.uid());

-- ---------- answers ----------
create policy "read own or staff answers" on public.answers
  for select using (
    exists (select 1 from public.attempts a
            where a.id = attempt_id and a.student_id = auth.uid())
    or exists (
      select 1 from public.attempts a
      join public.exams e on e.id = a.exam_id
      where a.id = attempt_id and public.is_course_staff(e.course_id)
    )
  );
-- Insert/update permitted for the owner; the enforce_answer_window() trigger
-- does the heavy lifting (only the current question, only while live).
create policy "student write own answers" on public.answers
  for insert with check (
    exists (select 1 from public.attempts a
            where a.id = attempt_id and a.student_id = auth.uid())
  );
create policy "student update own answers" on public.answers
  for update using (
    exists (select 1 from public.attempts a
            where a.id = attempt_id and a.student_id = auth.uid())
  ) with check (
    exists (select 1 from public.attempts a
            where a.id = attempt_id and a.student_id = auth.uid())
  );

-- ---------- grades ----------
-- Students see their grade only after results are released.
create policy "read grades" on public.grades
  for select using (
    exists (
      select 1
      from public.answers ans
      join public.attempts a on a.id = ans.attempt_id
      join public.exams e on e.id = a.exam_id
      where ans.id = answer_id
        and (
          public.is_course_staff(e.course_id)
          or (a.student_id = auth.uid() and e.status = 'released')
        )
    )
  );
-- Staff confirm/override grades.
create policy "staff write grades" on public.grades
  for all using (
    exists (
      select 1 from public.answers ans
      join public.attempts a on a.id = ans.attempt_id
      join public.exams e on e.id = a.exam_id
      where ans.id = answer_id and public.is_course_staff(e.course_id)
    )
  ) with check (
    exists (
      select 1 from public.answers ans
      join public.attempts a on a.id = ans.attempt_id
      join public.exams e on e.id = a.exam_id
      where ans.id = answer_id and public.is_course_staff(e.course_id)
    )
  );

-- ---------- audit_log ----------
create policy "admin reads audit" on public.audit_log
  for select using (public.is_admin());

-- >>>>>>>>>>>>>>>>>>>> 0004_realtime_grants.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- MEQ Exam Platform : realtime + execute grants
-- ============================================================

-- The synchronized clock relies on clients subscribing to the exams row.
-- When current_question_index changes, every student flips to the next
-- question at the same moment.
alter publication supabase_realtime add table public.exams;

-- Proctor live view watches attempts (who joined / submitted).
alter publication supabase_realtime add table public.attempts;

-- Allow authenticated users to call the RPCs (RLS / internal checks still apply).
grant execute on function public.server_now()             to authenticated;
grant execute on function public.join_exam(uuid)          to authenticated;
grant execute on function public.start_exam(uuid)         to authenticated;
grant execute on function public.advance_exam(uuid)       to authenticated;
grant execute on function public.advance_if_due(uuid)     to authenticated;
grant execute on function public.release_results(uuid)    to authenticated;
grant execute on function public.set_user_role(uuid, user_role) to authenticated;
grant execute on function public.is_admin()               to authenticated;
grant execute on function public.current_role()           to authenticated;
grant execute on function public.is_course_staff(uuid)    to authenticated;
grant execute on function public.is_course_student(uuid)  to authenticated;

-- >>>>>>>>>>>>>>>>>>>> 0005_enrolment.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- MEQ Exam Platform : enrolment helpers
-- ============================================================
-- Lecturers cannot read other users' profiles under RLS, so enrolment by email
-- goes through these SECURITY DEFINER functions with an explicit staff check.

create or replace function public.enrol_member(
  p_course_id uuid,
  p_email     text,
  p_role      text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid;
begin
  if not public.is_course_staff(p_course_id) then
    raise exception 'Not authorised';
  end if;
  if p_role not in ('lecturer', 'student') then
    raise exception 'Invalid role';
  end if;

  select id into v_uid from public.profiles where lower(email) = lower(p_email);
  if v_uid is null then
    raise exception 'No account exists for %; ask them to sign in once first', p_email;
  end if;

  insert into public.course_members (course_id, user_id, role_in_course)
  values (p_course_id, v_uid, p_role)
  on conflict (course_id, user_id)
  do update set role_in_course = excluded.role_in_course;
end $$;

create or replace function public.remove_member(
  p_course_id uuid,
  p_user_id   uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_course_staff(p_course_id) then
    raise exception 'Not authorised';
  end if;
  delete from public.course_members
  where course_id = p_course_id and user_id = p_user_id;
end $$;

grant execute on function public.enrol_member(uuid, text, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> 0006_clone_exam.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Reusable exams: clone an exam definition for a new sitting/run.
-- ============================================================
-- A recurring course reuses the same exam year after year. Rather than
-- re-authoring it (or overwriting last year's answers), the lecturer clones
-- the exam: this copies the questions + rubrics into a brand-new draft exam,
-- leaving the source exam and all its attempts/answers/grades untouched.
-- Each run is therefore an independent, permanent record.
-- ============================================================

create or replace function public.clone_exam(p_exam_id uuid, p_title text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_course_id uuid;
  v_new_id    uuid;
begin
  select course_id into v_course_id from public.exams where id = p_exam_id;
  if v_course_id is null then
    raise exception 'exam not found';
  end if;
  if not public.is_course_staff(v_course_id) then
    raise exception 'not authorised';
  end if;

  -- New exam: same definition, fresh (unstarted) live state.
  insert into public.exams
    (course_id, title, description, status, buffer_seconds,
     current_question_index, created_by)
  select course_id,
         coalesce(nullif(btrim(p_title), ''), title || ' (สำเนา)'),
         description, 'draft', buffer_seconds, -1, auth.uid()
    from public.exams
   where id = p_exam_id
  returning id into v_new_id;

  -- Copy every question + rubric verbatim.
  insert into public.questions
    (exam_id, order_index, stem, image_url, answer_key, rubric,
     max_score, time_limit_seconds)
  select v_new_id, order_index, stem, image_url, answer_key, rubric,
         max_score, time_limit_seconds
    from public.questions
   where exam_id = p_exam_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'clone_exam', 'exam', v_new_id,
          jsonb_build_object('source_exam_id', p_exam_id));

  return v_new_id;
end;
$$;

grant execute on function public.clone_exam(uuid, text) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> 0007_schedule.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Scheduled exams + waiting-room auto-start.
-- ============================================================
-- The lecturer sets exams.scheduled_start and status='scheduled' (allowed by
-- the existing staff-write RLS). Students open the exam early into a waiting
-- room; their page (and the lecturer's) poll start_if_due(), which flips the
-- exam to live exactly when the scheduled time arrives. No cron needed.
-- ============================================================

-- Allow students to JOIN while an exam is scheduled (waiting room), not only
-- once it is live. The attempt is created up front; the exam still doesn't
-- reveal questions until it goes live (enforced by the questions RLS).
create or replace function public.join_exam(p_exam_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_exam    public.exams%rowtype;
  v_attempt uuid;
begin
  select * into v_exam from public.exams where id = p_exam_id;
  if not found then raise exception 'Exam not found'; end if;

  if not public.is_course_student(v_exam.course_id) and not public.is_admin() then
    raise exception 'You are not enrolled in this course';
  end if;

  if v_exam.status not in ('scheduled', 'live') then
    raise exception 'Exam is not open for joining';
  end if;

  insert into public.attempts (exam_id, student_id)
  values (p_exam_id, auth.uid())
  on conflict (exam_id, student_id) do update set exam_id = excluded.exam_id
  returning id into v_attempt;

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'join_exam', 'exam', p_exam_id);

  return v_attempt;
end $$;

-- Server-guarded auto-start: any authenticated participant may poll this, but
-- it only starts the exam when it is scheduled AND the scheduled time has
-- arrived. It cannot start an exam early or one that isn't scheduled.
create or replace function public.start_if_due(p_exam_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_exam public.exams%rowtype;
begin
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then return; end if;

  if v_exam.status = 'scheduled'
     and v_exam.scheduled_start is not null
     and now() >= v_exam.scheduled_start then
    update public.exams
       set status = 'live',
           current_question_index = 0,
           current_started_at = now()
     where id = p_exam_id;

    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (auth.uid(), 'auto_start_exam', 'exam', p_exam_id);
  end if;
end $$;

grant execute on function public.start_if_due(uuid) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> 0008_cron_autostart.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Reliable scheduled auto-start via pg_cron.
-- ============================================================
-- The client waiting-room poll (start_if_due) only fires when someone has a
-- page open at the scheduled time. This adds a server-side scheduler that
-- starts every due exam once a minute, so an exam begins on time even if no
-- one is watching. The client poll stays as the instant fast-path.
-- ============================================================

create extension if not exists pg_cron;

-- Flip every scheduled exam whose start time has arrived. Returns how many
-- were started (0 most minutes).
create or replace function public.start_due_exams()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with started as (
    update public.exams
       set status = 'live',
           current_question_index = 0,
           current_started_at = now()
     where status = 'scheduled'
       and scheduled_start is not null
       and now() >= scheduled_start
    returning id
  )
  select count(*) into v_count from started;
  return v_count;
end $$;

-- Re-scheduling is idempotent: drop an existing job of the same name, then add.
do $$
begin
  perform cron.unschedule('start-due-exams');
exception
  when others then null;
end $$;

select cron.schedule(
  'start-due-exams',
  '* * * * *',
  $$select public.start_due_exams();$$
);

-- >>>>>>>>>>>>>>>>>>>> 0009_cron_advance.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Server-side auto-advance backstop (extends the pg_cron tick).
-- ============================================================
-- advance_if_due only runs when a page is polling it. For an unattended /
-- auto-started exam nobody is polling, so it never leaves Q1. This replaces the
-- start-only cron job with a combined tick that BOTH starts due exams AND
-- advances due live exams every minute. The client polls stay as the instant
-- fast-path when students/lecturers are watching (sub-second); the cron is the
-- guaranteed backstop (within ~1 minute) when no one is.
-- ============================================================

create or replace function public.exam_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- 1) start any scheduled exam whose time has arrived
  perform public.start_due_exams();

  -- 2) advance any live exam past its current question's deadline
  --    (advance_if_due is guarded: it only advances when actually due, and
  --     closes the exam after the last question)
  for r in select id from public.exams where status = 'live' loop
    perform public.advance_if_due(r.id);
  end loop;
end $$;

-- Replace the start-only job with the combined tick (idempotent).
do $$ begin perform cron.unschedule('start-due-exams'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('exam-tick');       exception when others then null; end $$;

select cron.schedule('exam-tick', '* * * * *', $$select public.exam_tick();$$);

-- >>>>>>>>>>>>>>>>>>>> 0010_cron_faster.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Run the exam tick every 15 seconds (was every minute).
-- ============================================================
-- The minute-granularity backstop meant an unattended exam could sit up to ~60s
-- past a question's deadline before advancing. 15s makes unattended start and
-- advance feel on-time. (When students are actually in the exam, their browsers
-- still advance it instantly — this only affects the no-one-watching case.)
-- Falls back to every-minute if this pg_cron build doesn't accept seconds.
--
-- Note: the outer DO block uses the $do$ tag so the inner $$…$$ around the cron
-- command doesn't close it early.
-- ============================================================

do $$ begin perform cron.unschedule('exam-tick'); exception when others then null; end $$;

do $do$
begin
  perform cron.schedule('exam-tick', '15 seconds', $$select public.exam_tick();$$);
exception when others then
  perform cron.schedule('exam-tick', '* * * * *', $$select public.exam_tick();$$);
end
$do$;

-- >>>>>>>>>>>>>>>>>>>> 0011_realtime_replica.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Make Realtime reliable for the RLS-protected exam tables.
-- ============================================================
-- Supabase Realtime evaluates row-level security against each change before
-- delivering it. With the default replica identity (primary key only), that
-- check can drop UPDATE/DELETE events, so a student's screen may not flip to the
-- next question even though it advanced. REPLICA IDENTITY FULL logs the whole
-- row so Realtime can authorize and deliver every change.
-- ============================================================

alter table public.exams    replica identity full;
alter table public.attempts replica identity full;

-- >>>>>>>>>>>>>>>>>>>> 0012_no_buffer.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Remove the inter-question grace buffer: advance exactly at zero.
-- ============================================================
-- advance_if_due waits time_limit + buffer_seconds before moving on. The 5s
-- buffer added a visible delay. Setting it to 0 makes each question advance the
-- instant its timer ends. (Answers autosave every 2s and are flushed on
-- advance, so nothing is lost.)
-- ============================================================

alter table public.exams alter column buffer_seconds set default 0;
update public.exams set buffer_seconds = 0 where buffer_seconds <> 0;

-- >>>>>>>>>>>>>>>>>>>> 0013_question_images.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Allow multiple image links per question.
-- ============================================================
-- Adds questions.image_urls (jsonb array of URLs). Migrates any existing single
-- image_url into the array. image_url is left in place for safety but the app
-- now reads/writes image_urls.
-- ============================================================

alter table public.questions
  add column if not exists image_urls jsonb not null default '[]'::jsonb;

update public.questions
   set image_urls = jsonb_build_array(image_url)
 where image_url is not null
   and image_url <> ''
   and (image_urls is null or image_urls = '[]'::jsonb);

-- >>>>>>>>>>>>>>>>>>>> 0014_exam_lock.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Exam integrity: record when a student leaves the exam window.
-- ============================================================
-- Browsers can't block tab switching, but we can detect and count it. The
-- student's exam page reports each time it is hidden / loses focus; the proctor
-- sees the count per student. Acts as a deterrent + an audit signal.
-- ============================================================

alter table public.attempts
  add column if not exists focus_violations int not null default 0;

create or replace function public.record_focus_violation(p_exam_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.attempts
     set focus_violations = focus_violations + 1
   where exam_id = p_exam_id and student_id = auth.uid();
end $$;

grant execute on function public.record_focus_violation(uuid) to authenticated;

-- ============================================================
-- 0015_question_media : video links + image upload storage
-- ============================================================
alter table public.questions
  add column if not exists video_urls jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('question-media', 'question-media', true)
on conflict (id) do nothing;

drop policy if exists "question media public read" on storage.objects;
create policy "question media public read" on storage.objects
  for select using (bucket_id = 'question-media');

drop policy if exists "question media authenticated upload" on storage.objects;
create policy "question media authenticated upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'question-media');

drop policy if exists "question media owner update" on storage.objects;
create policy "question media owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'question-media' and owner = auth.uid());

drop policy if exists "question media owner delete" on storage.objects;
create policy "question media owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'question-media' and owner = auth.uid());

create or replace function public.clone_exam(p_exam_id uuid, p_title text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_course_id uuid;
  v_new_id    uuid;
begin
  select course_id into v_course_id from public.exams where id = p_exam_id;
  if v_course_id is null then
    raise exception 'exam not found';
  end if;
  if not public.is_course_staff(v_course_id) then
    raise exception 'not authorised';
  end if;

  insert into public.exams
    (course_id, title, description, status, buffer_seconds,
     current_question_index, created_by)
  select course_id,
         coalesce(nullif(btrim(p_title), ''), title || ' (สำเนา)'),
         description, 'draft', buffer_seconds, -1, auth.uid()
    from public.exams
   where id = p_exam_id
  returning id into v_new_id;

  insert into public.questions
    (exam_id, order_index, stem, image_url, image_urls, video_urls,
     answer_key, rubric, max_score, time_limit_seconds)
  select v_new_id, order_index, stem, image_url, image_urls, video_urls,
         answer_key, rubric, max_score, time_limit_seconds
    from public.questions
   where exam_id = p_exam_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'clone_exam', 'exam', v_new_id,
          jsonb_build_object('source_exam_id', p_exam_id));

  return v_new_id;
end;
$$;


-- ============================================================
-- 0016_exam_graders : per-exam grading permissions
-- ============================================================
-- ============================================================
-- Per-exam grading permissions (co-teaching).
-- ============================================================
-- By default an exam is SHARED: every lecturer in the course can view + grade
-- it (unchanged behaviour). A lecturer may instead RESTRICT a specific exam to
-- a chosen set of course lecturers ("who can help grade this test"). When an
-- exam is restricted, only its creator + the chosen graders (+ admins) can see,
-- run, and grade it; other course lecturers cannot see it at all.
--
-- Mechanism: exams.graders_restricted flag + an exam_graders allow-list, and a
-- new is_exam_staff() that all exam-scoped access now flows through. For a
-- non-restricted exam, is_exam_staff() == is_course_staff(), so nothing about
-- existing exams changes.
-- ============================================================

alter table public.exams
  add column if not exists graders_restricted boolean not null default false;

create table if not exists public.exam_graders (
  exam_id uuid not null references public.exams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (exam_id, user_id)
);
alter table public.exam_graders enable row level security;

-- ---------- who is "staff" for a given exam ----------
create or replace function public.is_exam_staff(p_exam_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.exams e
      where e.id = p_exam_id
        and (
          -- shared exam: any lecturer of the course
          (not e.graders_restricted and public.is_course_staff(e.course_id))
          -- restricted exam: the creator or an explicitly assigned grader
          or (e.graders_restricted and (
                e.created_by = auth.uid()
             or exists (
                  select 1 from public.exam_graders g
                  where g.exam_id = e.id and g.user_id = auth.uid()
                )
          ))
        )
    )
$$;

-- Staff of an exam may read its grader list; writes go through the RPC below.
drop policy if exists "read exam graders" on public.exam_graders;
create policy "read exam graders" on public.exam_graders
  for select using (public.is_exam_staff(exam_id));

-- ---------- set an exam's grading permissions ----------
-- Only the exam's creator (or an admin) can change who grades it. Assigned
-- users must be lecturers of the same course.
create or replace function public.set_exam_graders(
  p_exam_id    uuid,
  p_restricted boolean,
  p_user_ids   uuid[]
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_course  uuid;
  v_creator uuid;
  u         uuid;
begin
  select course_id, created_by into v_course, v_creator
  from public.exams where id = p_exam_id;
  if v_course is null then raise exception 'exam not found'; end if;

  if not (public.is_admin() or v_creator = auth.uid()) then
    raise exception 'Only the exam owner can change grading access';
  end if;

  update public.exams set graders_restricted = p_restricted where id = p_exam_id;

  delete from public.exam_graders where exam_id = p_exam_id;
  if p_restricted and p_user_ids is not null then
    foreach u in array p_user_ids loop
      if exists (
        select 1 from public.course_members m
        where m.course_id = v_course and m.user_id = u
          and m.role_in_course = 'lecturer'
      ) then
        insert into public.exam_graders (exam_id, user_id)
        values (p_exam_id, u)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'set_exam_graders', 'exam', p_exam_id,
          jsonb_build_object('restricted', p_restricted,
                             'count', coalesce(array_length(p_user_ids, 1), 0)));
end $$;

grant execute on function public.is_exam_staff(uuid) to authenticated;
grant execute on function public.set_exam_graders(uuid, boolean, uuid[]) to authenticated;

-- ============================================================
-- Re-point every exam-scoped RLS staff check at is_exam_staff().
-- Student policies are unchanged.
-- ============================================================

-- ---------- exams ----------
drop policy if exists "read exams" on public.exams;
create policy "read exams" on public.exams
  for select using (
    public.is_exam_staff(id)
    or (public.is_course_student(course_id)
        and status in ('scheduled', 'live', 'closed', 'released'))
  );

-- Split write so creation is gated on course membership (the exam row does not
-- exist yet), while edits/deletes respect per-exam restriction.
drop policy if exists "staff write exams" on public.exams;
drop policy if exists "staff insert exams" on public.exams;
create policy "staff insert exams" on public.exams
  for insert with check (public.is_course_staff(course_id));
drop policy if exists "staff update exams" on public.exams;
create policy "staff update exams" on public.exams
  for update using (public.is_exam_staff(id)) with check (public.is_exam_staff(id));
drop policy if exists "staff delete exams" on public.exams;
create policy "staff delete exams" on public.exams
  for delete using (public.is_exam_staff(id));

-- ---------- questions ----------
drop policy if exists "staff read questions" on public.questions;
create policy "staff read questions" on public.questions
  for select using (public.is_exam_staff(exam_id));
drop policy if exists "staff write questions" on public.questions;
create policy "staff write questions" on public.questions
  for all using (public.is_exam_staff(exam_id))
  with check (public.is_exam_staff(exam_id));

-- ---------- attempts ----------
drop policy if exists "read own or staff attempts" on public.attempts;
create policy "read own or staff attempts" on public.attempts
  for select using (
    student_id = auth.uid() or public.is_exam_staff(exam_id)
  );

-- ---------- answers ----------
drop policy if exists "read own or staff answers" on public.answers;
create policy "read own or staff answers" on public.answers
  for select using (
    exists (select 1 from public.attempts a
            where a.id = attempt_id and a.student_id = auth.uid())
    or exists (
      select 1 from public.attempts a
      where a.id = attempt_id and public.is_exam_staff(a.exam_id)
    )
  );

-- ---------- grades ----------
drop policy if exists "read grades" on public.grades;
create policy "read grades" on public.grades
  for select using (
    exists (
      select 1
      from public.answers ans
      join public.attempts a on a.id = ans.attempt_id
      join public.exams e on e.id = a.exam_id
      where ans.id = answer_id
        and (
          public.is_exam_staff(e.id)
          or (a.student_id = auth.uid() and e.status = 'released')
        )
    )
  );
drop policy if exists "staff write grades" on public.grades;
create policy "staff write grades" on public.grades
  for all using (
    exists (
      select 1 from public.answers ans
      join public.attempts a on a.id = ans.attempt_id
      where ans.id = answer_id and public.is_exam_staff(a.exam_id)
    )
  ) with check (
    exists (
      select 1 from public.answers ans
      join public.attempts a on a.id = ans.attempt_id
      where ans.id = answer_id and public.is_exam_staff(a.exam_id)
    )
  );

-- ============================================================
-- Re-point exam-control RPCs at is_exam_staff() too, so a non-assigned
-- lecturer cannot start / advance / release / clone a restricted exam.
-- ============================================================

create or replace function public.start_exam(p_exam_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_exam_staff(p_exam_id) then
    raise exception 'Not authorised';
  end if;
  update public.exams
     set status = 'live', current_question_index = 0, current_started_at = now()
   where id = p_exam_id;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'start_exam', 'exam', p_exam_id);
end $$;

create or replace function public.advance_exam(p_exam_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_exam  public.exams%rowtype;
  v_count int;
begin
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then raise exception 'Exam not found'; end if;
  if not public.is_exam_staff(p_exam_id) then
    raise exception 'Not authorised';
  end if;

  select count(*) into v_count from public.questions where exam_id = p_exam_id;
  if v_exam.current_question_index + 1 >= v_count then
    update public.exams set status = 'closed' where id = p_exam_id;
  else
    update public.exams
       set current_question_index = v_exam.current_question_index + 1,
           current_started_at = now()
     where id = p_exam_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'advance_exam', 'exam', p_exam_id,
          jsonb_build_object('from_index', v_exam.current_question_index));
  return (select current_question_index from public.exams where id = p_exam_id);
end $$;

create or replace function public.release_results(p_exam_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_exam_staff(p_exam_id) then
    raise exception 'Not authorised';
  end if;
  update public.exams set status = 'released' where id = p_exam_id;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'release_results', 'exam', p_exam_id);
end $$;

create or replace function public.clone_exam(p_exam_id uuid, p_title text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_new_id uuid;
begin
  if not public.is_exam_staff(p_exam_id) then
    raise exception 'not authorised';
  end if;

  insert into public.exams
    (course_id, title, description, status, buffer_seconds,
     current_question_index, created_by)
  select course_id,
         coalesce(nullif(btrim(p_title), ''), title || ' (สำเนา)'),
         description, 'draft', buffer_seconds, -1, auth.uid()
    from public.exams
   where id = p_exam_id
  returning id into v_new_id;

  insert into public.questions
    (exam_id, order_index, stem, image_url, image_urls, video_urls,
     answer_key, rubric, max_score, time_limit_seconds)
  select v_new_id, order_index, stem, image_url, image_urls, video_urls,
         answer_key, rubric, max_score, time_limit_seconds
    from public.questions
   where exam_id = p_exam_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'clone_exam', 'exam', v_new_id,
          jsonb_build_object('source_exam_id', p_exam_id));
  return v_new_id;
end;
$$;

-- >>>>>>>>>>>>>>>>>>>> 0015_question_media.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Question media: video links + direct image upload storage.
-- ============================================================
-- Two additions for the question editor:
--  1. questions.video_urls: a jsonb array of video links (YouTube / Drive /
--     direct file), shown to students with a live preview, like image_urls.
--  2. A public Storage bucket "question-media" so lecturers can upload an image
--     directly (in addition to pasting a URL). Uploaded files get a public URL
--     that is stored back into questions.image_urls, so nothing about how the
--     app reads images changes. Images are compressed in the browser before
--     upload (kept well under 5 MB), so storage stays small (free-tier friendly).
-- ============================================================

alter table public.questions
  add column if not exists video_urls jsonb not null default '[]'::jsonb;

-- ---------- storage bucket ----------
-- Public bucket: read is public (needed so the <img>/<video> tag can load the
-- file without a signed URL); writes are restricted to signed-in staff below.
insert into storage.buckets (id, name, public)
values ('question-media', 'question-media', true)
on conflict (id) do nothing;

-- Anyone can read (public exam images render for students without auth juggling).
drop policy if exists "question media public read" on storage.objects;
create policy "question media public read" on storage.objects
  for select using (bucket_id = 'question-media');

-- Only authenticated users (lecturers/admins reach the editor via RLS) upload.
drop policy if exists "question media authenticated upload" on storage.objects;
create policy "question media authenticated upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'question-media');

-- Allow the uploader to overwrite / remove their own files.
drop policy if exists "question media owner update" on storage.objects;
create policy "question media owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'question-media' and owner = auth.uid());

drop policy if exists "question media owner delete" on storage.objects;
create policy "question media owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'question-media' and owner = auth.uid());

-- ---------- keep clone_exam in sync with the media columns ----------
-- The original clone_exam copied only image_url, so it silently dropped the
-- multi-image list (0013) and now videos. Copy all media columns verbatim.
create or replace function public.clone_exam(p_exam_id uuid, p_title text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_course_id uuid;
  v_new_id    uuid;
begin
  select course_id into v_course_id from public.exams where id = p_exam_id;
  if v_course_id is null then
    raise exception 'exam not found';
  end if;
  if not public.is_course_staff(v_course_id) then
    raise exception 'not authorised';
  end if;

  insert into public.exams
    (course_id, title, description, status, buffer_seconds,
     current_question_index, created_by)
  select course_id,
         coalesce(nullif(btrim(p_title), ''), title || ' (สำเนา)'),
         description, 'draft', buffer_seconds, -1, auth.uid()
    from public.exams
   where id = p_exam_id
  returning id into v_new_id;

  insert into public.questions
    (exam_id, order_index, stem, image_url, image_urls, video_urls,
     answer_key, rubric, max_score, time_limit_seconds)
  select v_new_id, order_index, stem, image_url, image_urls, video_urls,
         answer_key, rubric, max_score, time_limit_seconds
    from public.questions
   where exam_id = p_exam_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'clone_exam', 'exam', v_new_id,
          jsonb_build_object('source_exam_id', p_exam_id));

  return v_new_id;
end;
$$;

-- >>>>>>>>>>>>>>>>>>>> 0016_exam_graders.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Per-exam grading permissions (co-teaching).
-- ============================================================
-- By default an exam is SHARED: every lecturer in the course can view + grade
-- it (unchanged behaviour). A lecturer may instead RESTRICT a specific exam to
-- a chosen set of course lecturers ("who can help grade this test"). When an
-- exam is restricted, only its creator + the chosen graders (+ admins) can see,
-- run, and grade it; other course lecturers cannot see it at all.
--
-- Mechanism: exams.graders_restricted flag + an exam_graders allow-list, and a
-- new is_exam_staff() that all exam-scoped access now flows through. For a
-- non-restricted exam, is_exam_staff() == is_course_staff(), so nothing about
-- existing exams changes.
-- ============================================================

alter table public.exams
  add column if not exists graders_restricted boolean not null default false;

create table if not exists public.exam_graders (
  exam_id uuid not null references public.exams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (exam_id, user_id)
);
alter table public.exam_graders enable row level security;

-- ---------- who is "staff" for a given exam ----------
create or replace function public.is_exam_staff(p_exam_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.exams e
      where e.id = p_exam_id
        and (
          -- shared exam: any lecturer of the course
          (not e.graders_restricted and public.is_course_staff(e.course_id))
          -- restricted exam: the creator or an explicitly assigned grader
          or (e.graders_restricted and (
                e.created_by = auth.uid()
             or exists (
                  select 1 from public.exam_graders g
                  where g.exam_id = e.id and g.user_id = auth.uid()
                )
          ))
        )
    )
$$;

-- Staff of an exam may read its grader list; writes go through the RPC below.
drop policy if exists "read exam graders" on public.exam_graders;
create policy "read exam graders" on public.exam_graders
  for select using (public.is_exam_staff(exam_id));

-- ---------- set an exam's grading permissions ----------
-- Only the exam's creator (or an admin) can change who grades it. Assigned
-- users must be lecturers of the same course.
create or replace function public.set_exam_graders(
  p_exam_id    uuid,
  p_restricted boolean,
  p_user_ids   uuid[]
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_course  uuid;
  v_creator uuid;
  u         uuid;
begin
  select course_id, created_by into v_course, v_creator
  from public.exams where id = p_exam_id;
  if v_course is null then raise exception 'exam not found'; end if;

  if not (public.is_admin() or v_creator = auth.uid()) then
    raise exception 'Only the exam owner can change grading access';
  end if;

  update public.exams set graders_restricted = p_restricted where id = p_exam_id;

  delete from public.exam_graders where exam_id = p_exam_id;
  if p_restricted and p_user_ids is not null then
    foreach u in array p_user_ids loop
      if exists (
        select 1 from public.course_members m
        where m.course_id = v_course and m.user_id = u
          and m.role_in_course = 'lecturer'
      ) then
        insert into public.exam_graders (exam_id, user_id)
        values (p_exam_id, u)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'set_exam_graders', 'exam', p_exam_id,
          jsonb_build_object('restricted', p_restricted,
                             'count', coalesce(array_length(p_user_ids, 1), 0)));
end $$;

grant execute on function public.is_exam_staff(uuid) to authenticated;
grant execute on function public.set_exam_graders(uuid, boolean, uuid[]) to authenticated;

-- ============================================================
-- Re-point every exam-scoped RLS staff check at is_exam_staff().
-- Student policies are unchanged.
-- ============================================================

-- ---------- exams ----------
drop policy if exists "read exams" on public.exams;
create policy "read exams" on public.exams
  for select using (
    public.is_exam_staff(id)
    or (public.is_course_student(course_id)
        and status in ('scheduled', 'live', 'closed', 'released'))
  );

-- Split write so creation is gated on course membership (the exam row does not
-- exist yet), while edits/deletes respect per-exam restriction.
drop policy if exists "staff write exams" on public.exams;
drop policy if exists "staff insert exams" on public.exams;
create policy "staff insert exams" on public.exams
  for insert with check (public.is_course_staff(course_id));
drop policy if exists "staff update exams" on public.exams;
create policy "staff update exams" on public.exams
  for update using (public.is_exam_staff(id)) with check (public.is_exam_staff(id));
drop policy if exists "staff delete exams" on public.exams;
create policy "staff delete exams" on public.exams
  for delete using (public.is_exam_staff(id));

-- ---------- questions ----------
drop policy if exists "staff read questions" on public.questions;
create policy "staff read questions" on public.questions
  for select using (public.is_exam_staff(exam_id));
drop policy if exists "staff write questions" on public.questions;
create policy "staff write questions" on public.questions
  for all using (public.is_exam_staff(exam_id))
  with check (public.is_exam_staff(exam_id));

-- ---------- attempts ----------
drop policy if exists "read own or staff attempts" on public.attempts;
create policy "read own or staff attempts" on public.attempts
  for select using (
    student_id = auth.uid() or public.is_exam_staff(exam_id)
  );

-- ---------- answers ----------
drop policy if exists "read own or staff answers" on public.answers;
create policy "read own or staff answers" on public.answers
  for select using (
    exists (select 1 from public.attempts a
            where a.id = attempt_id and a.student_id = auth.uid())
    or exists (
      select 1 from public.attempts a
      where a.id = attempt_id and public.is_exam_staff(a.exam_id)
    )
  );

-- ---------- grades ----------
drop policy if exists "read grades" on public.grades;
create policy "read grades" on public.grades
  for select using (
    exists (
      select 1
      from public.answers ans
      join public.attempts a on a.id = ans.attempt_id
      join public.exams e on e.id = a.exam_id
      where ans.id = answer_id
        and (
          public.is_exam_staff(e.id)
          or (a.student_id = auth.uid() and e.status = 'released')
        )
    )
  );
drop policy if exists "staff write grades" on public.grades;
create policy "staff write grades" on public.grades
  for all using (
    exists (
      select 1 from public.answers ans
      join public.attempts a on a.id = ans.attempt_id
      where ans.id = answer_id and public.is_exam_staff(a.exam_id)
    )
  ) with check (
    exists (
      select 1 from public.answers ans
      join public.attempts a on a.id = ans.attempt_id
      where ans.id = answer_id and public.is_exam_staff(a.exam_id)
    )
  );

-- ============================================================
-- Re-point exam-control RPCs at is_exam_staff() too, so a non-assigned
-- lecturer cannot start / advance / release / clone a restricted exam.
-- ============================================================

create or replace function public.start_exam(p_exam_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_exam_staff(p_exam_id) then
    raise exception 'Not authorised';
  end if;
  update public.exams
     set status = 'live', current_question_index = 0, current_started_at = now()
   where id = p_exam_id;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'start_exam', 'exam', p_exam_id);
end $$;

create or replace function public.advance_exam(p_exam_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_exam  public.exams%rowtype;
  v_count int;
begin
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then raise exception 'Exam not found'; end if;
  if not public.is_exam_staff(p_exam_id) then
    raise exception 'Not authorised';
  end if;

  select count(*) into v_count from public.questions where exam_id = p_exam_id;
  if v_exam.current_question_index + 1 >= v_count then
    update public.exams set status = 'closed' where id = p_exam_id;
  else
    update public.exams
       set current_question_index = v_exam.current_question_index + 1,
           current_started_at = now()
     where id = p_exam_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'advance_exam', 'exam', p_exam_id,
          jsonb_build_object('from_index', v_exam.current_question_index));
  return (select current_question_index from public.exams where id = p_exam_id);
end $$;

create or replace function public.release_results(p_exam_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_exam_staff(p_exam_id) then
    raise exception 'Not authorised';
  end if;
  update public.exams set status = 'released' where id = p_exam_id;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'release_results', 'exam', p_exam_id);
end $$;

create or replace function public.clone_exam(p_exam_id uuid, p_title text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_new_id uuid;
begin
  if not public.is_exam_staff(p_exam_id) then
    raise exception 'not authorised';
  end if;

  insert into public.exams
    (course_id, title, description, status, buffer_seconds,
     current_question_index, created_by)
  select course_id,
         coalesce(nullif(btrim(p_title), ''), title || ' (สำเนา)'),
         description, 'draft', buffer_seconds, -1, auth.uid()
    from public.exams
   where id = p_exam_id
  returning id into v_new_id;

  insert into public.questions
    (exam_id, order_index, stem, image_url, image_urls, video_urls,
     answer_key, rubric, max_score, time_limit_seconds)
  select v_new_id, order_index, stem, image_url, image_urls, video_urls,
         answer_key, rubric, max_score, time_limit_seconds
    from public.questions
   where exam_id = p_exam_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'clone_exam', 'exam', v_new_id,
          jsonb_build_object('source_exam_id', p_exam_id));
  return v_new_id;
end;
$$;

-- >>>>>>>>>>>>>>>>>>>> 0017_enrol_student_code.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- MEQ Exam Platform : enrolment now carries an optional student ID
-- ============================================================
-- CMU student emails are name-based (e.g. somchai_j@cmu.ac.th), so the student
-- ID cannot be derived from the email. Instead the lecturer may paste it next
-- to the email in the add/drop panel. This extends enrol_member to accept that
-- code and write it onto the student's profile (lecturers cannot write profiles
-- directly under RLS, so it goes through this SECURITY DEFINER function).
--
-- Run this WHOLE file once in the Supabase SQL editor.
-- ============================================================

-- Drop the old 3-arg signature so the new default-arg version is unambiguous.
drop function if exists public.enrol_member(uuid, text, text);

create or replace function public.enrol_member(
  p_course_id    uuid,
  p_email        text,
  p_role         text,
  p_student_code text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid;
begin
  if not public.is_course_staff(p_course_id) then
    raise exception 'Not authorised';
  end if;
  if p_role not in ('lecturer', 'student') then
    raise exception 'Invalid role';
  end if;

  select id into v_uid from public.profiles where lower(email) = lower(p_email);
  if v_uid is null then
    raise exception 'No account exists for %; ask them to sign in once first', p_email;
  end if;

  insert into public.course_members (course_id, user_id, role_in_course)
  values (p_course_id, v_uid, p_role)
  on conflict (course_id, user_id)
  do update set role_in_course = excluded.role_in_course;

  -- Only set the student ID when a non-empty one was provided, so re-adding a
  -- member without a code never wipes an ID that is already on file.
  if p_student_code is not null and length(btrim(p_student_code)) > 0 then
    update public.profiles
    set student_code = btrim(p_student_code)
    where id = v_uid;
  end if;
end $$;

grant execute on function public.enrol_member(uuid, text, text, text) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> 0018_cmu_sso_accounts.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- MEQ Exam Platform : CMU SSO account records
-- ============================================================
-- WHY THIS EXISTS
--
-- Until now the only identity the platform had was an email address, and the
-- student ID had to be typed in by hand by a lecturer (see 0017). Once CMU
-- Entra ID / CMU OAuth is switched on, every sign-in returns an authoritative
-- "Basic Info" payload from CMU that already contains the student ID, the real
-- Thai and English name, the faculty, and the account type. This table stores
-- that payload so students and lecturers are linked to the platform by CMU's
-- own record instead of by hand-typed data.
--
-- THE PAYLOAD CMU RETURNS (verified against two live accounts, 2026-08-04)
--
--   Employee / lecturer                Student
--   -------------------------------    -------------------------------
--   cmuitaccount_name  "chalita.j"     cmuitaccount_name  "thairat_panmethis"
--   cmuitaccount       "chalita.j@..." cmuitaccount       "thairat_panmethis@..."
--   student_id         ""              student_id         "641410022"
--   prename_id         "MS"            prename_id         "OTH"
--   prename_TH         "นางสาว"          prename_TH         ""
--   prename_EN         "Miss"          prename_EN         ""
--   firstname_TH       "ชลิตา"           firstname_TH       "ไทยรัฐ"
--   firstname_EN       "CHALITA"       firstname_EN       "THAIRAT"
--   lastname_TH        "ใจนนถีย์"         lastname_TH        "พันธุ์เมธิส"
--   lastname_EN        "JAINONTHEE"    lastname_EN        "PANMETHIS"
--   organization_code  "14"            organization_code  "14"
--   organization_name_TH  "คณะสัตวแพทยศาสตร์"  (same for both)
--   organization_name_EN  "Faculty of Veterinary Medicine"
--   itaccounttype_id   "MISEmpAcc"     itaccounttype_id   "StdAcc"
--   itaccounttype_TH   "บุคลากร"          itaccounttype_TH   "นักศึกษาปัจจุบัน"
--   itaccounttype_EN   "MIS Employee"  itaccounttype_EN   "Student Account"
--
-- THREE TRAPS THAT THIS MIGRATION HANDLES, DO NOT REMOVE THEM
--   1. CMU sends EMPTY STRINGS, not nulls. A lecturer's student_id is "" and a
--      student's prename_TH is "". Every text field is normalised through
--      nullif(btrim(...), '') on the way in, so "" never reaches the table.
--   2. student_id for a non-student is EITHER "" OR A ZERO ("0", "000000000"),
--      confirmed by CMU IT. Both mean "this person has no student ID". They are
--      normalised to NULL by norm_student_id() below, so nothing downstream has
--      to know about the placeholder. A real CMU student ID is year-prefixed
--      (e.g. 641410022) and is never all zeros, so this cannot eat a real one.
--   3. itaccounttype_id is the ONLY reliable way to tell a student from staff.
--      Do not guess from the email: student emails are name-based, exactly the
--      problem 0017 was written to work around.
--
-- Run this WHOLE file once in the Supabase SQL editor.
-- ============================================================

-- ---------- helper ----------
-- Turn CMU's "no student ID" values into a real NULL. CMU sends "" for some
-- staff accounts and a zero ("0", or a zero-padded run) for others; both mean
-- the same thing. Immutable so it can be used in an index or a check.
create or replace function public.norm_student_id(p_value text)
returns text
language sql immutable
as $$
  select nullif(
           nullif(btrim(coalesce(p_value, '')), ''),
           repeat('0', length(btrim(coalesce(p_value, ''))))
         )
$$;

comment on function public.norm_student_id(text) is
  'Normalises a CMU student_id: empty string or all-zeros becomes NULL.';

-- ---------- table ----------
-- One row per CMU account, 1:1 with profiles. profiles stays the app-level
-- identity (role, display name); this table is the raw CMU record of truth.
create table if not exists public.cmu_accounts (
  user_id              uuid primary key references public.profiles(id) on delete cascade,

  -- Identity. cmuitaccount is the full email, cmuitaccount_name is the part
  -- before the @. Both are unique: one CMU account maps to one platform user.
  cmuitaccount_name    text not null,
  cmuitaccount         text not null,

  -- Student ID. NULL for staff, because CMU's "" and "0" placeholders are
  -- normalised away by norm_student_id() on the way in. This is what 0017
  -- asked lecturers to type by hand; after SSO it arrives automatically.
  student_id           text,

  -- Name. TH is what the exam papers and score exports should show; EN is kept
  -- for international documents.
  prename_id           text,
  prename_th           text,
  prename_en           text,
  firstname_th         text,
  firstname_en         text,
  lastname_th          text,
  lastname_en          text,

  -- Faculty. "14" = Faculty of Veterinary Medicine. Kept so the platform can
  -- later restrict sign-in to the faculty rather than to all of cmu.ac.th.
  organization_code    text,
  organization_name_th text,
  organization_name_en text,

  -- Account type. "StdAcc" = current student, "MISEmpAcc" = employee.
  itaccounttype_id     text,
  itaccounttype_th     text,
  itaccounttype_en     text,

  -- The untouched payload. If CMU adds a field later it is captured here
  -- without needing a migration, and it is the audit trail for what CMU
  -- actually returned at each sign-in.
  raw                  jsonb not null default '{}'::jsonb,

  first_seen_at        timestamptz not null default now(),
  last_login_at        timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Case-insensitive uniqueness: CMU is inconsistent about capitalisation.
create unique index if not exists cmu_accounts_account_key
  on public.cmu_accounts (lower(cmuitaccount));
create unique index if not exists cmu_accounts_account_name_key
  on public.cmu_accounts (lower(cmuitaccount_name));

-- Look up a student by the ID printed on their exam paper.
create index if not exists cmu_accounts_student_id_idx
  on public.cmu_accounts (student_id) where student_id is not null;
-- Filter a course roster down to one faculty or one account type.
create index if not exists cmu_accounts_org_idx
  on public.cmu_accounts (organization_code);
create index if not exists cmu_accounts_type_idx
  on public.cmu_accounts (itaccounttype_id);

comment on table public.cmu_accounts is
  'Authoritative CMU SSO Basic Info record, one row per user, 1:1 with profiles.';

-- ---------- convenience view ----------
-- What the roster and export screens actually want, already joined and with
-- the display name assembled.
--
-- security_invoker = true is REQUIRED. Without it a Postgres view runs with the
-- owner's rights, which would let any signed-in user read every student's ID
-- and name straight through the view, bypassing the policies below.
create or replace view public.v_user_directory
with (security_invoker = true) as
select
  p.id            as user_id,
  p.email,
  p.role,
  c.student_id,
  btrim(coalesce(c.prename_th, '') || ' ' ||
        coalesce(c.firstname_th, '') || ' ' ||
        coalesce(c.lastname_th, ''))                as full_name_th,
  btrim(coalesce(c.firstname_en, '') || ' ' ||
        coalesce(c.lastname_en, ''))                as full_name_en,
  c.organization_code,
  c.organization_name_th,
  c.itaccounttype_id,
  c.last_login_at
from public.profiles p
left join public.cmu_accounts c on c.user_id = p.id;

-- ---------- upsert on sign-in ----------
-- Called once per sign-in with the raw JSON straight from CMU.
--
-- SECURITY: runs as definer so it can write profiles (which users cannot write
-- directly under RLS), but it refuses to write a row for anyone other than the
-- caller. Without that check any signed-in student could overwrite a
-- lecturer's record by posting their email.
create or replace function public.sync_cmu_account(p_payload jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid            uuid := auth.uid();
  v_caller_email   text;
  v_account        text;
  v_student_id     text;
  v_type           text;
  v_name_th        text;
  v_is_new         boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Normalise: CMU sends "" for missing values, we want NULL. student_id gets
  -- the extra zero-placeholder handling (see trap 2 in the header).
  v_account    := lower(nullif(btrim(p_payload->>'cmuitaccount'), ''));
  v_student_id := public.norm_student_id(p_payload->>'student_id');
  v_type       := nullif(btrim(p_payload->>'itaccounttype_id'), '');

  if v_account is null then
    raise exception 'Payload has no cmuitaccount';
  end if;

  -- The payload must belong to the caller. Compare against the email on the
  -- session token, not against anything in the payload itself. Falls back to
  -- auth.users if the JWT carries no email claim.
  v_caller_email := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  if v_caller_email is null then
    select lower(email) into v_caller_email from auth.users where id = v_uid;
  end if;
  if v_caller_email is distinct from v_account then
    raise exception 'CMU payload (%) does not match the signed-in account', v_account;
  end if;

  insert into public.cmu_accounts as t (
    user_id, cmuitaccount_name, cmuitaccount, student_id,
    prename_id, prename_th, prename_en,
    firstname_th, firstname_en, lastname_th, lastname_en,
    organization_code, organization_name_th, organization_name_en,
    itaccounttype_id, itaccounttype_th, itaccounttype_en,
    raw
  )
  values (
    v_uid,
    nullif(btrim(p_payload->>'cmuitaccount_name'), ''),
    v_account,
    v_student_id,
    nullif(btrim(p_payload->>'prename_id'), ''),
    nullif(btrim(p_payload->>'prename_TH'), ''),
    nullif(btrim(p_payload->>'prename_EN'), ''),
    nullif(btrim(p_payload->>'firstname_TH'), ''),
    nullif(btrim(p_payload->>'firstname_EN'), ''),
    nullif(btrim(p_payload->>'lastname_TH'), ''),
    nullif(btrim(p_payload->>'lastname_EN'), ''),
    nullif(btrim(p_payload->>'organization_code'), ''),
    nullif(btrim(p_payload->>'organization_name_TH'), ''),
    nullif(btrim(p_payload->>'organization_name_EN'), ''),
    v_type,
    nullif(btrim(p_payload->>'itaccounttype_TH'), ''),
    nullif(btrim(p_payload->>'itaccounttype_EN'), ''),
    p_payload
  )
  on conflict (user_id) do update set
    cmuitaccount_name    = excluded.cmuitaccount_name,
    cmuitaccount         = excluded.cmuitaccount,
    -- Never let a later sign-in blank out an ID we already hold.
    student_id           = coalesce(excluded.student_id, t.student_id),
    prename_id           = excluded.prename_id,
    prename_th           = excluded.prename_th,
    prename_en           = excluded.prename_en,
    firstname_th         = excluded.firstname_th,
    firstname_en         = excluded.firstname_en,
    lastname_th          = excluded.lastname_th,
    lastname_en          = excluded.lastname_en,
    organization_code    = excluded.organization_code,
    organization_name_th = excluded.organization_name_th,
    organization_name_en = excluded.organization_name_en,
    itaccounttype_id     = excluded.itaccounttype_id,
    itaccounttype_th     = excluded.itaccounttype_th,
    itaccounttype_en     = excluded.itaccounttype_en,
    raw                  = excluded.raw,
    last_login_at        = now(),
    updated_at           = now();

  -- Did this sign-in create the profile's first CMU link?
  select (first_seen_at = last_login_at) into v_is_new
    from public.cmu_accounts where user_id = v_uid;

  -- Push the derived fields onto the profile the rest of the app reads.
  v_name_th := nullif(btrim(
    coalesce(nullif(btrim(p_payload->>'prename_TH'), ''), '') || ' ' ||
    coalesce(nullif(btrim(p_payload->>'firstname_TH'), ''), '') || ' ' ||
    coalesce(nullif(btrim(p_payload->>'lastname_TH'), ''), '')
  ), '');

  update public.profiles
  set
    full_name    = coalesce(v_name_th, full_name),
    -- CMU's student ID wins over anything a lecturer typed by hand in 0017.
    student_code = coalesce(v_student_id, student_code),
    -- ROLE POLICY. Only ever set on the FIRST link, so an admin promotion is
    -- never undone by the next sign-in, and never downgraded.
    --   StdAcc    -> student
    --   MISEmpAcc -> guest, an admin promotes them to lecturer
    -- Employees are deliberately NOT auto-made lecturers: "MIS Employee"
    -- covers all faculty staff, not only teaching staff, and a lecturer can
    -- read every student's answers. To change this policy, replace 'guest'
    -- below with 'lecturer'.
    role = case
             when not v_is_new then role
             when role in ('admin', 'lecturer') then role
             when v_type = 'StdAcc' then 'student'::user_role
             when v_type = 'MISEmpAcc' then 'guest'::user_role
             else role
           end
  where id = v_uid;
end $$;

grant execute on function public.sync_cmu_account(jsonb) to authenticated;

-- ---------- row level security ----------
alter table public.cmu_accounts enable row level security;

-- Everyone may read their own CMU record.
create policy "read own cmu account" on public.cmu_accounts
  for select using (user_id = auth.uid() or public.is_admin());

-- Course staff may read the CMU record of anyone in a course they teach, so
-- the roster, the grading panel and the CSV export can show the real Thai name
-- and student ID.
create policy "staff read cmu accounts of their students" on public.cmu_accounts
  for select using (
    exists (
      select 1
      from public.course_members cm_student
      join public.course_members cm_staff
        on cm_staff.course_id = cm_student.course_id
      where cm_student.user_id = cmu_accounts.user_id
        and cm_staff.user_id = auth.uid()
        and cm_staff.role_in_course = 'lecturer'
    )
  );

-- No INSERT/UPDATE/DELETE policies on purpose: all writes go through
-- sync_cmu_account(), which verifies the payload belongs to the caller.
