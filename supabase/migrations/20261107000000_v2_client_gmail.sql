-- Sampadha v2: broker orders go from the client's own Gmail. Full design: supabase/GMAIL-SEND.md.
--
-- * v2.client_gmail_tokens / v2.gmail_oauth_states: secrets, reachable only by service_role.
-- * v2.client_gmail_links: the state of each client's Gmail connection (no token material).
-- * v2.mailer_heartbeat: when the scheduled mailer run last started.
-- * v2.email_log gains send_via, alerted_at and attempts. The status constraint already allows every status
--   this feature uses (Queued, Sending, Sent, Failed, Expired), so it stays as it is. So does the
--   email_log_read policy: order and test rows carry client_id (the client sees them already) and an
--   'Order alert' row carries recipient_id = the report's author (who then sees it the same way).
-- * The consent wording changed, so every Active consent on the old version goes back to Pending.
--   That also keeps the mail queue safe between this migration and the new mailer going live: until
--   a client connects Gmail, which needs the new screens, no order or test row can be queued.
--
-- The 30-minute rule for broker orders lives in the mailer and does not change here.

begin;

-- ───────────────────────── mail queue ─────────────────────────
alter table v2.email_log
  add column send_via text not null default 'smtp' check (send_via in ('smtp', 'client_gmail')),
  add column alerted_at timestamptz,
  add column attempts int not null default 0; -- SMTP tries of an 'Order alert' row

-- The scheduled run alerts every Failed or Expired order with alerted_at null. Old rows are history,
-- not news: mark them as dealt with so nobody gets an alert about them.
update v2.email_log set alerted_at = now()
 where mail_type = 'Broker order' and status in ('Failed', 'Expired');

-- ───────────────────────── tokens and sign-in state (service_role only) ─────────────────────────
create table v2.client_gmail_tokens (
  client_id uuid primary key references v2.profiles (id) on delete cascade,
  gmail_address text not null,
  refresh_token_enc text not null, -- AES-256-GCM, encrypted by the Edge Function
  scope text not null,
  updated_at timestamptz not null default now()
);
alter table v2.client_gmail_tokens enable row level security;
revoke all on v2.client_gmail_tokens from public, anon, authenticated;
grant all on v2.client_gmail_tokens to service_role;

create table v2.gmail_oauth_states (
  state_hash text primary key,
  client_id uuid not null references v2.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index v2_gmail_oauth_states_client_idx on v2.gmail_oauth_states (client_id);
alter table v2.gmail_oauth_states enable row level security;
revoke all on v2.gmail_oauth_states from public, anon, authenticated;
grant all on v2.gmail_oauth_states to service_role;

-- ───────────────────────── connection state ─────────────────────────
create table v2.client_gmail_links (
  client_id uuid primary key references v2.profiles (id) on delete cascade,
  gmail_address text,
  status text not null default 'Disconnected'
    check (status in ('Connected', 'Reconnect needed', 'Disconnected')),
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_sent_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  check (status <> 'Connected' or gmail_address is not null)
);
alter table v2.client_gmail_links enable row level security;
create policy client_gmail_links_read on v2.client_gmail_links for select to authenticated
  using (client_id = (select auth.uid()) or v2_private.is_role('admin', 'sales', 'ra'));
revoke all on v2.client_gmail_links from public, anon, authenticated;
grant select on v2.client_gmail_links to authenticated;
grant all on v2.client_gmail_links to service_role;

-- ───────────────────────── scheduled run ─────────────────────────
-- One row. The mailer writes it at the start of every scheduled run, and the Admin mail panel reads
-- it through the mailer's status action, so a schedule that has stopped is seen.
create table v2.mailer_heartbeat (
  id boolean primary key default true check (id),
  last_cron_at timestamptz
);
insert into v2.mailer_heartbeat default values;
alter table v2.mailer_heartbeat enable row level security;
create policy mailer_heartbeat_read on v2.mailer_heartbeat for select to authenticated
  using (v2_private.is_role('admin'));
revoke all on v2.mailer_heartbeat from public, anon, authenticated;
grant select on v2.mailer_heartbeat to authenticated;
grant all on v2.mailer_heartbeat to service_role;

-- ───────────────────────── consent version ─────────────────────────
create or replace function v2_private.broker_consent_version() returns text
language sql immutable set search_path = '' as $$ select 'BAE-2026-11-07' $$;

-- Pending rows carry no consent version or date (see save_broker_email); the audit entry keeps what
-- the client had agreed to.
do $$
declare
  v_row record;
begin
  for v_row in
    select c.client_id, c.consent_version, c.consented_at, p.login_id
      from v2.broker_email_consents c join v2.profiles p on p.id = c.client_id
     where c.status = 'Active'
       and c.consent_version is distinct from v2_private.broker_consent_version()
       for update of c
  loop
    update v2.broker_email_consents
       set status = 'Pending', consent_version = null, consented_at = null, updated_by = null,
           updated_at = now()
     where client_id = v_row.client_id;
    perform v2_private.log_audit('broker_email.reconsent_required', 'broker_email_consent',
                                 v_row.login_id,
                                 jsonb_build_object('from_version', v_row.consent_version,
                                                    'to_version', v2_private.broker_consent_version(),
                                                    'consented_at', v_row.consented_at));
    insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
    values ('ALT-' || nextval('v2_private.mail_ref_seq'), v_row.client_id, 'In-app',
            'Connect your Gmail and consent again',
            'Order emails to your broker now go from your own Gmail, so your earlier consent has '
              || 'ended. No order email goes to your broker until you connect your Gmail and give '
              || 'your consent again on the Broker auto-email page.');
  end loop;
end $$;

-- ───────────────────────── consent needs a connected Gmail ─────────────────────────
-- As in 20261027020000_v2_broker_email.sql, with the Gmail check added.
create or replace function v2.save_broker_email(p_login_id text, p_broker text, p_broker_client_id text,
                                                p_to_email text, p_cc_emails text, p_consent boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := v2_private.broker_email_client(p_login_id);
  v_is_client boolean := v2_private.is_role('client');
  v_broker text := trim(coalesce(p_broker, ''));
  v_code text := upper(trim(coalesce(p_broker_client_id, '')));
  v_to text := lower(trim(coalesce(p_to_email, '')));
  v_cc text[] := v2_private.email_list(p_cc_emails);
  v_old v2.broker_email_consents;
  v_status text;
begin
  if char_length(v_broker) not between 2 and 80 then
    raise exception 'Enter the broker name';
  end if;
  if v_code !~ '^[A-Z0-9._/-]{2,30}$' then
    raise exception 'Enter the broker client ID (letters, digits, . _ / -)';
  end if;
  if not v2_private.valid_email(v_to) then
    raise exception 'Enter the broker''s order email address (TO)';
  end if;
  if coalesce(p_consent, false) and not v_is_client then
    raise exception 'Only the client can give the consent' using errcode = '42501';
  end if;
  if coalesce(p_consent, false) and not exists (
       select 1 from v2.client_gmail_links where client_id = v_client and status = 'Connected') then
    raise exception 'Connect your Gmail first';
  end if;

  select * into v_old from v2.broker_email_consents where client_id = v_client for update;
  v_status := case
    when v_is_client and coalesce(p_consent, false) then 'Active'
    when v_old.client_id is not null and v_old.status = 'Active' and v_old.broker = v_broker
         and v_old.broker_client_id = v_code and v_old.to_email = v_to and v_old.cc_emails = v_cc
      then 'Active'
    else 'Pending' end;

  insert into v2.broker_email_consents as c (client_id, broker, broker_client_id, to_email,
                                             cc_emails, status, consent_version, consented_at,
                                             revoked_at, updated_by, updated_at)
  values (v_client, v_broker, v_code, v_to, v_cc, v_status,
          case when v_status = 'Active' then v2_private.broker_consent_version() end,
          case when v_status = 'Active' then now() end, null, (select auth.uid()), now())
  on conflict (client_id) do update set
    broker = excluded.broker, broker_client_id = excluded.broker_client_id,
    to_email = excluded.to_email, cc_emails = excluded.cc_emails, status = excluded.status,
    consent_version = case when excluded.status = 'Active' and v_is_client and p_consent
                           then excluded.consent_version
                           when excluded.status = 'Active' then c.consent_version end,
    consented_at = case when excluded.status = 'Active' and v_is_client and p_consent
                        then excluded.consented_at
                        when excluded.status = 'Active' then c.consented_at end,
    revoked_at = null, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  perform v2_private.log_audit(
    case when v_status = 'Active' and v_is_client and p_consent then 'broker_email.consented'
         else 'broker_email.details_saved' end,
    'broker_email_consent', (select login_id from v2.profiles where id = v_client),
    jsonb_build_object('broker', v_broker, 'broker_client_id', v_code, 'to', v_to, 'cc', v_cc,
                       'status', v_status, 'version', v2_private.broker_consent_version()));
  return jsonb_build_object('status', v_status);
end $$;

-- ───────────────────────── RA and Sales/Admin list ─────────────────────────
-- A client with no link row has never connected, which reads as 'Disconnected'.
drop function v2.list_broker_email_clients();
create function v2.list_broker_email_clients()
returns table (client_id uuid, login_id text, full_name text, broker text, broker_client_id text,
               to_email text, cc_emails text[], status text, consented_at timestamptz,
               updated_at timestamptz, gmail_status text, gmail_address text)
language sql stable security definer set search_path = '' as $$
  select c.client_id, p.login_id, p.full_name, c.broker, c.broker_client_id, c.to_email,
         c.cc_emails, c.status, c.consented_at, c.updated_at,
         coalesce(g.status, 'Disconnected'), g.gmail_address
  from v2.broker_email_consents c join v2.profiles p on p.id = c.client_id
  left join v2.client_gmail_links g on g.client_id = c.client_id
  where v2_private.is_role('admin', 'sales', 'ra')
  order by p.login_id
$$;

-- ───────────────────────── order email text ─────────────────────────
-- 120.00 → 120, 120.50 → 120.5
create function v2_private.plain_number(p numeric) returns text
language sql immutable set search_path = '' as $$ select trim_scale(p)::text $$;

-- The tier a leg's product belongs to, or null if it is not a Multi tier. Report legs keep the name
-- they were signed with, so the old names (20261030000000_v2_multi_tiers.sql) still count.
create function v2_private.multi_tier_of(p_product text) returns text
language sql immutable set search_path = '' as $$
  select case lower(trim(p_product))
    when 'bronze' then 'Bronze' when 'nano' then 'Bronze'
    when 'silver' then 'Silver' when 'micro' then 'Silver'
    when 'palladium' then 'Palladium' when 'mini' then 'Palladium'
    when 'platinum' then 'Platinum' when 'mega' then 'Platinum'
    when 'gold' then 'Gold' when 'giga' then 'Gold'
    when 'rhodium' then 'Rhodium' end
$$;

-- The legs a broker can still act on: not fully exited, and not past expiry in India. Delivery fires
-- before send_research_report opens the legs, so a new leg here is still 'Generated'.
create function v2_private.broker_live_legs(p_report_id uuid) returns setof v2.research_legs
language sql stable security definer set search_path = '' as $$
  select l.* from v2.research_legs l
   where l.report_id = p_report_id and l.status <> 'Closed' and l.remaining_lots > 0
     and (l.expiry is null or l.expiry >= (now() at time zone 'Asia/Kolkata')::date)
$$;

-- Why no order can be worked out for this client, or null. One leg nobody can place stops the order:
-- it might be this client's, and leaving it out would send a partial order as if it were whole.
create function v2_private.broker_order_problem(p_report_id uuid, p_client_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from v2_private.broker_live_legs(p_report_id)) then null
    when exists (select 1 from v2_private.broker_live_legs(p_report_id) l
                  where v2_private.multi_tier_of(l.product) is null)
      then 'Not sent: a leg of this report has a product that is not a known tier'
    when not exists (select 1 from v2.subscriptions s
                      where s.client_id = p_client_id and s.status = 'Active'
                        and s.multi_tier is not null)
      then 'Not sent: the client has no active Multi tier' end
$$;

-- One line per order, newline separated (GMAIL-SEND.md): only live legs of the client's own tier, at
-- the lots still open. The CSV and the Quick input both store the underlying in contract_name (NIFTY),
-- the same value as symbol, so that alone would be an order with no expiry or strike. It is used on its
-- own only when it says more than symbol does (legs from the first CSV format); otherwise the contract
-- is built from the leg.
create function v2_private.broker_instruction_lines(p_report_id uuid, p_client_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(string_agg(line, E'\n' order by pos), '')
  from (
    select l.position as pos,
           lower(l.side) || ' ' || l.remaining_lots
           || case when l.remaining_lots = 1 then ' lot ' else ' lots ' end
           || case when nullif(trim(l.contract_name), '') is not null
                        and upper(trim(l.contract_name)) <> upper(l.symbol)
                   then trim(l.contract_name)
                   else concat_ws(' ', l.symbol, to_char(l.expiry, 'DDMON'),
                                  v2_private.plain_number(l.strike), l.option_type) end
           -- A stated entry price always goes out, even on a CMP leg: Quick input stores every leg as
           -- CMP, so going by price type alone would turn "@120-125" into an unlimited market order.
           || case when coalesce(l.initiation_price, l.entry_price_end) is null
                     then ' at market'
                   when l.initiation_price is null or l.entry_price_end is null
                        or l.initiation_price = l.entry_price_end
                     then ' at ' || v2_private.plain_number(coalesce(l.initiation_price, l.entry_price_end))
                   else ' at ' || v2_private.plain_number(l.initiation_price)
                        || ' - ' || v2_private.plain_number(l.entry_price_end) end
           || coalesce(', target ' || v2_private.plain_number(l.t1), '')
           || coalesce(', stop-loss ' || v2_private.plain_number(l.stop_loss), '') as line
    from v2_private.broker_live_legs(p_report_id) l
    where v2_private.multi_tier_of(l.product) in (
            select s.multi_tier from v2.subscriptions s
             where s.client_id = p_client_id and s.status = 'Active')
  ) x
$$;

create function v2_private.broker_instruction_body(p_broker_client_id text, p_lines text,
                                                   p_test boolean) returns text
language sql immutable set search_path = '' as $$
  select (case when p_test then E'TEST EMAIL - sample only. Do not place any order.\n\n' else '' end)
      || E'Dear Team,\n\nfor ' || p_broker_client_id || E' -\n' || p_lines || E'\n\nThanks'
$$;

-- "Trade Instructions 7/11/2026 for - THFGHF of Angel One", dated in IST. The broker name is free
-- text, so any line break is flattened before it reaches a mail header.
create function v2_private.broker_instruction_subject(p_broker_client_id text, p_broker text,
                                                      p_test boolean) returns text
language sql stable set search_path = '' as $$
  select (case when p_test then 'TEST - ' else '' end)
      || 'Trade Instructions ' || to_char(now() at time zone 'Asia/Kolkata', 'FMDD/FMMM/YYYY')
      || ' for - ' || p_broker_client_id || ' of ' || regexp_replace(p_broker, '\s+', ' ', 'g')
$$;

-- ───────────────────────── alerts ─────────────────────────
-- Tells the client and the report's author once that an order did not go as planned. The fixed text
-- says "could not confirm", not "not sent", because after a timeout Gmail may have delivered it
-- (GMAIL-SEND.md rule 3). p_reason is quoted as given, and says "Not sent" only when that is certain.
create function v2.broker_mail_alert(p_mail_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_mail v2.email_log;
  v_report v2.research_reports;
  v_author v2.profiles;
  v_client v2.profiles;
  v_about text;
  v_reason text := left(coalesce(nullif(trim(p_reason), ''), 'The order email could not be sent'), 300);
begin
  update v2.email_log set alerted_at = now()
   where id = p_mail_id and mail_type = 'Broker order' and alerted_at is null
  returning * into v_mail;
  if not found then
    return;
  end if;
  select * into v_report from v2.research_reports where id = v_mail.report_id;
  select * into v_author from v2.profiles where id = v_report.author_id;
  select * into v_client from v2.profiles where id = v_mail.client_id;
  v_about := coalesce(v_report.report_ref, v_mail.mail_ref);

  if v_client.id is not null then
    insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
    values ('ALT-' || nextval('v2_private.mail_ref_seq'), v_client.id, 'In-app',
            'Broker order needs your attention',
            'We could not confirm that the order email for ' || v_about || ' reached '
              || coalesce(v_mail.recipient_name, 'your broker') || '. Reason: ' || v_reason
              || '. Please check with your broker before acting, so that nothing is placed twice.');
  end if;

  if v_author.id is not null then
    insert into v2.email_log (mail_ref, report_id, recipient_id, recipient_email, recipient_name,
                              subject, mail_type, send_via, body, created_by)
    values ('MAIL-' || nextval('v2_private.mail_ref_seq'), v_mail.report_id, v_author.id,
            v_author.email, v_author.full_name,
            'Order alert · ' || v_about || ' · ' || coalesce(v_client.login_id, 'client'),
            'Order alert', 'smtp',
            'We could not confirm that a broker order email went out.' || E'\n\n'
              || 'Report: ' || v_about || E'\n'
              || 'Client: ' || coalesce(v_client.full_name || ' (' || v_client.login_id || ')', 'not on file')
              || E'\n'
              || 'Broker: ' || coalesce(v_mail.recipient_name, 'not on file') || E'\n'
              || 'Status: ' || v_mail.status || E'\n'
              || 'Reason: ' || v_reason || E'\n'
              || 'Reference: ' || v_mail.mail_ref || E'\n\n'
              || 'Please speak to the client. They should check with their broker before acting, '
              || 'so that nothing is placed twice.',
            (select auth.uid()));
  end if;

  perform v2_private.log_audit('broker_email.alerted', 'email_log', v_mail.mail_ref,
                               jsonb_build_object('report', v_report.report_ref,
                                                  'client', v_client.login_id,
                                                  'status', v_mail.status,
                                                  'reason', v_reason));
end $$;

-- For the delivery trigger: an alert that fails must not touch the delivery. Its changes roll back,
-- so alerted_at stays null and the scheduled run sends the alert instead.
create function v2_private.try_broker_mail_alert(p_mail_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform v2.broker_mail_alert(p_mail_id, p_reason);
exception when others then
  raise warning 'broker_mail_alert % failed: %', p_mail_id, sqlerrm;
end $$;

-- ───────────────────────── queue the order ─────────────────────────
-- Same trigger as before. Nothing in here may stop the client's report: every error is caught, and
-- a failure to build the order becomes a Failed row with an alert, so people are told. The technical
-- error goes to the audit log only, because clients can read their own email_log rows.
create or replace function v2_private.queue_broker_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_consent v2.broker_email_consents;
  v_report_ref text;
  v_lines text;
  v_problem text;
  v_failure text;
  v_connected boolean;
  v_mail_id uuid;
  v_error text;
begin
  begin
    select * into v_consent from v2.broker_email_consents
     where client_id = new.client_id and status = 'Active';
    if not found then
      return new;
    end if;
    select report_ref into v_report_ref from v2.research_reports where id = new.report_id;
    if not exists (select 1 from v2.research_legs where report_id = new.report_id) then
      return new; -- a Cash report, or an uploaded PDF
    end if;
    v_problem := v2_private.broker_order_problem(new.report_id, new.client_id);
    if v_problem is null then
      v_lines := v2_private.broker_instruction_lines(new.report_id, new.client_id);
      if v_lines = '' then
        perform v2_private.log_audit(
          'broker_email.nothing_to_send', 'research_report', v_report_ref,
          jsonb_build_object('client', new.client_id, 'reason',
            case when exists (select 1 from v2_private.broker_live_legs(new.report_id))
                 then 'No legs for this client''s tier' else 'No open legs left' end));
        return new;
      end if;
    end if;
    v_connected := exists (select 1 from v2.client_gmail_links
                            where client_id = new.client_id and status = 'Connected');
    v_failure := coalesce(v_problem,
                          case when not v_connected then 'The client''s Gmail is not connected' end);

    insert into v2.email_log (mail_ref, report_id, client_id, recipient_email, recipient_name,
                              cc_emails, subject, mail_type, send_via, status, provider_message,
                              body, created_by)
    values ('MAIL-' || nextval('v2_private.mail_ref_seq'), new.report_id, new.client_id,
            v_consent.to_email, v_consent.broker, v_consent.cc_emails,
            v2_private.broker_instruction_subject(v_consent.broker_client_id, v_consent.broker, false),
            'Broker order', 'client_gmail',
            case when v_failure is null then 'Queued' else 'Failed' end, v_failure,
            case when v_problem is null
                 then v2_private.broker_instruction_body(v_consent.broker_client_id, v_lines, false)
                 else 'The order email could not be prepared, so nothing was sent.' end,
            (select auth.uid()))
    returning id into v_mail_id;
    perform v2_private.log_audit('broker_email.queued', 'research_report', v_report_ref,
                                 jsonb_build_object('client', new.client_id,
                                                    'to', v_consent.to_email,
                                                    'gmail_connected', v_connected,
                                                    'problem', v_problem));
    if v_failure is not null then
      perform v2_private.try_broker_mail_alert(v_mail_id, v_failure);
    end if;
  exception when others then
    -- Everything above is rolled back here, so no Queued row can survive next to this Failed one.
    v_error := left(sqlerrm, 300);
    begin
      perform v2_private.log_audit('broker_email.queue_failed', 'research_report',
                                   coalesce(v_report_ref, new.report_id::text),
                                   jsonb_build_object('client', new.client_id, 'error', v_error));
    exception when others then
      raise warning 'broker_email.queue_failed for report %, client %: %',
                    new.report_id, new.client_id, v_error;
    end;
    if v_consent.client_id is not null then
      begin
        insert into v2.email_log (mail_ref, report_id, client_id, recipient_email, recipient_name,
                                  cc_emails, subject, mail_type, send_via, status,
                                  provider_message, body, created_by)
        values ('MAIL-' || nextval('v2_private.mail_ref_seq'), new.report_id, new.client_id,
                v_consent.to_email, v_consent.broker, v_consent.cc_emails,
                'Trade Instructions for - ' || v_consent.broker_client_id,
                'Broker order', 'client_gmail', 'Failed',
                'The order email could not be prepared',
                'The order email could not be prepared, so nothing was sent.',
                (select auth.uid()))
        returning id into v_mail_id;
        perform v2_private.try_broker_mail_alert(v_mail_id, 'The order email could not be prepared');
      exception when others then
        raise warning 'Could not record the failed order for report %, client %: %',
                      new.report_id, new.client_id, sqlerrm;
        -- Last resort. With no row the schedule cannot raise the alert, so the client hears it here.
        begin
          insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
          values ('ALT-' || nextval('v2_private.mail_ref_seq'), new.client_id, 'In-app',
                  'Broker order needs your attention',
                  'The order email for ' || coalesce(v_report_ref, 'your latest report')
                    || ' could not be prepared, so nothing went to ' || v_consent.broker
                    || '. Please contact Sampadha before acting.');
        exception when others then
          raise warning 'Could not notify the client for report %, client %: %',
                        new.report_id, new.client_id, sqlerrm;
        end;
      end;
    end if;
  end;
  return new;
end $$;

-- ───────────────────────── test email ─────────────────────────
-- p_login_id stays so the portal's call keeps working. It no longer selects anyone: only the client
-- can send, from their own Gmail.
create or replace function v2.send_broker_test_email(p_login_id text, p_test_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := (select auth.uid());
  v_to text := lower(trim(coalesce(nullif(trim(p_test_email), ''),
                                   (select email from v2.profiles where id = (select auth.uid())))));
  v_consent v2.broker_email_consents;
  v_ref text;
begin
  if not v2_private.is_role('client') then
    raise exception 'Only the client can send a test from their own Gmail' using errcode = '42501';
  end if;
  if not v2_private.valid_email(v_to) then
    raise exception 'Enter a valid test email address';
  end if;
  select * into v_consent from v2.broker_email_consents where client_id = v_client;
  if not found then
    raise exception 'Save the broker details first';
  end if;
  if not exists (select 1 from v2.client_gmail_links
                  where client_id = v_client and status = 'Connected') then
    raise exception 'Connect your Gmail first';
  end if;
  if (select count(*) from v2.email_log where mail_type = 'Broker test'
        and created_by = (select auth.uid()) and sent_at > now() - interval '1 hour') >= 10 then
    raise exception 'At most 10 test emails an hour';
  end if;
  v_ref := 'MAIL-' || nextval('v2_private.mail_ref_seq');
  insert into v2.email_log (mail_ref, client_id, recipient_email, recipient_name, subject,
                            mail_type, send_via, body, created_by)
  values (v_ref, v_client, v_to, null,
          v2_private.broker_instruction_subject(v_consent.broker_client_id, v_consent.broker, true),
          'Broker test', 'client_gmail',
          v2_private.broker_instruction_body(v_consent.broker_client_id,
            'buy 1 lot NIFTY 25000 CE at 120 - 125, target 150, stop-loss 100 (sample)', true),
          (select auth.uid()));
  perform v2_private.log_audit('broker_email.test_queued', 'broker_email_consent',
                               v_consent.broker_client_id, jsonb_build_object('to', v_to));
  return jsonb_build_object('mail_ref', v_ref, 'to', v_to);
end $$;

-- ───────────────────────── replaced functions ─────────────────────────
drop function v2_private.broker_order_lines(uuid);
drop function v2_private.broker_order_body(uuid, text, text, boolean);
drop function v2_private.price_text(numeric);

-- ───────────────────────── mail queued under the old route ─────────────────────────
-- A broker row still Queued here has send_via 'smtp' and would leave from Sampadha's mailbox, which
-- rule 1 forbids. Stop it; orders are alerted now, tests never are. A row in 'Sending' was claimed by
-- the old mailer and may have gone (rule 3), so it is never sent again and says delivery is unknown.
-- Anything in 'Sending' for over an hour is history, like the old Failed rows above: no alert, and
-- the mailer does not resend it. Newer non-broker rows stay for the mailer's stale check.
do $$
declare
  v_id uuid;
  v_reason constant text := 'Not sent: broker orders now go only through the client''s Gmail';
  v_unknown constant text := 'The send did not finish, so delivery is unknown. It may or may not have gone out';
begin
  update v2.email_log set status = 'Failed', provider_message = v_unknown, alerted_at = now()
   where status = 'Sending' and send_via = 'smtp' and sent_at < now() - interval '1 hour';
  update v2.email_log set status = 'Failed', provider_message = v_reason
   where mail_type = 'Broker test' and status = 'Queued' and send_via = 'smtp';
  update v2.email_log set status = 'Failed', provider_message = v_unknown
   where mail_type = 'Broker test' and status = 'Sending' and send_via = 'smtp';
  for v_id in
    update v2.email_log set status = 'Failed', provider_message = v_reason
     where mail_type = 'Broker order' and status = 'Queued' and send_via = 'smtp'
    returning id
  loop
    perform v2.broker_mail_alert(v_id, v_reason);
  end loop;
  for v_id in
    update v2.email_log set status = 'Failed', provider_message = v_unknown
     where mail_type = 'Broker order' and status = 'Sending' and send_via = 'smtp'
    returning id
  loop
    perform v2.broker_mail_alert(v_id, v_unknown);
  end loop;
end $$;

-- ───────────────────────── privileges ─────────────────────────
revoke all on function v2.save_broker_email(text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function v2.list_broker_email_clients() from public, anon, authenticated;
revoke all on function v2.send_broker_test_email(text, text) from public, anon, authenticated;
revoke all on function v2.broker_mail_alert(uuid, text) from public, anon, authenticated;
revoke all on function v2_private.broker_consent_version() from public, anon, authenticated;
revoke all on function v2_private.plain_number(numeric) from public, anon, authenticated;
revoke all on function v2_private.multi_tier_of(text) from public, anon, authenticated;
revoke all on function v2_private.broker_live_legs(uuid) from public, anon, authenticated;
revoke all on function v2_private.broker_order_problem(uuid, uuid) from public, anon, authenticated;
revoke all on function v2_private.broker_instruction_lines(uuid, uuid) from public, anon, authenticated;
revoke all on function v2_private.broker_instruction_body(text, text, boolean) from public, anon, authenticated;
revoke all on function v2_private.broker_instruction_subject(text, text, boolean) from public, anon, authenticated;
revoke all on function v2_private.try_broker_mail_alert(uuid, text) from public, anon, authenticated;
revoke all on function v2_private.queue_broker_order() from public, anon, authenticated;
grant execute on function v2.save_broker_email(text, text, text, text, text, boolean) to authenticated;
grant execute on function v2.list_broker_email_clients() to authenticated;
grant execute on function v2.send_broker_test_email(text, text) to authenticated;
grant execute on function v2.broker_mail_alert(uuid, text) to service_role;

-- The compliance list and the Overview meter count broker auto-email as on only when an order could
-- really go out: consent Active and the client's Gmail Connected.
create or replace function v2.list_client_compliance()
returns table (client_id uuid, login_id text, full_name text, email text, is_active boolean,
               kyc_status text, risk_category text, risk_score int, derivatives_suitable boolean,
               risk_at timestamptz, agreement_signed_at timestamptz, documents_pending int,
               broker_email_status text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.login_id, p.full_name, p.email, p.is_active, p.kyc_status,
         rp.category, rp.score, rp.derivatives_suitable, rp.submitted_at,
         (select max(d.signed_at) from v2.client_documents d
           where d.client_id = p.id and d.kind = 'Client agreement' and d.status = 'Signed'),
         (select count(*)::int from v2.client_documents d
           where d.client_id = p.id and d.status in ('Awaiting signature', 'Signing')),
         (select case when c.status = 'Active'
                       and coalesce((select g.status from v2.client_gmail_links g
                                      where g.client_id = p.id), '') <> 'Connected'
                      then 'Gmail not connected' else c.status end
            from v2.broker_email_consents c where c.client_id = p.id)
  from v2.profiles p
  left join lateral (select r.category, r.score, r.derivatives_suitable, r.submitted_at
                       from v2.risk_profiles r where r.client_id = p.id
                      order by r.submitted_at desc limit 1) rp on true
  where p.role = 'client' and v2_private.is_role('admin', 'sales', 'ra')
  order by p.login_id
$$;

commit;
