# Moving the platform from Seoul to Singapore

Readable version, kept current: https://claude.ai/code/artifact/afab020a-ab13-4c12-a3b4-b3a1e858ca86

**Status: in progress, clean rebuild.** Decided 5 September 2026 after reading what
production actually holds: no student work, and none ever. The platform is rebuilt in
Singapore rather than copied. Production is still in Seoul (`ap-northeast-2`) with functions
in `icn1` until the cutover.

## Why

During an exam the student's browser talks directly to Supabase, not through Vercel:
the exam-row poll, every autosave, the Realtime socket, the advance call. The 100-student
load test measured 39 autosaves and 19 polls per second, each one a Chiang Mai round trip
costing about 135 ms. The database is idle throughout, so that number is distance, not work.
Singapore brings it to roughly 50 ms.

"Pin to the data, not the people" still holds. This satisfies it by moving both. The
arrangement to avoid remains functions in Singapore with the database in Seoul.

## Why nothing is copied

Read on 5 September, not just counted. The 12 exams are `Test3` … `Test8`, `test test`,
`DEMO (Released)` and three clones of the demo. The 35 questions have 11 distinct stems, of
which three are literally `Question1` / `question 2` / `Question 3` and two are keyboard
mash. The 17 attempts and 39 answers are all dated 1 to 3 August and are all Aom's own
testing; three were ever submitted. The 7 accounts are the 5 seed logins plus Aom and the
faculty developer.

Copying that would mean disabling **two** safety mechanisms:

1. `handle_new_user()` fires on insert into `auth.users` and creates a profile, so a restore
   invents seven profiles that then collide with the real rows.
2. `enforce_answer_window()` refuses any answer write outside the currently open question of
   a live exam, and its only exception is `is_admin()`. A service-key migration script is not
   an admin, so inserting historical answers **fails outright**. A copy would need the exam
   integrity rule switched off while it ran.

Neither risk is worth taking for `Test3` through `Test8`.

## Verified inventory (4 September 2026)

| Table | Rows |
|---|---|
| profiles | 7 |
| courses | 1 |
| course_members | 5 |
| exams | 12 |
| questions | 35 (10 carry media) |
| attempts | 17 |
| answers | 39 |
| grades | 24 |
| audit_log | 43 |
| cmu_accounts | 2 |
| exam_graders | 0 |
| Storage `question-media` | 6 JPEGs, 24.8 KB |

About 185 rows in total.

## Three things that make this smaller than expected

1. **CMU needs no change.** The registered redirect URI is our own Vercel domain
   (`/app/login`); `src/app/auth/callback/route.ts` exchanges the code itself and only then
   mints a Supabase session. Supabase's address is not part of CMU's registration, so nothing
   goes back to the faculty developer.
2. **Only three environment variables change:** `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. `CMU_*`,
   `ANTHROPIC_API_KEY` and `GRADING_MODEL` are untouched.
3. **No stored media URL needs rewriting today.** All 10 questions with media point at
   external hosts, not at Supabase Storage. **This expires the moment anyone uploads an image
   through the question editor**, because an uploaded file's public URL embeds the project
   ref. Re-check immediately before cutover.

## The one real trap

`handle_new_user()` fires on insert into `auth.users` and creates a profile. A straight
`pg_dump` restore therefore invents seven profiles before the real profile rows arrive, and
they collide. Any restore-based route must disable triggers for the duration. This is why
Phase 2 (rehearsal) exists.

Smaller notes: every key is a UUID, so no sequences to reset; the `exam-tick` cron job and
the Realtime publication both come from `ALL_MIGRATIONS.sql`, but confirm them by eye.

## Sequence

1. **Aom:** create `meq-production-sg` in **Southeast Asia (Singapore)**, inside the existing
   `meq-platform` organisation.
2. **Aom:** run `supabase/ALL_MIGRATIONS.sql` once in its SQL editor. Answer *Run and enable
   RLS*; that warning is a false positive, the file enables RLS on every table itself.
3. **Aom:** put the project URL and the two keys into `.env.singapore` (gitignored). Full
   URL, `https://<ref>.supabase.co`, not the bare ref and not the organisation name.
4. **Claude:** seed a demo course and exam; confirm 11 tables with RLS on, the `exam-tick`
   cron job scheduled, and `exams` + `attempts` in the Realtime publication.
5. **Aom:** replace the three variables in Vercel production settings. **Claude:** then push
   `"regions": ["sin1"]` in `vercel.json`, which deploys by itself and picks up the new
   variables in the same deployment, so code and data never sit apart.
6. **Verify:** Aom signs in through CMU (her admin returns automatically via `0019`); the
   developer signs in and is re-granted admin, the only role that does not restore itself; a
   throwaway exam started and advanced once; `x-vercel-id` middle segment reads `sin1` on a
   dynamic path; a 25-student load test landing near 50 ms rather than 135 ms.
7. **Keep Seoul paused for a month.** Rollback is restoring the three variables and reverting
   `vercel.json` to `icn1`. Delete only after a real exam has run on Singapore.

## Open questions

All three are now answered. Route: clean rebuild. Date: no exam is scheduled or live, so any
time works. Provenance: the attempts and answers are Aom's own testing, which is what decided
the route.
