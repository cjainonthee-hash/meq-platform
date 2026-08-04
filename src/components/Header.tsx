import Link from "next/link";
import type { Profile } from "@/lib/types";
import { roleTh } from "@/lib/labels";

const roleColor: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700",
  lecturer: "bg-brand-light text-brand-dark",
  student: "bg-emerald-100 text-emerald-700",
  guest: "bg-slate-100 text-slate-600",
};

export function Header({ profile }: { profile: Profile }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-base font-bold text-brand">
          <span className="flex h-7 items-center rounded-lg bg-brand px-2 text-xs font-bold tracking-wide text-white">
            MEQ
          </span>
          <span className="hidden sm:inline">ระบบสอบ</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className={`badge ${roleColor[profile.role]}`}>
            {roleTh[profile.role] ?? profile.role}
          </span>
          <span className="hidden text-slate-600 sm:inline">
            {profile.full_name || profile.email}
            {profile.student_code && (
              <span className="ml-1.5 text-slate-400">· รหัส {profile.student_code}</span>
            )}
          </span>
          <form action="/auth/signout" method="post">
            <button className="btn-ghost px-3 py-1.5">ออกจากระบบ</button>
          </form>
        </div>
      </div>
    </header>
  );
}
