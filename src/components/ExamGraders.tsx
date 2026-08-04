"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Lecturer {
  user_id: string;
  full_name: string | null;
  email: string;
}

/**
 * Per-exam grading permission control (co-teaching).
 * Shared by default: every course lecturer can grade. The exam owner can switch
 * to "restricted" and pick which lecturers may view + help grade this exam.
 */
export function ExamGraders({
  examId,
  restricted: initialRestricted,
  lecturers,
  graderIds,
  creatorId,
  isOwner,
}: {
  examId: string;
  restricted: boolean;
  lecturers: Lecturer[];
  graderIds: string[];
  creatorId: string | null;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [restricted, setRestricted] = useState(initialRestricted);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(graderIds)
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(id: string) {
    setSaved(false);
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function save() {
    setBusy(true);
    setSaved(false);
    const supabase = createClient();
    // The owner always keeps access on the server side; send the chosen extras.
    const ids = Array.from(selected).filter((id) => id !== creatorId);
    const { error } = await supabase.rpc("set_exam_graders", {
      p_exam_id: examId,
      p_restricted: restricted,
      p_user_ids: ids,
    });
    setBusy(false);
    if (error) {
      alert("บันทึกสิทธิ์ไม่สำเร็จ: " + error.message);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const nameOf = (l: Lecturer) => l.full_name || l.email;

  // Read-only summary for lecturers who are not the owner.
  if (!isOwner) {
    return (
      <div className="card">
        <h2 className="font-semibold">สิทธิ์การตรวจข้อสอบ</h2>
        <p className="mt-1 text-sm text-slate-600">
          {restricted
            ? "ข้อสอบนี้จำกัดผู้ตรวจเฉพาะอาจารย์ที่เจ้าของข้อสอบเลือกไว้"
            : "อาจารย์ทุกคนในรายวิชานี้สามารถช่วยตรวจข้อสอบนี้ได้"}
        </p>
        <p className="mt-2 text-xs text-slate-400">
          เฉพาะเจ้าของข้อสอบ (ผู้สร้าง) เท่านั้นที่เปลี่ยนสิทธิ์นี้ได้
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="font-semibold">สิทธิ์การตรวจข้อสอบ</h2>
      <p className="mt-1 text-xs text-slate-500">
        เลือกว่าใครเห็นและช่วยตรวจข้อสอบนี้ได้ ค่าเริ่มต้นคืออาจารย์ทุกคนในรายวิชา
      </p>

      <div className="mt-3 space-y-2">
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-2 text-sm">
          <input
            type="radio"
            className="mt-0.5"
            checked={!restricted}
            onChange={() => {
              setRestricted(false);
              setSaved(false);
            }}
          />
          <span>
            <span className="font-medium text-slate-800">
              อาจารย์ทุกคนในรายวิชา
            </span>
            <span className="block text-xs text-slate-500">
              อาจารย์ทุกคนที่อยู่ในรายวิชานี้ช่วยตรวจได้ (แนะนำสำหรับการสอนร่วมกัน)
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-2 text-sm">
          <input
            type="radio"
            className="mt-0.5"
            checked={restricted}
            onChange={() => {
              setRestricted(true);
              setSaved(false);
            }}
          />
          <span>
            <span className="font-medium text-slate-800">
              จำกัดเฉพาะอาจารย์ที่เลือก
            </span>
            <span className="block text-xs text-slate-500">
              เฉพาะเจ้าของข้อสอบและอาจารย์ที่เลือกเท่านั้นที่เห็นและตรวจข้อสอบนี้ได้
            </span>
          </span>
        </label>
      </div>

      {restricted && (
        <div className="mt-3 rounded-md border border-slate-200 p-3">
          <div className="text-xs font-medium text-slate-500">
            อาจารย์ที่ตรวจข้อสอบนี้ได้
          </div>
          <ul className="mt-2 space-y-1.5 text-sm">
            {lecturers.map((l) => {
              const isCreator = l.user_id === creatorId;
              return (
                <li key={l.user_id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isCreator || selected.has(l.user_id)}
                    disabled={isCreator}
                    onChange={() => toggle(l.user_id)}
                  />
                  <span className={isCreator ? "text-slate-500" : "text-slate-800"}>
                    {nameOf(l)}
                    {isCreator && (
                      <span className="ml-1 text-xs text-slate-400">(เจ้าของ)</span>
                    )}
                    <span className="ml-1 text-xs text-slate-400">({l.email})</span>
                  </span>
                </li>
              );
            })}
            {lecturers.length === 0 && (
              <li className="text-xs text-slate-400">
                ยังไม่มีอาจารย์ร่วมสอนในรายวิชานี้ เพิ่มได้ที่หน้ารายวิชา (สมาชิก)
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button className="btn-primary px-3 py-1 text-sm" onClick={save} disabled={busy}>
          {busy ? "กำลังบันทึก…" : "บันทึกสิทธิ์"}
        </button>
        {saved && (
          <span className="text-xs font-medium text-emerald-600">✓ บันทึกแล้ว</span>
        )}
      </div>
    </div>
  );
}
