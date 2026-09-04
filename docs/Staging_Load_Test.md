# Staging project and load test

The load test creates a hundred fake student accounts and writes answers, so it
must never run against the production database. This document sets up a free
second Supabase project to run it in, and then runs it.

Everything here is free. The load test talks straight to Supabase, so **no
Vercel deploy and no staging website are needed**: it exercises the database,
Realtime, and the security policies, which is where the hundred-student
pressure actually lands.

---

## Part 1: what you do (about five minutes)

### 1. Create the project

Go to https://supabase.com/dashboard/new

- **Name:** `meq-staging`
- **Region:** **Northeast Asia (Seoul)**, the same region as production, so the
  numbers mean something.
- **Database password:** choose one and save it in your password manager. It is
  not needed for any step below, and it is not something to paste into a chat.
- **Plan:** Free.

Wait for it to finish provisioning, usually a minute or two.

### 2. Create the tables

Open the new project's SQL editor, then paste in the whole contents of
`supabase/ALL_MIGRATIONS.sql` from this repo and run it once. That single file
contains every migration in order, including the `0020` lock guards, so nothing
else has to be run afterwards.

Expect it to take a few seconds and finish with no error. If `pg_cron` reports a
problem, ignore it: the cron tick is only the unattended backstop and has no
effect on the load test.

### 3. Copy the three keys

In the new project, open **Project Settings**, then **API keys**. Create a file
called `.env.staging` in the repo root with these three lines:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-new-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon / publishable key>
SUPABASE_SERVICE_ROLE_KEY=<the service_role / secret key>
```

`.env.staging` is gitignored, so it will not be committed.

**Do not edit `.env.local`.** That file is production and must stay pointing at
production.

---

## Part 2: seeding and running

### 4. Seed a demo course and exam

```bash
npm run seed -- --env .env.staging
```

It prints the project ref it is seeding (check it is the staging one, not
production) and ends with a line like `Exam created: <examId> with N questions`.
Keep that exam id.

### 5. Create the simulated students

```bash
npm run loadtest -- --env .env.staging --exam <examId> --students 25 --setup
```

### 6. Run it

```bash
npm run loadtest -- --env .env.staging --exam <examId> --students 25 --start --qtime 60
```

`--start` schedules the exam to begin thirty seconds later, so the run also
tests the waiting-room crowd all hitting `start_if_due` at the same moment.
`--qtime 60` shortens every question to a minute so the run cycles through
several question flips instead of sitting through one five-minute question.

Every fifteen seconds it prints a table: operation, total count, requests per
second, errors, and p50/p95/p99/max latency. Press Ctrl+C to stop early and get
the final table.

### 7. Repeat at 50, then 100

```bash
npm run loadtest -- --env .env.staging --exam <examId> --students 50  --setup
npm run loadtest -- --env .env.staging --exam <examId> --students 50  --start --qtime 60
npm run loadtest -- --env .env.staging --exam <examId> --students 100 --setup
npm run loadtest -- --env .env.staging --exam <examId> --students 100 --start --qtime 60
```

Sign-ins are spread over sixty seconds by default, because Supabase rate-limits
its login endpoint per IP address, and sessions are cached in
`scripts/.loadtest-sessions.json` so a repeat run does not sign in again.

### 8. Tidy up when finished

```bash
npm run loadtest -- --env .env.staging --exam <examId> --students 100 --cleanup
```

The staging project itself can be left in place for next time. A free project
that goes a week without traffic is paused automatically and can be resumed from
the dashboard.

---

## How to read the result

Watch four things:

- **`advance_if_due` count.** With the jitter and the pre-lock guard working,
  this should be a small number per question flip, not one call per student.
  A count close to the student count means the skip check is not firing.
- **`autosave` p95.** This is the heaviest sustained path, and the one whose
  trigger has deliberately not been flattened yet. If p95 climbs steeply between
  50 and 100 students, that is the evidence that the
  `enforce_answer_window()` rewrite is worth its risk.
- **`realtime_error` count.** Free plan caps Realtime at 200 concurrent
  connections. Errors here at 100 students would mean the cap is closer than it
  looks.
- **The database's own graphs**, on the staging project's Reports page:
  CPU, memory, and connection count during a question flip. The free `t3a.nano`
  has 0.5 GB of memory and a hard ceiling of 60 connections.

If the numbers hold at 100, nothing more is needed. If they do not, the answer is
still the one-day compute upgrade rather than a rewrite: compute is billed by the
hour while the plan fee is monthly, so a larger instance for a single exam day
costs well under a dollar.

## Safety

`scripts/loadtest.mjs` refuses to run when the env file it is given points at the
same Supabase project as `.env.local`. That refusal can be overridden with
`--allow-production`, which should not be used.
