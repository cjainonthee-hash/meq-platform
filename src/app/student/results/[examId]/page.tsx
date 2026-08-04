import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/Header";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  const profile = await requireRole(["student", "admin"]);
  const supabase = await createClient();

  const { data: exam } = await supabase
    .from("exams")
    .select("id, title, status, course_id")
    .eq("id", examId)
    .single();
  if (!exam || exam.status !== "released") redirect("/student");

  // Per-question detail is intentionally not shown to students: they see their
  // total on the course results page only. Staff/admin keep the full breakdown.
  if (profile.role === "student") redirect(`/student/course/${exam.course_id}`);

  const { data: attempt } = await supabase
    .from("attempts")
    .select("id")
    .eq("exam_id", examId)
    .eq("student_id", profile.id)
    .maybeSingle();

  const { data: rows } = attempt
    ? await supabase
        .from("answers")
        .select(
          "answer_text, question:questions(order_index, stem, max_score), grade:grades(final_score, ai_rationale)"
        )
        .eq("attempt_id", attempt.id)
    : { data: [] as any[] };

  const items = (rows ?? []).sort(
    (a: any, b: any) => a.question.order_index - b.question.order_index
  );
  const total = items.reduce(
    (s: number, r: any) => s + (r.grade?.final_score ?? 0),
    0
  );
  const max = items.reduce(
    (s: number, r: any) => s + (r.question?.max_score ?? 0),
    0
  );
  const pct = max > 0 ? Math.round((total / max) * 100) : 0;

  return (
    <>
      <Header profile={profile} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/student" className="text-sm text-brand hover:underline">
          ← กลับ
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">{exam.title}</h1>
        <p className="mt-1 text-sm text-slate-500">ผลการสอบของคุณ</p>

        {/* Score summary */}
        <div className="card mt-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-sm text-slate-500">คะแนนรวม</div>
              <div className="mt-1 text-3xl font-bold text-slate-800">
                {total}{" "}
                <span className="text-lg font-medium text-slate-400">
                  / {max}
                </span>
              </div>
            </div>
            <div className="text-3xl font-bold text-brand">{pct}%</div>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Per-question feedback */}
        <div className="mt-6 space-y-4">
          {items.map((r: any, i: number) => {
            const mx = r.question?.max_score ?? 0;
            const sc = r.grade?.final_score;
            const ratio = mx > 0 && sc != null ? sc / mx : 0;
            const chip =
              sc == null
                ? "bg-slate-100 text-slate-500"
                : ratio >= 1
                ? "bg-emerald-100 text-emerald-700"
                : ratio >= 0.5
                ? "bg-amber-100 text-amber-700"
                : "bg-red-100 text-red-700";
            return (
              <div key={i} className="card">
                <div className="flex items-center justify-between">
                  <span className="badge bg-brand-light text-brand-dark">
                    ข้อ {r.question.order_index + 1}
                  </span>
                  <span className={`badge ${chip}`}>
                    {sc ?? "-"} / {mx} คะแนน
                  </span>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                  {r.question.stem}
                </div>
                <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                  <div className="mb-1 text-xs font-medium text-slate-500">
                    คำตอบของคุณ
                  </div>
                  <div className="whitespace-pre-wrap text-slate-700">
                    {r.answer_text || "(ไม่ได้ตอบ)"}
                  </div>
                </div>
                {r.grade?.ai_rationale && (
                  <div className="mt-3 rounded-lg border border-brand-light bg-brand-light/50 p-3 text-sm">
                    <div className="mb-1 text-xs font-medium text-brand-dark">
                      ความเห็นผู้ตรวจ
                    </div>
                    <div className="whitespace-pre-wrap text-slate-700">
                      {r.grade.ai_rationale}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {items.length === 0 && (
            <div className="card text-sm text-slate-500">
              ไม่พบคำตอบของคุณสำหรับการสอบนี้
            </div>
          )}
        </div>
      </main>
    </>
  );
}
