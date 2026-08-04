import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { gradeAnswer, makeGrader } from "@/lib/anthropic";

// Kept within the serverless time limit; the client calls repeatedly in
// batches until every answer is graded (see the client loop in GradingPanel).
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json();
  const examId = body?.examId;
  if (!examId) return new NextResponse("examId required", { status: 400 });

  // AI pre-grading is opt-in. The lecturer supplies their own key when they
  // turn it on; it is used for this run only and never stored. A faculty may
  // instead set a shared ANTHROPIC_API_KEY, but by default there is none.
  const apiKey =
    (typeof body?.apiKey === "string" && body.apiKey.trim()) ||
    process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new NextResponse(
      "AI pre-grading is off. Enter an Anthropic API key to enable it, or grade manually.",
      { status: 400 }
    );
  }

  // ---- authorise: caller must be staff of this exam's course ----
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorised", { status: 401 });

  const { data: exam } = await supabase
    .from("exams")
    .select("course_id")
    .eq("id", examId)
    .single();
  if (!exam) return new NextResponse("Exam not found", { status: 404 });

  const { data: isStaff } = await supabase.rpc("is_exam_staff", {
    p_exam_id: examId,
  });
  if (!isStaff) return new NextResponse("Forbidden", { status: 403 });

  // ---- gather answers (service role) ----
  const svc = createServiceClient();
  const { data: attempts } = await svc
    .from("attempts")
    .select("id")
    .eq("exam_id", examId);
  const attemptIds = (attempts ?? []).map((a: any) => a.id);
  if (!attemptIds.length) return NextResponse.json({ graded: 0 });

  const { data: answers } = await svc
    .from("answers")
    .select(
      "id, answer_text, questions(stem, answer_key, rubric, max_score), grades(status)"
    )
    .in("attempt_id", attemptIds);

  // Only answers that don't yet have an AI grade (skip already ai_graded and
  // lecturer-confirmed). This makes the run resumable: each call grades the
  // next chunk, so repeated calls progress without redoing work.
  const pending = (answers ?? []).filter((ans: any) => {
    const g = Array.isArray(ans.grades) ? ans.grades[0] : ans.grades;
    return !g || g.status === "pending";
  });

  const grader = makeGrader(apiKey);
  const deadline = Date.now() + 50_000; // stop before the serverless timeout
  let graded = 0;
  const errors: string[] = [];

  for (const ans of pending) {
    // Stop before we time out; the client calls again for the rest.
    if (Date.now() > deadline) break;

    const q = (ans as any).questions;
    try {
      const result = await gradeAnswer(grader, {
        stem: q?.stem ?? "",
        answerKey: q?.answer_key ?? "",
        rubric: q?.rubric ?? [],
        maxScore: q?.max_score ?? 0,
        studentAnswer: (ans as any).answer_text ?? "",
      });
      await svc.from("grades").upsert(
        {
          answer_id: (ans as any).id,
          ai_score: result.total_score,
          ai_confidence: result.confidence,
          ai_breakdown: result.breakdown,
          ai_rationale: result.rationale,
          status: "ai_graded",
        },
        { onConflict: "answer_id" }
      );
      graded++;
    } catch (e: any) {
      errors.push(`${(ans as any).id}: ${e.message}`);
    }
  }

  const remaining = pending.length - graded;

  await svc.from("audit_log").insert({
    actor_id: user.id,
    action: "ai_grade_run",
    entity: "exam",
    entity_id: examId,
    meta: { graded, remaining, errors: errors.length },
  });

  return NextResponse.json({ graded, remaining, errors });
}
