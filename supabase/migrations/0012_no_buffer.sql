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
