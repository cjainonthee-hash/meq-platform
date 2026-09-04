/**
 * Shared .env loader.
 *
 * Both seed.mjs and loadtest.mjs use this so a staging run can be pointed at a
 * different file with `--env .env.staging` and never touch the production
 * credentials in .env.local. Values in the chosen file win over the ambient
 * environment, so the file you name is the file you get.
 */
import { readFileSync } from "node:fs";

export function loadEnv(file = ".env.local") {
  try {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return file;
  } catch {
    return null;
  }
}

/** "https://abcd.supabase.co" -> "abcd". Used to tell projects apart. */
export function projectRef(url) {
  const m = String(url || "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  return m ? m[1] : null;
}

/** The project ref recorded in .env.local, i.e. production. */
export function productionRef() {
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const m = text.match(/NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?(\S+)/);
    return m ? projectRef(m[1]) : null;
  } catch {
    return null;
  }
}
