-- Sampadha v2: broker auto-email (Mahogha's "Auto Email Execution", with the client's own consent)
-- and real outbound mail.
--
-- * v2.broker_email_consents: one row per client with the broker, broker client ID, the broker's
--   dealing-desk address (TO) and CC copies. Sales/Admin may enter the details, but the order email is
--   only sent once the client has confirmed them in the portal (status 'Active'); the client can
--   withdraw at any time. Every change is written to the audit log.
-- * When a signed report is delivered to a consenting client (v2.research_deliveries insert), an
--   order email built from the report's legs / Cash rows is queued to that client's broker.
-- * email_log rows are now 'Queued'; the mailer Edge Function sends them over SMTP (secrets SMTP_*),
--   or marks them 'Simulated' while mail is not set up. Broker orders older than 30 minutes are never
--   sent late ('Expired').

-- ───────────────────────── mail queue ─────────────────────────
alter table v2.email_log
  add column cc_emails text[] not null default '{}',
  add column client_id uuid references v2.profiles (id) on delete set null,
  add column delivered_at timestamptz,
  add column provider_message text;
alter table v2.email_log alter column status set default 'Queued';
alter table v2.email_log add constraint email_log_status_check
  check (status in ('Queued', 'Sending', 'Sent', 'Failed', 'Simulated', 'Expired'));
create index v2_email_log_queued_idx on v2.email_log (sent_at) where status = 'Queued';
create index v2_email_log_client_idx on v2.email_log (client_id);

-- Clients also see the broker emails sent on their behalf.
drop policy email_log_read on v2.email_log;
create policy email_log_read on v2.email_log for select to authenticated using (
  v2_private.is_role('admin')
  or recipient_id = (select auth.uid())
  or client_id = (select auth.uid())
  or (v2_private.is_role('sales') and (application_ref is not null or mail_type = 'Broker test'))
);

-- ───────────────────────── consents ─────────────────────────
create table v2.broker_email_consents (
  client_id uuid primary key references v2.profiles (id) on delete cascade,
  broker text not null check (char_length(broker) between 2 and 80),
  broker_client_id text not null check (broker_client_id ~ '^[A-Za-z0-9._/-]{2,30}$'),
  to_email text not null,
  cc_emails text[] not null default '{}',
  status text not null default 'Pending' check (status in ('Pending', 'Active', 'Revoked')),
  consent_version text,
  consented_at timestamptz,
  revoked_at timestamptz,
  updated_by uuid references v2.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table v2.broker_email_consents enable row level security;
create policy broker_email_consents_read on v2.broker_email_consents for select to authenticated
  using (client_id = (select auth.uid()) or v2_private.is_role('admin', 'sales'));
grant select on v2.broker_email_consents to authenticated;
grant all on v2.broker_email_consents to service_role;

-- The consent wording the client agrees to. Bump the version whenever the text changes.
create function v2_private.broker_consent_version() returns text
language sql immutable set search_path = '' as $$ select 'BAE-2026-10-27' $$;

create function v2_private.valid_email(p_email text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
                  and char_length(p_email) <= 254, false)
$$;

-- "a@x.com; b@y.com" → {a@x.com,b@y.com} (lower-case, unique, at most 5).
create function v2_private.email_list(p_text text) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  v_list text[];
begin
  select coalesce(array_agg(distinct lower(trim(x))), '{}') into v_list
  from unnest(regexp_split_to_array(coalesce(p_text, ''), '[;,\s]+')) x where trim(x) <> '';
  if exists (select 1 from unnest(v_list) e where not v2_private.valid_email(e)) then
    raise exception 'Check the CC email addresses (separate them with ;)';
  end if;
  if array_length(v_list, 1) > 5 then
    raise exception 'Use at most 5 CC email addresses';
  end if;
  return v_list;
end $$;

-- The client a call is about: the signed-in client, or (Admin / Sales) the client with that login ID.
create function v2_private.broker_email_client(p_login_id text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if v2_private.is_role('client') then
    return (select auth.uid());
  end if;
  if not v2_private.is_role('admin', 'sales') then
    raise exception 'Admin or Sales access required' using errcode = '42501';
  end if;
  select id into v_id from v2.profiles
   where role = 'client' and upper(login_id) = upper(trim(coalesce(p_login_id, '')));
  if v_id is null then
    raise exception 'Client % not found', p_login_id;
  end if;
  return v_id;
end $$;

-- Saves the broker details. Sales/Admin entries (and any change of details) wait for the client's
-- confirmation; p_consent = true is accepted only from the client and makes the consent Active.
create function v2.save_broker_email(p_login_id text, p_broker text, p_broker_client_id text,
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

create function v2.revoke_broker_email(p_login_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := v2_private.broker_email_client(p_login_id);
begin
  update v2.broker_email_consents
     set status = 'Revoked', revoked_at = now(), updated_by = (select auth.uid()), updated_at = now()
   where client_id = v_client and status <> 'Revoked';
  if not found then
    raise exception 'There is no broker auto-email to withdraw';
  end if;
  perform v2_private.log_audit('broker_email.revoked', 'broker_email_consent',
                               (select login_id from v2.profiles where id = v_client), '{}');
  return jsonb_build_object('status', 'Revoked');
end $$;

-- For the RA send screens (which clients get the broker email) and the Sales/Admin page.
create function v2.list_broker_email_clients()
returns table (client_id uuid, login_id text, full_name text, broker text, broker_client_id text,
               to_email text, cc_emails text[], status text, consented_at timestamptz,
               updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.client_id, p.login_id, p.full_name, c.broker, c.broker_client_id, c.to_email,
         c.cc_emails, c.status, c.consented_at, c.updated_at
  from v2.broker_email_consents c join v2.profiles p on p.id = c.client_id
  where v2_private.is_role('admin', 'sales', 'ra')
  order by p.login_id
$$;

-- ───────────────────────── order email text ─────────────────────────
create function v2_private.price_text(p numeric) returns text
language sql immutable set search_path = '' as $$
  select case when p is null then '—' else 'Rs ' || trim(to_char(p, 'FM999999990.00')) end
$$;

create function v2_private.broker_order_lines(p_report_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(string_agg(line, E'\n' order by pos), '')
  from (
    select l.position as pos,
           l.position || '. ' || l.side || ' ' || l.lots || ' lot(s) × ' || l.lot_size || ' = '
           || l.quantity || ' qty  ' || coalesce(nullif(l.contract_name, ''),
                concat_ws(' ', l.symbol, to_char(l.expiry, 'DDMONYY'), l.strike, l.option_type))
           || E'\n   Exchange: ' || coalesce(nullif(l.exchange_name, ''), '—')
           || '  ·  Price type: ' || coalesce(nullif(l.price_type, ''), 'LIMIT')
           || '  ·  Product: ' || case when upper(coalesce(l.if_intraday, '')) = 'YES'
                                       then 'Intraday (MIS)' else 'Carry forward (NRML)' end
           || E'\n   Entry: ' || v2_private.price_text(l.initiation_price)
           || case when l.entry_price_end is null then ''
                   else ' – ' || v2_private.price_text(l.entry_price_end) end
           || '  ·  Target: ' || v2_private.price_text(l.t1)
           || '  ·  Stop-loss: ' || v2_private.price_text(l.stop_loss) as line
    from v2.research_legs l where l.report_id = p_report_id
    union all
    select r.position,
           r.position || '. ' || r.action || ' ' || r.quantity || ' share(s)  ' || r.stock
           || ' (ISIN ' || r.isin || ')' || E'\n   Exchange: ' || r.exchange_name
           || '  ·  Price: ' || v2_private.price_text(r.initiation_price)
           || '  ·  Product: Delivery (CNC)'
    from v2.cash_report_rows r where r.report_id = p_report_id and r.action in ('BUY', 'SELL')
  ) x
$$;

create function v2_private.broker_order_body(p_client uuid, p_lines text, p_ref text,
                                             p_test boolean) returns text
language sql stable security definer set search_path = '' as $$
  select (case when p_test then E'TEST EMAIL — this is a sample. Do not place any order.\n\n' else '' end)
      || 'Dear ' || c.broker || ' dealing desk,' || E'\n\n'
      || 'Our client ' || p.full_name || ' (broker client ID ' || c.broker_client_id || ') has '
      || 'asked Sampadha, a SEBI-registered Research Analyst, to send our research recommendations '
      || 'to you by email. The client gave this consent in the Sampadha portal on '
      || to_char(coalesce(c.consented_at, now()) at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI')
      || ' IST (' || coalesce(c.consent_version, v2_private.broker_consent_version()) || ').'
      || E'\n\n' || 'Recommendation ' || p_ref || ':' || E'\n\n' || p_lines || E'\n\n'
      || 'Validity: Day. Please act only as per the client''s standing authorisation with you; '
      || 'Sampadha does not hold client funds or securities and does not place orders.'
      || E'\n\n' || 'Regards,' || E'\n' || 'Sampadha Research'
  from v2.broker_email_consents c join v2.profiles p on p.id = c.client_id
  where c.client_id = p_client
$$;

-- Queues the order email when a report reaches a client whose broker auto-email is Active.
create function v2_private.queue_broker_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_consent v2.broker_email_consents;
  v_report v2.research_reports;
  v_lines text;
  v_name text;
begin
  select * into v_consent from v2.broker_email_consents
   where client_id = new.client_id and status = 'Active';
  if not found then
    return new;
  end if;
  select * into v_report from v2.research_reports where id = new.report_id;
  v_lines := v2_private.broker_order_lines(new.report_id);
  if v_lines = '' then
    return new; -- e.g. a Cash report with HOLD rows only
  end if;
  select full_name into v_name from v2.profiles where id = new.client_id;
  insert into v2.email_log (mail_ref, report_id, client_id, recipient_email, recipient_name,
                            cc_emails, subject, mail_type, body, created_by)
  values ('MAIL-' || nextval('v2_private.mail_ref_seq'), new.report_id, new.client_id,
          v_consent.to_email, v_consent.broker,
          v_consent.cc_emails,
          'Order instruction · ' || v_name || ' (' || v_consent.broker_client_id || ') · '
            || v_report.report_ref,
          'Broker order',
          v2_private.broker_order_body(new.client_id, v_lines, v_report.report_ref, false),
          (select auth.uid()));
  perform v2_private.log_audit('broker_email.queued', 'research_report', v_report.report_ref,
                               jsonb_build_object('client', new.client_id, 'to', v_consent.to_email));
  return new;
end $$;
create trigger research_deliveries_broker_email after insert on v2.research_deliveries
  for each row execute function v2_private.queue_broker_order();

-- "Send test email": a sample order to a test address (default: the signed-in user's email).
create function v2.send_broker_test_email(p_login_id text, p_test_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := v2_private.broker_email_client(p_login_id);
  v_to text := lower(trim(coalesce(nullif(trim(p_test_email), ''),
                                   (select email from v2.profiles where id = (select auth.uid())))));
  v_consent v2.broker_email_consents;
  v_ref text := 'MAIL-' || nextval('v2_private.mail_ref_seq');
begin
  if not v2_private.valid_email(v_to) then
    raise exception 'Enter a valid test email address';
  end if;
  select * into v_consent from v2.broker_email_consents where client_id = v_client;
  if not found then
    raise exception 'Save the broker details first';
  end if;
  if (select count(*) from v2.email_log where mail_type = 'Broker test'
        and created_by = (select auth.uid()) and sent_at > now() - interval '1 hour') >= 10 then
    raise exception 'At most 10 test emails an hour';
  end if;
  insert into v2.email_log (mail_ref, client_id, recipient_email, recipient_name, subject,
                            mail_type, body, created_by)
  values (v_ref, v_client, v_to, null,
          'TEST · Order instruction · ' || v_consent.broker_client_id,
          'Broker test',
          v2_private.broker_order_body(v_client,
            E'1. BUY 1 lot(s) × 75 = 75 qty  NIFTY 25000 CE (sample)\n'
            || E'   Exchange: NSE  ·  Price type: LIMIT  ·  Product: Carry forward (NRML)\n'
            || '   Entry: Rs 120.00 – Rs 125.00  ·  Target: Rs 150.00  ·  Stop-loss: Rs 100.00',
            'TEST', true),
          (select auth.uid()));
  perform v2_private.log_audit('broker_email.test_queued', 'broker_email_consent',
                               v_consent.broker_client_id, jsonb_build_object('to', v_to));
  return jsonb_build_object('mail_ref', v_ref, 'to', v_to);
end $$;

-- ───────────────────────── privileges ─────────────────────────
revoke all on function v2.save_broker_email(text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function v2.revoke_broker_email(text) from public, anon, authenticated;
revoke all on function v2.list_broker_email_clients() from public, anon, authenticated;
revoke all on function v2.send_broker_test_email(text, text) from public, anon, authenticated;
revoke all on function v2_private.broker_consent_version() from public, anon, authenticated;
revoke all on function v2_private.valid_email(text) from public, anon, authenticated;
revoke all on function v2_private.email_list(text) from public, anon, authenticated;
revoke all on function v2_private.broker_email_client(text) from public, anon, authenticated;
revoke all on function v2_private.price_text(numeric) from public, anon, authenticated;
revoke all on function v2_private.broker_order_lines(uuid) from public, anon, authenticated;
revoke all on function v2_private.broker_order_body(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function v2_private.queue_broker_order() from public, anon, authenticated;
grant execute on function v2.save_broker_email(text, text, text, text, text, boolean) to authenticated;
grant execute on function v2.revoke_broker_email(text) to authenticated;
grant execute on function v2.list_broker_email_clients() to authenticated;
grant execute on function v2.send_broker_test_email(text, text) to authenticated;
