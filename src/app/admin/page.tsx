import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Header } from "@/components/Header";
import { AdminUsers } from "@/components/AdminUsers";
import type { Profile } from "@/lib/types";

export default async function AdminPage() {
  const profile = await requireRole(["admin"]);
  // Admin can read all profiles; service client keeps it simple and ordered.
  const svc = createServiceClient();
  const { data: users } = await svc
    .from("profiles")
    .select("id, email, full_name, student_code, role")
    .order("created_at", { ascending: false });

  return (
    <>
      <Header profile={profile} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">การดูแลระบบ</h1>
          <Link href="/lecturer" className="btn-ghost">
            ไปที่หน้าจัดการการสอน →
          </Link>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          ในฐานะผู้ดูแลระบบ คุณมีสิทธิ์ทุกอย่างของอาจารย์ด้วย
          ใช้หน้าจัดการการสอนเพื่อดูแลรายวิชาและการสอบของคุณเอง
        </p>
        <div className="mt-6">
          <AdminUsers users={(users ?? []) as Profile[]} />
        </div>
      </main>
    </>
  );
}
