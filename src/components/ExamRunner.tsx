"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { VideoEmbed } from "@/components/VideoEmbed";
import type { Exam, Question } from "@/lib/types";

/**
 * The student's lockstep exam experience.
 *
 * Everything about timing is server-driven:
 *  - We read exams.current_question_index / current_started_at (live-updated
 *    via Supabase Realtime), never a local decision about which question is open.
 *  - We sync a clock offset against server_now() so a tampered device clock
 *    cannot change the displayed timer.
 *  - When the deadline passes, ANY client calls advance_if_due(); the server
 *    atomically advances once and Realtime flips everyone to the next question
 *    at the same moment.
 *  - Answers autosave to the server every couple of seconds, so a dropped
 *    connection never loses typed work.
 */
export function ExamRunner({
  examId,
  attemptId,
  initialExam,
  totalQuestions,
  watermark,
}: {
  examId: string;
  attemptId: string;
  initialExam: Exam;
  totalQuestions: number;
  watermark: string;
}) {
  const supabase = useRef(createClient());
  const [exam, setExam] = useState<Exam>(initialExam);
  const [question, setQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [startRemaining, setStartRemaining] = useState<number>(0);
  const [violations, setViolations] = useState(0);
  const [isFs, setIsFs] = useState(false);
  // Some devices (notably iPad / iOS, where every browser uses WebKit) do not
  // support the Fullscreen API for a page. On those we cannot show a fullscreen
  // kiosk lock, so we fall back to letting the student sit the exam while still
  // logging tab-switch / app-switch violations (visibilitychange + blur below).
  const [fsSupported, setFsSupported] = useState(true);

  const clockOffset = useRef(0); // serverNow - clientNow, in ms
  // Always-current copy of `exam`, so a callback scheduled a moment ago can
  // re-check the live state instead of the state captured when it was queued.
  const examRef = useRef<Exam>(initialExam);
  const lastAdvanceCall = useRef(0);
  const lastStartCall = useRef(0);
  const lastFocusFlag = useRef(0);
  const answerRef = useRef("");
  const dirty = useRef(false);
  const loadedIndex = useRef(-1);

  // Faint, tiled, diagonal identity watermark. Cannot stop screenshots, but
  // makes any leaked capture traceable to this student.
  const watermarkStyle = useMemo<CSSProperties>(() => {
    const safe = (watermark || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='520' height='210'>` +
      `<text x='26' y='120' transform='rotate(-18 260 105)' ` +
      `font-family='sans-serif' font-size='13' fill='rgba(15,23,42,0.075)'>` +
      `${safe}</text></svg>`;
    return {
      backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`,
      backgroundRepeat: "repeat",
    };
  }, [watermark]);

  // ---- sync clock offset with the server ----
  useEffect(() => {
    let alive = true;
    async function sync() {
      const t0 = Date.now();
      const { data } = await supabase.current.rpc("server_now");
      if (!alive || !data) return;
      const t1 = Date.now();
      const serverMs = new Date(data as string).getTime();
      // account for round-trip; assume symmetric latency
      clockOffset.current = serverMs - (t0 + (t1 - t0) / 2);
    }
    sync();
    const id = setInterval(sync, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const serverNow = () => Date.now() + clockOffset.current;

  useEffect(() => {
    examRef.current = exam;
  }, [exam]);

  // ---- subscribe to the exam row (the lockstep signal) ----
  useEffect(() => {
    const channel = supabase.current
      .channel(`exam-${examId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "exams",
          filter: `id=eq.${examId}`,
        },
        (payload) => setExam(payload.new as Exam)
      )
      .subscribe();
    return () => {
      supabase.current.removeChannel(channel);
    };
  }, [examId]);

  // ---- adaptive poll as a Realtime backstop ----
  // Realtime is the instant path, but it can lag or drop an event, which made
  // the next question appear seconds late, so a poll guarantees the flip.
  // A flat 1 s poll cost one request per student per second for the whole exam
  // (100 students = 100 req/s sustained, each one re-running the `read exams`
  // RLS policy and its two course_members lookups). The rate now follows the
  // clock: 5 s while there is time left, 1 s only in the closing seconds, which
  // is the only window where a late or dropped event is actually visible.
  useEffect(() => {
    if (exam.status === "closed" || exam.status === "released") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    // How soon could the exam row plausibly change?
    const nextDelay = () => {
      if (exam.status === "live" && exam.current_started_at && question) {
        const deadline =
          new Date(exam.current_started_at).getTime() +
          question.time_limit_seconds * 1000;
        if (deadline - serverNow() <= 12000) return 1000;
      }
      if (exam.status === "scheduled" && exam.scheduled_start) {
        const startsIn = new Date(exam.scheduled_start).getTime() - serverNow();
        if (startsIn <= 12000) return 1000;
      }
      return 5000;
    };

    const poll = async () => {
      const { data } = await supabase.current
        .from("exams")
        .select(
          "id,status,current_question_index,current_started_at,scheduled_start,buffer_seconds"
        )
        .eq("id", examId)
        .single();
      if (!alive) return;
      if (data) {
        const row = data as Exam;
        // Merge rather than replace (this is a narrowed select, so the columns
        // it does not fetch must survive), and return the previous object
        // untouched when nothing moved, so an unchanged poll costs no render.
        setExam((prev) =>
          prev.status === row.status &&
          prev.current_question_index === row.current_question_index &&
          prev.current_started_at === row.current_started_at &&
          prev.scheduled_start === row.scheduled_start
            ? prev
            : { ...prev, ...row }
        );
      }
      timer = setTimeout(poll, nextDelay());
    };

    timer = setTimeout(poll, nextDelay());
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    exam.status,
    exam.current_started_at,
    exam.scheduled_start,
    question,
    examId,
  ]);

  // ---- load the current question whenever the index changes ----
  useEffect(() => {
    if (exam.status !== "live") return;
    const idx = exam.current_question_index;
    if (idx < 0 || idx === loadedIndex.current) return;

    // moving on: flush the previous answer one last time (best effort)
    flushAnswer();

    loadedIndex.current = idx;
    setAnswer("");
    answerRef.current = "";
    dirty.current = false;
    setSavedAt(null);

    (async () => {
      const { data: q } = await supabase.current
        .from("questions")
        .select("*")
        .eq("exam_id", examId)
        .eq("order_index", idx)
        .single();
      if (q) setQuestion(q as Question);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.current_question_index, exam.status]);

  // ---- autosave (debounced) ----
  const flushAnswer = useCallback(async () => {
    if (!dirty.current || !question) return;
    dirty.current = false;
    const { error } = await supabase.current.from("answers").upsert(
      {
        attempt_id: attemptId,
        question_id: question.id,
        answer_text: answerRef.current,
      },
      { onConflict: "attempt_id,question_id" }
    );
    if (!error) setSavedAt(new Date());
    else dirty.current = true; // retry on next tick
  }, [attemptId, question]);

  useEffect(() => {
    const id = setInterval(flushAnswer, 2000);
    return () => clearInterval(id);
  }, [flushAnswer]);

  // save on unmount / tab close
  useEffect(() => {
    const handler = () => flushAnswer();
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      flushAnswer();
    };
  }, [flushAnswer]);

  // ---- the ticking timer + due check ----
  useEffect(() => {
    const id = setInterval(() => {
      if (exam.status !== "live" || !exam.current_started_at || !question) return;
      const started = new Date(exam.current_started_at).getTime();
      const deadline = started + question.time_limit_seconds * 1000;
      const left = Math.max(0, Math.round((deadline - serverNow()) / 1000));
      setRemaining(left);

      if (left <= 0 && Date.now() - lastAdvanceCall.current > 1500) {
        lastAdvanceCall.current = Date.now();
        const dueIndex = exam.current_question_index;
        flushAnswer().then(() => {
          // Every browser reaches zero inside the same 250 ms tick, so without a
          // spread all of them fire this RPC at the same instant and queue on a
          // single exam row lock. Wait a random moment, then skip the call
          // entirely if Realtime (or the poll) has already moved the exam on.
          // In practice only the first browser or two ever reach the server.
          window.setTimeout(() => {
            if (
              examRef.current.status !== "live" ||
              examRef.current.current_question_index !== dueIndex
            ) {
              return;
            }
            supabase.current.rpc("advance_if_due", { p_exam_id: examId });
          }, Math.random() * 800);
        });
      }
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.status, exam.current_started_at, question]);

  // ---- scheduled waiting room: count down and auto-start on time ----
  useEffect(() => {
    if (exam.status !== "scheduled" || !exam.scheduled_start) return;
    const startMs = new Date(exam.scheduled_start).getTime();
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((startMs - serverNow()) / 1000));
      setStartRemaining(left);
      if (left <= 0 && Date.now() - lastStartCall.current > 2000) {
        lastStartCall.current = Date.now();
        // Same herd as the advance call: the whole cohort sits in the waiting
        // room and reaches the scheduled time together.
        window.setTimeout(() => {
          if (examRef.current.status !== "scheduled") return;
          supabase.current.rpc("start_if_due", { p_exam_id: examId });
        }, Math.random() * 800);
      }
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.status, exam.scheduled_start]);

  // ---- mark the attempt submitted when the exam closes ----
  useEffect(() => {
    if (exam.status === "closed" || exam.status === "released") {
      flushAnswer();
      supabase.current
        .from("attempts")
        .update({ submitted_at: new Date().toISOString() })
        .eq("id", attemptId)
        .is("submitted_at", null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.status]);

  // ---- exam integrity / kiosk lockdown ----
  const recordViolation = useCallback(() => {
    // de-dupe: a tab switch fires several events at once
    if (Date.now() - lastFocusFlag.current < 1000) return;
    lastFocusFlag.current = Date.now();
    setViolations((v) => v + 1);
    supabase.current.rpc("record_focus_violation", { p_exam_id: examId });
  }, [examId]);

  // flag leaving the exam window (tab switch / minimise / lose focus)
  useEffect(() => {
    if (exam.status !== "live") return;
    const onVis = () => {
      if (document.visibilityState === "hidden") recordViolation();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", recordViolation);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", recordViolation);
    };
  }, [exam.status, recordViolation]);

  // detect whether this device can do page fullscreen at all (iPad/iOS cannot)
  useEffect(() => {
    setFsSupported(
      typeof document.documentElement.requestFullscreen === "function" &&
        document.fullscreenEnabled !== false
    );
  }, []);

  // require fullscreen; exiting fullscreen mid-exam re-locks and counts.
  // Only meaningful where fullscreen is supported; on iPad this never fires.
  useEffect(() => {
    const onFs = () => {
      const fs = !!document.fullscreenElement;
      setIsFs(fs);
      if (!fs && fsSupported && exam.status === "live") recordViolation();
    };
    document.addEventListener("fullscreenchange", onFs);
    setIsFs(!!document.fullscreenElement);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [exam.status, recordViolation, fsSupported]);

  // block copy / paste / cut / right-click during the exam
  useEffect(() => {
    if (exam.status !== "live") return;
    const prevent = (e: Event) => e.preventDefault();
    const evs = ["contextmenu", "copy", "cut", "paste"];
    evs.forEach((ev) => document.addEventListener(ev, prevent));
    return () => evs.forEach((ev) => document.removeEventListener(ev, prevent));
  }, [exam.status]);

  function enterFullscreen() {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  // ---------- render ----------
  if (exam.status === "closed" || exam.status === "released") {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center px-4">
        <div className="card w-full text-center">
          <div className="text-5xl">✓</div>
          <h1 className="mt-3 text-2xl font-bold">เสร็จสิ้น</h1>
          <p className="mt-3 text-slate-600">
            ส่งข้อสอบเรียบร้อยแล้ว ทุกคำตอบที่คุณพิมพ์ถูกบันทึกโดยอัตโนมัติ
            คุณไม่ต้องทำอะไรเพิ่มเติม
          </p>
          <p className="mt-4 text-sm text-slate-400">
            อาจารย์จะประกาศผลสอบให้ทราบ คุณสามารถปิดหน้านี้ได้อย่างปลอดภัย
          </p>
        </div>
      </div>
    );
  }

  if (exam.status === "scheduled") {
    const h = Math.floor(startRemaining / 3600);
    const m = Math.floor((startRemaining % 3600) / 60);
    const s = startRemaining % 60;
    const p = (n: number) => String(n).padStart(2, "0");
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center px-4">
        <div className="card w-full text-center">
          <div className="text-5xl">⏳</div>
          <h1 className="mt-3 text-2xl font-bold">ห้องรอสอบ</h1>
          <p className="mt-2 text-slate-600">
            การสอบจะเริ่มโดยอัตโนมัติเมื่อถึงเวลา เปิดหน้านี้ค้างไว้ ไม่ต้องรีเฟรช
          </p>
          {exam.scheduled_start && (
            <p className="mt-4 text-sm text-slate-500">
              เวลาเริ่มสอบ:{" "}
              {new Date(exam.scheduled_start).toLocaleString("th-TH", {
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              น.
            </p>
          )}
          <div className="mt-4 inline-block rounded-lg bg-brand-light px-6 py-3 font-mono text-4xl font-bold text-brand-dark">
            {h > 0 ? `${p(h)}:` : ""}
            {p(m)}:{p(s)}
          </div>
          <p className="mt-3 text-xs text-slate-400">เหลือเวลาก่อนเริ่มสอบ</p>
        </div>
      </div>
    );
  }

  if (exam.status !== "live" || !question) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center px-4">
        <div className="card w-full text-center">
          <div className="text-5xl">⏳</div>
          <h1 className="mt-3 text-2xl font-bold">รอเริ่มการสอบ</h1>
          <p className="mt-3 text-slate-600">
            เปิดหน้านี้ค้างไว้ ระบบจะเริ่มการสอบให้เองทันทีที่อาจารย์กดเริ่มสอบ
            คุณไม่ต้องรีเฟรชหน้า
          </p>
        </div>
      </div>
    );
  }

  // Kiosk lock: the exam content is only shown in fullscreen.
  // Skipped on devices without the Fullscreen API (iPad/iOS) so they are not
  // locked out; leaving the exam is still logged via visibilitychange/blur.
  if (exam.status === "live" && fsSupported && !isFs) {
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-2xl items-center px-4">
        <div className="card w-full text-center">
          <div className="text-5xl">🔒</div>
          <h1 className="mt-3 text-2xl font-bold">โหมดสอบแบบล็อกหน้าจอ</h1>
          <p className="mt-3 text-slate-600">
            เพื่อความยุติธรรม การสอบนี้ต้องทำในโหมดเต็มจอ กดปุ่มด้านล่างเพื่อเข้าสู่
            โหมดเต็มจอและเริ่มทำข้อสอบ ห้ามออกจากเต็มจอ สลับแท็บ หรือคัดลอก/วาง
            ระหว่างสอบ ระบบจะบันทึกและแจ้งผู้คุมสอบ
          </p>
          <button className="btn-primary mt-5" onClick={enterFullscreen}>
            เข้าสู่โหมดเต็มจอเพื่อเริ่มสอบ
          </button>
          {violations > 0 && (
            <p className="mt-3 text-sm font-medium text-red-600">
              ⚠ ตรวจพบการออกจากหน้าสอบ {violations} ครั้ง
            </p>
          )}
        </div>
      </div>
    );
  }

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const low = remaining <= 30;
  const veryLow = remaining <= 10;
  const idx = exam.current_question_index;
  const locked = remaining <= 0; // time's up: stop accepting input immediately

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* traceable identity watermark tiled over the whole exam viewport */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-40"
        style={watermarkStyle}
      />
      {violations > 0 && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          ⚠ ตรวจพบว่าคุณออกจากหน้าสอบ {violations} ครั้ง
          การสลับแท็บหรือออกจากหน้าจอถูกบันทึกและแจ้งผู้คุมสอบ
          กรุณาอยู่ในหน้าสอบตลอดเวลา
        </div>
      )}
      {/* progress + timer */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-700">
            ข้อ {idx + 1} จาก {totalQuestions}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {Array.from({ length: totalQuestions }).map((_, i) => (
              <span
                key={i}
                className={`h-2.5 rounded-full transition-all ${
                  i < idx
                    ? "w-2.5 bg-brand"
                    : i === idx
                    ? "w-6 bg-brand"
                    : "w-2.5 bg-slate-200"
                }`}
              />
            ))}
          </div>
        </div>
        <div
          className={`rounded-lg px-4 py-2 text-center ${
            veryLow
              ? "animate-pulse bg-red-100 text-red-700"
              : low
              ? "bg-amber-100 text-amber-700"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          <div className="font-mono text-3xl font-bold leading-none">
            {mins}:{secs.toString().padStart(2, "0")}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wide">
            เวลาที่เหลือ
          </div>
        </div>
      </div>

      {low && (
        <div
          className={`mt-3 rounded-md px-3 py-2 text-sm ${
            veryLow ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {veryLow
            ? "ข้อนี้จะล็อกในอีกไม่กี่วินาที รีบเขียนคำตอบให้เสร็จ"
            : "เหลือเวลาไม่ถึง 30 วินาที ข้อนี้จะล็อกและเลื่อนไปข้อถัดไปเมื่อหมดเวลา"}
        </div>
      )}

      {/* question — block selection/copy of the prompt (incl. iOS long-press
          callout); the answer textarea below stays fully editable */}
      <div
        className="card mt-4 select-none"
        style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
      >
        <div className="whitespace-pre-wrap text-lg leading-relaxed text-slate-800">
          {question.stem}
        </div>
        {(question.image_urls?.length
          ? question.image_urls
          : question.image_url
          ? [question.image_url]
          : []
        ).map((u, k) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={k}
            src={u}
            alt="รูปประกอบคำถาม"
            className="mt-4 max-h-96 rounded-md border"
          />
        ))}
        {(question.video_urls ?? []).map((u, k) => (
          <div key={`v-${k}`} className="mt-4">
            <VideoEmbed url={u} />
          </div>
        ))}
      </div>

      {/* answer */}
      <label className="mt-5 block text-sm font-medium text-slate-600">
        คำตอบของคุณ
      </label>
      <textarea
        className={`input mt-1 min-h-[300px] font-serif text-base leading-relaxed ${
          locked ? "cursor-not-allowed bg-slate-100 opacity-70" : ""
        }`}
        placeholder="พิมพ์คำตอบของคุณที่นี่…"
        value={answer}
        disabled={locked}
        onChange={(e) => {
          setAnswer(e.target.value);
          answerRef.current = e.target.value;
          dirty.current = true;
        }}
        autoFocus
      />
      {locked && (
        <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          หมดเวลาข้อนี้แล้ว กำลังไปข้อถัดไป…
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-slate-400">
          เมื่อหมดเวลาแล้วจะไม่สามารถกลับมาตอบข้อนี้ได้อีก
        </span>
        <span
          className={
            savedAt ? "font-medium text-emerald-600" : "text-slate-400"
          }
        >
          {savedAt
            ? `✓ บันทึกแล้ว ${savedAt.toLocaleTimeString()}`
            : dirty.current
            ? "กำลังบันทึก…"
            : "ยังไม่ได้บันทึก"}
        </span>
      </div>
    </div>
  );
}
