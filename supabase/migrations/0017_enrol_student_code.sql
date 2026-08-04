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
