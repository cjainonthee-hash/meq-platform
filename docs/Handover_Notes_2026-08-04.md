# MEQ Platform: Handover Notes

**Date:** 2026-08-04
**For:** Boss (personal reference)
**Status:** Code is on GitHub and ready for the Vet CMU dev. Not yet redeployed.

---

## 1. The link

**https://github.com/cjainonthee-hash/meq-platform**

It is a **private** repo under your account `cjainonthee-hash`. Private means nobody can see it unless you invite them.

### To give the dev access

1. Open the link above
2. Click **Settings** (top right of the repo page)
3. Click **Collaborators** in the left sidebar
4. Click **Add people**, type his GitHub username or email, and send

He then runs `git clone https://github.com/cjainonthee-hash/meq-platform.git` and has everything. Next time you push an update, he runs `git pull` to get it. That was the whole point of his first request.

---

## 2. What is in the repo

74 files: the app code, the database migrations, the seed script, and a `docs/` folder holding the handover document and the requirement notes, so the repo explains itself without needing anything from your laptop.

**Deliberately left out:** `node_modules` (he rebuilds it with `npm install`), the build output, your `.env.local` secrets, the demo recording, and the uploaded images. This is what he meant by "ignore upload files".

I checked every file for leaked passwords or API keys before the first upload. Clean.

---

## 3. What to do next

| # | Task | Status |
|---|---|---|
| 1 | Run migration `0018` in Supabase | **DONE** (you did this) |
| 2 | Add the dev as a collaborator on GitHub | **TO DO** (section 1 above) |
| 3 | Decide the staff role policy | **TO DO** (section 4 below) |
| 4 | Decide when to redeploy to Vercel | **TO DO** (section 5 below) |

---

## 4. One decision I need from you

When CMU SSO goes live, a person signing in for the first time gets a role automatically:

- A **student account** (`StdAcc`) becomes a **student**. No question about this.
- A **staff account** (`MISEmpAcc`) currently becomes a **guest**, and an admin has to promote them to lecturer by hand.

**Why I chose the cautious option:** CMU's "MIS Employee" label covers *every* member of faculty staff, not only teachers. Office staff, technicians, and administrators all carry the same label. A lecturer in this system can read every student's exam answers. So auto-promoting everyone with a staff account would hand exam access to people who should not have it.

**The cost:** each real lecturer needs one manual promotion by you the first time they sign in.

**If you would rather skip that friction,** tell me and it is a one line change. But my recommendation is to keep it as is: promoting a few colleagues by hand is much cheaper than accidentally exposing exam answers.

---

## 5. Not deployed yet (important)

The live site at **meq-platform.vercel.app still runs the OLD version.** Everything I did today is on GitHub, but not pushed to the public site.

This was on purpose. I upgraded the two biggest pieces of the app (the web framework and the styling system) to new major versions. I verified it works by running the real site locally and confirming the login page loads correctly with the right colours and styling. But going live is your call, not mine, especially if any exam is scheduled soon.

**When you want it live, just tell me and I will deploy it.** Do not deploy on a day you have an exam running.

---

## 6. Things nobody should "fix" later

This is the part worth remembering, because it looks like a mistake and is not.

If you or the dev run `npm outdated`, two packages will always show as out of date:

| Package | We use | Newest exists | Why we stay behind |
|---|---|---|---|
| TypeScript | 6.0.3 | 7.0.2 | Version 7 breaks the code checking tool completely |
| ESLint | 9.x | 10.x | Version 10 crashes one of the required plugins |

**This is intentional, not laziness.** You already chose this when I asked. TypeScript 6 and 7 check the code in exactly the same way; version 7 is only a faster compiler, so we lose nothing real and keep a working quality checker.

I wrote the reason inside the code files themselves (`README.md` and `eslint.config.mjs`), so if the dev tries to upgrade them, he will read why first.

---

## 7. The code quality warnings (not a problem)

If the dev runs `npm run lint`, he will see about **52 warnings**. This will look alarming. It is not.

The lint tool was **silently broken before today**. Upgrading the framework fixed it, so this is simply the first time anyone could see these. They were always there.

- About 44 are "loose typing" on database results. This is untidiness, not a bug.
- About 8 are minor React details.

**None of them break anything.** The app builds and runs perfectly.

I deliberately did not fix them. Fixing them means editing the exact components that run live exams, and that deserves its own round of proper testing rather than being bundled into a library upgrade. This is written in the README so the dev is not surprised.

---

## 8. What I fixed today that you did not ask for

Two genuine problems I found while working:

1. **A hidden settings bug.** The old ignore-file had a rule that would have permanently blocked the environment template from ever reaching GitHub. The dev would have had no example config file at all and would have had to guess. Fixed.

2. **The setup bundle was out of date.** The file `ALL_MIGRATIONS.sql` is the "set up a fresh database in one go" script. It stopped at migration 0014, so migrations 0015 to 0018 were missing from it. If the dev built a fresh database on the Vet CMU server using that file, he would have got a database missing question media, grader permissions, student IDs, and the new CMU login table, and it would have failed in confusing ways. It now covers 0001 to 0018.

---

## 9. The new CMU login table (migration 0018, already run)

This is the table the dev asked for: it links a real CMU person to their account here.

When CMU login goes live, every sign-in will hand us the person's student ID, their real Thai and English name, their faculty, and whether they are a student or staff. Today the lecturer types student IDs by hand. After this, they arrive automatically.

**Three traps in CMU's data that I handled**, worth knowing because they cause silent wrong data if missed:

1. CMU sends **empty text instead of "nothing"** for missing values.
2. A non-student's student ID arrives as **empty OR as a zero** (`0`). Your dev flagged this. Both now correctly mean "no student ID". Real CMU IDs start with the year (like `641410022`), so this can never accidentally delete a genuine ID.
3. **You cannot tell a student from staff by their email.** CMU emails are name-based (`somchai_j@cmu.ac.th`), so only the account-type field is trustworthy.

**It is not switched on yet.** It sits dormant and harmless until CMU IT gives us the address to fetch this data from. Nothing changes for current users. That is still waiting on your CMU IT request from earlier.

---

## 10. Plain-language summary of the tech changes

For your own reference, in case the dev mentions these:

| What changed | Meaning |
|---|---|
| Security warnings 3 → **0** | Three known security holes in the libraries are now closed |
| Next.js 15 → 16 | The web framework, one major version newer |
| Tailwind 3 → 4 | The styling system, one major version newer. It is now configured differently, so there is no `tailwind.config.ts` file anymore |
| `middleware.ts` → `proxy.ts` | Next.js renamed this. Same job: refresh logins and block signed-out visitors |
| Claude model → `claude-opus-5` | Newer AI grading model, with the token budget raised so grades never get cut off halfway |
| One env file | One template committed to GitHub, one real secret file that stays on your machine |

**On the frontend/backend split the dev asked about:** the rule is the variable *name*, not the folder. Anything starting with `NEXT_PUBLIC_` is sent to every student's web browser and anyone can read it. Everything else stays on the server. That matters because if someone renames a secret key to start with `NEXT_PUBLIC_`, it leaks to the whole world instantly. It is now written out clearly in the config file so nobody does that by accident.

---

## 11. If you need to tell the dev one paragraph

> The platform is at https://github.com/cjainonthee-hash/meq-platform (I have added you as a collaborator). All libraries are on the latest versions and `npm audit` is clean at zero vulnerabilities. Environment config is one template (`.env.example`) plus one local secret file (`.env.local`), split into frontend (`NEXT_PUBLIC_*`) and backend sections with comments. TypeScript is pinned at 6.x and ESLint at 9.x on purpose, and the reason is written in the README, so please do not upgrade those two. `npm run lint` shows about 52 pre-existing warnings that were invisible before, documented as a known baseline in the README. The new `cmu_accounts` table (migration 0018) is already applied and is ready for the CMU SSO fields, but stays dormant until `CMU_BASIC_INFO_URL` is set.

---

*Files: repo at `Projects/2026/MEQ_Exam_System/meq-platform`. Thai handover document at `meq-platform/docs/HANDOVER.md`.*
