"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Question, RubricCriterion } from "@/lib/types";
import { VideoEmbed } from "@/components/VideoEmbed";

const blank = (order: number): Partial<Question> => ({
  order_index: order,
  stem: "",
  answer_key: "",
  rubric: [],
  image_urls: [],
  video_urls: [],
  max_score: 10,
  time_limit_seconds: 300,
});

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // keep uploaded images under 5 MB

/**
 * Shrink and re-encode an image in the browser so uploads stay small.
 * Scales the longest side down to `maxDim`, then steps JPEG quality down until
 * the result is under MAX_UPLOAD_BYTES. Returns a JPEG blob.
 */
async function compressImage(file: File, maxDim = 1600): Promise<Blob> {
  const dataUrl: string = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });

  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.fillStyle = "#fff"; // flatten any transparency for JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const toBlob = (q: number) =>
    new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));

  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await toBlob(q);
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
    if (q === 0.4 && blob) return blob; // best effort at lowest quality
  }
  return file;
}

export function QuestionEditor({
  examId,
  editable,
  initial,
}: {
  examId: string;
  editable: boolean;
  initial: Question[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Partial<Question>[]>(
    initial.length ? initial : [blank(0)]
  );
  // Per-question edit state: which have unsaved changes, which were just saved.
  const [dirty, setDirty] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const savedSnapshot = useRef<Record<string, Partial<Question>>>(
    Object.fromEntries(initial.map((q) => [q.id, q]))
  );
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [uploading, setUploading] = useState<Record<number, boolean>>({});

  // Warn before leaving the page while any question has unsaved edits.
  useEffect(() => {
    if (!Object.values(dirty).some(Boolean)) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Highlight the question nearest the viewport centre as the active one.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setActiveIdx(Number((e.target as HTMLElement).dataset.idx));
          }
        });
      },
      { rootMargin: "-40% 0px -55% 0px" }
    );
    cardRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [rows.length]);

  function scrollToQuestion(i: number) {
    cardRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function addQuestion() {
    setRows((r) => [...r, blank(r.length)]);
  }

  function update(i: number, patch: Partial<Question>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    setDirty((d) => ({ ...d, [i]: true }));
    setSaved((s) => ({ ...s, [i]: false }));
  }

  function discard(i: number) {
    const row = rows[i];
    if (row.id && savedSnapshot.current[row.id]) {
      const snap = savedSnapshot.current[row.id];
      setRows((r) => r.map((x, idx) => (idx === i ? { ...snap } : x)));
      setDirty((d) => ({ ...d, [i]: false }));
      setSaved((s) => ({ ...s, [i]: false }));
    } else {
      // An unsaved new question — just remove it.
      setRows((r) => r.filter((_, idx) => idx !== i));
      setDirty({});
      setSaved({});
    }
  }

  function addRubric(i: number) {
    const row = rows[i];
    const rubric = [...((row.rubric as RubricCriterion[]) ?? []), { criterion: "", points: 0 }];
    update(i, { rubric });
  }
  function setRubric(i: number, j: number, patch: Partial<RubricCriterion>) {
    const rubric = ((rows[i].rubric as RubricCriterion[]) ?? []).map((c, idx) =>
      idx === j ? { ...c, ...patch } : c
    );
    update(i, { rubric });
  }
  function removeRubric(i: number, j: number) {
    const rubric = ((rows[i].rubric as RubricCriterion[]) ?? []).filter(
      (_, idx) => idx !== j
    );
    update(i, { rubric });
  }

  function addImage(i: number) {
    const image_urls = [...((rows[i].image_urls as string[]) ?? []), ""];
    update(i, { image_urls });
  }
  function setImage(i: number, j: number, val: string) {
    const image_urls = ((rows[i].image_urls as string[]) ?? []).map((u, idx) =>
      idx === j ? val : u
    );
    update(i, { image_urls });
  }
  function removeImage(i: number, j: number) {
    const image_urls = ((rows[i].image_urls as string[]) ?? []).filter(
      (_, idx) => idx !== j
    );
    update(i, { image_urls });
  }

  // Compress an image in the browser, upload it to Supabase Storage, and append
  // the resulting public URL to this question's image list (alongside any
  // pasted links). No answer/database schema change: it is still just a URL.
  async function uploadImage(i: number, file: File) {
    if (!file.type.startsWith("image/")) {
      alert("กรุณาเลือกไฟล์รูปภาพ");
      return;
    }
    setUploading((u) => ({ ...u, [i]: true }));
    try {
      const blob = await compressImage(file);
      const supabase = createClient();
      const path = `${examId}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage
        .from("question-media")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) {
        alert("อัปโหลดรูปไม่สำเร็จ: " + error.message);
        return;
      }
      const { data } = supabase.storage.from("question-media").getPublicUrl(path);
      const image_urls = [
        ...((rows[i].image_urls as string[]) ?? []),
        data.publicUrl,
      ];
      update(i, { image_urls });
    } finally {
      setUploading((u) => ({ ...u, [i]: false }));
    }
  }

  function addVideo(i: number) {
    const video_urls = [...((rows[i].video_urls as string[]) ?? []), ""];
    update(i, { video_urls });
  }
  function setVideo(i: number, j: number, val: string) {
    const video_urls = ((rows[i].video_urls as string[]) ?? []).map((u, idx) =>
      idx === j ? val : u
    );
    update(i, { video_urls });
  }
  function removeVideo(i: number, j: number) {
    const video_urls = ((rows[i].video_urls as string[]) ?? []).filter(
      (_, idx) => idx !== j
    );
    update(i, { video_urls });
  }

  async function save(i: number) {
    const row = rows[i];
    // If an itemised rubric is used, its points must sum to the question total.
    const rubric = (row.rubric as RubricCriterion[]) ?? [];
    if (rubric.length > 0) {
      const sum = rubric.reduce((s, c) => s + (Number(c.points) || 0), 0);
      const maxS = Number(row.max_score) || 0;
      if (sum !== maxS) {
        alert(
          `ผลรวมคะแนนเกณฑ์ย่อย (${sum}) ไม่เท่ากับคะแนนเต็มของข้อนี้ (${maxS})\n` +
            `กรุณาปรับคะแนนเกณฑ์ย่อยหรือคะแนนเต็มให้เท่ากันก่อนบันทึก`
        );
        return;
      }
    }
    const supabase = createClient();
    const payload = {
      exam_id: examId,
      order_index: row.order_index,
      stem: row.stem ?? "",
      answer_key: row.answer_key ?? "",
      rubric: row.rubric ?? [],
      max_score: Number(row.max_score) || 0,
      time_limit_seconds: Number(row.time_limit_seconds) || 60,
      image_urls: ((row.image_urls as string[]) ?? []).filter((u) => u.trim()),
      video_urls: ((row.video_urls as string[]) ?? []).filter((u) => u.trim()),
    };
    let savedId = row.id;
    if (row.id) {
      await supabase.from("questions").update(payload).eq("id", row.id);
    } else {
      const { data } = await supabase
        .from("questions")
        .insert(payload)
        .select("id")
        .single();
      if (data) {
        savedId = data.id;
        setRows((r) => r.map((x, idx) => (idx === i ? { ...x, id: data.id } : x)));
      }
    }
    if (savedId) savedSnapshot.current[savedId] = { ...payload, id: savedId };
    setDirty((d) => ({ ...d, [i]: false }));
    setSaved((s) => ({ ...s, [i]: true }));
    router.refresh();
  }

  async function del(i: number) {
    const row = rows[i];
    if (row.id) {
      const supabase = createClient();
      await supabase.from("questions").delete().eq("id", row.id);
    }
    setRows((r) => r.filter((_, idx) => idx !== i));
    setDirty({});
    setSaved({});
    router.refresh();
  }

  return (
    <div className="flex gap-4">
      {/* Sticky question navigator: jump to any question, grows as you add. */}
      <nav className="sticky top-20 hidden h-fit shrink-0 flex-col gap-2 sm:flex">
        <span className="mb-1 text-center text-[10px] font-medium uppercase tracking-wide text-slate-400">
          ข้อ
        </span>
        {rows.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => scrollToQuestion(i)}
            className={`relative flex h-9 w-9 items-center justify-center rounded-md border text-sm font-medium transition ${
              activeIdx === i
                ? "border-brand bg-brand text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-brand hover:text-brand"
            }`}
            title={`ไปยังข้อ ${i + 1}`}
          >
            {i + 1}
            {dirty[i] && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500" />
            )}
          </button>
        ))}
        {editable && (
          <button
            type="button"
            onClick={addQuestion}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-slate-300 text-lg leading-none text-slate-400 hover:border-brand hover:text-brand"
            title="เพิ่มคำถาม"
          >
            +
          </button>
        )}
      </nav>

      {/* Question cards */}
      <div className="min-w-0 flex-1 space-y-4">
        {rows.map((row, i) => (
          <div
            key={row.id ?? `new-${i}`}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            data-idx={i}
            className="card scroll-mt-4"
          >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">ข้อ {i + 1}</h3>
            {editable && (
              <button
                className="text-xs text-red-500 hover:underline"
                onClick={() => del(i)}
              >
                ลบ
              </button>
            )}
          </div>

          <label className="label mt-3">โจทย์คำถาม</label>
          <textarea
            className="input min-h-[80px]"
            value={row.stem ?? ""}
            disabled={!editable}
            onChange={(e) => update(i, { stem: e.target.value })}
          />

          <label className="label mt-3">
            รูปภาพประกอบ (ถ้ามี) — ใส่ได้หลายลิงก์
          </label>
          <div className="space-y-2">
            {((row.image_urls as string[]) ?? []).map((u, j) => (
              <div key={j} className="rounded-md border border-slate-200 p-2">
                <div className="flex items-center gap-2">
                  <input
                    className="input flex-1"
                    placeholder="https://…"
                    value={u}
                    disabled={!editable}
                    onChange={(e) => setImage(i, j, e.target.value)}
                  />
                  {editable && (
                    <button
                      className="shrink-0 text-xs text-red-500 hover:underline"
                      onClick={() => removeImage(i, j)}
                    >
                      ลบ
                    </button>
                  )}
                </div>
                {u.trim() && (
                  <div className="mt-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u}
                      alt="ตัวอย่างรูปภาพ"
                      className="max-h-48 rounded border border-slate-200"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      หากไม่เห็นรูป แสดงว่าลิงก์อาจไม่ถูกต้อง
                    </p>
                  </div>
                )}
              </div>
            ))}
            {editable && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="btn-ghost px-3 py-1 text-sm"
                  onClick={() => addImage(i)}
                >
                  + เพิ่มลิงก์รูปภาพ
                </button>
                <label
                  className={`btn-ghost cursor-pointer px-3 py-1 text-sm ${
                    uploading[i] ? "pointer-events-none opacity-60" : ""
                  }`}
                >
                  {uploading[i] ? "กำลังอัปโหลด…" : "⬆ อัปโหลดรูปจากเครื่อง"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadImage(i, f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <span className="text-xs text-slate-400">
                  ระบบจะย่อขนาดรูปให้อัตโนมัติ (ไม่เกิน 5 MB)
                </span>
              </div>
            )}
          </div>

          <label className="label mt-3">
            วิดีโอประกอบ (ถ้ามี) — ใส่ลิงก์ YouTube, Google Drive หรือไฟล์วิดีโอ
          </label>
          <div className="space-y-2">
            {((row.video_urls as string[]) ?? []).map((u, j) => (
              <div key={j} className="rounded-md border border-slate-200 p-2">
                <div className="flex items-center gap-2">
                  <input
                    className="input flex-1"
                    placeholder="https://youtu.be/…"
                    value={u}
                    disabled={!editable}
                    onChange={(e) => setVideo(i, j, e.target.value)}
                  />
                  {editable && (
                    <button
                      className="shrink-0 text-xs text-red-500 hover:underline"
                      onClick={() => removeVideo(i, j)}
                    >
                      ลบ
                    </button>
                  )}
                </div>
                {u.trim() && <VideoEmbed url={u} />}
              </div>
            ))}
            {editable && (
              <button
                className="btn-ghost px-3 py-1 text-sm"
                onClick={() => addVideo(i)}
              >
                + เพิ่มลิงก์วิดีโอ
              </button>
            )}
          </div>

          <label className="label mt-3">เฉลย / คำตอบตัวอย่าง</label>
          <textarea
            className="input min-h-[180px]"
            value={row.answer_key ?? ""}
            disabled={!editable}
            onChange={(e) => update(i, { answer_key: e.target.value })}
          />

          <label className="label mt-3">เกณฑ์การให้คะแนน (ถ้ามี)</label>
          <p className="mb-2 text-xs text-slate-500">
            แบ่งคะแนนออกเป็นเกณฑ์ย่อย (เช่น &ldquo;ระบุเชื้อก่อโรคถูกต้อง &mdash; 2
            คะแนน&rdquo;) ใช้เป็นแนวทางในการตรวจของคุณเอง และหากเปิดใช้การตรวจ
            ล่วงหน้าด้วย AI ระบบจะให้คะแนนตามเกณฑ์เหล่านี้ หากเว้นว่างไว้
            จะเป็นการให้คะแนนแบบภาพรวมจากคะแนนเต็ม
          </p>
          <div className="space-y-3">
            {((row.rubric as RubricCriterion[]) ?? []).length === 0 && !editable && (
              <p className="text-xs text-slate-400">ยังไม่ได้ตั้งเกณฑ์การให้คะแนน</p>
            )}
            {((row.rubric as RubricCriterion[]) ?? []).map((c, j) => (
              <div key={j} className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">
                    เกณฑ์ที่ {j + 1}
                  </span>
                  {editable && (
                    <button
                      className="text-xs text-red-500 hover:underline"
                      onClick={() => removeRubric(i, j)}
                    >
                      ลบเกณฑ์นี้
                    </button>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_110px]">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">
                      รายละเอียดเกณฑ์ (สิ่งที่นักศึกษาต้องตอบให้ได้คะแนน)
                    </label>
                    <input
                      className="input"
                      placeholder="เช่น ระบุจุดควบคุมวิกฤต (CCP) ได้ถูกต้อง"
                      value={c.criterion}
                      disabled={!editable}
                      onChange={(e) =>
                        setRubric(i, j, { criterion: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">
                      คะแนน
                    </label>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      placeholder="เช่น 2"
                      value={c.points}
                      disabled={!editable}
                      onChange={(e) =>
                        setRubric(i, j, { points: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
            {editable && (
              <button
                className="btn-ghost px-3 py-1 text-sm"
                onClick={() => addRubric(i)}
              >
                + เพิ่มเกณฑ์การให้คะแนน
              </button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label">คะแนนเต็ม</label>
              <input
                className="input"
                type="number"
                value={row.max_score ?? 0}
                disabled={!editable}
                onChange={(e) =>
                  update(i, { max_score: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <label className="label">เวลาต่อข้อ (วินาที)</label>
              <input
                className="input"
                type="number"
                value={row.time_limit_seconds ?? 0}
                disabled={!editable}
                onChange={(e) =>
                  update(i, { time_limit_seconds: Number(e.target.value) })
                }
              />
            </div>
          </div>

          {(() => {
            const items = (row.rubric as RubricCriterion[]) ?? [];
            if (items.length === 0) return null;
            const sum = items.reduce((s, c) => s + (Number(c.points) || 0), 0);
            const maxS = Number(row.max_score) || 0;
            const match = sum === maxS;
            return (
              <div
                className={`mt-3 rounded-md px-3 py-2 text-xs font-medium ${
                  match
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-red-50 text-red-700"
                }`}
              >
                รวมคะแนนเกณฑ์ย่อย {sum} / คะแนนเต็ม {maxS}
                {match
                  ? " ✓ ตรงกัน"
                  : sum < maxS
                  ? " — ยังไม่ครบคะแนนเต็ม"
                  : " — เกินคะแนนเต็ม"}
              </div>
            );
          })()}

          {editable && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="btn-primary" onClick={() => save(i)}>
                บันทึกคำถาม
              </button>
              {dirty[i] ? (
                <>
                  <span className="text-xs font-medium text-amber-600">
                    ● มีการแก้ไขที่ยังไม่บันทึก
                  </span>
                  <button
                    className="text-xs text-slate-500 hover:underline"
                    onClick={() => discard(i)}
                  >
                    ละทิ้งการแก้ไข
                  </button>
                </>
              ) : (
                saved[i] && (
                  <span className="text-xs font-medium text-emerald-600">
                    ✓ บันทึกแล้ว
                  </span>
                )
              )}
            </div>
          )}
        </div>
      ))}

        {editable && (
          <button className="btn-ghost" onClick={addQuestion}>
            + เพิ่มคำถามอีกข้อ
          </button>
        )}
      </div>
    </div>
  );
}
