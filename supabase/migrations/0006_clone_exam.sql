-- ============================================================
-- Reusable exams: clone an exam definition for a new sitting/run.
-- ============================================================
-- A recurring course reuses the same exam year after year. Rather than
-- re-authoring it (or overwriting last year's answers), the lecturer clones
-- the exam: this copies the questions + rubrics into a brand-new draft exam,
-- leaving the source exam and all its attempts/answers/grades untouched.
-- Each run is therefore an independent, permanent record.
-- ============================================================

create or replace function public.clone_exam(p_exam_id uuid, p_title text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_course_id uuid;
  v_new_id    uuid;
begin
  select course_id into v_course_id from public.exams where id = p_exam_id;
  if v_course_id is null then
    raise exception 'exam not found';
  end if;
  if not public.is_course_staff(v_course_id) then
    raise exception 'not authorised';
  end if;

  -- New exam: same definition, fresh (unstarted) live state.
  insert into public.exams
    (course_id, title, description, status, buffer_seconds,
     current_question_index, created_by)
  select course_id,
         coalesce(nullif(btrim(p_title), ''), title || ' (สำเนา)'),
         description, 'draft', buffer_seconds, -1, auth.uid()
    from public.exams
   where id = p_exam_id
  returning id into v_new_id;

  -- Copy every question + rubric verbatim.
  insert into public.questions
    (exam_id, order_index, stem, image_url, answer_key, rubric,
     max_score, time_limit_seconds)
  select v_new_id, order_index, stem, image_url, answer_key, rubric,
         max_score, time_limit_seconds
    from public.questions
   where exam_id = p_exam_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'clone_exam', 'exam', v_new_id,
          jsonb_build_object('source_exam_id', p_exam_id));

  return v_new_id;
end;
$$;

grant execute on function public.clone_exam(uuid, text) to authenticated;
