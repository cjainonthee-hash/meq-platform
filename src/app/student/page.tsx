import Link from "next/link";
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
const statusDot: Record<ExamStatus, string> = {
  draft: "bg-slate-300",
  scheduled: "bg-amber-400",
  live: "bg-red-500",
  closed: "bg-slate-300",
  released: "bg-emerald-500",
};

export default async function StudentDashboard() {
  const profile = await requireRole(["student", "admin"]);
  const supabase = await createClient();

  const { data: exams } = await supabase
    .from("exams")
    .select(
      "id, title, status, scheduled_start, created_at, course_id, course:courses(code, title)"
    )
    .order("created_at", { ascending: false });

  const all = (exams ?? []) as any[];

  const rank: Record<string, number> = { live: 0, scheduled: 1 };
  const upcoming = all
    .filter((e) => e.status === "live" || e.status === "scheduled")
    .sort(
      (a, b) =>
        (rank[a.status] - rank[b.status]) ||
        new Date(a.scheduled_start ?? a.created_at).getTime() -
          new Date(b.scheduled_start ?? b.created_at).getTime()
    );

  // Past exams grouped by course -> one card per course.
  const past = all.filter((e) => e.status === "closed" || e.status === "released");
  const pastCourses: any[] = Array.from(
    past
      .reduce((m: Map<string, any>, e) => {
        const cur =
          m.get(e.course_id) ?? {
            course_id: e.course_id,
            code: e.course?.code,
            title: e.course?.title,
            count: 0,
          };
        cur.count += 1;
        m.set(e.course_id, cur);
        return m;
      }, new Map<string, any>())
      .values()
  );

  function ExamCard({ e }: { e: any }) {
    const status = e.status as ExamStatus;
    return (
      <div
        className={`card flex items-center justify-between gap-4 border-l-4 transition hover:shadow-md ${statusAccent[status]}`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${statusDot[status]} ${
              status === "live" ? "animate-pulse" : ""
            }`}
          />
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-800">
              {e.title}
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {e.course?.code} · {e.course?.title}
            </div>
            {status === "scheduled" && e.scheduled_start && (
              <div className="mt-1 text-xs font-medium text-brand">
                เริ่มสอบ:{" "}
                {new Date(e.scheduled_start).toLocaleString("th-TH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                น.
              </div>
            )}
            {status === "live" && (
              <div className="mt-1 text-xs font-medium text-red-600">
                กำลังสอบอยู่ตอนนี้
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={`badge ${statusBadge[status]}`}>
            {examStatusTh[status] ?? status}
          </span>
          {status === "scheduled" && (
            <Link href={`/student/exam/${e.id}`} className="btn-ghost">
              เข้าห้องรอสอบ
            </Link>
          )}
          {status === "live" && (
            <Link href={`/student/exam/${e.id}`} className="btn-primary">
              เข้าสอบ
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Header profile={profile} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-800">การสอบของฉัน</h1>
        <p className="mt-1 text-sm text-slate-500">
          {profile.full_name || profile.email}
          {profile.student_code && (
            <span className="font-medium text-slate-600"> · รหัสนักศึกษา {profile.student_code}</span>
          )}
        </p>

        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            กำลังสอบ / กำลังจะมาถึง
          </h2>
          <div className="space-y-3">
            {upcoming.length === 0 && (
              <div className="card text-sm text-slate-500">
                ไม่มีการสอบที่กำลังจะมาถึง
              </div>
            )}
            {upcoming.map((e) => (
              <ExamCard key={e.id} e={e} />
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            การสอบที่ผ่านมา (ตามรายวิชา)
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {pastCourses.length === 0 && (
              <div className="card text-sm text-slate-500">
                ยังไม่มีการสอบที่ผ่านมา
              </div>
            )}
            {pastCourses.map((c) => (
              <Link
                key={c.course_id}
                href={`/student/course/${c.course_id}`}
                className="card flex items-center justify-between gap-3 border-l-4 border-l-brand transition hover:shadow-md"
              >
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-slate-800">
                    {c.title}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {c.code} · {c.count} การสอบ
                  </div>
                </div>
                <span className="shrink-0 text-sm font-medium text-brand">
                  ดูทั้งหมด →
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
