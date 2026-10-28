-- Sign in with an email code, no password: the login-code Edge Function's 'request' action emails
-- a one-time Supabase Auth code to an active portal account, and the sign-in page verifies it
-- (auth.verifyOtp). That session counts as through both steps because it came from the mailbox
-- (JWT amr 'otp', see v2_private.session_verified in 20261028010000_v2_login_code.sql).
-- This adds only the sending limit, shared with the second-step codes (one email per 30 seconds and
-- 5 per 15 minutes per person), and an audit entry for each code sent.
create function v2.login_email_send(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from v2_private.login_code_sends
              where user_id = p_user and sent_at > now() - interval '30 seconds') then
    return 'too_soon';
  end if;
  if (select count(*) from v2_private.login_code_sends
       where user_id = p_user and sent_at > now() - interval '15 minutes') >= 5 then
    return 'too_many';
  end if;
  insert into v2_private.login_code_sends (user_id) values (p_user);
  delete from v2_private.login_code_sends where sent_at < now() - interval '1 day';
  insert into v2.audit_log (actor_id, actor_login, action, entity, entity_ref, detail)
  select p_user, p.login_id, 'login.email_code_sent', 'account', p.login_id, '{}'::jsonb
    from v2.profiles p where p.id = p_user;
  return 'ok';
end $$;
revoke all on function v2.login_email_send(uuid) from public, anon, authenticated;
grant execute on function v2.login_email_send(uuid) to service_role;
-- The function finds the account the same way the password sign-in does.
grant execute on function v2.resolve_login(text) to service_role;
