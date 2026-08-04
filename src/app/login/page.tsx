"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const passwordLoginEnabled =
    process.env.NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN === "true";
  const domains = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS || "cmu.ac.th";

  async function signInSso() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email openid profile",
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  async function signInPassword() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-light to-[#eef3f8] p-6">
      <div className="card w-full max-w-md text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_60px_-24px_rgba(15,23,42,0.28)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/Vet_Fac_Logo.png"
          alt="คณะสัตวแพทยศาสตร์ มหาวิทยาลัยเชียงใหม่"
          className="mx-auto mb-4 h-28 w-auto"
        />
        <h1 className="text-2xl font-bold text-brand">ระบบสอบ MEQ ออนไลน์</h1>

        <button
          onClick={signInSso}
          disabled={loading}
          className="btn-primary mt-6 w-full"
        >
          {loading ? "กำลังนำทาง…" : "เข้าสู่ระบบด้วยบัญชี CMU"}
        </button>
        <p className="mt-3 text-xs text-slate-500">
          อนุญาตเฉพาะบัญชี{" "}
          <span className="font-medium">@{domains.split(",")[0]}</span> เท่านั้น
        </p>

        {passwordLoginEnabled && (
          <div className="mt-6 border-t border-slate-200 pt-6 text-left">
            <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-amber-600">
              เข้าสู่ระบบสำหรับทดสอบ (สำหรับพัฒนาเท่านั้น)
            </p>
            <label className="label">อีเมล</label>
            <input
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="lecturer@cmu.ac.th"
            />
            <label className="label mt-3">รหัสผ่าน</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Demo1234!"
            />
            <button
              onClick={signInPassword}
              disabled={loading || !email || !password}
              className="btn-ghost mt-4 w-full"
            >
              เข้าสู่ระบบด้วยรหัสผ่าน
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}
