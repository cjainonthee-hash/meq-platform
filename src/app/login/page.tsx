"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Maps the ?error= code the /auth/callback route redirects back with to a
// message a signed-out user can actually read. Keep in sync with the codes
// thrown in src/app/auth/callback/route.ts.
const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  missing_code: "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  auth: "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  domain_not_allowed:
    "อนุญาตเฉพาะบัญชีอีเมลของมหาวิทยาลัยเชียงใหม่ (@cmu.ac.th) เท่านั้น",
  faculty_not_allowed:
    "ระบบนี้อนุญาตเฉพาะบุคลากรและนักศึกษาคณะสัตวแพทยศาสตร์เท่านั้น",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const domains = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS || "cmu.ac.th";

  function signInSso() {
    setLoading(true);
    setError(null);
    router.push("/auth/cmu-start");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-linear-to-b from-brand-light to-[#eef3f8] p-6">
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

        {(error || callbackError) && (
          <p className="mt-4 text-sm text-red-600">
            {error ||
              CALLBACK_ERROR_MESSAGES[callbackError ?? ""] ||
              CALLBACK_ERROR_MESSAGES.auth}
          </p>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
