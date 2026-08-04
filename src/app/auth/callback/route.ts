import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** OAuth (Microsoft Entra) redirect target. Exchanges the code for a session,
 *  then enforces the allowed-domain policy before letting the user in. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // Enforce institutional domain restriction.
  const allowed = (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS || "cmu.ac.th")
    .split(",")
    .map((d) => d.trim().toLowerCase());

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase() || "";
  const domain = email.split("@")[1] || "";

  if (!allowed.includes(domain)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain_not_allowed`);
  }

  return NextResponse.redirect(`${origin}/`);
}
