-- Sign-in code: after the password, a 6-digit code emailed to the account's own address.
-- Supabase's built-in MFA has no email factor, so the code is checked here and enforced by the
-- database itself: until the session's code is verified, every v2 API request and every
-- v2-research file is refused, whatever the client sends.
--   • The login-code Edge Function emails the code (SMTP) and verifies it, through the service-role
--     RPCs below; codes are stored only as an HMAC, for 10 minutes, 5 tries each.
--   • A session opened from an emailed link (set-password / recovery / magic link) already proved the
--     mailbox, so it counts as verified (JWT amr).
--   • Verified sessions are keyed by the JWT session_id and vanish with the session (sign-out or
--     expiry) through the foreign key to auth.sessions.
-- Undo: alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';

create table v2_private.login_codes (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_at timestamptz not null default now()
);
create table v2_private.login_code_sends (
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now()
);
create index v2_login_code_sends_idx on v2_private.login_code_sends (user_id, sent_at desc);
create table v2_private.login_verified (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  verified_at timestamptz not null default now()
);
revoke all on v2_private.login_codes, v2_private.login_code_sends, v2_private.login_verified
  from public, anon, authenticated;
-- No policies: only the SECURITY DEFINER functions below read or write these tables.
alter table v2_private.login_codes enable row level security;
alter table v2_private.login_code_sends enable row level security;
alter table v2_private.login_verified enable row level security;

-- Has the current request's session passed the sign-in code (or come from an emailed link)?
create function v2_private.session_verified() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    exists (select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
             where a ->> 'method' in ('otp', 'recovery', 'magiclink', 'invite', 'email/signup'))
    or exists (select 1 from v2_private.login_verified v
                where v.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
                  and v.user_id = (select auth.uid())),
    false)
$$;
grant execute on function v2_private.session_verified() to authenticated;

-- PostgREST runs this before every API request. Signed-in requests to the v2 schema are refused
-- until the sign-in code is verified; only login_code_status (which the sign-in screen asks)
-- passes. Anonymous requests (the sign-in page) and the service role are untouched, and so is
-- every other schema.
create function v2_private.check_request() returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_headers json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  v_schema text := coalesce(v_headers ->> 'content-profile', v_headers ->> 'accept-profile');
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or v_schema is distinct from 'v2' then
    return;
  end if;
  if current_setting('request.path', true) = '/rpc/login_code_status' then
    return;
  end if;
  if not v2_private.session_verified() then
    raise sqlstate 'PT403' using message = 'login_code_required',
      detail = 'Enter the sign-in code we emailed you.';
  end if;
end $$;
grant usage on schema v2_private to anon;
grant execute on function v2_private.check_request() to anon, authenticated;

-- The sign-in screen: is this session through, and where was the code sent (masked)?
create function v2.login_code_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'verified', v2_private.session_verified(),
    'sentTo', (select regexp_replace(u.email, '^(.)[^@]*', '\1•••') from auth.users u
                where u.id = (select auth.uid())))
  where (select auth.uid()) is not null
$$;
revoke all on function v2.login_code_status() from public, anon;
grant execute on function v2.login_code_status() to authenticated;

-- ───────────── for the login-code Edge Function (service role only) ─────────────
-- Stores a new code for the session; refuses more than one code per 30 seconds per session and
-- more than 5 per 15 minutes per person.
create function v2.login_code_store(p_session uuid, p_user uuid, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from v2_private.login_codes
              where session_id = p_session and sent_at > now() - interval '30 seconds') then
    return jsonb_build_object('stored', false, 'reason', 'too_soon');
  end if;
  if (select count(*) from v2_private.login_code_sends
       where user_id = p_user and sent_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('stored', false, 'reason', 'too_many');
  end if;
  insert into v2_private.login_codes (session_id, user_id, code_hash, expires_at)
  values (p_session, p_user, p_hash, now() + interval '10 minutes')
  on conflict (session_id) do update
    set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
        sent_at = now(), user_id = excluded.user_id;
  insert into v2_private.login_code_sends (user_id) values (p_user);
  delete from v2_private.login_code_sends where sent_at < now() - interval '1 day';
  return jsonb_build_object('stored', true);
end $$;

-- Checks a code: 'ok' (session now verified), 'wrong', 'expired', 'locked' or 'none'.
create function v2.login_code_check(p_session uuid, p_user uuid, p_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v v2_private.login_codes;
begin
  select * into v from v2_private.login_codes
   where session_id = p_session and user_id = p_user for update;
  if not found then return 'none'; end if;
  if v.expires_at < now() then return 'expired'; end if;
  if v.attempts >= 5 then return 'locked'; end if;
  if v.code_hash <> p_hash then
    update v2_private.login_codes set attempts = attempts + 1 where session_id = p_session;
    return case when v.attempts + 1 >= 5 then 'locked' else 'wrong' end;
  end if;
  delete from v2_private.login_codes where session_id = p_session;
  insert into v2_private.login_verified (session_id, user_id) values (p_session, p_user)
  on conflict (session_id) do nothing;
  insert into v2.audit_log (actor_id, actor_login, action, entity, entity_ref, detail)
  select p_user, p.login_id, 'login.code_verified', 'account', p.login_id, '{}'::jsonb
    from v2.profiles p where p.id = p_user;
  return 'ok';
end $$;

-- For the other Edge Functions: has this session passed its sign-in code?
create function v2.login_session_verified(p_session uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from v2_private.login_verified
                  where session_id = p_session and user_id = p_user)
$$;

revoke all on function v2.login_code_store(uuid, uuid, text) from public, anon, authenticated;
revoke all on function v2.login_code_check(uuid, uuid, text) from public, anon, authenticated;
revoke all on function v2.login_session_verified(uuid, uuid) from public, anon, authenticated;
grant execute on function v2.login_code_store(uuid, uuid, text) to service_role;
grant execute on function v2.login_code_check(uuid, uuid, text) to service_role;
grant execute on function v2.login_session_verified(uuid, uuid) to service_role;

-- Files: the same rule for the private v2-research bucket (Storage does not go through PostgREST).
create policy v2_research_login_code on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'v2-research' or v2_private.session_verified())
  with check (bucket_id <> 'v2-research' or v2_private.session_verified());

-- Switch the check on.
alter role authenticator set pgrst.db_pre_request = 'v2_private.check_request';
notify pgrst, 'reload config';
