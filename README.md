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
