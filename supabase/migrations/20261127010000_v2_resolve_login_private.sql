-- Security fixes, 27 Nov 2026 (part 2 of 2). Run this LAST: after the login-code Edge Function is
-- deployed and the new site is published. The old site calls resolve_login from the browser, so
-- running this first would stop ID sign-in until the new site is live.
--
-- v2.resolve_login gave the account email for any login ID to anyone, signed in or not. Login IDs
-- run in sequence (CL-1001, CL-1002, …), so every client's email could be listed. The sign-in page
-- no longer needs it: the login-code function looks the account up itself (actions 'password' and
-- 'email-code'), and only the service role may call it now.
revoke all on function v2.resolve_login(text) from public, anon, authenticated;
grant execute on function v2.resolve_login(text) to service_role;
notify pgrst, 'reload schema';
