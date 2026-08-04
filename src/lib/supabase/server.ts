import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server Supabase client bound to the request's auth cookies. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component; middleware refreshes the session.
          }
        },
      },
    }
  );
}

/**
 * Service-role client. SERVER ONLY. Bypasses RLS. Use for AI grading and
 * exports where we must read/write across all students. Never import this
 * into client code.
 */
export function createServiceClient() {
  const { createClient: createSbClient } = require("@supabase/supabase-js");
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
