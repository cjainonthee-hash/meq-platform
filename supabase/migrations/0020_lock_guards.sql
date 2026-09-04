-- ============================================================
-- Pre-lock guards on the two lockstep RPCs (advance_if_due, start_if_due).
-- ============================================================
-- Both functions opened with `select * from public.exams ... for update`, so
-- EVERY caller took a row lock before it had any idea whether there was
-- anything to do. During an exam that is a thundering herd: all 100 student
-- browsers hit the deadline inside the same 250 ms tick and fire
-- advance_if_due at once, then queue single file for one row lock against a
-- 60-connection pool. The same happens in the waiting room at the scheduled
-- start time, via start_if_due.
--
-- The fix is a cheap non-locking read first. If the question (or the start
-- time) is not actually due, return immediately without ever taking the lock.
-- In practice that is 99 of every 100 calls. The one caller that finds it IS
-- due then takes the lock and RE-CHECKS under it, exactly as before, so the
-- losers of the race still see the winner's committed update and still do
-- nothing. Correctness is unchanged; only the lock traffic drops.
--
-- Side benefit: the every-15-seconds exam_tick cron (0010) loops over all live
-- exams calling advance_if_due, so it becomes almost free too.
-- ============================================================

-- ---------- advance to the next question if its time is up ----------
create or replace function public.advance_if_due(p_exam_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_exam     public.exams%rowtype;
  v_limit    int;
  v_deadline timestamptz;
  v_count    int;
begin
  -- ---- pass 1: guard, NO lock ----
  select * into v_exam from public.exams where id = p_exam_id;
  if not found or v_exam.status <> 'live' then
    return coalesce(v_exam.current_question_index, -1);
  end if;

  select time_limit_seconds into v_limit
  from public.questions
  where exam_id = p_exam_id and order_index = v_exam.current_question_index;

  if v_limit is null then
    return v_exam.current_question_index;
  end if;

  -- A null current_started_at yields a null comparison, which is not true, so
  -- it falls through to the locking pass. That matches the old behaviour.
  if now() < v_exam.current_started_at
            + make_interval(secs => v_limit + v_exam.buffer_seconds) then
    return v_exam.current_question_index;   -- not due: the common case, no lock
  end if;

  -- ---- pass 2: it looks due, so lock and re-check under the lock ----
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found or v_exam.status <> 'live' then
    return coalesce(v_exam.current_question_index, -1);
  end if;

  select time_limit_seconds into v_limit
  from public.questions
  where exam_id = p_exam_id and order_index = v_exam.current_question_index;

  if v_limit is null then
    return v_exam.current_question_index;
  end if;

  v_deadline := v_exam.current_started_at
              + make_interval(secs => v_limit + v_exam.buffer_seconds);

  if now() < v_deadline then
    return v_exam.current_question_index;   -- another caller already advanced
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

  return (select current_question_index from public.exams where id = p_exam_id);
end $$;

-- ---------- start a scheduled exam if its time has arrived ----------
create or replace function public.start_if_due(p_exam_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_exam public.exams%rowtype;
begin
  -- ---- pass 1: guard, NO lock ----
  select * into v_exam from public.exams where id = p_exam_id;
  if not found
     or v_exam.status <> 'scheduled'
     or v_exam.scheduled_start is null
     or now() < v_exam.scheduled_start then
    return;
  end if;

  -- ---- pass 2: it looks due, so lock and re-check under the lock ----
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then return; end if;

  if v_exam.status = 'scheduled'
     and v_exam.scheduled_start is not null
     and now() >= v_exam.scheduled_start then
    update public.exams
       set status = 'live',
           current_question_index = 0,
           current_started_at = now()
     where id = p_exam_id;

    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (auth.uid(), 'auto_start_exam', 'exam', p_exam_id);
  end if;
end $$;

grant execute on function public.advance_if_due(uuid) to authenticated;
grant execute on function public.start_if_due(uuid)   to authenticated;
