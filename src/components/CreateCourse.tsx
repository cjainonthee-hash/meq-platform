"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function CreateCourse({ userId }: { userId: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("courses")
      .insert({ code, title, created_by: userId })
      .select("id")
      .single();
    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }
    // Creator becomes a lecturer of the course.
    await supabase
      .from("course_members")
      .insert({ course_id: data.id, user_id: userId, role_in_course: "lecturer" });
    setCode("");
    setTitle("");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="card">
      <h2 className="font-semibold">สร้างรายวิชาใหม่</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr_auto]">
        <input
          className="input"
          placeholder="รหัสวิชา (เช่น VET301)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          className="input"
          placeholder="ชื่อวิชา"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          className="btn-primary"
          onClick={submit}
          disabled={busy || !code || !title}
        >
          สร้าง
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
