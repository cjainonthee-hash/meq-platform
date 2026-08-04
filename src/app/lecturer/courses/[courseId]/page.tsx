import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { Header } from "@/components/Header";
import { CourseMembers } from "@/components/CourseMembers";
import { CreateExam } from "@/components/CreateExam";
import { examStatusTh } from "@/lib/labels";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const profile = await requireRole(["lecturer", "admin"]);
  const supabase = await createClient();

  // Authorise: must be staff of this course.
  const { data: isStaff } = await supabase.rpc("is_course_staff", {
    p_course_id: courseId,
  });
  if (!isStaff) redirect("/lecturer");

  const { data: course } = await supabase
    .from("courses")
    .select("id, code, title")
    .eq("id", courseId)
    .single();
  if (!course) redirect("/lecturer");

  const { data: exams } = await supabase
    .from("exams")
    .select("id, title, status")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });

  // Member list with emails (needs service role to read others' profiles).
  const svc = createServiceClient();
  const { data: rawMembers } = await svc
    .from("course_members")
    .select("user_id, role_in_course, profiles(email, full_name, student_code)")
    .eq("course_id", courseId);
  const members = (rawMembers ?? []).map((m: any) => ({
    user_id: m.user_id,
    role_in_course: m.role_in_course,
    email: m.profiles?.email ?? "",
    full_name: m.profiles?.full_name ?? null,
    student_code: m.profiles?.student_code ?? null,
  }));

  return (
    <>
      <Header profile={profile} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link href="/lecturer" className="text-sm text-brand">
          ← รายวิชาของฉัน
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{course.title}</h1>
        <div className="text-sm text-slate-500">{course.code}</div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <CourseMembers courseId={courseId} members={members} />

          <div className="card">
            <h2 className="font-semibold">การสอบ</h2>
            <div className="mt-3 space-y-2">
              {(exams ?? []).map((e) => (
                <Link
                  key={e.id}
                  href={`/lecturer/exams/${e.id}`}
                  className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm hover:border-brand"
                >
                  <span>{e.title}</span>
                  <span className="badge bg-slate-100 text-slate-600">
                    {examStatusTh[e.status] ?? e.status}
                  </span>
                </Link>
              ))}
            </div>
            <CreateExam courseId={courseId} userId={profile.id} />
          </div>
        </div>
      </main>
    </>
  );
}
