/**
 * BACKEND (server only). CMU SSO account linking.
 *
 * On every sign-in CMU returns a "Basic Info" payload containing the student
 * ID, the real Thai and English name, the faculty and the account type. This
 * module hands that payload to the `sync_cmu_account()` database function
 * (migration 0018), which stores it in `public.cmu_accounts` and copies the
 * derived fields onto the user's profile.
 *
 * Why this replaces hand-typed data: CMU student emails are name-based
 * (somchai_j@cmu.ac.th), so the student ID cannot be derived from the email.
 * Migration 0017 worked around that by asking lecturers to paste the ID next to
 * each email. Once SSO is live, the ID arrives automatically and CMU's value
 * wins over the hand-typed one.
 */

import { createClient } from "@/lib/supabase/server";
import type { CmuBasicInfo } from "@/lib/types";

/**
 * Store the CMU payload for the currently signed-in user.
 *
 * Safe to call on every sign-in: the database function upserts, only ever sets
 * the role on the very first link, and never blanks out a student ID it
 * already holds.
 *
 * Returns an error message on failure rather than throwing, because a failed
 * profile sync must not block a student from reaching their exam.
 */
export async function syncCmuAccount(
  payload: CmuBasicInfo,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sync_cmu_account", {
    p_payload: payload,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Fetch the Basic Info payload from CMU's API using the OAuth access token
 * Entra ID handed back at sign-in.
 *
 * NOT WIRED UP YET. CMU IT has not yet issued the client credentials or the
 * endpoint (see docs/, the CMU IT Azure SSO request of 2026-08-04). When they
 * do, set CMU_BASIC_INFO_URL and this starts working with no other change.
 */
export async function fetchCmuBasicInfo(
  accessToken: string,
): Promise<CmuBasicInfo | null> {
  const url =
    process.env.CMU_BASIC_INFO_URL || process.env.NEXT_PUBLIC_BASICINFO_URL;
  if (!url) return null;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as CmuBasicInfo;
  } catch {
    return null;
  }
}
