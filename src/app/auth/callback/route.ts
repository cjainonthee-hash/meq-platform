/**
 * BACKEND (server only). OAuth redirect target for CMU SSO (Microsoft Entra).
 *
 * Not Supabase's exchangeCodeForSession flow: CMU's Azure app registration
 * only allows a redirect URI on our own domain (see src/app/auth/cmu-start),
 * so we exchange the authorization code for a token ourselves, fetch CMU's
 * Basic Info, enforce the domain/faculty policy, then mint a normal Supabase
 * session for the verified email via the admin API before letting the user
 * in. Middleware (src/lib/supabase/middleware.ts) forwards Microsoft's
 * redirect here from "/app/login" — the redirect URI registered on CMU's
 * Azure app, which has no real page behind it.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { fetchCmuBasicInfo, syncCmuAccount } from "@/lib/cmu";

// CMU organization_code for the Faculty of Veterinary Medicine. Sign-in is
// restricted to this faculty even though the whole university shares the
// cmu.ac.th email domain.
const VET_MED_FACULTY_CODE = "14";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const tokenUrl = process.env.CMU_TOKEN_URL || process.env.TOKEN_URI;
  const clientId = process.env.CMU_CLIENT_ID || process.env.CLIENT_ID;
  const clientSecret =
    process.env.CMU_CLIENT_SECRET || process.env.CLIENT_SECRET;
  const scope = process.env.CMU_SCOPE || process.env.SCOPE;
  const redirectUri = process.env.REDIRECT_URI || `${origin}/app/login`;

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("cmu_oauth_state")?.value;
  cookieStore.delete("cmu_oauth_state");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }
  if (!expectedState || state !== expectedState) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }
  if (!tokenUrl || !clientId || !clientSecret || !scope) {
    console.error("[cmu] OAuth server configuration is incomplete");
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // Exchange the authorization code for an access token ourselves.
  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      // Must exactly match what src/app/auth/cmu-start/route.ts sent.
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope,
    }),
  });
  if (!tokenRes.ok) {
    console.error("[cmu] token exchange failed:", await tokenRes.text());
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }
  const { access_token: accessToken } = (await tokenRes.json()) as {
    access_token?: string;
  };
  if (!accessToken) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const info = await fetchCmuBasicInfo(accessToken);
  if (!info) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // Enforce institutional domain restriction. No Supabase session exists yet
  // at this point, so the email comes straight from CMU's payload.
  const allowed = (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS || "cmu.ac.th")
    .split(",")
    .map((d) => d.trim().toLowerCase());
  const email = (info.cmuitaccount || "").toLowerCase();
  const domain = email.split("@")[1] || "";
  if (!allowed.includes(domain)) {
    return NextResponse.redirect(`${origin}/login?error=domain_not_allowed`);
  }

  // Faculty gate: only organization_code "14" (Faculty of Veterinary
  // Medicine) may sign in, even though the whole university shares the
  // cmu.ac.th domain.
  if (info.organization_code?.trim() !== VET_MED_FACULTY_CODE) {
    return NextResponse.redirect(`${origin}/login?error=faculty_not_allowed`);
  }

  // Mint a real Supabase session for this verified email. No email is ever
  // sent — generateLink just returns a token we redeem ourselves, right here,
  // server-side.
  const admin = createServiceClient();
  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("[cmu] generateLink failed:", linkError?.message);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const supabase = await createClient();
  // Despite generateLink's `type: "magiclink"` above, verifyOtp redeems a
  // hashed_token with `type: "email"` — Supabase's admin API is asymmetric
  // here. Using "magiclink" here fails with "invalid or expired" even on a
  // token that's seconds old.
  const { error: otpError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email",
  });
  if (otpError) {
    console.error("[cmu] verifyOtp failed:", otpError.message);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // Link the CMU record: student ID, Thai name, faculty, account type. A
  // failure here is logged and swallowed on purpose: a profile sync problem
  // must never stop a student from reaching an exam that is already running.
  const { ok, error: syncError } = await syncCmuAccount(info);
  if (!ok) console.error("[cmu] account sync failed:", syncError);

  return NextResponse.redirect(`${origin}/`);
}
