-- ============================================================
-- MEQ Exam Platform : designated system admin
-- ============================================================
-- WHY THIS EXISTS
--
-- handle_new_user() (0002) used to hand admin to whoever happened to sign up
-- first on a given database. That is fine for a throwaway dev project but not
-- for production: once faculty-code gating (see the auth callback) is live,
-- the first vet-med sign-in of the day could be anyone, not necessarily the
-- PI. This migration replaces that bootstrap with one hardcoded admin email,
-- and promotes the account if it already exists.
--
-- Run this once in the Supabase SQL editor, after 0018.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_default_role user_role := 'guest';
begin
  -- The designated system admin, regardless of sign-up order.
  if lower(new.email) = 'chalita.j@cmu.ac.th' then
    v_default_role := 'admin';
  else
    v_default_role := coalesce(
      nullif(current_setting('app.default_new_user_role', true), '')::user_role,
      'guest'
    );
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    v_default_role
  )
  on conflict (id) do nothing;

  return new;
end $$;

-- Promote the account if it already signed up under the old bootstrap rule
-- (e.g. as 'guest' or 'student', or as 'admin' only because it happened to be
-- first). Idempotent, safe to re-run.
update public.profiles
set role = 'admin'
where lower(email) = 'chalita.j@cmu.ac.th'
  and role is distinct from 'admin';
