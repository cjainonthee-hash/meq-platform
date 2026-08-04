import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/Header";
import { CreateCourse } from "@/components/CreateCourse";

export default async function LecturerDashboard() {
  const profile = await requireRole(["lecturer", "admin"]);
  const supabase = await createClient();

  const { data: courses } = await supabase
    .from("courses")
    .select("id, code, title")
    .order("created_at", { ascending: false });

  return (
    <>
      <Header profile={profile} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">รายวิชาของฉัน</h1>
        <div className="mt-6">
          <CreateCourse userId={profile.id} />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(courses ?? []).length === 0 && (
            <div className="card text-sm text-slate-500 sm:col-span-2 lg:col-span-3">
              ยังไม่มีรายวิชา สร้างรายวิชาด้านบน
            </div>
          )}
          {(courses ?? []).map((c) => (
            <Link
              key={c.id}
              href={`/lecturer/courses/${c.id}`}
              className="card flex min-h-[120px] flex-col justify-between hover:border-brand"
            >
              <div>
                <div className="font-medium">{c.title}</div>
                <div className="text-xs text-slate-500">{c.code}</div>
              </div>
              <span className="mt-3 self-end text-brand">จัดการ →</span>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
