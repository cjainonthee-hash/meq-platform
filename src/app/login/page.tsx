"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";




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
  const code = searchParams.get("code");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");



  

  // useEffect(() => {

  //   if (code) {
  //     setError(null);
      console.log("Received code:", code);
  //   } 
   
  // }, [code]);

  const passwordLoginEnabled =
    process.env.NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN === "true";
  const domains = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS || "cmu.ac.th";

  // function signInSso() {
  //   setLoading(true);
  //   setError(null);
  //   // Not a Supabase call: CMU's Azure app registration only allows a
  //   // redirect URI on our own domain, so we drive the OAuth handshake
  //   // ourselves (see src/app/auth/cmu-start and src/app/auth/callback).
  //   window.location.href = "/auth/cmu-start";
  // }

  async function signInSso() {
    setLoading(true);
    setError(null);
    const reqEnv = {
      authorizeUrl: process.env.NEXT_PUBLIC_AUTH_URL || "",
      clientId: process.env.NEXT_PUBLIC_CLIENT_ID || "",
      redirectUri: process.env.NEXT_PUBLIC_REDIRECT_URI || "",
      scope: process.env.NEXT_PUBLIC_SCOPE || "",
      responseType: "code",
    }

  

    if (!reqEnv.authorizeUrl || !reqEnv.clientId || !reqEnv.redirectUri) {
      setError("เกิดข้อผิดพลาดในการเข้าสู่ระบบด้วยบัญชี CMU กรุณาลองใหม่อีกครั้ง");
      setLoading(false);
      return;
    }

    try {

      const authUrl = new URL(reqEnv.authorizeUrl);
      authUrl.searchParams.set("client_id", reqEnv.clientId);
      authUrl.searchParams.set("redirect_uri", reqEnv.redirectUri);
      authUrl.searchParams.set("response_type", reqEnv.responseType);
      authUrl.searchParams.set("scope", reqEnv.scope);


      // console.log("Redirecting to CMU SSO URL:", authUrl.toString());


      window.location.href = authUrl.toString();
      

    } catch (error) {
      // console.error("Error during SSO sign-in:", error);
      setError("เกิดข้อผิดพลาดในการเข้าสู่ระบบด้วยบัญชี CMU กรุณาลองใหม่อีกครั้ง");
      setLoading(false);
    } finally {
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

     
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        
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
