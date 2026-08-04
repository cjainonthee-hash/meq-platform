"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function CreateExam({
  courseId,
  userId,
}: {
  courseId: string;
  userId: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const supabase = createClient();
    await supabase
      .from("exams")
      .insert({ course_id: courseId, title, created_by: userId });
    setTitle("");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="mt-3 flex gap-2">
      <input
        className="input flex-1"
        placeholder="ชื่อการสอบใหม่"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button className="btn-primary" onClick={create} disabled={busy || !title}>
        เพิ่มการสอบ
      </button>
    </div>
  );
}
