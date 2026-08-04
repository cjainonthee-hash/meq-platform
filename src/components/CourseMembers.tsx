"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { courseRoleTh } from "@/lib/labels";

interface Member {
  user_id: string;
  email: string;
  full_name: string | null;
  student_code: string | null;
  role_in_course: string;
}

export function CourseMembers({
  courseId,
  members,
}: {
  courseId: string;
  members: Member[];
}) {
  const router = useRouter();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState("student");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; fail: string[] } | null>(
    null
  );

  async function add() {
    // Accept a pasted roster, one entry per line. Each line is an email with an
    // OPTIONAL student ID next to it (comma / space / semicolon / tab separated),
    // e.g.  "somchai_j@cmu.ac.th, 640610001". The ID is stored on the profile.
    const seen = new Set<string>();
    const list: { email: string; code: string | null }[] = [];
    for (const line of emails.split(/\r?\n/)) {
      const parts = line.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
      const email = parts.find((p) => p.includes("@"))?.toLowerCase();
      if (!email || seen.has(email)) continue;
      const code = parts.find((p) => !p.includes("@")) ?? null;
      seen.add(email);
      list.push({ email, code });
    }
    if (list.length === 0) {
      alert("กรุณาวางอีเมลอย่างน้อยหนึ่งรายการ");
      return;
    }
    setBusy(true);
    setResult(null);
    const supabase = createClient();
    let ok = 0;
    const fail: string[] = [];
    for (const { email, code } of list) {
      const { error } = await supabase.rpc("enrol_member", {
        p_course_id: courseId,
        p_email: email,
        p_role: role,
        p_student_code: code,
      });
      if (error) fail.push(email);
      else ok++;
    }
    setBusy(false);
    setResult({ ok, fail });
    if (ok > 0) setEmails("");
    router.refresh();
  }

  async function remove(userId: string) {
    const supabase = createClient();
    await supabase.rpc("remove_member", {
      p_course_id: courseId,
      p_user_id: userId,
    });
    router.refresh();
  }

  return (
    <div className="card">
      <h2 className="font-semibold">สมาชิก</h2>
      <p className="mt-1 text-xs text-slate-500">
        วางอีเมลได้หลายรายการพร้อมกัน หนึ่งรายการต่อหนึ่งบรรทัด เลือกบทบาท แล้วกดเพิ่มสมาชิกครั้งเดียว
        <br />
        ใส่รหัสนักศึกษาต่อท้ายอีเมลในบรรทัดเดียวกันได้ (คั่นด้วยเครื่องหมายจุลภาคหรือเว้นวรรค)
        เช่น <span className="font-mono">somchai_j@cmu.ac.th, 640610001</span> ระบบจะบันทึกรหัสให้อัตโนมัติ
        (จะใส่หรือไม่ใส่ก็ได้)
      </p>
      <textarea
        className="input mt-2 min-h-[90px] font-mono text-sm"
        placeholder={
          "student1@cmu.ac.th, 640610001\nstudent2@cmu.ac.th, 640610002\nstudent3@cmu.ac.th"
        }
        value={emails}
        onChange={(e) => setEmails(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          className="input w-40"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="student">นักศึกษา</option>
          <option value="lecturer">อาจารย์</option>
        </select>
        <button className="btn-primary" onClick={add} disabled={busy || !emails.trim()}>
          {busy ? "กำลังเพิ่ม…" : "เพิ่มสมาชิก"}
        </button>
      </div>

      {result && (
        <div className="mt-2 text-xs">
          <span className="font-medium text-emerald-700">
            เพิ่มสำเร็จ {result.ok} คน
          </span>
          {result.fail.length > 0 && (
            <div className="mt-1 text-red-600">
              เพิ่มไม่สำเร็จ {result.fail.length} คน (ยังไม่เคยเข้าสู่ระบบ หรือ
              อีเมลไม่ถูกต้อง): {result.fail.join(", ")}
            </div>
          )}
        </div>
      )}

      <ul className="mt-4 divide-y text-sm">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center justify-between py-2">
            <span>
              {m.full_name || m.email}{" "}
              <span className="text-xs text-slate-400">({m.email})</span>
              {m.student_code && (
                <span className="ml-2 badge bg-brand-light text-brand-dark">
                  รหัส {m.student_code}
                </span>
              )}
            </span>
            <span className="flex items-center gap-3">
              <span className="badge bg-slate-100 text-slate-600">
                {courseRoleTh[m.role_in_course] ?? m.role_in_course}
              </span>
              <button
                className="text-xs text-red-500 hover:underline"
                onClick={() => remove(m.user_id)}
              >
                นำออก
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
