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
