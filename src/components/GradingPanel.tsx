"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confidenceTh } from "@/lib/labels";
import type { RubricCriterion } from "@/lib/types";

export interface GradeRow {
  answer_id: string;
  question_order: number;
  max_score: number;
  answer_text: string;
  ai_score: number | null;
  ai_confidence: string | null;
  ai_rationale: string | null;
  final_score: number | null;
  status: string | null;
}
export interface StudentBlock {
  student_id: string;
  name: string;
  email: string;
  student_code: string | null;
  answers: GradeRow[];
}
export interface QuestionRef {
  order_index: number;
  stem: string;
  answer_key: string;
  max_score: number;
  rubric: RubricCriterion[];
}

const confColor: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-red-100 text-red-700",
};

function seedScores(students: StudentBlock[]): Record<string, number | ""> {
  const m: Record<string, number | ""> = {};
  for (const s of students)
    for (const r of s.answers) m[r.answer_id] = r.final_score ?? r.ai_score ?? "";
  return m;
}

type Mode = "student" | "question";

export function GradingPanel({
  examId,
  userId,
  students,
  questions = [],
}: {
  examId: string;
  userId: string;
  students: StudentBlock[];
  questions?: QuestionRef[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("student");
  const [active, setActive] = useState(0); // active student (student mode)
  const [activeQ, setActiveQ] = useState(0); // active question (question mode)
  const [scores, setScores] = useState<Record<string, number | "">>(() =>
    seedScores(students)
  );
  const [savedState, setSavedState] = useState<Record<string, "saving" | "saved">>(
    {}
  );
  const [showKey, setShowKey] = useState(true);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [showAi, setShowAi] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  // Re-seed when the server data changes (after a refresh or AI pre-grading).
  useEffect(() => {
    setScores(seedScores(students));
  }, [students]);

  // Keep the active indices in range if the roster / question set changes.
  useEffect(() => {
    if (active > students.length - 1) setActive(Math.max(0, students.length - 1));
  }, [students.length, active]);

  // The list of questions to grade by. Prefer the passed reference; otherwise
  // derive it from whatever answers exist so the mode still works.
  const questionList: QuestionRef[] = useMemo(() => {
    if (questions.length) return [...questions].sort((a, b) => a.order_index - b.order_index);
    const byOrder = new Map<number, QuestionRef>();
    for (const s of students)
      for (const r of s.answers)
        if (!byOrder.has(r.question_order))
          byOrder.set(r.question_order, {
            order_index: r.question_order,
            stem: "",
            answer_key: "",
            max_score: r.max_score,
            rubric: [],
          });
    return [...byOrder.values()].sort((a, b) => a.order_index - b.order_index);
  }, [questions, students]);

  useEffect(() => {
    if (activeQ > questionList.length - 1)
      setActiveQ(Math.max(0, questionList.length - 1));
  }, [questionList.length, activeQ]);

  async function saveScore(answerId: string, value: number | "") {
    const num = value === "" ? null : Number(value);
    setSavedState((s) => ({ ...s, [answerId]: "saving" }));
    const supabase = createClient();
    await supabase.from("grades").upsert(
      {
        answer_id: answerId,
        final_score: num,
        status: num == null ? "pending" : "confirmed",
        graded_by: userId,
      },
      { onConflict: "answer_id" }
    );
    setSavedState((s) => ({ ...s, [answerId]: "saved" }));
  }

  function onScore(answerId: string, raw: string) {
    const value: number | "" = raw === "" ? "" : Number(raw);
    setScores((m) => ({ ...m, [answerId]: value }));
    setSavedState((s) => ({ ...s, [answerId]: "saving" }));
    clearTimeout(saveTimers.current[answerId]);
    saveTimers.current[answerId] = setTimeout(
      () => saveScore(answerId, value),
      700
    );
  }

  // Save a set of currently-shown scores at once (accept AI proposals in bulk).
  async function saveMany(answerIds: string[]) {
    for (const id of answerIds) await saveScore(id, scores[id] ?? "");
  }

  async function runAi() {
    if (!apiKey.trim()) {
      alert("กรุณากรอก Anthropic API key ของคุณเพื่อเริ่มตรวจด้วย AI");
      return;
    }
    setBusy(true);
    setProgress(0);
    let total = 0;
    try {
      while (true) {
        const res = await fetch("/api/grade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ examId, apiKey: apiKey.trim() }),
        });
        if (!res.ok) {
          alert("ตรวจไม่สำเร็จ: " + (await res.text()));
          break;
        }
        const data = await res.json();
        total += data.graded ?? 0;
        setProgress(total);
        if ((data.remaining ?? 0) <= 0) break;
        if ((data.graded ?? 0) === 0) {
          alert(`ตรวจเสร็จบางส่วน (${total} ข้อ) มีบางข้อที่ตรวจไม่สำเร็จ`);
          break;
        }
      }
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const isGraded = (answerId: string) =>
    scores[answerId] !== "" && scores[answerId] != null;

  // A single gradeable answer card (shared by both modes).
  function AnswerCard({
    r,
    heading,
    subheading,
  }: {
    r: GradeRow;
    heading: string;
    subheading?: string;
  }) {
    return (
      <div className="rounded bg-slate-50 p-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-xs font-medium text-slate-600">{heading}</span>
            {subheading && (
              <span className="ml-1 text-xs text-slate-400">{subheading}</span>
            )}
          </div>
          {r.ai_confidence && (
            <span className={`badge shrink-0 ${confColor[r.ai_confidence] ?? ""}`}>
              AI: {r.ai_score} (มั่นใจ
              {confidenceTh[r.ai_confidence] ?? r.ai_confidence})
            </span>
          )}
        </div>
        <div className="mt-1 whitespace-pre-wrap text-slate-700">
          {r.answer_text || "(ไม่ได้ตอบ)"}
        </div>
        {r.ai_rationale && (
          <div className="mt-1 text-xs italic text-slate-500">{r.ai_rationale}</div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            className="input w-24"
            value={scores[r.answer_id] === "" ? "" : scores[r.answer_id]}
            onChange={(e) => onScore(r.answer_id, e.target.value)}
          />
          <span className="text-xs text-slate-400">/ {r.max_score}</span>
          <span
            className={`text-xs ${
              savedState[r.answer_id] === "saved"
                ? "font-medium text-emerald-600"
                : "text-slate-400"
            }`}
          >
            {savedState[r.answer_id] === "saving"
              ? "กำลังบันทึก…"
              : savedState[r.answer_id] === "saved"
              ? "✓ บันทึกแล้ว"
              : ""}
          </span>
        </div>
      </div>
    );
  }

  const s = students[active];
  const q = questionList[activeQ];

  // Rows for the active question (question mode): each student's answer to it.
  const qRows = useMemo(() => {
    if (!q) return [];
    return students
      .map((st) => {
        const r = st.answers.find((a) => a.question_order === q.order_index);
        return r ? { student: st, row: r } : null;
      })
      .filter((x): x is { student: StudentBlock; row: GradeRow } => x !== null);
  }, [students, q]);

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">การตรวจให้คะแนน</h2>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => router.refresh()}>
            รีเฟรชคำตอบ
          </button>
          {!showAi && (
            <button className="btn-ghost" onClick={() => setShowAi(true)}>
              เปิดใช้การตรวจล่วงหน้าด้วย AI
            </button>
          )}
          <a className="btn-ghost" href={`/api/export?examId=${examId}`}>
            ส่งออกคะแนน CSV
          </a>
          <a
            className="btn-ghost"
            href={`/api/export?examId=${examId}&mode=answers`}
            title="ส่งออกคำตอบทั้งหมดของนักศึกษา เพื่อนำไปตรวจนอกระบบ"
          >
            ส่งออกคำตอบทั้งหมด CSV
          </a>
        </div>
      </div>

      {/* Mode switch: grade one student at a time, or one question at a time. */}
      <div className="mt-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
        <button
          onClick={() => setMode("student")}
          className={`rounded-md px-3 py-1 font-medium transition ${
            mode === "student"
              ? "bg-white text-brand shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          ทีละคน (ทุกข้อของนักศึกษาคนหนึ่ง)
        </button>
        <button
          onClick={() => setMode("question")}
          className={`rounded-md px-3 py-1 font-medium transition ${
            mode === "question"
              ? "bg-white text-brand shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          ทีละข้อ (คำตอบข้อเดียวกันของทุกคน)
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {mode === "student"
          ? "ตรวจทีละคน: เห็นทุกคำตอบของนักศึกษาหนึ่งคน เหมาะกับการดูภาพรวมของแต่ละคน"
          : "ตรวจทีละข้อ: เห็นคำตอบของทุกคนในข้อเดียวกัน ให้คะแนนได้สม่ำเสมอเพราะเป็นโจทย์เดียวกัน"}
        {" "}ระบบบันทึกให้อัตโนมัติ (ไม่ต้องกดยืนยันทีละข้อ)
      </p>

      {showAi && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="text-xs font-medium text-slate-600">
            Anthropic API key ของคุณ
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              type="password"
              className="input w-72"
              placeholder="sk-ant-..."
              value={apiKey}
              autoComplete="off"
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button className="btn-primary px-3 py-1" disabled={busy} onClick={runAi}>
              {busy ? `กำลังตรวจ… (${progress} ข้อ)` : "เริ่มตรวจด้วย AI"}
            </button>
            <button className="btn-ghost px-3 py-1" onClick={() => setShowAi(false)}>
              ยกเลิก
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            คีย์ใช้สำหรับการตรวจครั้งนี้เท่านั้นและไม่ถูกจัดเก็บ ค่าใช้จ่ายคิดกับผู้ที่กดตรวจ
          </p>
        </div>
      )}

      {students.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">
          ยังไม่มีการส่งคำตอบ การตรวจให้คะแนนจะพร้อมใช้งานหลังจากนักศึกษาเข้าสอบ
        </p>
      ) : mode === "student" ? (
        /* ================= BY STUDENT ================= */
        <>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {students.map((st, i) => {
              const done =
                st.answers.length > 0 &&
                st.answers.every((r) => isGraded(r.answer_id));
              return (
                <button
                  key={st.student_id}
                  onClick={() => setActive(i)}
                  title={st.name}
                  className={`relative flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm font-medium transition ${
                    i === active
                      ? "border-brand bg-brand text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-brand hover:text-brand"
                  }`}
                >
                  {i + 1}
                  {done && (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-md border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-slate-800">
                  {s.name}
                  {s.student_code && (
                    <span className="ml-2 badge bg-brand-light text-brand-dark">
                      รหัส {s.student_code}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400">{s.email}</div>
              </div>
              <div className="text-xs text-slate-500">
                ตรวจแล้ว {s.answers.filter((r) => isGraded(r.answer_id)).length} /{" "}
                {s.answers.length} ข้อ
              </div>
            </div>

            <div className="mt-3 space-y-3">
              {s.answers.map((r) => (
                <AnswerCard
                  key={r.answer_id}
                  r={r}
                  heading={`ข้อ ${r.question_order + 1}`}
                  subheading={`เต็ม ${r.max_score}`}
                />
              ))}
            </div>

            <div className="mt-3">
              <button
                className="btn-ghost px-3 py-1 text-sm"
                onClick={() => saveMany(s.answers.map((r) => r.answer_id))}
              >
                บันทึกคะแนนทั้งหมดของคนนี้
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              className="btn-ghost"
              disabled={active === 0}
              onClick={() => setActive((a) => Math.max(0, a - 1))}
            >
              ← คนก่อนหน้า
            </button>
            <span className="text-sm text-slate-500">
              คนที่ {active + 1} / {students.length}
            </span>
            <button
              className="btn-ghost"
              disabled={active >= students.length - 1}
              onClick={() => setActive((a) => Math.min(students.length - 1, a + 1))}
            >
              คนถัดไป →
            </button>
          </div>
        </>
      ) : (
        /* ================= BY QUESTION ================= */
        <>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {questionList.map((qq, i) => {
              const rows = students
                .map((st) => st.answers.find((a) => a.question_order === qq.order_index))
                .filter(Boolean) as GradeRow[];
              const done =
                rows.length > 0 && rows.every((r) => isGraded(r.answer_id));
              return (
                <button
                  key={qq.order_index}
                  onClick={() => setActiveQ(i)}
                  title={`ข้อ ${qq.order_index + 1}`}
                  className={`relative flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm font-medium transition ${
                    i === activeQ
                      ? "border-brand bg-brand text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-brand hover:text-brand"
                  }`}
                >
                  {qq.order_index + 1}
                  {done && (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  )}
                </button>
              );
            })}
          </div>

          {q && (
            <div className="mt-4 rounded-md border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-slate-800">
                  ข้อ {q.order_index + 1}{" "}
                  <span className="text-xs font-normal text-slate-400">
                    · เต็ม {q.max_score}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  ตรวจแล้ว {qRows.filter(({ row }) => isGraded(row.answer_id)).length}{" "}
                  / {qRows.length} คน
                </div>
              </div>

              {/* Reference for consistent marking: stem + answer key + rubric. */}
              {(q.stem || q.answer_key || q.rubric?.length > 0) && (
                <div className="mt-3">
                  <button
                    className="text-xs font-medium text-brand hover:underline"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? "ซ่อนโจทย์และเฉลย ▲" : "แสดงโจทย์และเฉลย ▼"}
                  </button>
                  {showKey && (
                    <div className="mt-2 space-y-2 rounded-md border border-brand-light bg-brand-light/40 p-3 text-sm">
                      {q.stem && (
                        <div>
                          <div className="text-xs font-medium text-brand-dark">โจทย์</div>
                          <div className="whitespace-pre-wrap text-slate-700">
                            {q.stem}
                          </div>
                        </div>
                      )}
                      {q.answer_key && (
                        <div>
                          <div className="text-xs font-medium text-brand-dark">
                            เฉลย / คำตอบตัวอย่าง
                          </div>
                          <div className="whitespace-pre-wrap text-slate-700">
                            {q.answer_key}
                          </div>
                        </div>
                      )}
                      {q.rubric?.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-brand-dark">
                            เกณฑ์การให้คะแนน
                          </div>
                          <ul className="ml-4 list-disc text-slate-700">
                            {q.rubric.map((c, j) => (
                              <li key={j}>
                                {c.criterion} — {c.points} คะแนน
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 space-y-3">
                {qRows.map(({ student, row }) => (
                  <AnswerCard
                    key={row.answer_id}
                    r={row}
                    heading={
                      student.student_code
                        ? `${student.name} · ${student.student_code}`
                        : student.name
                    }
                    subheading={student.email}
                  />
                ))}
                {qRows.length === 0 && (
                  <p className="text-sm text-slate-400">ยังไม่มีคำตอบสำหรับข้อนี้</p>
                )}
              </div>

              <div className="mt-3">
                <button
                  className="btn-ghost px-3 py-1 text-sm"
                  onClick={() => saveMany(qRows.map(({ row }) => row.answer_id))}
                >
                  บันทึกคะแนนของข้อนี้ทั้งหมด
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <button
              className="btn-ghost"
              disabled={activeQ === 0}
              onClick={() => setActiveQ((a) => Math.max(0, a - 1))}
            >
              ← ข้อก่อนหน้า
            </button>
            <span className="text-sm text-slate-500">
              ข้อ {activeQ + 1} / {questionList.length}
            </span>
            <button
              className="btn-ghost"
              disabled={activeQ >= questionList.length - 1}
              onClick={() =>
                setActiveQ((a) => Math.min(questionList.length - 1, a + 1))
              }
            >
              ข้อถัดไป →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
