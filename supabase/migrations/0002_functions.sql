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
