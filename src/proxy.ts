/**
 * BACKEND (server only). Runs before every matched request.
 *
 * Two jobs: refresh the Supabase auth session so a student's login does not
 * expire mid-exam, and bounce signed-out users away from protected pages.
 *
 * Next.js 16 renamed this file convention from `middleware` to `proxy`. The
 * exported function must be named `proxy`; the old `middleware` name still
 * works but is deprecated and warns on every build.
 */

import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Skip static assets and images: they need no session refresh, and running
  // this on every image request would be a pointless round trip to Supabase.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
