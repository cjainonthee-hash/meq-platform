import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { Header } from "@/components/Header";
import { QuestionEditor } from "@/components/QuestionEditor";
import { LiveControl } from "@/components/LiveControl";
import { GradingPanel, type StudentBlock } from "@/components/GradingPanel";
import { ExamTabs } from "@/components/ExamTabs";
import { ExamGraders } from "@/components/ExamGraders";
import { CloneExamButton } from "@/components/CloneExamButton";
import type { Exam, Question } from "@/lib/types";

export default async function ExamManagePage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  const profile = await requireRole(["lecturer", "admin"]);
  const supabase = await createClient();

  const { data: exam } = await supabase
    .from("exams")
    .select("*")
    .eq("id", examId)
    .single();
  if (!exam) redirect("/lecturer");

  const { data: isStaff } = await supabase.rpc("is_exam_staff", {
    p_exam_id: examId,
  });
  if (!isStaff) redirect("/lecturer");

  const { data: questions } = await supabase
    .from("questions")
    .select("*")
    .eq("exam_id", examId)
    .order("order_index");

  // Assemble proctor + grading data with the service client (crosses students).
  const svc = createServiceClient();

  // Co-teaching: course lecturers + this exam's assigned graders, for the
  // per-exam permission control. Service client reads across profiles.
  const { data: rawLecturers } = await svc
    .from("course_members")
    .select("user_id, profiles(email, full_name)")
    .eq("course_id", exam.course_id)
    .eq("role_in_course", "lecturer");
  const lecturers = (rawLecturers ?? []).map((m: any) => ({
    user_id: m.user_id,
    email: m.profiles?.email ?? "",
    full_name: m.profiles?.full_name ?? null,
  }));
  const { data: rawGraders } = await svc
    .from("exam_graders")
    .select("user_id")
    .eq("exam_id", examId);
  const graderIds = (rawGraders ?? []).map((g: any) => g.user_id);
  const isOwner = exam.created_by === profile.id || profile.role === "admin";
  const { data: attempts } = await svc
    .from("attempts")
    .select(
      "id, student_id, joined_at, submitted_at, focus_violations, profiles(email, full_name, student_code)"
    )
    .eq("exam_id", examId)
    .order("joined_at");

  const attemptIds = (attempts ?? []).map((a: any) => a.id);
  const { data: answers } = attemptIds.length
    ? await svc
        .from("answers")
        .select(
          "id, attempt_id, answer_text, questions(order_index, max_score), grades(ai_score, ai_confidence, ai_rationale, final_score, status)"
        )
        .in("attempt_id", attemptIds)
    : { data: [] as any[] };

  const proctor = (attempts ?? []).map((a: any) => ({
    full_name: a.profiles?.full_name ?? null,
    email: a.profiles?.email ?? "",
    joined_at: a.joined_at,
    submitted_at: a.submitted_at,
    violations: a.focus_violations ?? 0,
  }));

  const students: StudentBlock[] = (attempts ?? []).map((a: any) => {
    const rows = (answers ?? [])
      .filter((ans: any) => ans.attempt_id === a.id)
      .map((ans: any) => {
        const g = Array.isArray(ans.grades) ? ans.grades[0] : ans.grades;
        return {
          answer_id: ans.id,
          question_order: ans.questions?.order_index ?? 0,
          max_score: ans.questions?.max_score ?? 0,
          answer_text: ans.answer_text ?? "",
          ai_score: g?.ai_score ?? null,
          ai_confidence: g?.ai_confidence ?? null,
          ai_rationale: g?.ai_rationale ?? null,
          final_score: g?.final_score ?? null,
          status: g?.status ?? null,
        };
      })
      .sort((x: any, y: any) => x.question_order - y.question_order);
    return {
      student_id: a.student_id,
      name: a.profiles?.full_name ?? a.profiles?.email ?? "student",
      email: a.profiles?.email ?? "",
      student_code: a.profiles?.student_code ?? null,
      answers: rows,
    };
  });

  const editable = exam.status === "draft" || exam.status === "scheduled";

  return (
    <>
      <Header profile={profile} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link href={`/lecturer/courses/${exam.course_id}`} className="text-sm text-brand">
          ← กลับไปที่รายวิชา
        </Link>
        <div className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{exam.title}</h1>
          <CloneExamButton examId={examId} sourceTitle={exam.title} />
        </div>

        <ExamTabs
          status={exam.status}
          setup={
            <section className="space-y-4">
              <ExamGraders
                examId={examId}
                restricted={!!exam.graders_restricted}
                lecturers={lecturers}
                graderIds={graderIds}
                creatorId={exam.created_by ?? null}
                isOwner={isOwner}
              />
              <div>
                <h2 className="mb-3 text-lg font-semibold">
                  คำถาม {editable ? "" : "(ล็อกเมื่อเริ่มสอบแล้ว)"}
                </h2>
                <QuestionEditor
                  examId={examId}
                  editable={editable}
                  initial={(questions ?? []) as Question[]}
                />
              </div>
            </section>
          }
          run={
            <LiveControl
              examId={examId}
              initialExam={exam as Exam}
              totalQuestions={(questions ?? []).length}
              questionTimes={(questions ?? []).map((q: any) => ({
                order_index: q.order_index,
                time_limit_seconds: q.time_limit_seconds,
              }))}
              attempts={proctor}
            />
          }
          grade={
            <GradingPanel
              examId={examId}
              userId={profile.id}
              students={students}
              questions={(questions ?? []).map((q: any) => ({
                order_index: q.order_index,
                stem: q.stem ?? "",
                answer_key: q.answer_key ?? "",
                max_score: q.max_score ?? 0,
                rubric: Array.isArray(q.rubric) ? q.rubric : [],
              }))}
            />
          }
        />
      </main>
    </>
  );
}
