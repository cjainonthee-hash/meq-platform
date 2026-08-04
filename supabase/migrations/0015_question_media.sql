-- ============================================================
-- Question media: video links + direct image upload storage.
-- ============================================================
-- Two additions for the question editor:
--  1. questions.video_urls: a jsonb array of video links (YouTube / Drive /
--     direct file), shown to students with a live preview, like image_urls.
--  2. A public Storage bucket "question-media" so lecturers can upload an image
--     directly (in addition to pasting a URL). Uploaded files get a public URL
--     that is stored back into questions.image_urls, so nothing about how the
--     app reads images changes. Images are compressed in the browser before
--     upload (kept well under 5 MB), so storage stays small (free-tier friendly).
-- ============================================================

alter table public.questions
  add column if not exists video_urls jsonb not null default '[]'::jsonb;

-- ---------- storage bucket ----------
-- Public bucket: read is public (needed so the <img>/<video> tag can load the
-- file without a signed URL); writes are restricted to signed-in staff below.
insert into storage.buckets (id, name, public)
values ('question-media', 'question-media', true)
on conflict (id) do nothing;

-- Anyone can read (public exam images render for students without auth juggling).
drop policy if exists "question media public read" on storage.objects;
create policy "question media public read" on storage.objects
  for select using (bucket_id = 'question-media');

-- Only authenticated users (lecturers/admins reach the editor via RLS) upload.
drop policy if exists "question media authenticated upload" on storage.objects;
create policy "question media authenticated upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'question-media');

-- Allow the uploader to overwrite / remove their own files.
drop policy if exists "question media owner update" on storage.objects;
create policy "question media owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'question-media' and owner = auth.uid());

drop policy if exists "question media owner delete" on storage.objects;
create policy "question media owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'question-media' and owner = auth.uid());

-- ---------- keep clone_exam in sync with the media columns ----------
-- The original clone_exam copied only image_url, so it silently dropped the
-- multi-image list (0013) and now videos. Copy all media columns verbatim.
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

  insert into public.exams
    (course_id, title, description, status, buffer_seconds,
     current_question_index, created_by)
  select course_id,
         coalesce(nullif(btrim(p_title), ''), title || ' (สำเนา)'),
         description, 'draft', buffer_seconds, -1, auth.uid()
    from public.exams
   where id = p_exam_id
  returning id into v_new_id;

  insert into public.questions
    (exam_id, order_index, stem, image_url, image_urls, video_urls,
     answer_key, rubric, max_score, time_limit_seconds)
  select v_new_id, order_index, stem, image_url, image_urls, video_urls,
         answer_key, rubric, max_score, time_limit_seconds
    from public.questions
   where exam_id = p_exam_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'clone_exam', 'exam', v_new_id,
          jsonb_build_object('source_exam_id', p_exam_id));

  return v_new_id;
end;
$$;
