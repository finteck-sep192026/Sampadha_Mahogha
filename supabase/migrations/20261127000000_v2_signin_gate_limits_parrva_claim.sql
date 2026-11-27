-- Security fixes, 27 Nov 2026 (part 1 of 2). Run this BEFORE deploying the login-code and parrva
-- Edge Functions; part 2 (20261127010000) is run after the new site is live.
--
--   1. Sign-in code gate: could be skipped on reads by sending mismatched schema headers.
--   2. Sign-in code sending limits: the no-password "email me a code" request (which anyone can make
--      for any account) spent the same allowance as the code after a password, so five anonymous
--      requests locked a person out of password sign-in.
--   3. CARE PaRRVA: one submission at a time per report, so a double click or two tabs cannot file
--      the same report twice.
begin;

-- ───────────────────────── 1. sign-in code gate ─────────────────────────
-- PostgREST picks the schema from Accept-Profile for GET/HEAD and from Content-Profile for the other
-- methods. The check used to read Content-Profile first for every method, so a GET that also carried
-- "Content-Profile: public" was served from v2 without the code. Now either header naming v2 is
-- enough to require it.
create or replace function v2_private.check_request() returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_headers json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return;
  end if;
  if coalesce(v_headers ->> 'content-profile', '') <> 'v2'
     and coalesce(v_headers ->> 'accept-profile', '') <> 'v2' then
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

-- ───────────────────────── 2. separate sending limits ─────────────────────────
-- 'code'  = the 6-digit code after a password (the person is signed in).
-- 'email' = the no-password email code (nobody is signed in; anyone can ask for any account).
alter table v2_private.login_code_sends
  add column kind text not null default 'code' check (kind in ('code', 'email'));

create or replace function v2.login_code_store(p_session uuid, p_user uuid, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from v2_private.login_codes
              where session_id = p_session and sent_at > now() - interval '30 seconds') then
    return jsonb_build_object('stored', false, 'reason', 'too_soon');
  end if;
  if (select count(*) from v2_private.login_code_sends
       where user_id = p_user and kind = 'code'
         and sent_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('stored', false, 'reason', 'too_many');
  end if;
  insert into v2_private.login_codes (session_id, user_id, code_hash, expires_at)
  values (p_session, p_user, p_hash, now() + interval '10 minutes')
  on conflict (session_id) do update
    set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
        sent_at = now(), user_id = excluded.user_id;
  insert into v2_private.login_code_sends (user_id, kind) values (p_user, 'code');
  delete from v2_private.login_code_sends where sent_at < now() - interval '1 day';
  return jsonb_build_object('stored', true);
end $$;

create or replace function v2.login_email_send(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from v2_private.login_code_sends
              where user_id = p_user and kind = 'email'
                and sent_at > now() - interval '30 seconds') then
    return 'too_soon';
  end if;
  if (select count(*) from v2_private.login_code_sends
       where user_id = p_user and kind = 'email'
         and sent_at > now() - interval '15 minutes') >= 5 then
    return 'too_many';
  end if;
  insert into v2_private.login_code_sends (user_id, kind) values (p_user, 'email');
  delete from v2_private.login_code_sends where sent_at < now() - interval '1 day';
  insert into v2.audit_log (actor_id, actor_login, action, entity, entity_ref, detail)
  select p_user, p.login_id, 'login.email_code_sent', 'account', p.login_id, '{}'::jsonb
    from v2.profiles p where p.id = p_user;
  return 'ok';
end $$;

-- ───────────────────────── 3. CARE PaRRVA: one submission at a time ─────────────────────────
-- 'Submitting' is held only while the parrva Edge Function is talking to NSE.
do $$
declare
  c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'v2.research_reports'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%parrva_status%' loop
    execute format('alter table v2.research_reports drop constraint %I', c.conname);
  end loop;
end $$;
alter table v2.research_reports
  add constraint research_reports_parrva_status_check
    check (parrva_status in ('Not sent', 'Submitting', 'Submitted', 'Failed')),
  add column parrva_claimed_at timestamptz;

-- Takes the report for one submission. Answers:
--   ok        → the caller may submit; "previous" is the status to put back if it never reaches NSE
--   submitted → already accepted (also repairs a report whose accepted attempt was recorded but
--               whose status was not)
--   busy      → another submission started less than 5 minutes ago
--   none      → no such report
create function v2.parrva_claim(p_report uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_claimed timestamptz;
  v_accepted timestamptz;
begin
  select parrva_status, parrva_claimed_at into v_status, v_claimed
    from v2.research_reports where id = p_report for update;
  if not found then
    return jsonb_build_object('result', 'none');
  end if;
  select max(submitted_at) into v_accepted
    from v2.parrva_submissions where report_id = p_report and ok;
  if v_status = 'Submitted' or v_accepted is not null then
    if v_status <> 'Submitted' then
      update v2.research_reports
         set parrva_status = 'Submitted',
             parrva_submitted_at = coalesce(parrva_submitted_at, v_accepted),
             parrva_message = 'Accepted by CARE PaRRVA',
             parrva_claimed_at = null
       where id = p_report;
    end if;
    return jsonb_build_object('result', 'submitted');
  end if;
  if v_status = 'Submitting' and v_claimed > now() - interval '5 minutes' then
    return jsonb_build_object('result', 'busy');
  end if;
  update v2.research_reports
     set parrva_status = 'Submitting', parrva_claimed_at = now()
   where id = p_report;
  return jsonb_build_object('result', 'ok',
                            'previous', case when v_status = 'Failed' then 'Failed' else 'Not sent' end);
end $$;
revoke all on function v2.parrva_claim(uuid) from public, anon, authenticated;
grant execute on function v2.parrva_claim(uuid) to service_role;

commit;
notify pgrst, 'reload schema';
