"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile, UserRole } from "@/lib/types";
import { roleTh } from "@/lib/labels";

const roles: UserRole[] = ["guest", "student", "lecturer", "admin"];

export function AdminUsers({ users }: { users: Profile[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("");

  async function setRole(id: string, role: UserRole) {
    const supabase = createClient();
    const { error } = await supabase.rpc("set_user_role", {
      p_user_id: id,
      p_role: role,
    });
    if (error) alert(error.message);
    router.refresh();
  }

  const shown = users.filter(
    (u) =>
      !filter ||
      (u.full_name ?? "").toLowerCase().includes(filter.toLowerCase()) ||
      u.email.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">ผู้ใช้และสิทธิ์</h2>
        <input
          className="input w-56"
          placeholder="ค้นหาชื่อหรืออีเมล"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-2">ชื่อ</th>
            <th>อีเมล</th>
            <th>สิทธิ์</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {shown.map((u) => (
            <tr key={u.id}>
              <td className="py-2">{u.full_name || "-"}</td>
              <td className="text-slate-500">{u.email}</td>
              <td>
                <select
                  className="input w-32"
                  value={u.role}
                  onChange={(e) => setRole(u.id, e.target.value as UserRole)}
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {roleTh[r] ?? r}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
