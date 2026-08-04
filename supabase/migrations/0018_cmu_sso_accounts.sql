-- ============================================================
-- MEQ Exam Platform : CMU SSO account records
-- ============================================================
-- WHY THIS EXISTS
--
-- Until now the only identity the platform had was an email address, and the
-- student ID had to be typed in by hand by a lecturer (see 0017). Once CMU
-- Entra ID / CMU OAuth is switched on, every sign-in returns an authoritative
-- "Basic Info" payload from CMU that already contains the student ID, the real
-- Thai and English name, the faculty, and the account type. This table stores
-- that payload so students and lecturers are linked to the platform by CMU's
-- own record instead of by hand-typed data.
--
-- THE PAYLOAD CMU RETURNS (verified against two live accounts, 2026-08-04)
--
--   Employee / lecturer                Student
--   -------------------------------    -------------------------------
--   cmuitaccount_name  "chalita.j"     cmuitaccount_name  "thairat_panmethis"
--   cmuitaccount       "chalita.j@..." cmuitaccount       "thairat_panmethis@..."
--   student_id         ""              student_id         "641410022"
--   prename_id         "MS"            prename_id         "OTH"
--   prename_TH         "นางสาว"          prename_TH         ""
--   prename_EN         "Miss"          prename_EN         ""
--   firstname_TH       "ชลิตา"           firstname_TH       "ไทยรัฐ"
--   firstname_EN       "CHALITA"       firstname_EN       "THAIRAT"
--   lastname_TH        "ใจนนถีย์"         lastname_TH        "พันธุ์เมธิส"
--   lastname_EN        "JAINONTHEE"    lastname_EN        "PANMETHIS"
--   organization_code  "14"            organization_code  "14"
--   organization_name_TH  "คณะสัตวแพทยศาสตร์"  (same for both)
--   organization_name_EN  "Faculty of Veterinary Medicine"
--   itaccounttype_id   "MISEmpAcc"     itaccounttype_id   "StdAcc"
--   itaccounttype_TH   "บุคลากร"          itaccounttype_TH   "นักศึกษาปัจจุบัน"
--   itaccounttype_EN   "MIS Employee"  itaccounttype_EN   "Student Account"
--
-- THREE TRAPS THAT THIS MIGRATION HANDLES, DO NOT REMOVE THEM
--   1. CMU sends EMPTY STRINGS, not nulls. A lecturer's student_id is "" and a
--      student's prename_TH is "". Every text field is normalised through
--      nullif(btrim(...), '') on the way in, so "" never reaches the table.
--   2. student_id for a non-student is EITHER "" OR A ZERO ("0", "000000000"),
--      confirmed by CMU IT. Both mean "this person has no student ID". They are
--      normalised to NULL by norm_student_id() below, so nothing downstream has
--      to know about the placeholder. A real CMU student ID is year-prefixed
--      (e.g. 641410022) and is never all zeros, so this cannot eat a real one.
--   3. itaccounttype_id is the ONLY reliable way to tell a student from staff.
--      Do not guess from the email: student emails are name-based, exactly the
--      problem 0017 was written to work around.
--
-- Run this WHOLE file once in the Supabase SQL editor.
-- ============================================================

-- ---------- helper ----------
-- Turn CMU's "no student ID" values into a real NULL. CMU sends "" for some
-- staff accounts and a zero ("0", or a zero-padded run) for others; both mean
-- the same thing. Immutable so it can be used in an index or a check.
create or replace function public.norm_student_id(p_value text)
returns text
language sql immutable
as $$
  select nullif(
           nullif(btrim(coalesce(p_value, '')), ''),
           repeat('0', length(btrim(coalesce(p_value, ''))))
         )
$$;

comment on function public.norm_student_id(text) is
  'Normalises a CMU student_id: empty string or all-zeros becomes NULL.';

-- ---------- table ----------
-- One row per CMU account, 1:1 with profiles. profiles stays the app-level
-- identity (role, display name); this table is the raw CMU record of truth.
create table if not exists public.cmu_accounts (
  user_id              uuid primary key references public.profiles(id) on delete cascade,

  -- Identity. cmuitaccount is the full email, cmuitaccount_name is the part
  -- before the @. Both are unique: one CMU account maps to one platform user.
  cmuitaccount_name    text not null,
  cmuitaccount         text not null,

  -- Student ID. NULL for staff, because CMU's "" and "0" placeholders are
  -- normalised away by norm_student_id() on the way in. This is what 0017
  -- asked lecturers to type by hand; after SSO it arrives automatically.
  student_id           text,

  -- Name. TH is what the exam papers and score exports should show; EN is kept
  -- for international documents.
  prename_id           text,
  prename_th           text,
  prename_en           text,
  firstname_th         text,
  firstname_en         text,
  lastname_th          text,
  lastname_en          text,

  -- Faculty. "14" = Faculty of Veterinary Medicine. Kept so the platform can
  -- later restrict sign-in to the faculty rather than to all of cmu.ac.th.
  organization_code    text,
  organization_name_th text,
  organization_name_en text,

  -- Account type. "StdAcc" = current student, "MISEmpAcc" = employee.
  itaccounttype_id     text,
  itaccounttype_th     text,
  itaccounttype_en     text,

  -- The untouched payload. If CMU adds a field later it is captured here
  -- without needing a migration, and it is the audit trail for what CMU
  -- actually returned at each sign-in.
  raw                  jsonb not null default '{}'::jsonb,

  first_seen_at        timestamptz not null default now(),
  last_login_at        timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Case-insensitive uniqueness: CMU is inconsistent about capitalisation.
create unique index if not exists cmu_accounts_account_key
  on public.cmu_accounts (lower(cmuitaccount));
create unique index if not exists cmu_accounts_account_name_key
  on public.cmu_accounts (lower(cmuitaccount_name));

-- Look up a student by the ID printed on their exam paper.
create index if not exists cmu_accounts_student_id_idx
  on public.cmu_accounts (student_id) where student_id is not null;
-- Filter a course roster down to one faculty or one account type.
create index if not exists cmu_accounts_org_idx
  on public.cmu_accounts (organization_code);
create index if not exists cmu_accounts_type_idx
  on public.cmu_accounts (itaccounttype_id);

comment on table public.cmu_accounts is
  'Authoritative CMU SSO Basic Info record, one row per user, 1:1 with profiles.';

-- ---------- convenience view ----------
-- What the roster and export screens actually want, already joined and with
-- the display name assembled.
--
-- security_invoker = true is REQUIRED. Without it a Postgres view runs with the
-- owner's rights, which would let any signed-in user read every student's ID
-- and name straight through the view, bypassing the policies below.
create or replace view public.v_user_directory
with (security_invoker = true) as
select
  p.id            as user_id,
  p.email,
  p.role,
  c.student_id,
  btrim(coalesce(c.prename_th, '') || ' ' ||
        coalesce(c.firstname_th, '') || ' ' ||
        coalesce(c.lastname_th, ''))                as full_name_th,
  btrim(coalesce(c.firstname_en, '') || ' ' ||
        coalesce(c.lastname_en, ''))                as full_name_en,
  c.organization_code,
  c.organization_name_th,
  c.itaccounttype_id,
  c.last_login_at
from public.profiles p
left join public.cmu_accounts c on c.user_id = p.id;

-- ---------- upsert on sign-in ----------
-- Called once per sign-in with the raw JSON straight from CMU.
--
-- SECURITY: runs as definer so it can write profiles (which users cannot write
-- directly under RLS), but it refuses to write a row for anyone other than the
-- caller. Without that check any signed-in student could overwrite a
-- lecturer's record by posting their email.
create or replace function public.sync_cmu_account(p_payload jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid            uuid := auth.uid();
  v_caller_email   text;
  v_account        text;
  v_student_id     text;
  v_type           text;
  v_name_th        text;
  v_is_new         boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Normalise: CMU sends "" for missing values, we want NULL. student_id gets
  -- the extra zero-placeholder handling (see trap 2 in the header).
  v_account    := lower(nullif(btrim(p_payload->>'cmuitaccount'), ''));
  v_student_id := public.norm_student_id(p_payload->>'student_id');
  v_type       := nullif(btrim(p_payload->>'itaccounttype_id'), '');

  if v_account is null then
    raise exception 'Payload has no cmuitaccount';
  end if;

  -- The payload must belong to the caller. Compare against the email on the
  -- session token, not against anything in the payload itself. Falls back to
  -- auth.users if the JWT carries no email claim.
  v_caller_email := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  if v_caller_email is null then
    select lower(email) into v_caller_email from auth.users where id = v_uid;
  end if;
  if v_caller_email is distinct from v_account then
    raise exception 'CMU payload (%) does not match the signed-in account', v_account;
  end if;

  insert into public.cmu_accounts as t (
    user_id, cmuitaccount_name, cmuitaccount, student_id,
    prename_id, prename_th, prename_en,
    firstname_th, firstname_en, lastname_th, lastname_en,
    organization_code, organization_name_th, organization_name_en,
    itaccounttype_id, itaccounttype_th, itaccounttype_en,
    raw
  )
  values (
    v_uid,
    nullif(btrim(p_payload->>'cmuitaccount_name'), ''),
    v_account,
    v_student_id,
    nullif(btrim(p_payload->>'prename_id'), ''),
    nullif(btrim(p_payload->>'prename_TH'), ''),
    nullif(btrim(p_payload->>'prename_EN'), ''),
    nullif(btrim(p_payload->>'firstname_TH'), ''),
    nullif(btrim(p_payload->>'firstname_EN'), ''),
    nullif(btrim(p_payload->>'lastname_TH'), ''),
    nullif(btrim(p_payload->>'lastname_EN'), ''),
    nullif(btrim(p_payload->>'organization_code'), ''),
    nullif(btrim(p_payload->>'organization_name_TH'), ''),
    nullif(btrim(p_payload->>'organization_name_EN'), ''),
    v_type,
    nullif(btrim(p_payload->>'itaccounttype_TH'), ''),
    nullif(btrim(p_payload->>'itaccounttype_EN'), ''),
    p_payload
  )
  on conflict (user_id) do update set
    cmuitaccount_name    = excluded.cmuitaccount_name,
    cmuitaccount         = excluded.cmuitaccount,
    -- Never let a later sign-in blank out an ID we already hold.
    student_id           = coalesce(excluded.student_id, t.student_id),
    prename_id           = excluded.prename_id,
    prename_th           = excluded.prename_th,
    prename_en           = excluded.prename_en,
    firstname_th         = excluded.firstname_th,
    firstname_en         = excluded.firstname_en,
    lastname_th          = excluded.lastname_th,
    lastname_en          = excluded.lastname_en,
    organization_code    = excluded.organization_code,
    organization_name_th = excluded.organization_name_th,
    organization_name_en = excluded.organization_name_en,
    itaccounttype_id     = excluded.itaccounttype_id,
    itaccounttype_th     = excluded.itaccounttype_th,
    itaccounttype_en     = excluded.itaccounttype_en,
    raw                  = excluded.raw,
    last_login_at        = now(),
    updated_at           = now();

  -- Did this sign-in create the profile's first CMU link?
  select (first_seen_at = last_login_at) into v_is_new
    from public.cmu_accounts where user_id = v_uid;

  -- Push the derived fields onto the profile the rest of the app reads.
  v_name_th := nullif(btrim(
    coalesce(nullif(btrim(p_payload->>'prename_TH'), ''), '') || ' ' ||
    coalesce(nullif(btrim(p_payload->>'firstname_TH'), ''), '') || ' ' ||
    coalesce(nullif(btrim(p_payload->>'lastname_TH'), ''), '')
  ), '');

  update public.profiles
  set
    full_name    = coalesce(v_name_th, full_name),
    -- CMU's student ID wins over anything a lecturer typed by hand in 0017.
    student_code = coalesce(v_student_id, student_code),
    -- ROLE POLICY. Only ever set on the FIRST link, so an admin promotion is
    -- never undone by the next sign-in, and never downgraded.
    --   StdAcc    -> student
    --   MISEmpAcc -> guest, an admin promotes them to lecturer
    --
    -- CONFIRMED BY THE PI ON 2026-08-04. This is a settled decision, not a
    -- placeholder default: do not "helpfully" change it to 'lecturer'.
    --
    -- Rationale: CMU's "MIS Employee" account type covers EVERY member of
    -- faculty staff (office staff, technicians, administrators), not only
    -- teaching staff. A lecturer in this system can read every student's exam
    -- answers, so auto-promoting on account type alone would hand exam access
    -- to people who should not have it. The cost is one manual promotion per
    -- genuine lecturer, which is far cheaper than that exposure.
    role = case
             when not v_is_new then role
             when role in ('admin', 'lecturer') then role
             when v_type = 'StdAcc' then 'student'::user_role
             when v_type = 'MISEmpAcc' then 'guest'::user_role
             else role
           end
  where id = v_uid;
end $$;

grant execute on function public.sync_cmu_account(jsonb) to authenticated;

-- ---------- row level security ----------
alter table public.cmu_accounts enable row level security;

-- Everyone may read their own CMU record.
create policy "read own cmu account" on public.cmu_accounts
  for select using (user_id = auth.uid() or public.is_admin());

-- Course staff may read the CMU record of anyone in a course they teach, so
-- the roster, the grading panel and the CSV export can show the real Thai name
-- and student ID.
create policy "staff read cmu accounts of their students" on public.cmu_accounts
  for select using (
    exists (
      select 1
      from public.course_members cm_student
      join public.course_members cm_staff
        on cm_staff.course_id = cm_student.course_id
      where cm_student.user_id = cmu_accounts.user_id
        and cm_staff.user_id = auth.uid()
        and cm_staff.role_in_course = 'lecturer'
    )
  );

-- No INSERT/UPDATE/DELETE policies on purpose: all writes go through
-- sync_cmu_account(), which verifies the payload belongs to the caller.
