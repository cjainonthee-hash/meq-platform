"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { examStatusTh } from "@/lib/labels";
import type { Exam } from "@/lib/types";

interface ProctorRow {
  full_name: string | null;
  email: string;
  joined_at: string;
  submitted_at: string | null;
  violations: number;
}

// ISO (UTC) -> value for <input type="datetime-local"> in the viewer's local time.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

function fmtSchedule(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function LiveControl({
  examId,
  initialExam,
  totalQuestions,
  questionTimes,
  attempts,
}: {
  examId: string;
  initialExam: Exam;
  totalQuestions: number;
  questionTimes: { order_index: number; time_limit_seconds: number }[];
  attempts: ProctorRow[];
}) {
  const router = useRouter();
  const supabase = useRef(createClient());
  const [exam, setExam] = useState<Exam>(initialExam);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const clockOffset = useRef(0);

  // Sync a clock offset against the server, same as the student view, so the
  // lecturer's timer matches exactly what students see.
  useEffect(() => {
    let alive = true;
    async function sync() {
      const t0 = Date.now();
      const { data } = await supabase.current.rpc("server_now");
      if (!alive || !data) return;
      const t1 = Date.now();
      clockOffset.current =
        new Date(data as string).getTime() - (t0 + (t1 - t0) / 2);
    }
    sync();
    const id = setInterval(sync, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Tick the current question's countdown while the exam is live.
  useEffect(() => {
    if (exam.status !== "live" || !exam.current_started_at) return;
    const id = setInterval(() => {
      const q = questionTimes.find(
        (x) => x.order_index === exam.current_question_index
      );
      if (!q) return;
      const deadline =
        new Date(exam.current_started_at as string).getTime() +
        q.time_limit_seconds * 1000;
      setRemaining(
        Math.max(0, Math.round((deadline - (Date.now() + clockOffset.current)) / 1000))
      );
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.status, exam.current_started_at, exam.current_question_index]);
  const [startAt, setStartAt] = useState<string>(
    initialExam.scheduled_start ? toLocalInput(initialExam.scheduled_start) : ""
  );

  useEffect(() => {
    const ch = supabase.current
      .channel(`ctrl-${examId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "exams", filter: `id=eq.${examId}` },
        (p) => setExam(p.new as Exam)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attempts", filter: `exam_id=eq.${examId}` },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      supabase.current.removeChannel(ch);
    };
  }, [examId, router]);

  // Lecturer-side auto-advance safety net. advance_if_due is server-guarded
  // (it only advances when a question's time is actually up), so polling it
  // here means the exam progresses on time even if no student is online — the
  // lecturer never has to press a button to move on.
  useEffect(() => {
    if (exam.status !== "live") return;
    const id = setInterval(() => {
      supabase.current.rpc("advance_if_due", { p_exam_id: examId });
    }, 2000);
    return () => clearInterval(id);
  }, [exam.status, examId]);

  // Scheduled auto-start safety net. start_if_due is server-guarded (starts
  // only when the scheduled time has arrived), so polling it from the open
  // lecturer page means the exam begins on time without a manual press.
  useEffect(() => {
    if (exam.status !== "scheduled") return;
    const id = setInterval(() => {
      supabase.current.rpc("start_if_due", { p_exam_id: examId });
    }, 2000);
    return () => clearInterval(id);
  }, [exam.status, examId]);

  async function call(fn: string) {
    setBusy(true);
    await supabase.current.rpc(fn, { p_exam_id: examId });
    setBusy(false);
    router.refresh();
  }

  async function schedule() {
    if (!startAt) {
      alert("กรุณาเลือกวันและเวลาสอบ");
      return;
    }
    setBusy(true);
    const iso = new Date(startAt).toISOString();
    await supabase.current
      .from("exams")
      .update({ scheduled_start: iso, status: "scheduled" })
      .eq("id", examId);
    setBusy(false);
    router.refresh();
  }

  async function cancelSchedule() {
    setBusy(true);
    await supabase.current
      .from("exams")
      .update({ status: "draft", scheduled_start: null })
      .eq("id", examId);
    setBusy(false);
    router.refresh();
  }

  const joined = attempts.length;
  const submitted = attempts.filter((a) => a.submitted_at).length;
  const canSchedule = exam.status === "draft" || exam.status === "scheduled";

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">การควบคุมการสอบ</h2>
        <span className="badge bg-slate-100 text-slate-600">
          {examStatusTh[exam.status] ?? exam.status}
        </span>
      </div>

      {canSchedule && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label">กำหนดวันและเวลาสอบ</label>
              <input
                type="datetime-local"
                className="input w-auto"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </div>
            <button className="btn-ghost" disabled={busy || !startAt} onClick={schedule}>
              {exam.status === "scheduled" ? "อัปเดตเวลาสอบ" : "ตั้งเวลาสอบ"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              disabled={busy || totalQuestions === 0}
              onClick={() => call("start_exam")}
            >
              เริ่มสอบทันที (ทุกคนเริ่มพร้อมกัน)
            </button>
            {exam.status === "scheduled" && (
              <button className="btn-ghost" disabled={busy} onClick={cancelSchedule}>
                ยกเลิกกำหนดเวลา
              </button>
            )}
          </div>
        </div>
      )}

      {exam.status === "scheduled" && exam.scheduled_start && (
        <p className="mt-3 rounded-md bg-brand-light px-3 py-2 text-sm text-brand-dark">
          ตั้งเวลาสอบไว้:{" "}
          <span className="font-semibold">{fmtSchedule(exam.scheduled_start)}</span>{" "}
          น. ระบบจะเริ่มสอบให้โดยอัตโนมัติเมื่อถึงเวลา แจ้งให้นักศึกษาเข้าห้องรอสอบ
          ก่อนเวลาเล็กน้อย
        </p>
      )}

      {exam.status === "live" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() => call("advance_exam")}
            title="ระบบจะเลื่อนไปข้อถัดไปเองเมื่อหมดเวลา ใช้ปุ่มนี้เฉพาะเมื่อต้องการให้ทุกคนไปข้อถัดไปก่อนเวลา"
          >
            ข้ามไปข้อถัดไปทันที →
          </button>
        </div>
      )}

      {exam.status === "closed" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => call("release_results")}
          >
            ประกาศผลให้นักศึกษา
          </button>
        </div>
      )}

      {exam.status === "live" && (
        <div className="mt-3 flex items-center gap-3">
          <div
            className={`rounded-lg px-4 py-2 text-center font-mono text-3xl font-bold leading-none ${
              remaining <= 10
                ? "bg-red-100 text-red-700"
                : remaining <= 30
                ? "bg-amber-100 text-amber-700"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {Math.floor(remaining / 60)}:
            {(remaining % 60).toString().padStart(2, "0")}
          </div>
          <p className="text-sm text-slate-600">
            กำลังอยู่ที่{" "}
            <span className="font-semibold">
              ข้อ {exam.current_question_index + 1} จาก {totalQuestions}
            </span>
            <br />
            เวลาที่เหลือของข้อนี้ (ตรงกับหน้าจอนักศึกษา) ระบบจะเลื่อนอัตโนมัติเมื่อหมดเวลา
          </p>
        </div>
      )}

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">การคุมสอบ</span>
          <span className="text-slate-500">
            เข้าร่วม {joined} · ส่งแล้ว {submitted}
          </span>
        </div>
        <ul className="max-h-56 divide-y overflow-y-auto text-sm">
          {attempts.map((a, i) => (
            <li key={i} className="flex items-center justify-between py-1.5">
              <span>{a.full_name || a.email}</span>
              <span className="flex items-center gap-2">
                {a.violations > 0 && (
                  <span
                    className="badge bg-red-100 text-red-700"
                    title="ออกจากหน้าสอบ / สลับแท็บ"
                  >
                    ⚠ {a.violations}
                  </span>
                )}
                <span
                  className={`badge ${
                    a.submitted_at
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {a.submitted_at ? "ส่งแล้ว" : "กำลังทำ"}
                </span>
              </span>
            </li>
          ))}
          {attempts.length === 0 && (
            <li className="py-2 text-slate-400">ยังไม่มีนักศึกษาเข้าร่วม</li>
          )}
        </ul>
      </div>
    </div>
  );
}
