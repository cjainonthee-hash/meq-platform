# MEQ Exam Platform

A synchronized, lockstep **Modified Essay Question (MEQ)** online examination
platform for the Faculty of Veterinary Medicine, Chiang Mai University.

Built with **Next.js (App Router) + Supabase + Claude (AI pre-grading)**.

## What it does

- **One question per page**, with a per-question timer.
- **Everyone starts together and advances together** (server-authoritative clock,
  broadcast live). Students **cannot go back or edit** a past question, enforced
  at the database level, not just the UI.
- **Answers autosave** every couple of seconds, so a dropped connection never
  loses typed work.
- **Microsoft Entra ID (CMU) single sign-on**, restricted to `@cmu.ac.th`.
- **Four roles**: student, lecturer, guest, admin, with separate dashboards.
- **Lecturer backend** to author questions, answer keys, and rubrics.
- **AI pre-grading** with Claude: proposes a score + confidence + per-criterion
  rationale for each answer. The lecturer confirms or overrides every grade
  before results are released. Prompt-injection defended.
- **Score export** to CSV (name, code, email, join/submit time, per-question and
  total scores).
- **Live proctor view** and an **immutable audit log**.

## Architecture at a glance

```
Browser (Next.js client)
   │  Supabase Realtime (exam clock) + auth session
   ▼
Supabase Postgres  ──  RLS + SECURITY DEFINER RPCs (lockstep engine)
   ▲
Next.js server / API routes  ──  service role (AI grading, CSV export)
   │
Claude API (report_grade tool)
```

The synchronized clock needs **no always-on server**: whichever client reaches a
question's deadline calls `advance_if_due()`, which atomically advances the exam
once; Realtime then flips every student to the next question at the same moment.

## Getting started

See **[SETUP.md](./SETUP.md)** for the full step-by-step (Supabase project,
database migrations, Microsoft Entra app registration, environment variables,
and deployment).

Quick version once configured:

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

## Project layout

```
supabase/migrations/   SQL: schema, lockstep functions, RLS, enrolment, CMU SSO
src/lib/               Supabase clients, auth guard, Claude grader, CMU SSO, types
src/components/        ExamRunner (student), lecturer & admin UI
src/app/               routes: login, student, lecturer, admin, api/grade, api/export
src/proxy.ts           runs before every request: session refresh + route guard
docs/                  handover, requirements, v2 change notes
```

### Frontend vs backend

The split is by **environment variable prefix**, not by folder:

| | Where it runs | Env vars it can read |
|---|---|---|
| **Frontend** | The student's browser | `NEXT_PUBLIC_*` only |
| **Backend** | The server (API routes, server components, `proxy.ts`) | everything, including secrets |

`.env.example` documents this in full. The rule that matters: renaming a
server-only variable to start with `NEXT_PUBLIC_` ships it to every browser.

## Scripts

```bash
npm run dev        # local dev server
npm run build      # production build (also type-checks)
npm run typecheck  # TypeScript only, no build
npm run lint       # ESLint
npm run seed       # create the demo accounts
npm run loadtest -- --exam <examId> --students 100   # simulate a full cohort
```

## Toolchain notes

- **Tailwind CSS v4.** Configured in CSS (`src/app/globals.css`), not in a JS
  config file. There is no `tailwind.config.ts`; the brand palette lives in the
  `@theme` block. Autoprefixer is gone, v4 handles prefixing itself.
- **Next.js 16.** The `middleware.ts` convention was renamed, so the file is
  `src/proxy.ts` and exports `proxy()`.
- **TypeScript is pinned to 6.x on purpose.** `typescript-eslint` (behind
  `next/typescript`) supports only `typescript < 6.1`, so moving to TypeScript 7
  silently disables every lint rule on `.ts`/`.tsx`. TS 6 and 7 type-check
  identically; 7 is just a faster compiler. Revisit when typescript-eslint
  supports 7.
- **ESLint is pinned to 9.x on purpose.** `eslint-plugin-react`, pulled in by
  `eslint-config-next`, crashes on ESLint 10.
- **Functions are pinned to `icn1` (Seoul) on purpose.** See below.

### Deployment region

`vercel.json` pins every function to **`icn1`, Vercel's Seoul region**, because
the Supabase project runs in **`ap-northeast-2`, also Seoul**. Without that file
the project inherited Vercel's default, `iad1` (Washington DC), so each request
ran in Virginia and called the database in Korea. Measured before the change:
`/login` took 1.54 s cold and 0.41 to 0.48 s warm, on a page that was a **cache
HIT**, because `src/proxy.ts` refreshes the session before the cache is
consulted.

**Do not "optimize" this to `sin1` (Singapore) because it is nearer to the
students.** Rendering one exam page makes six *sequential* Supabase calls, so
region choice is dominated by the distance to the **database**, not to the user.
Singapore would save roughly 30 ms once on the trip from Chiang Mai and add
roughly 80 ms six times over on the trips to Seoul. Pin to the data.

If the Supabase project is ever moved to another region, this file has to move
with it. To check the database's region without the dashboard:

```bash
dig +short AAAA db.<project-ref>.supabase.co
# then match that address against https://ip-ranges.amazonaws.com/ip-ranges.json
```

To verify the setting is live, read the response header. The middle segment is
the function region and must say `icn1`:

```bash
curl -sD - -o /dev/null https://meq-platform.vercel.app/login | grep x-vercel-id
# x-vercel-id: sin1::icn1::...
```

### Scaling to a full cohort

Three changes make the engine survive 100 simultaneous students on the free
Supabase instance. They are cheap, and they were all measured against the same
bottleneck: the database is a **t3a.nano with a hard 60-connection ceiling**, so
what matters is the *number of requests and lock waits*, not query complexity.

**1. Pre-lock guards on `advance_if_due` and `start_if_due`**
(`supabase/migrations/0020_lock_guards.sql`). Both functions used to open with
`select * from exams ... for update`, so every caller took a row lock before
knowing whether there was anything to do. At each question flip all 100
browsers hit the deadline inside the same 250 ms tick and queued single file for
that one lock. The functions now do a cheap non-locking read first and return
immediately when nothing is due, which is 99 of every 100 calls. The caller that
does find it due takes the lock and re-checks under it exactly as before, so the
losers of the race still see the winner's committed update and still do nothing.
Behaviour is unchanged; only the lock traffic drops. The every-15-seconds
`exam_tick` cron benefits for the same reason.

**2. Adaptive backstop polling** (`src/components/ExamRunner.tsx`). Realtime is
the instant path, but a dropped event used to make the next question appear
seconds late, so the component also polled `select *` on the exam row once per
second. For a full cohort that was 100 requests per second sustained for the
whole sitting, each one re-running the `read exams` RLS policy and its two
`course_members` lookups. The poll is now self-scheduling: 5 s while there is
time on the clock, 1 s only inside the last 12 seconds before a deadline or a
scheduled start, on a narrowed column list, and it skips the state update
entirely when nothing changed. Baseline drops to roughly 20 requests per second.

**3. Jittered lockstep RPCs** (`src/components/ExamRunner.tsx`). Even with the
guard, 100 identical calls landing in one 250 ms window is a spike. Both
`advance_if_due` and `start_if_due` now wait a random 0 to 800 ms and then skip
the call outright if Realtime or the poll has already moved the exam on, so in
practice only the first browser or two reach the server.

**Verify with the load test before an exam day, not after.** Everything above is
an estimate until it is measured:

```bash
# once, against a STAGING project (it creates test users and writes answers)
npm run loadtest -- --exam <examId> --students 100 --setup
# start the exam, then drive it
npm run loadtest -- --exam <examId> --students 100
# afterwards
npm run loadtest -- --exam <examId> --students 100 --cleanup
```

It reports request rate and p50/p95/p99/max latency per operation. Ramp the
cohort at 25, then 50, then 100. Supabase rate-limits the auth endpoint per IP,
so sign-ins are spread over `--ramp` seconds (60 by default) and sessions are
cached in `scripts/.loadtest-sessions.json`, which is gitignored.

Two ceilings the load test will not fix, worth knowing:

- The **free plan caps Realtime at 200 concurrent connections**. One hundred
  students with one tab each is comfortable; reloads plus open lecturer
  dashboards can approach it. Watch the Realtime graph during a mock run.
- `t3a.nano` is a **burstable** instance, so a 90-minute exam under sustained
  load can drain CPU credits and get throttled part way through. Compute size is
  a Pro-plan setting, but **compute is billed hourly while the plan fee is
  monthly**, so bumping to a Small instance for a single exam day costs well
  under a dollar. Treat it as exam-day insurance, not as an architecture change.

### Known lint baseline

`npm run lint` currently reports ~52 pre-existing findings. These are **not**
regressions: the project had no working lint before Next.js 16, so this is the
first time they have been visible. None of them break the build or the running
app. Breakdown:

| Count | Rule | What it means |
|---|---|---|
| ~44 | `@typescript-eslint/no-explicit-any` | Supabase query results typed as `any`. Typing debt, not a bug. |
| 5 | `react-hooks/set-state-in-effect` | `setState` called straight from an effect. Causes an extra render pass. |
| 3 | other `react-hooks` rules | Ref cleanup and memoization details. |

Left deliberately unfixed: fixing them means editing components that run live
exams, which is a separate, testable piece of work rather than part of a
dependency upgrade.

## Status

Phase 1 MVP, live. See `docs/Requirements_and_Gaps.md` for the phase plan and
the integrity/PDPA items scheduled for Phase 2.
