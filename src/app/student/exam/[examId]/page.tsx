import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ExamRunner } from "@/components/ExamRunner";
import type { Exam } from "@/lib/types";

export default async function StudentExamPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  const profile = await requireRole(["student", "admin"]);
  const supabase = await createClient();

  // Identity watermark tiled across the exam so any leaked screenshot is
  // traceable to the student who took it (cannot block screenshots on the web).
  const watermark = [profile.full_name, profile.student_code, profile.email]
    .filter(Boolean)
    .join("   ·   ");

  const { data: exam } = await supabase
    .from("exams")
    .select("*")
    .eq("id", examId)
    .single();

  if (!exam) redirect("/student");

  // Join the live sitting (creates the attempt, idempotent).
  const { data: attemptId, error } = await supabase.rpc("join_exam", {
    p_exam_id: examId,
  });
  if (error || !attemptId) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="card">
          <h1 className="text-xl font-bold">ไม่สามารถเข้าสอบได้</h1>
          <p className="mt-3 text-sm text-slate-600">
            {error?.message ?? "การสอบยังไม่เปิด"}
          </p>
        </div>
      </main>
    );
  }

  // Total question count (not sensitive; used only for the "X of N" label).
  const svc = createServiceClient();
  const { count } = await svc
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", examId);

  return (
    <main className="min-h-screen">
      <ExamRunner
        examId={examId}
        attemptId={attemptId as string}
        initialExam={exam as Exam}
        totalQuestions={count ?? 0}
        watermark={watermark}
      />
    </main>
  );
}
