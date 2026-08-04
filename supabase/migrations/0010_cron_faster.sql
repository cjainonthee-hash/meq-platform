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
