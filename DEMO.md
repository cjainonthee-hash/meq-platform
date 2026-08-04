# Demo Walkthrough (no CMU login needed)

This lets you click through the entire exam flow using demo accounts and a
ready-made veterinary MEQ exam, before you wire up real Microsoft Entra SSO.

## Prerequisites

1. A Supabase project with the 5 migrations run (see SETUP.md steps 1–2).
2. `.env.local` filled with:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY` (only needed for the AI grading step)
   - `NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN=true`   ← important for the demo

## 1. Seed the demo data

```bash
npm install
npm run seed
```

This creates:

| Account | Role | Password |
|---|---|---|
| `admin@cmu.ac.th` | admin | `Demo1234!` |
| `lecturer@cmu.ac.th` | lecturer | `Demo1234!` |
| `student1@cmu.ac.th` | student | `Demo1234!` |
| `student2@cmu.ac.th` | student | `Demo1234!` |
| `student3@cmu.ac.th` | student | `Demo1234!` |

Plus a demo course, enrolments, and an exam **"MEQ Midterm — Foodborne Zoonoses
& AMR"** with 3 questions (2 minutes each).

Re-running `npm run seed` resets the demo course and exam (keeps the accounts).

## 2. Start the app

```bash
npm run dev
```

Open http://localhost:3000 . Because password login is enabled, the sign-in page
shows a "Demo login" box.

## 3. Click through the flow

Use separate browser windows so several people are signed in at once. The
cleanest way: one normal window for the lecturer, and **incognito / private
windows** for each student (each incognito window is an independent session).

1. **Lecturer window** — sign in as `lecturer@cmu.ac.th`.
   - Open the demo course, then the exam.
   - Look over the 3 questions (already filled with rubrics). Do NOT start yet.

2. **Student windows** — in two or three incognito windows, sign in as
   `student1@cmu.ac.th`, `student2@…`, `student3@…`.
   - Open the exam. Each shows **"Waiting to start…"**.

3. **Start the exam** — back in the lecturer window, click **Start exam**.
   - Every student window flips to Question 1 at the same moment. The timer
     counts down (2 minutes).
   - Type answers in the student windows. Watch the "Saved" indicator.
   - Try to refresh a student window mid-question: the typed answer is still
     there (autosave). Try changing the question after the timer — you cannot.
   - When the timer ends, all students advance to Question 2 together. Or click
     **Force next question** in the lecturer window to move everyone on early.

4. **Proctor view** — in the lecturer window, watch the "joined / submitted"
   counts update live as students join and finish.

5. **After the exam closes** (all questions done):
   - In the lecturer window, click **Run AI pre-grading**. Claude scores each
     answer with a confidence level and rationale.
   - Adjust any score, then click **Confirm** on each. Low-confidence answers
     are flagged so you know which to check.
   - Click **Export CSV** to download the score sheet.
   - Click **Release results to students**.

6. **Results** — in a student window, open the exam again to see the released
   score and per-question feedback.

7. **Admin** — sign in as `admin@cmu.ac.th` to see the user list and change
   anyone's role (this is how you promote a real colleague to lecturer later).

## Tips

- To watch the auto-advance quickly, let a question's 2-minute timer run out in
  one window while you keep the others open.
- To reset and start over, run `npm run seed` again and reload.
- When you are ready for real CMU accounts, set
  `NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN=false` and follow SETUP.md step 3 (Entra).
