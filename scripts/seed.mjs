/**
 * Demo seed for the MEQ Exam Platform.
 *
 * Creates demo users (with passwords), a veterinary course, enrolments, and a
 * ready-to-run MEQ exam with rubrics. Safe to re-run: it resets the demo course
 * each time but keeps the user accounts.
 *
 * Usage:
 *   1. Fill .env.local (SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL).
 *   2. Set NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN=true in .env.local so you can log
 *      in with the demo passwords.
 *   3. npm run seed
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnv, projectRef } from "./env.mjs";

// Which env file to seed. Defaults to .env.local; pass `--env .env.staging` to
// seed a staging project instead.
const envIdx = process.argv.indexOf("--env");
const ENV_FILE = envIdx > -1 ? process.argv[envIdx + 1] : ".env.local";
if (!loadEnv(ENV_FILE)) {
  console.error(`Could not read ${ENV_FILE}. Create it, or pass --env <file>.`);
  process.exit(1);
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error(
    `${ENV_FILE} is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.`
  );
  process.exit(1);
}
console.log(`Seeding project ${projectRef(URL_)} (from ${ENV_FILE})`);

const db = createClient(URL_, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = "Demo1234!";

const USERS = [
  { email: "admin@cmu.ac.th", full_name: "Demo Admin", role: "admin" },
  { email: "lecturer@cmu.ac.th", full_name: "Dr. Somchai (Lecturer)", role: "lecturer" },
  { email: "student1@cmu.ac.th", full_name: "Nong A", role: "student", code: "640001" },
  { email: "student2@cmu.ac.th", full_name: "Nong B", role: "student", code: "640002" },
  { email: "student3@cmu.ac.th", full_name: "Nong C", role: "student", code: "640003" },
];

async function findUserByEmail(email) {
  // Scan the first pages of users (fine for a demo instance).
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

async function ensureUser(u) {
  let user = await findUserByEmail(u.email);
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email: u.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.full_name },
    });
    if (error) throw error;
    user = data.user;
    console.log("  created", u.email);
  } else {
    console.log("  exists ", u.email);
  }
  // The on_auth_user_created trigger created a profile row; set role/code/name.
  const { error: pErr } = await db
    .from("profiles")
    .update({ role: u.role, full_name: u.full_name, student_code: u.code ?? null })
    .eq("id", user.id);
  if (pErr) throw pErr;
  return user.id;
}

const QUESTIONS = [
  {
    stem: "A broiler slaughterhouse reports rising Campylobacter contamination on carcasses at the post-chill stage. Identify TWO likely critical control points along the processing line and, for each, state one practical intervention to reduce contamination.",
    answer_key:
      "Expected CCPs include scalding (temperature/time control), defeathering (cross-contamination via pickers), evisceration (gut rupture), and chilling (chlorinated water / air chill). Interventions: raise scald temperature, maintain/replace picker fingers and sanitise, careful automated evisceration settings, adequate chiller sanitiser and counterflow.",
    rubric: [
      { criterion: "Identifies two valid critical control points", points: 4 },
      { criterion: "Gives a practical, correct intervention for each CCP", points: 4 },
      { criterion: "Reasoning links the control point to Campylobacter reduction", points: 2 },
    ],
    max_score: 10,
    time_limit_seconds: 120,
  },
  {
    stem: "You sample chicken meat at a fresh retail market and isolate Salmonella from 30% of samples. Outline how you would design a simple risk-based sampling and machine-learning approach to predict which market stalls are highest risk, given that you cannot enter the slaughterhouse.",
    answer_key:
      "Purchase-based sampling at stalls (open access), collect metadata (stall hygiene score, temperature, supplier, time of day). Label samples Salmonella +/-. Train a classifier (e.g. random forest / XGBoost) on stall-level features; evaluate with ROC/AUC and cross-validation; use SHAP for interpretability. Note class imbalance handling and the constraint of no farm/slaughterhouse access.",
    rubric: [
      { criterion: "Sensible open-access sampling plan and metadata to collect", points: 3 },
      { criterion: "Appropriate ML model and features for stall-level prediction", points: 4 },
      { criterion: "Correct evaluation (AUC / cross-validation) and interpretability", points: 3 },
    ],
    max_score: 10,
    time_limit_seconds: 120,
  },
  {
    stem: "ESBL-producing E. coli is detected in retail pork. Explain briefly (a) why this is a One Health concern and (b) two surveillance actions a public-health veterinarian could realistically take at the retail level.",
    answer_key:
      "(a) ESBL confers resistance to third-generation cephalosporins; transmissible via food chain to humans, linking animal, food and human health (One Health). (b) Retail surveillance: periodic purchase-and-test monitoring with resistance profiling, integration with human clinical AMR data, consumer/handler education, traceback to suppliers where possible.",
    rubric: [
      { criterion: "Explains the One Health / AMR transmission concern correctly", points: 4 },
      { criterion: "Two realistic retail-level surveillance actions", points: 4 },
      { criterion: "Clarity and use of correct terminology", points: 2 },
    ],
    max_score: 10,
    time_limit_seconds: 120,
  },
];

async function main() {
  console.log("Seeding demo data…");
  console.log("Users:");
  const ids = {};
  for (const u of USERS) ids[u.email] = await ensureUser(u);

  const lecturerId = ids["lecturer@cmu.ac.th"];

  // Reset the demo course (cascade removes its exams/questions/members).
  const CODE = "VET401-DEMO";
  const { data: existing } = await db.from("courses").select("id").eq("code", CODE);
  for (const c of existing ?? []) await db.from("courses").delete().eq("id", c.id);

  const { data: course, error: cErr } = await db
    .from("courses")
    .insert({
      code: CODE,
      title: "Veterinary Public Health & Food Hygiene (Demo)",
      description: "Demo course for the MEQ platform",
      created_by: lecturerId,
    })
    .select("id")
    .single();
  if (cErr) throw cErr;
  console.log("Course created:", course.id);

  // Memberships: lecturer + three students.
  const members = [
    { course_id: course.id, user_id: lecturerId, role_in_course: "lecturer" },
    { course_id: course.id, user_id: ids["student1@cmu.ac.th"], role_in_course: "student" },
    { course_id: course.id, user_id: ids["student2@cmu.ac.th"], role_in_course: "student" },
    { course_id: course.id, user_id: ids["student3@cmu.ac.th"], role_in_course: "student" },
  ];
  await db.from("course_members").insert(members);

  // Exam (draft) + questions.
  const { data: exam, error: eErr } = await db
    .from("exams")
    .insert({
      course_id: course.id,
      title: "MEQ Midterm — Foodborne Zoonoses & AMR (Demo)",
      description: "Three MEQ questions, 2 minutes each.",
      status: "draft",
      created_by: lecturerId,
    })
    .select("id")
    .single();
  if (eErr) throw eErr;

  const rows = QUESTIONS.map((q, i) => ({ exam_id: exam.id, order_index: i, ...q }));
  await db.from("questions").insert(rows);
  console.log("Exam created:", exam.id, "with", rows.length, "questions");

  console.log("\nDone. Demo accounts (password for all: %s):", PASSWORD);
  for (const u of USERS) console.log("  %s  [%s]", u.email.padEnd(22), u.role);
  console.log(
    "\nMake sure NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN=true in .env.local, then `npm run dev`."
  );
}

main().catch((e) => {
  console.error("Seed failed:", e.message ?? e);
  process.exit(1);
});
