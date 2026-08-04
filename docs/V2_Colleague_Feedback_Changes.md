# MEQ Platform: Colleague Feedback Changes (V2 pass)

Date: 2026-08-03
By: One Catalyst (Proto, with Resa on grading)

Four points came back from a co-teaching colleague. Status below.

---

## 1. Grading tab: grade by student OR by question (DONE)

The ตรวจให้คะแนน tab now has a mode switch:

- **ทีละคน (by student):** the original view. All of one student's answers, navigate student to student.
- **ทีละข้อ (by question):** all students' answers to the same question on one screen, with the question stem, answer key, and rubric shown as a collapsible reference. Easier and more consistent because it is the same item.

Scores autosave in both modes. Each mode has a "save all shown scores" button (accept AI proposals in bulk). Files: `src/components/GradingPanel.tsx`, `src/app/lecturer/exams/[examId]/page.tsx`.

## 2. Setup tab: video links + direct image upload (DONE, needs DB migration run)

- **Video per question:** a "วิดีโอประกอบ" field list. Paste a YouTube, Vimeo, Google Drive, or direct video-file link and it previews inline (lecturer editor + student exam screen). Component: `src/components/VideoEmbed.tsx`.
- **Direct image upload:** an "อัปโหลดรูปจากเครื่อง" button next to the paste-link field. The image is compressed in the browser (longest side <= 1600 px, JPEG quality stepped down) so it stays under 5 MB, then uploaded to a Supabase Storage bucket `question-media`; the public URL is appended to the question's image list. No change to how answers/grades are stored, only a URL.

**Storage impact (the point the colleague flagged):** uploads go to Supabase Storage, not the database. Free tier includes 1 GB, which is far more than compressed exam images need. Requires running migration `0015_question_media.sql` on the live Supabase project (adds the `video_urls` column, the `question-media` bucket + policies, and updates `clone_exam`).

Files: `supabase/migrations/0015_question_media.sql`, `src/components/QuestionEditor.tsx`, `src/components/ExamRunner.tsx`, `src/lib/types.ts`.

Bonus fix found on the way: `clone_exam` was copying only the old single `image_url`, so cloning an exam silently dropped multi-image links (from migration 0013). Migration 0015 fixes it to copy `image_urls` and `video_urls` too.

## 3. Many co-teaching lecturers: per-exam grading permission (DONE, needs DB migration run)

Boss's refined decision: let the owner of a specific exam choose which lecturers can help grade it. Built as a per-exam permission control in the ตั้งค่า tab:

- **Default = shared:** every lecturer in the course can view and grade the exam (unchanged from before).
- **Restricted:** the owner picks specific course lecturers. Only the owner + chosen lecturers (+ admins) can see, run, and grade that exam; other course lecturers cannot see it at all. Other exams in the same course stay independent (each has its own setting).
- Only the exam's **owner (creator)** or an admin can change the setting. Non-owners see a read-only summary.

Mechanism (migration `0016_exam_graders.sql`): `exams.graders_restricted` flag + an `exam_graders` allow-list + a new `is_exam_staff()` function that every exam-scoped access now flows through (row-level security on exams/questions/attempts/answers/grades, the start/advance/release/clone RPCs, and the AI-grade + CSV-export API routes). For a non-restricted exam, `is_exam_staff()` behaves exactly like the old course-level check, so nothing about existing exams changes. Owner is set from `created_by` (exams created in the app always set it).

Files: `supabase/migrations/0016_exam_graders.sql`, `src/components/ExamGraders.tsx`, `src/app/lecturer/exams/[examId]/page.tsx`, `src/app/api/grade/route.ts`, `src/app/api/export/route.ts`, `src/lib/types.ts`.

## 4. ประกาศคะแนน: total score only, no per-question click-through (DONE)

On the student side, each released exam card now shows the **total score** prominently and no longer links to the per-question breakdown. The old per-question results route redirects students back to their course results page (staff/admin keep the full breakdown for support). Files: `src/app/student/course/[courseId]/page.tsx`, `src/app/student/results/[examId]/page.tsx`.

---

## To deploy

1. In the live Supabase project SQL editor, run **`0015_question_media.sql`** then **`0016_exam_graders.sql`** (in that order). Do NOT re-run `ALL_MIGRATIONS.sql` on the existing project (its `create policy` lines would clash with already-installed policies); that file is only for building a fresh project.
2. From `meq-platform/`: `npx vercel --prod` (do not run `next build` while `npm run dev` is running).
3. Smoke test: upload an image on a question, add a YouTube link, grade in both modes, restrict an exam to one co-lecturer and confirm the other cannot see it, release an exam and check the student sees only the total.

Typecheck (`npx tsc --noEmit`) passes.
