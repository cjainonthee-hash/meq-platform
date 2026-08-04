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
