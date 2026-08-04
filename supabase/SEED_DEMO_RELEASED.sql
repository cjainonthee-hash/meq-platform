-- ============================================================
-- Demo data for the recording: a RELEASED, pre-graded MEQ exam.
-- Run this WHOLE file once in the Supabase SQL editor.
-- Safe to re-run: it deletes and rebuilds only its own demo exam.
-- Cleanup block at the very bottom (commented out) removes it afterwards.
-- ============================================================

do $$
declare
  v_lect  uuid;
  v_admin uuid;
  v_s1    uuid;
  v_s2    uuid;
  v_s3    uuid;
  v_course uuid;
  v_exam   uuid;
  v_q1 uuid; v_q2 uuid; v_q3 uuid;
  v_a1 uuid; v_a2 uuid; v_a3 uuid;
begin
  -- ---- find the demo accounts (created by `npm run seed`) ----
  select id into v_lect  from public.profiles where lower(email) = 'lecturer@cmu.ac.th';
  select id into v_admin from public.profiles where lower(email) = 'admin@cmu.ac.th';
  select id into v_s1    from public.profiles where lower(email) = 'student1@cmu.ac.th';
  select id into v_s2    from public.profiles where lower(email) = 'student2@cmu.ac.th';
  select id into v_s3    from public.profiles where lower(email) = 'student3@cmu.ac.th';
  if v_lect is null or v_s1 is null then
    raise exception 'Demo accounts missing. Run `npm run seed` first.';
  end if;

  -- ---- demo course (reuse the seeded one, or create it) ----
  select id into v_course from public.courses where code = 'VET401-DEMO';
  if v_course is null then
    insert into public.courses (code, title, description, created_by)
    values ('VET401-DEMO', 'Veterinary Public Health & Food Hygiene (Demo)',
            'Demo course for the MEQ platform', v_lect)
    returning id into v_course;
  end if;

  -- ---- memberships (idempotent). Admin joins as a CO-LECTURER so the
  --      per-exam permission picker (Scene 2) has a real name to choose. ----
  insert into public.course_members (course_id, user_id, role_in_course)
  values (v_course, v_lect, 'lecturer')
  on conflict (course_id, user_id) do update set role_in_course = 'lecturer';
  if v_admin is not null then
    insert into public.course_members (course_id, user_id, role_in_course)
    values (v_course, v_admin, 'lecturer')
    on conflict (course_id, user_id) do update set role_in_course = 'lecturer';
  end if;
  insert into public.course_members (course_id, user_id, role_in_course)
  values (v_course, v_s1, 'student'), (v_course, v_s2, 'student'), (v_course, v_s3, 'student')
  on conflict (course_id, user_id) do update set role_in_course = 'student';

  -- ---- remove any previous run of this demo exam (cascades) ----
  delete from public.exams
   where course_id = v_course and title like 'DEMO (Released)%';

  -- ---- the released exam ----
  insert into public.exams
    (course_id, title, description, status, created_by, graders_restricted,
     current_question_index)
  values (v_course, 'DEMO (Released) — MEQ Foodborne Zoonoses & AMR',
          'Pre-graded demo exam for the walkthrough recording.',
          'released', v_lect, false, 2)
  returning id into v_exam;

  -- ---- three questions ----
  insert into public.questions (exam_id, order_index, stem, answer_key, rubric, max_score, time_limit_seconds)
  values (v_exam, 0,
    'A broiler slaughterhouse reports rising Campylobacter contamination at the post-chill stage. Identify TWO critical control points and one practical intervention for each.',
    'CCPs: scalding, defeathering, evisceration, chilling. Interventions: raise scald temperature, sanitise/replace picker fingers, careful evisceration settings, adequate chiller sanitiser and counterflow.',
    '[{"criterion":"Identifies two valid CCPs","points":4},{"criterion":"Practical intervention for each","points":4},{"criterion":"Links control point to Campylobacter reduction","points":2}]'::jsonb,
    10, 120)
  returning id into v_q1;

  insert into public.questions (exam_id, order_index, stem, answer_key, rubric, max_score, time_limit_seconds)
  values (v_exam, 1,
    'You isolate Salmonella from 30% of retail chicken samples. Outline a simple risk-based sampling + machine-learning approach to predict highest-risk stalls, given no slaughterhouse access.',
    'Open-access purchase sampling with stall metadata; label +/-; train RF/XGBoost on stall features; evaluate with ROC/AUC and cross-validation; SHAP for interpretability; handle class imbalance.',
    '[{"criterion":"Sensible open-access sampling plan + metadata","points":3},{"criterion":"Appropriate ML model and features","points":4},{"criterion":"Correct evaluation and interpretability","points":3}]'::jsonb,
    10, 120)
  returning id into v_q2;

  insert into public.questions (exam_id, order_index, stem, answer_key, rubric, max_score, time_limit_seconds)
  values (v_exam, 2,
    'ESBL-producing E. coli is detected in retail pork. Explain (a) why this is a One Health concern and (b) two realistic retail-level surveillance actions.',
    '(a) ESBL resists 3rd-gen cephalosporins; transmissible via the food chain, linking animal/food/human health. (b) Periodic purchase-and-test monitoring with resistance profiling; integration with human AMR data; handler education; traceback to suppliers.',
    '[{"criterion":"Explains One Health / AMR transmission","points":4},{"criterion":"Two realistic retail surveillance actions","points":4},{"criterion":"Clarity and correct terminology","points":2}]'::jsonb,
    10, 120)
  returning id into v_q3;

  -- ---- attempts (submitted) ----
  insert into public.attempts (exam_id, student_id, submitted_at)
  values (v_exam, v_s1, now()) returning id into v_a1;
  insert into public.attempts (exam_id, student_id, submitted_at)
  values (v_exam, v_s2, now()) returning id into v_a2;
  insert into public.attempts (exam_id, student_id, submitted_at)
  values (v_exam, v_s3, now()) returning id into v_a3;

  -- ---- answers: the write-window trigger must be off to backfill history ----
  alter table public.answers disable trigger trg_answer_window;

  insert into public.answers (attempt_id, question_id, answer_text) values
    (v_a1, v_q1, 'Scalding and evisceration. Raise and control scald tank temperature to reduce surface load, and tune the automated eviscerator to avoid gut rupture and faecal spillage onto the carcass.'),
    (v_a1, v_q2, 'Buy samples at stalls and record stall hygiene score, temperature, supplier and time of day. Label each Salmonella positive or negative and train a random forest, evaluating with AUC and cross-validation, using SHAP to see which features drive risk.'),
    (v_a1, v_q3, 'ESBL E. coli resists third-generation cephalosporins and can pass to people through the food chain, so it is a One Health issue. Surveillance: routine purchase-and-test monitoring with resistance profiling, and linking results with human clinical AMR data.'),
    (v_a2, v_q1, 'Defeathering and chilling. Clean and replace picker fingers regularly, and keep the chiller water chlorinated with counterflow to limit cross-contamination.'),
    (v_a2, v_q2, 'Sample at markets and use temperature and supplier as features. Train a classifier to predict positive stalls and check accuracy.'),
    (v_a2, v_q3, 'It is resistant bacteria in food that can reach humans. Actions: test pork at markets and teach vendors about hygiene.'),
    (v_a3, v_q1, 'Scalding and chilling are the main points; keep temperatures correct.'),
    (v_a3, v_q2, 'Collect samples and use machine learning to predict risky stalls.'),
    (v_a3, v_q3, 'ESBL is dangerous. We should monitor the meat and inform people.');

  alter table public.answers enable trigger trg_answer_window;

  -- ---- grades: student1 fully graded (good), student2 fully graded (medium),
  --      student3 LEFT UNGRADED on purpose so the lecturer can type a score
  --      live on camera in the grading scene. ----
  insert into public.grades (answer_id, final_score, status, graded_by) values
    ((select id from public.answers where attempt_id = v_a1 and question_id = v_q1), 9, 'confirmed', v_lect),
    ((select id from public.answers where attempt_id = v_a1 and question_id = v_q2), 8, 'confirmed', v_lect),
    ((select id from public.answers where attempt_id = v_a1 and question_id = v_q3), 9, 'confirmed', v_lect),
    ((select id from public.answers where attempt_id = v_a2 and question_id = v_q1), 6, 'confirmed', v_lect),
    ((select id from public.answers where attempt_id = v_a2 and question_id = v_q2), 5, 'confirmed', v_lect),
    ((select id from public.answers where attempt_id = v_a2 and question_id = v_q3), 6, 'confirmed', v_lect);

  raise notice 'Demo released exam created: %', v_exam;
end $$;

-- ============================================================
-- CLEANUP (run this AFTER you have finished recording, to remove the demo):
-- ============================================================
-- delete from public.exams
--  where course_id = (select id from public.courses where code = 'VET401-DEMO')
--    and title like 'DEMO (Released)%';
-- -- optional: put the admin back to non-lecturer in the demo course
-- -- delete from public.course_members
-- --  where course_id = (select id from public.courses where code = 'VET401-DEMO')
-- --    and user_id = (select id from public.profiles where lower(email)='admin@cmu.ac.th');
