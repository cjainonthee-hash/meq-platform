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
