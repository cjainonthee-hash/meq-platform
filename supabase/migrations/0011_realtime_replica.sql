-- ============================================================
-- Make Realtime reliable for the RLS-protected exam tables.
-- ============================================================
-- Supabase Realtime evaluates row-level security against each change before
-- delivering it. With the default replica identity (primary key only), that
-- check can drop UPDATE/DELETE events, so a student's screen may not flip to the
-- next question even though it advanced. REPLICA IDENTITY FULL logs the whole
-- row so Realtime can authorize and deliver every change.
-- ============================================================

alter table public.exams    replica identity full;
alter table public.attempts replica identity full;
