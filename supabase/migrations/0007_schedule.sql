-- ============================================================
-- Scheduled exams + waiting-room auto-start.
-- ============================================================
-- The lecturer sets exams.scheduled_start and status='scheduled' (allowed by
-- the existing staff-write RLS). Students open the exam early into a waiting
-- room; their page (and the lecturer's) poll start_if_due(), which flips the
-- exam to live exactly when the scheduled time arrives. No cron needed.
-- ============================================================

-- Allow students to JOIN while an exam is scheduled (waiting room), not only
-- once it is live. The attempt is created up front; the exam still doesn't
-- reveal questions until it goes live (enforced by the questions RLS).
create or replace function public.join_exam(p_exam_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_exam    public.exams%rowtype;
  v_attempt uuid;
begin
  select * into v_exam from public.exams where id = p_exam_id;
  if not found then raise exception 'Exam not found'; end if;

  if not public.is_course_student(v_exam.course_id) and not public.is_admin() then
    raise exception 'You are not enrolled in this course';
  end if;

  if v_exam.status not in ('scheduled', 'live') then
    raise exception 'Exam is not open for joining';
  end if;

  insert into public.attempts (exam_id, student_id)
  values (p_exam_id, auth.uid())
  on conflict (exam_id, student_id) do update set exam_id = excluded.exam_id
  returning id into v_attempt;

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'join_exam', 'exam', p_exam_id);

  return v_attempt;
end $$;

-- Server-guarded auto-start: any authenticated participant may poll this, but
-- it only starts the exam when it is scheduled AND the scheduled time has
-- arrived. It cannot start an exam early or one that isn't scheduled.
create or replace function public.start_if_due(p_exam_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_exam public.exams%rowtype;
begin
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

grant execute on function public.start_if_due(uuid) to authenticated;
