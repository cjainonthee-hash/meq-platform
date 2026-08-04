# Setup Guide

This walks you from zero to a running MEQ platform. Everything here is on free
tiers except Claude API usage (a few US cents per graded answer).

---

## 1. Create the Supabase project (free)

1. Go to https://supabase.com, sign in, **New project**.
2. Pick a name and a strong database password. Choose the Singapore region
   (closest to Thailand).
3. When it finishes, open **Project Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret)

## 2. Run the database migrations

In Supabase, open **SQL Editor** and run each file in order, top to bottom:

1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_functions.sql`
3. `supabase/migrations/0003_rls.sql`
4. `supabase/migrations/0004_realtime_grants.sql`
5. `supabase/migrations/0005_enrolment.sql`

(If you prefer the CLI: `supabase db push` with the files in place.)

### Default new-user role

New `@cmu.ac.th` accounts default to **student**. The very first account to sign
in becomes **admin** automatically (bootstrap). To change the default later, run
in SQL editor:

```sql
alter database postgres set app.default_new_user_role = 'student';
```

## 3. Register the app in Microsoft Entra ID (CMU)

You (or CMU IT) create an app registration so `@cmu.ac.th` accounts can sign in.

1. Go to the Azure portal → **Microsoft Entra ID → App registrations → New
   registration**.
2. Name: `MEQ Exam Platform`. Supported account types: **Accounts in this
   organizational directory only** (CMU single tenant).
3. **Redirect URI** (type *Web*):
   `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
   (find the exact value in Supabase → Authentication → Providers → Azure.)
4. After creating it, note the **Application (client) ID** and the **Directory
   (tenant) ID**.
5. **Certificates & secrets → New client secret**. Copy the secret **value**.

Then in **Supabase → Authentication → Providers → Azure**:

- Enable Azure.
- Application (client) ID = the client ID above.
- Secret = the client secret value.
- Azure Tenant URL = `https://login.microsoftonline.com/YOUR-TENANT-ID`
  (this restricts logins to CMU accounts).
- Save.

In **Supabase → Authentication → URL Configuration**, set the **Site URL** to
your app URL (for local dev, `http://localhost:3000`) and add it to the
**Redirect URLs** allow-list along with `http://localhost:3000/auth/callback`.

> The app additionally enforces the `@cmu.ac.th` domain in `auth/callback`, so
> even if a personal Microsoft account slips through, it is signed out.

## 4. Get an Anthropic API key

1. Go to https://console.anthropic.com → **API Keys → Create key**.
2. Copy it into `ANTHROPIC_API_KEY`.
3. `GRADING_MODEL` defaults to `claude-opus-4-8` (best quality). You can set it
   to `claude-sonnet-5` later to reduce cost.

## 5. Configure the app

```bash
cp .env.example .env.local
```

Fill in all values from steps 1, 3, and 4.

## 6. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 and sign in with your CMU account. The first sign-in
becomes admin.

### First run checklist

1. Sign in (you are now admin).
2. As admin, open **Administration**, promote a colleague to **lecturer** if
   needed (or use your own admin account, which has all lecturer powers).
3. Go to the **teaching dashboard**, create a course, enrol student emails
   (they must have signed in at least once so an account exists).
4. Create an exam, add questions with rubrics, then **Start exam**.
5. Have students open the exam; watch them appear in the proctor view.
6. After it closes, **Run AI pre-grading**, confirm the scores, then **Release
   results** and **Export CSV**.

## 7. Deploy (free) on Vercel

1. Push this folder to a Git repository.
2. On https://vercel.com → **New Project** → import the repo.
3. Add all the environment variables from `.env.local` in Vercel project
   settings.
4. Deploy. Then update the Supabase **Site URL / Redirect URLs** and the Entra
   **Redirect URI** to your Vercel domain.

## Troubleshooting

- **Login loops back to /login**: the email domain is not in
  `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS`, or the Supabase redirect URL is not
  allow-listed.
- **"No account exists for that email" when enrolling**: the student must sign in
  once first so their profile row is created.
- **Timer not advancing for everyone**: confirm Realtime is enabled (migration
  0004 adds the `exams` table to the `supabase_realtime` publication).
- **Grading returns an error**: check `ANTHROPIC_API_KEY` and that the model in
  `GRADING_MODEL` is spelled exactly (`claude-opus-4-8`).
