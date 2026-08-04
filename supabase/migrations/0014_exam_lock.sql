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
