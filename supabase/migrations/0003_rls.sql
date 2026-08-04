-- ============================================================
-- MEQ Exam Platform : Row Level Security
-- ============================================================
-- Roles: student / lecturer / guest / admin.
-- Server API routes that must cross students (AI grading, exports) use the
-- Supabase service-role key and bypass RLS by design.
-- ============================================================

alter table public.profiles       enable row level security;
alter table public.courses        enable row level security;
alter table public.course_members enable row level security;
alter table public.exams          enable row level security;
alter table public.questions      enable row level security;
alter table public.attempts       enable row level security;
alter table public.answers        enable row level security;
alter table public.grades         enable row level security;
alter table public.audit_log      enable row level security;

-- ---------- profiles ----------
create policy "read own profile" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
-- Admins manage everyone (role changes go through set_user_role()).
create policy "admin manage profiles" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- courses ----------
create policy "read courses you belong to" on public.courses
  for select using (
    public.is_admin()
    or public.is_course_staff(id)
    or public.is_course_student(id)
  );
create policy "lecturers create courses" on public.courses
  for insert with check (public.current_role() in ('lecturer', 'admin'));
create policy "staff edit their courses" on public.courses
  for update using (public.is_course_staff(id)) with check (public.is_course_staff(id));

-- ---------- course_members ----------
create policy "read memberships of your courses" on public.course_members
  for select using (
    user_id = auth.uid() or public.is_course_staff(course_id)
  );
create policy "staff manage memberships" on public.course_members
  for all using (public.is_course_staff(course_id))
  with check (public.is_course_staff(course_id));

-- ---------- exams ----------
-- Students only see exams that are live/closed/released (not drafts).
create policy "read exams" on public.exams
  for select using (
    public.is_course_staff(course_id)
    or (public.is_course_student(course_id)
        and status in ('scheduled', 'live', 'closed', 'released'))
  );
create policy "staff write exams" on public.exams
  for all using (public.is_course_staff(course_id))
  with check (public.is_course_staff(course_id));

-- ---------- questions ----------
-- Staff: full read. Students: read only questions at/behind the current index
-- of a live exam, or all questions once results are released. This is the
-- second guard behind "one question per page, no peeking ahead".
create policy "staff read questions" on public.questions
  for select using (
    exists (select 1 from public.exams e
            where e.id = exam_id and public.is_course_staff(e.course_id))
  );
create policy "students read open questions" on public.questions
  for select using (
    exists (
      select 1 from public.exams e
      where e.id = exam_id
        and public.is_course_student(e.course_id)
        and (
          e.status = 'released'
          or (e.status = 'live' and questions.order_index <= e.current_question_index)
        )
    )
  );
create policy "staff write questions" on public.questions
  for all using (
    exists (select 1 from public.exams e
            where e.id = exam_id and public.is_course_staff(e.course_id))
  ) with check (
    exists (select 1 from public.exams e
            where e.id = exam_id and public.is_course_staff(e.course_id))
  );

-- ---------- attempts ----------
create policy "read own or staff attempts" on public.attempts
  for select using (
    student_id = auth.uid()
    or exists (select 1 from public.exams e
               where e.id = exam_id and public.is_course_staff(e.course_id))
  );
-- Students update their own attempt only to mark submission time.
create policy "student submit own attempt" on public.attempts
  for update using (student_id = auth.uid()) with check (student_id = auth.uid());

-- ---------- answers ----------
create policy "read own or staff answers" on public.answers
  for select using (
    exists (select 1 from public.attempts a
            where a.id = attempt_id and a.student_id = auth.uid())
    or exists (
      select 1 from public.attempts a
      join public.exams e on e.id = a.exam_id
      where a.id = attempt_id and public.is_course_staff(e.course_id)
    )
  );
-- Insert/update permitted for the owner; the enforce_answer_window() trigger
-- does the heavy lifting (only the current question, only while live).
create policy "student write own answers" on public.answers
  for insert with check (
    exists (select 1 from public.attempts a
            where a.id = attempt_id and a.student_id = auth.uid())
  );
create policy "student update own answers" on public.answers
  for update using (
    exists (select 1 from public.attempts a
            where a.id = attempt_id and a.student_id = auth.uid())
  ) with check (
    exists (select 1 from public.attempts a
            where a.id = attempt_id and a.student_id = auth.uid())
  );

-- ---------- grades ----------
-- Students see their grade only after results are released.
create policy "read grades" on public.grades
  for select using (
    exists (
      select 1
      from public.answers ans
      join public.attempts a on a.id = ans.attempt_id
      join public.exams e on e.id = a.exam_id
      where ans.id = answer_id
        and (
          public.is_course_staff(e.course_id)
          or (a.student_id = auth.uid() and e.status = 'released')
        )
    )
  );
-- Staff confirm/override grades.
create policy "staff write grades" on public.grades
  for all using (
    exists (
      select 1 from public.answers ans
      join public.attempts a on a.id = ans.attempt_id
      join public.exams e on e.id = a.exam_id
      where ans.id = answer_id and public.is_course_staff(e.course_id)
    )
  ) with check (
    exists (
      select 1 from public.answers ans
      join public.attempts a on a.id = ans.attempt_id
      join public.exams e on e.id = a.exam_id
      where ans.id = answer_id and public.is_course_staff(e.course_id)
    )
  );

-- ---------- audit_log ----------
create policy "admin reads audit" on public.audit_log
  for select using (public.is_admin());
