/**
 * BACKEND (server only). OAuth redirect target for CMU SSO (Microsoft Entra).
 *
 * Exchanges the authorisation code for a session, enforces the allowed-domain
 * policy, then links the CMU account record before letting the user in.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchCmuBasicInfo, syncCmuAccount } from "@/lib/cmu";

// CMU organization_code for the Faculty of Veterinary Medicine. Sign-in is
// restricted to this faculty even though the whole university shares the
// cmu.ac.th email domain.
const VET_MED_FACULTY_CODE = "14";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data: session, error } =
    await supabase.auth.exchangeCodeForSession(code);
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

  // Link the CMU record: student ID, Thai name, faculty, account type. This is
  // a no-op until CMU IT issues the Basic Info endpoint (CMU_BASIC_INFO_URL).
  // A failure here is logged and swallowed on purpose: a profile sync problem
  // must never stop a student from reaching an exam that is already running.
  //
  // The faculty check is the one exception: once CMU's Basic Info is
  // available, anyone outside organization_code "14" (Faculty of Veterinary
  // Medicine) is signed back out, even though their @cmu.ac.th email already
  // passed the domain check above.
  const providerToken = session?.session?.provider_token;
  if (providerToken) {
    const info = await fetchCmuBasicInfo(providerToken);
    if (info) {
      if (info.organization_code?.trim() !== VET_MED_FACULTY_CODE) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=faculty_not_allowed`);
      }

      const { ok, error: syncError } = await syncCmuAccount(info);
      if (!ok) console.error("[cmu] account sync failed:", syncError);
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
