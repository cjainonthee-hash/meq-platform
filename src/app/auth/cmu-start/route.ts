/**
 * BACKEND (server only). Starts the CMU SSO sign-in.
 *
 * Builds the Microsoft authorize URL ourselves and redirects the browser to
 * it, instead of using Supabase's built-in OAuth provider — CMU's Azure app
 * registration only allows a redirect URI on our own domain, so Supabase's
 * hosted callback URL can never be registered there (see src/app/auth/
 * callback/route.ts for the token exchange this hands off to).
 */

import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const state = crypto.randomUUID();
  const authorizeUrlValue =
    process.env.CMU_AUTHORIZE_URL || process.env.NEXT_PUBLIC_AUTH_URL;
  const clientId = process.env.CMU_CLIENT_ID || process.env.CLIENT_ID;
  const scope = process.env.CMU_SCOPE || process.env.SCOPE;
  const redirectUri = process.env.REDIRECT_URI || `${origin}/app/login`;

  if (!authorizeUrlValue || !clientId || !scope) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const authorizeUrl = new URL(authorizeUrlValue);
  authorizeUrl.searchParams.set("client_id", clientId);
  // Must exactly match the redirect URI registered on CMU's Azure app
  // (currently "http://localhost:3000/app/login" — not "/login").
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", scope);
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl);
  // Read back and checked in src/app/auth/callback/route.ts. Short-lived,
  // one-time use, never readable by client JS.
  response.cookies.set("cmu_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
