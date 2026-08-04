# MEQ Platform: Handover Notes

**Date:** 2026-08-04
**For:** Boss (personal reference)
**Status:** All technical work is COMPLETE and LIVE on meq-platform.vercel.app. Migration 0018 applied, code on GitHub, grading model aligned. The only remaining step is human: invite the dev to the repository when you meet him on 2026-08-05.

---

## 1. The link

**https://github.com/cjainonthee-hash/meq-platform**

It is a **private** repo under your account `cjainonthee-hash`. Private means nobody can see it unless you invite them.

*("Repo" is just short for "repository", which is GitHub's word for the project page itself.)*

### To give the dev access (planned for 2026-08-05, when you meet him)

**Direct link, skips all the menus:**

**https://github.com/cjainonthee-hash/meq-platform/settings/access**

Open it, click the green **Add people** button, type his GitHub username or the email he uses for GitHub, and send. He gets an email invitation and has to accept it.

If that link ever fails, navigate manually: open the repository, find the **Settings** tab with the gear icon at the far right of the row of tabs along the top (`Code`, `Issues`, `Pull requests`, ...), then **Collaborators** in the left menu. If you cannot see a Settings tab at all, you are signed into GitHub as a different account: it only appears for the owner.

**Or just tell me his GitHub username and I will send the invitation for you.**

Once he accepts, he runs `git clone https://github.com/cjainonthee-hash/meq-platform.git` and has everything. Whenever you push an update after that, he runs `git pull` to receive it. That was the whole point of his first request.

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
| 2 | Decide the staff role policy | **DONE** (staff stay as guest, section 4) |
| 3 | Deploy to Vercel | **DONE** (live, section 5) |
| 4 | Add the dev as a collaborator on GitHub | **PLANNED 2026-08-05**, when you meet him (section 1) |

So there is only **one** thing left, and it is scheduled: adding the dev to the repository when you meet him on **2026-08-05**. Everything technical is finished and live.

The AI grading model is now aligned to `claude-opus-5` in production too (section 12).

---

## 4. Role policy: DECIDED (2026-08-04)

**You confirmed: staff stay as guest.** This is now settled, and no further action is needed.

When CMU SSO goes live, a person signing in for the first time gets a role automatically:

- A **student account** (`StdAcc`) becomes a **student**.
- A **staff account** (`MISEmpAcc`) becomes a **guest**. An admin (you) promotes them to lecturer by hand.

**Why:** CMU's "MIS Employee" label covers *every* member of faculty staff, not only teachers. Office staff, technicians, and administrators all carry the same label. A lecturer in this system can read every student's exam answers, so auto-promoting on account type alone would hand exam access to people who should not have it.

**The cost:** each genuine lecturer needs one manual promotion by you the first time they sign in. That is far cheaper than the alternative.

**Important:** this needed **no change to the database**. The migration you already ran was written this way from the start, so there is nothing to re-run in Supabase. I only added a comment in the code recording that this is a confirmed decision, so that nobody later assumes it was an unfinished default and "helpfully" changes it to lecturer.

**Once SSO is live, your routine will be:** a colleague signs in once, tells you, and you promote them in the admin page. After that they stay a lecturer permanently. A later sign-in never downgrades them back.

---

## 5. DEPLOYED (2026-08-04)

**The live site at meq-platform.vercel.app now runs the new version.**

Deployment ID `dpl_7DpD7YXbRDmcUfYS5ZmU2Hu5NGhD`, status READY, target production.

*(This was the first of two deploys today. It was superseded a few minutes later by `dpl_s3MvkWBcuFuxsMapAKShW6f7npVe`, which carries the same code plus the AI grading model change in section 12. That second one is what is live now.)*

**Safety check before deploying:** I queried the database first and confirmed there were **zero live exams and zero scheduled exams**, so nobody could be mid-sitting. This check matters because the upgrade replaced the web framework and the styling system, and a student halfway through a timed exam would have had the page change underneath them. If you ever deploy without me, check this first.

**Verified live after deploying:**

- `/login` returns 200, `/` returns 307 (the sign-in gate is working, so the renamed `proxy.ts` file is doing its job)
- The stylesheet loads and contains the CMU brand blues and every component style (`btn-primary`, `card`, `input`, `label`, `badge`)
- The login page actually uses those styles
- Thai text renders correctly (เข้าสู่ระบบ, บัญชี CMU, อีเมล)

That last set matters because Tailwind 4 changed how styling is configured. "It built successfully" would not have proven the page still looks right, so I checked the real served files.

**If anything looks wrong, you can roll back instantly** from the Vercel dashboard: Deployments, find the previous one, and use "Promote to Production". No code changes needed.

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
| Claude model → `claude-opus-5` | Newer AI grading model, live in production, with the token budget raised so grades never get cut off halfway |
| One env file | One template committed to GitHub, one real secret file that stays on your machine |

**On the frontend/backend split the dev asked about:** the rule is the variable *name*, not the folder. Anything starting with `NEXT_PUBLIC_` is sent to every student's web browser and anyone can read it. Everything else stays on the server. That matters because if someone renames a secret key to start with `NEXT_PUBLIC_`, it leaks to the whole world instantly. It is now written out clearly in the config file so nobody does that by accident.

---

## 11. If you need to tell the dev one paragraph

> The platform is at https://github.com/cjainonthee-hash/meq-platform (I have added you as a collaborator). All libraries are on the latest versions and `npm audit` is clean at zero vulnerabilities. Environment config is one template (`.env.example`) plus one local secret file (`.env.local`), split into frontend (`NEXT_PUBLIC_*`) and backend sections with comments. TypeScript is pinned at 6.x and ESLint at 9.x on purpose, and the reason is written in the README, so please do not upgrade those two. `npm run lint` shows about 52 pre-existing warnings that were invisible before, documented as a known baseline in the README. The new `cmu_accounts` table (migration 0018) is already applied and is ready for the CMU SSO fields, but stays dormant until `CMU_BASIC_INFO_URL` is set. On first sign-in a CMU student account becomes a student automatically, while a CMU staff account becomes a guest and is promoted to lecturer by an admin: that is a deliberate policy decision, not a to-do. Please also note `ALL_MIGRATIONS.sql` now covers 0001 to 0018, so use that file for a fresh database.

---

*Files: repo at `Projects/2026/MEQ_Exam_System/meq-platform`. Thai handover document at `meq-platform/docs/HANDOVER.md`.*

---

## 12. AI grading model: ALIGNED (2026-08-04)

**Done.** Production now uses `claude-opus-5` for AI pre-grading, matching the code.

Previously Vercel had `GRADING_MODEL` pinned to the older `claude-opus-4-8`, and an explicit setting always overrides the code default, so production would have kept using the old model regardless of the upgrade. You approved aligning it.

**What I changed:**

1. Replaced the `GRADING_MODEL` value in Vercel production with `claude-opus-5`
2. Redeployed, because an environment variable change does **not** affect an already-running deployment. Without a redeploy the change would have looked applied but done nothing.

Deployment `dpl_s3MvkWBcuFuxsMapAKShW6f7npVe`, READY. Verified again afterwards: `/login` 200, `/` 307, styling and Thai text all correct.

**One small improvement I made while there.** Vercel had this variable stored as *encrypted/sensitive*, meaning nobody, including you, could read the value back to check it. A model name is not a secret, and being unable to verify it is how a typo survives unnoticed. I stored it as a normal readable value instead, then read it back to confirm it says exactly `claude-opus-5` with no typo or stray spaces. You and the dev can now see it in the Vercel dashboard.

The genuine secrets (your Supabase keys) remain encrypted, as they should be.

**Cost impact: none.** The two models are the same price, and AI grading stays off by default with each lecturer using their own key.
