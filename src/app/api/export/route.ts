import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const examId = url.searchParams.get("examId");
  // mode=answers exports every student's full written answer (one row per
  // answer) so a lecturer can grade outside the platform. Default is the
  // score gradebook (one row per student).
  const mode = url.searchParams.get("mode") === "answers" ? "answers" : "scores";
  if (!examId) return new NextResponse("examId required", { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorised", { status: 401 });

  const { data: exam } = await supabase
    .from("exams")
    .select("course_id, title")
    .eq("id", examId)
    .single();
  if (!exam) return new NextResponse("Exam not found", { status: 404 });

  const { data: isStaff } = await supabase.rpc("is_exam_staff", {
    p_exam_id: examId,
  });
  if (!isStaff) return new NextResponse("Forbidden", { status: 403 });

  const svc = createServiceClient();
  const { data: attempts } = await svc
    .from("attempts")
    .select("id, student_id, joined_at, submitted_at, profiles(email, full_name, student_code)")
    .eq("exam_id", examId)
    .order("joined_at");

  const attemptIds = (attempts ?? []).map((a: any) => a.id);
  const { data: answers } = attemptIds.length
    ? await svc
        .from("answers")
        .select(
          "attempt_id, answer_text, questions(order_index, stem, max_score), grades(final_score, ai_score)"
        )
        .in("attempt_id", attemptIds)
    : { data: [] as any[] };

  // Determine question count for column headers.
  const { data: qs } = await svc
    .from("questions")
    .select("order_index, stem, max_score")
    .eq("exam_id", examId)
    .order("order_index");
  const nQ = (qs ?? []).length;

  const safe =
    exam.title.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "exam";

  // ---- mode=answers: one row per (student, question) with the full answer ----
  if (mode === "answers") {
    const aHeader = [
      "รหัสนักศึกษา",
      "ชื่อนักศึกษา",
      "อีเมล",
      "ข้อที่",
      "โจทย์",
      "คำตอบของนักศึกษา",
      "คะแนนเต็ม",
      "คะแนน AI",
      "คะแนนที่ให้",
    ];
    const aLines = [aHeader.map(csvCell).join(",")];
    for (const a of attempts ?? []) {
      const p = (a as any).profiles;
      const rows = (answers ?? []).filter((x: any) => x.attempt_id === a.id);
      for (const q of qs ?? []) {
        const r = rows.find((x: any) => x.questions?.order_index === q.order_index);
        const g = r ? (Array.isArray(r.grades) ? r.grades[0] : r.grades) : null;
        aLines.push(
          [
            p?.student_code ?? "",
            p?.full_name ?? "",
            p?.email ?? "",
            (q as any).order_index + 1,
            (q as any).stem ?? "",
            r?.answer_text ?? "",
            (q as any).max_score ?? "",
            g?.ai_score ?? "",
            g?.final_score ?? "",
          ]
            .map(csvCell)
            .join(",")
        );
      }
    }
    const answersCsv = "﻿" + aLines.join("\n");
    return new NextResponse(answersCsv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${safe}_answers.csv"`,
      },
    });
  }

  const header = [
    "ชื่อนักศึกษา",
    "รหัสนักศึกษา",
    "อีเมล",
    "เวลาเข้าสอบ",
    "เวลาส่ง",
    ...Array.from({ length: nQ }, (_, i) => `ข้อ ${i + 1}`),
    "คะแนนรวม",
    "คะแนนเต็ม",
  ];

  const lines = [header.map(csvCell).join(",")];

  for (const a of attempts ?? []) {
    const rows = (answers ?? []).filter((x: any) => x.attempt_id === a.id);
    const perQ: (number | string)[] = Array.from({ length: nQ }, () => "");
    let total = 0;
    for (const r of rows) {
      const g = Array.isArray(r.grades) ? r.grades[0] : r.grades;
      const idx = r.questions?.order_index ?? 0;
      const score = g?.final_score ?? g?.ai_score ?? "";
      perQ[idx] = score;
      total += Number(g?.final_score ?? 0);
    }
    const max = (qs ?? []).reduce((s: number, q: any) => s + Number(q.max_score), 0);
    const p = (a as any).profiles;
    lines.push(
      [
        p?.full_name ?? "",
        p?.student_code ?? "",
        p?.email ?? "",
        a.joined_at ?? "",
        a.submitted_at ?? "",
        ...perQ,
        total,
        max,
      ]
        .map(csvCell)
        .join(",")
    );
  }

  // Prepend a UTF-8 BOM so Excel opens the Thai text without garbling it.
  const csv = "﻿" + lines.join("\n");
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safe}_results.csv"`,
    },
  });
}
