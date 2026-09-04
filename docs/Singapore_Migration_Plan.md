# Moving the platform from Seoul to Singapore

Readable version, kept current: https://claude.ai/code/artifact/afab020a-ab13-4c12-a3b4-b3a1e858ca86

**Status: plan only. Nothing here has been carried out.** Production is still in Seoul
(`ap-northeast-2`) with functions in `icn1`.

## Why

During an exam the student's browser talks directly to Supabase, not through Vercel:
the exam-row poll, every autosave, the Realtime socket, the advance call. The 100-student
load test measured 39 autosaves and 19 polls per second, each one a Chiang Mai round trip
costing about 135 ms. The database is idle throughout, so that number is distance, not work.
Singapore brings it to roughly 50 ms.

"Pin to the data, not the people" still holds. This satisfies it by moving both. The
arrangement to avoid remains functions in Singapore with the database in Seoul.

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

## Two routes

**Recommended: copy through the service key, remapping user ids.** A script recreates the 7
accounts on the new project by email (via `admin.generateLink`, which creates on demand),
records the new ids, then copies each table in dependency order rewriting `user_id` /
`student_id` / `created_by` / `actor_id` as it goes. No database password, no extra tooling,
and the trigger problem disappears because accounts are created normally. Costs: account
creation timestamps reset and seed-script demo passwords do not carry over. Neither matters,
since real users arrive through CMU SSO.

**Fallback: `pg_dump` / `psql`.** Perfect fidelity, well-documented, but needs the database
password, Postgres client tools, and correct trigger handling during restore.

## Sequence

1. **Build** the Singapore project (`ap-southeast-1`) in the `meq-platform` org; run
   `supabase/ALL_MIGRATIONS.sql` once. Confirm: 11 tables, RLS on, `exam-tick` cron present,
   `exams` + `attempts` in the Realtime publication.
2. **Rehearse** the copy from live production into it. Reads only, so production is safe and
   this can be repeated. Compare row counts per table; open a released exam's results.
3. **Freeze and copy for real.** No exam `live` or `scheduled`; re-check the storage point;
   empty the new tables; run the copy again so the data is current.
4. **Cut over.** Change the three variables in Vercel, and in the same change set
   `"regions": ["sin1"]` in `vercel.json`. Pushing to `main` deploys by itself. Update
   `.env.local` to match.
5. **Verify:** CMU sign-in first; a released exam's answers and grades; a throwaway exam
   started and advanced once; `x-vercel-id` middle segment reads `sin1` on a dynamic path;
   a 25-student load test showing ~50 ms rather than ~135 ms.
6. **Keep the Seoul project paused for a month.** It is the whole rollback: restore the three
   variables and revert `vercel.json` to `icn1`. Delete only after a real exam has run on
   Singapore.

## Open questions before starting

- Which route, script or dump. Script recommended.
- A date with no exam near it. The quiet window is about half an hour.
- Are the 17 attempts and 39 answers real student work or Aom's own testing? If testing,
  the copy and the rehearsal both get simpler.
