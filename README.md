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
supabase/migrations/   SQL: schema, lockstep functions, RLS, enrolment
src/lib/               Supabase clients, auth guard, Claude grader, types
src/components/        ExamRunner (student), lecturer & admin UI
src/app/               routes: login, student, lecturer, admin, api/grade, api/export
```

## Status

Phase 1 MVP. See `../Notes/2026-07-22_Requirements_and_Gaps.md` for the phase
plan and the integrity/PDPA items scheduled for Phase 2.
