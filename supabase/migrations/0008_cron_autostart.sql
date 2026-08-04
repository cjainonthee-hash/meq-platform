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
