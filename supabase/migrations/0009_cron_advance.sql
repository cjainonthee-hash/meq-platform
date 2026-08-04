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
