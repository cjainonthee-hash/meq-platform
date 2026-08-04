-- ============================================================
-- Allow multiple image links per question.
-- ============================================================
-- Adds questions.image_urls (jsonb array of URLs). Migrates any existing single
-- image_url into the array. image_url is left in place for safety but the app
-- now reads/writes image_urls.
-- ============================================================

alter table public.questions
  add column if not exists image_urls jsonb not null default '[]'::jsonb;

update public.questions
   set image_urls = jsonb_build_array(image_url)
 where image_url is not null
   and image_url <> ''
   and (image_urls is null or image_urls = '[]'::jsonb);
