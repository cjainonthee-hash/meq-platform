/**
 * Load test for the MEQ lockstep exam engine.
 *
 * Drives N simulated students against a real exam on a Supabase project, doing
 * exactly what a browser does: a Realtime subscription on the exam row, the
 * adaptive backstop poll, join_exam, an autosave every 2 s while typing, and a
 * jittered advance_if_due at each deadline. It then reports request rates and
 * latency percentiles per operation, which is the only honest way to know
 * whether the free t3a.nano instance holds for a whole sitting.
 *
 * RUN THIS AGAINST A STAGING PROJECT, never against the database that is about
 * to hold a real exam. It creates test users and writes answers.
 *
 * Usage:
 *   node scripts/loadtest.mjs --exam <examId> --students 100 --setup
 *   node scripts/loadtest.mjs --exam <examId> --students 100
 *   node scripts/loadtest.mjs --exam <examId> --students 100 --cleanup
 *
 * Flags:
 *   --exam <uuid>     the exam to sit (required)
 *   --students <n>    how many simulated students (default 25)
 *   --ramp <seconds>  spread sign-ins over this long (default 60). Supabase
 *                     rate-limits the auth endpoint per IP, so do not set this
 *                     to 0 for a large cohort.
 *   --minutes <n>     stop after this long even if the exam is still live
 *                     (default 120)
 *   --setup           create/enrol the test users, then exit
 *   --cleanup         delete the test users (cascades to attempts/answers)
 *   --no-realtime     poll only, to isolate the Realtime connection count
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY from .env.local, same as scripts/seed.mjs.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ---- load .env.local (simple parser; no extra dependency) ----
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // fall back to real environment variables
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

// ---- arguments ----
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const EXAM_ID = arg("exam");
const COUNT = Number(arg("students", 25));
const RAMP_MS = Number(arg("ramp", 60)) * 1000;
const MAX_MS = Number(arg("minutes", 120)) * 60 * 1000;
const USE_REALTIME = !has("no-realtime");
const PASSWORD = "LoadTest1234!";
const SESSION_CACHE = new URL("./.loadtest-sessions.json", import.meta.url);

if (!EXAM_ID) {
  console.error("Missing --exam <examId>. See the header of this file.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = (i) => `loadtest+${String(i).padStart(3, "0")}@meq.test`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// metrics
// ============================================================
const metrics = new Map(); // kind -> { n, errors, samples[] }

function record(kind, ms, error) {
  let m = metrics.get(kind);
  if (!m) metrics.set(kind, (m = { n: 0, errors: 0, samples: [] }));
  m.n++;
  if (error) {
    m.errors++;
    const key = String(error.message || error).slice(0, 80);
    errorTally.set(key, (errorTally.get(key) ?? 0) + 1);
  }
  // Keep a bounded reservoir so a 90-minute run does not grow without limit.
  if (m.samples.length < 20000) m.samples.push(ms);
  else m.samples[Math.floor(Math.random() * m.samples.length)] = ms;
}
const errorTally = new Map();

/** Time one Supabase call and file it under `kind`. */
async function timed(kind, fn) {
  const t0 = Date.now();
  try {
    const res = await fn();
    record(kind, Date.now() - t0, res?.error);
    return res;
  } catch (e) {
    record(kind, Date.now() - t0, e);
    return { data: null, error: e };
  }
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

let started = Date.now();
function report(final) {
  const secs = Math.max(1, (Date.now() - started) / 1000);
  const rows = [...metrics.entries()].sort((a, b) => b[1].n - a[1].n);
  console.log(
    `\n${final ? "FINAL" : "···"}  ${Math.round(secs)}s elapsed, ${COUNT} students`
  );
  console.log(
    "  operation            count    /sec   errors    p50     p95     p99     max"
  );
  for (const [kind, m] of rows) {
    const s = [...m.samples].sort((a, b) => a - b);
    console.log(
      "  " +
        kind.padEnd(20) +
        String(m.n).padStart(6) +
        (m.n / secs).toFixed(1).padStart(8) +
        String(m.errors).padStart(9) +
        `${pct(s, 50)}ms`.padStart(8) +
        `${pct(s, 95)}ms`.padStart(8) +
        `${pct(s, 99)}ms`.padStart(8) +
        `${s[s.length - 1] ?? 0}ms`.padStart(8)
    );
  }
  if (errorTally.size) {
    console.log("  errors seen:");
    for (const [msg, n] of [...errorTally].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`    ${String(n).padStart(5)} x ${msg}`);
    }
  }
}

// ============================================================
// setup / cleanup
// ============================================================
async function findUserByEmail(addr) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === addr.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

async function setup() {
  const { data: exam, error } = await admin
    .from("exams")
    .select("id,course_id,title,status")
    .eq("id", EXAM_ID)
    .single();
  if (error || !exam) throw new Error(`Exam ${EXAM_ID} not found: ${error?.message}`);
  console.log(`Exam: ${exam.title} (${exam.status}), course ${exam.course_id}`);

  for (let i = 1; i <= COUNT; i++) {
    const addr = email(i);
    let user = await findUserByEmail(addr);
    if (!user) {
      const { data, error: e } = await admin.auth.admin.createUser({
        email: addr,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: `Load Test ${i}` },
      });
      if (e) throw e;
      user = data.user;
    }
    // handle_new_user() gives a default role; force student + a code.
    await admin
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email: addr,
          full_name: `Load Test ${i}`,
          student_code: `LT${String(i).padStart(4, "0")}`,
          role: "student",
        },
        { onConflict: "id" }
      );
    await admin
      .from("course_members")
      .upsert(
        { course_id: exam.course_id, user_id: user.id, role_in_course: "student" },
        { onConflict: "course_id,user_id" }
      );
    if (i % 20 === 0 || i === COUNT) console.log(`  enrolled ${i}/${COUNT}`);
  }
  console.log("Setup done. Now start the exam, then run without --setup.");
}

async function cleanup() {
  for (let i = 1; i <= COUNT; i++) {
    const user = await findUserByEmail(email(i));
    if (user) await admin.auth.admin.deleteUser(user.id);
    if (i % 20 === 0 || i === COUNT) console.log(`  deleted ${i}/${COUNT}`);
  }
  if (existsSync(SESSION_CACHE)) writeFileSync(SESSION_CACHE, "{}");
  console.log("Cleanup done.");
}

// ============================================================
// one simulated student
// ============================================================
async function signIn(i, cache) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  const saved = cache[email(i)];
  if (saved) {
    const { error } = await client.auth.setSession(saved);
    if (!error) return client;
  }
  const { data, error } = await timed("sign_in", () =>
    client.auth.signInWithPassword({ email: email(i), password: PASSWORD })
  );
  if (error) throw error;
  cache[email(i)] = {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  };
  return client;
}

/**
 * Mirrors ExamRunner: Realtime subscription, adaptive backstop poll, join,
 * autosave every 2 s, jittered advance at the deadline.
 */
async function student(i, client, stopAt) {
  let exam = null;
  let question = null;
  let attemptId = null;
  let loadedIndex = -1;
  let typed = 0;
  let done = false;

  const EXAM_COLS =
    "id,status,current_question_index,current_started_at,scheduled_start,buffer_seconds";

  const { data: first } = await timed("exam_poll", () =>
    client.from("exams").select(EXAM_COLS).eq("id", EXAM_ID).single()
  );
  exam = first;

  if (USE_REALTIME) {
    client
      .channel(`exam-${EXAM_ID}-lt${i}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "exams", filter: `id=eq.${EXAM_ID}` },
        (p) => {
          record("realtime_event", 0);
          exam = { ...exam, ...p.new };
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          record("realtime_error", 0, new Error(`channel ${status}`));
        }
      });
  }

  const deadline = () =>
    exam?.current_started_at && question
      ? new Date(exam.current_started_at).getTime() +
        (question.time_limit_seconds + (exam.buffer_seconds ?? 0)) * 1000
      : null;

  // --- backstop poll, same adaptive rate as the browser ---
  (async () => {
    while (!done && Date.now() < stopAt) {
      const d = deadline();
      const near = d !== null && d - Date.now() <= 12000;
      await sleep(near ? 1000 : 5000);
      if (done) break;
      const { data } = await timed("exam_poll", () =>
        client.from("exams").select(EXAM_COLS).eq("id", EXAM_ID).single()
      );
      if (data) exam = { ...exam, ...data };
    }
  })();

  // --- autosave, same 2 s cadence, assuming the student types continuously ---
  (async () => {
    while (!done && Date.now() < stopAt) {
      await sleep(2000);
      if (done || !attemptId || !question || exam?.status !== "live") continue;
      typed += 40;
      await timed("autosave", () =>
        client.from("answers").upsert(
          {
            attempt_id: attemptId,
            question_id: question.id,
            answer_text: "ก".repeat(Math.min(typed, 4000)),
          },
          { onConflict: "attempt_id,question_id" }
        )
      );
    }
  })();

  // --- main loop: join, load questions, advance at the deadline ---
  let lastAdvance = 0;
  let lastStart = 0;
  while (!done && Date.now() < stopAt) {
    await sleep(250);
    if (!exam) continue;

    if (exam.status === "closed" || exam.status === "released") {
      done = true;
      break;
    }

    if (exam.status === "scheduled" && exam.scheduled_start) {
      const left = new Date(exam.scheduled_start).getTime() - Date.now();
      if (left <= 0 && Date.now() - lastStart > 2000) {
        lastStart = Date.now();
        const delay = Math.random() * 800;
        setTimeout(() => {
          if (exam?.status !== "scheduled") return;
          timed("start_if_due", () =>
            client.rpc("start_if_due", { p_exam_id: EXAM_ID })
          );
        }, delay);
      }
      continue;
    }

    if (exam.status !== "live") continue;

    if (!attemptId) {
      const { data, error } = await timed("join_exam", () =>
        client.rpc("join_exam", { p_exam_id: EXAM_ID })
      );
      if (error) {
        await sleep(2000);
        continue;
      }
      attemptId = data;
    }

    if (exam.current_question_index !== loadedIndex) {
      loadedIndex = exam.current_question_index;
      typed = 0;
      const { data } = await timed("load_question", () =>
        client
          .from("questions")
          .select("*")
          .eq("exam_id", EXAM_ID)
          .eq("order_index", loadedIndex)
          .single()
      );
      question = data ?? null;
    }

    const d = deadline();
    if (d !== null && Date.now() >= d && Date.now() - lastAdvance > 1500) {
      lastAdvance = Date.now();
      const dueIndex = exam.current_question_index;
      const delay = Math.random() * 800;
      setTimeout(() => {
        // Skip if Realtime or the poll already moved the exam on. This is the
        // client-side half of the thundering-herd fix.
        if (exam?.status !== "live" || exam.current_question_index !== dueIndex) {
          record("advance_skipped", 0);
          return;
        }
        timed("advance_if_due", () =>
          client.rpc("advance_if_due", { p_exam_id: EXAM_ID })
        );
      }, delay);
    }
  }

  done = true;
  await client.removeAllChannels().catch(() => {});
}

// ============================================================
// main
// ============================================================
async function run() {
  const cache = existsSync(SESSION_CACHE)
    ? JSON.parse(readFileSync(SESSION_CACHE, "utf8"))
    : {};

  console.log(
    `Signing in ${COUNT} students over ${RAMP_MS / 1000}s (cached sessions are reused)…`
  );
  const clients = [];
  for (let i = 1; i <= COUNT; i++) {
    try {
      clients.push([i, await signIn(i, cache)]);
    } catch (e) {
      console.error(`  student ${i} could not sign in: ${e.message}`);
    }
    writeFileSync(SESSION_CACHE, JSON.stringify(cache, null, 2));
    if (COUNT > 1) await sleep(RAMP_MS / COUNT);
  }
  console.log(`${clients.length} signed in. Running…  (Ctrl+C to stop early)`);

  started = Date.now();
  const stopAt = started + MAX_MS;
  const ticker = setInterval(() => report(false), 15000);
  process.on("SIGINT", () => {
    clearInterval(ticker);
    report(true);
    process.exit(0);
  });

  await Promise.all(clients.map(([i, c]) => student(i, c, stopAt)));
  clearInterval(ticker);
  report(true);
  process.exit(0);
}

if (has("setup")) await setup();
else if (has("cleanup")) await cleanup();
else await run();
