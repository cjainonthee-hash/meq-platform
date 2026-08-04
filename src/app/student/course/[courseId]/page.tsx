import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/Header";
import { examStatusTh } from "@/lib/labels";
import type { ExamStatus } from "@/lib/types";

const statusBadge: Record<ExamStatus, string> = {
  draft: "bg-slate-100 text-slate-500",
  scheduled: "bg-amber-100 text-amber-700",
  live: "bg-red-100 text-red-700",
  closed: "bg-slate-200 text-slate-700",
  released: "bg-emerald-100 text-emerald-700",
};
const statusAccent: Record<ExamStatus, string> = {
  draft: "border-l-slate-300",
  scheduled: "border-l-amber-400",
  live: "border-l-red-500",
  closed: "border-l-slate-300",
  released: "border-l-emerald-500",
};

export default async function StudentCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const profile = await requireRole(["student", "admin"]);
  const supabase = await createClient();

  const { data: exams } = await supabase
    .from("exams")
    .select("id, title, status, created_at, course:courses(code, title)")
    .eq("course_id", courseId)
    .in("status", ["closed", "released"])
    .order("created_at", { ascending: false });

  const list = (exams ?? []) as any[];
  if (list.length === 0) redirect("/student");

  const course = list[0].course;

  // Student's own total per released exam in this course.
  const releasedIds = list.filter((e) => e.status === "released").map((e) => e.id);
  const scoreByExam: Record<string, { total: number; max: number }> = {};
  if (releasedIds.length) {
    const { data: rows } = await supabase
      .from("attempts")
      .select(
        "exam_id, answers(grade:grades(final_score), question:questions(max_score))"
      )
      .eq("student_id", profile.id)
      .in("exam_id", releasedIds);
    for (const at of (rows ?? []) as any[]) {
      let total = 0;
      let max = 0;
      for (const ans of at.answers ?? []) {
        total += ans.grade?.final_score ?? 0;
        max += ans.question?.max_score ?? 0;
      }
      scoreByExam[at.exam_id] = { total, max };
    }
  }

  return (
    <>
      <Header profile={profile} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/student" className="text-sm text-brand hover:underline">
          ← การสอบของฉัน
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">{course?.title}</h1>
        <div className="text-sm text-slate-500">{course?.code}</div>
        <p className="mt-1 text-sm text-slate-500">การสอบที่ผ่านมาทั้งหมดในรายวิชานี้</p>

        <div className="mt-6 space-y-3">
          {list.map((e) => {
            const status = e.status as ExamStatus;
            const score = scoreByExam[e.id];
            return (
              <div
                key={e.id}
                className={`card flex items-center justify-between gap-4 border-l-4 ${statusAccent[status]}`}
              >
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-slate-800">
                    {e.title}
                  </div>
                  {status !== "released" && (
                    <div className="mt-1 text-xs text-slate-400">
                      รอประกาศผลจากอาจารย์
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {status === "released" && score && (
                    <div className="text-right">
                      <div className="text-2xl font-bold leading-none text-emerald-700">
                        {score.total}
                        <span className="text-sm font-medium text-slate-400">
                          {" "}
                          / {score.max}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-400">
                        คะแนนรวม
                      </div>
                    </div>
                  )}
                  <span className={`badge ${statusBadge[status]}`}>
                    {examStatusTh[status] ?? status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
