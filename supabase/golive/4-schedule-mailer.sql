-- Runs the mailer every minute: POST {"action":"cron"} with header x-cron-secret. The mailer then records
-- its heartbeat, marks stale Sending rows, retries failed Order alerts, flushes the queue and alerts
-- failed or expired broker orders. Run in the SQL Editor, after the mailer is deployed. Safe to re-run:
-- the job is replaced, not added twice.
--
-- First store the secret in Vault, once, with the same value as the MAILER_CRON_SECRET Edge Function
-- secret. Run this on its own and do not save it in a file:
--   select vault.create_secret('<value of MAILER_CRON_SECRET>', 'mailer_cron_secret',
--                              'Sent as x-cron-secret to the mailer');
-- To change it later (the job reads Vault on every run, so it needs no re-run):
--   select vault.update_secret(
--     (select id from vault.decrypted_secrets where name = 'mailer_cron_secret'), '<new value>');
--
-- To stop the schedule:
--   select cron.unschedule('mailer-cron');

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'mailer_cron_secret') then
    raise exception 'Store mailer_cron_secret in Vault first (see the top of this file)';
  end if;
end $$;

select cron.schedule('mailer-cron', '* * * * *', $job$
  select net.http_post(
    url := 'https://nxtyswlxnmekpvlfuucg.supabase.co/functions/v1/mailer',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', s.decrypted_secret),
    body := jsonb_build_object('action', 'cron'),
    timeout_milliseconds := 55000
  )
  from vault.decrypted_secrets s
  where s.name = 'mailer_cron_secret'
$job$);
