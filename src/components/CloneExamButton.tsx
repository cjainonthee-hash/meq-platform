"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Duplicate this exam (questions + rubrics) into a fresh draft for a new
 * sitting. The source exam and all its answers/scores stay untouched, so a
 * recurring course reuses the same exam every year without rebuilding it and
 * without overwriting past results.
 */
export function CloneExamButton({
  examId,
  sourceTitle,
}: {
  examId: string;
  sourceTitle: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function clone() {
    const title = window.prompt(
      "ตั้งชื่อการสอบครั้งใหม่ (เช่น ปีการศึกษา 2569)",
      `${sourceTitle} (สำเนา)`
    );
    if (title === null) return; // cancelled
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("clone_exam", {
      p_exam_id: examId,
      p_title: title,
    });
    setBusy(false);
    if (error || !data) {
      alert("ทำสำเนาไม่สำเร็จ: " + (error?.message ?? ""));
      return;
    }
    router.push(`/lecturer/exams/${data}`);
    router.refresh();
  }

  return (
    <button
      className="btn-ghost whitespace-nowrap"
      disabled={busy}
      onClick={clone}
      title="สร้างสำเนาข้อสอบชุดนี้เพื่อจัดสอบครั้งใหม่ ผลสอบเดิมจะยังคงอยู่ครบถ้วน"
    >
      {busy ? "กำลังทำสำเนา…" : "ทำสำเนาเพื่อจัดสอบใหม่"}
    </button>
  );
}
