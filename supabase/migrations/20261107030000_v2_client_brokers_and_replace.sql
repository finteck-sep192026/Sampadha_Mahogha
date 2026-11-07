-- Sampadha v2: one broker per market segment, Sales-led broker auto-email, product prices, and
-- report delivery status and replacement for the Research Analyst.
--
-- * Add client: services, and one broker account (with its own amount) per ticked segment. The older
--   single-broker columns keep the first account, and proposed_amount keeps the total.
-- * v2.broker_desks: Admin's list of broker order addresses, the default TO on the auto-email form.
-- * v2.product_prices: Admin's annual price for each product, shown beside it in Add client.
-- * Broker auto-email: Sales enters the details and sends the client a consent request by email and
--   in the portal. The client can only connect Gmail, consent, or withdraw. Only the client can
--   consent, so no request turns sending on.
-- * Replace: a new PDF for a report already sent. The old PDF is kept at <id>/archive/v<n>.pdf, the
--   report must be eSigned again, clients get a notice, and no broker order goes out, because the
--   order trigger fires only on a new delivery row.

begin;

-- ───────────────────────── Add client ─────────────────────────
alter table v2.client_applications
  add column services text[] not null default '{}',
  add column broker_accounts jsonb not null default '[]',
  add column quoted_annual numeric(12, 2);

create table v2.broker_desks (
  name text primary key check (char_length(name) between 2 and 80),
  order_email text,
  sort_order int not null default 100,
  updated_at timestamptz not null default now()
);
insert into v2.broker_desks (name, sort_order) values
  ('Motilal Oswal', 10), ('Bajaj Broking', 20), ('Northeast Broking', 30), ('Angel One', 40),
  ('Kotak Securities', 50), ('Zerodha', 60), ('ICICI Direct', 70), ('HDFC Securities', 80),
  ('Upstox', 90);
alter table v2.broker_desks enable row level security;
create policy broker_desks_read on v2.broker_desks for select to authenticated
  using (v2_private.is_role('admin', 'sales'));
create policy broker_desks_write on v2.broker_desks for all to authenticated
  using (v2_private.is_role('admin')) with check (v2_private.is_role('admin'));
grant select, insert, update, delete on v2.broker_desks to authenticated;
grant all on v2.broker_desks to service_role;

create table v2.product_prices (
  product text primary key,
  segment text not null check (segment in ('Cash', 'Multi')),
  price_annual numeric(12, 2) check (price_annual >= 0),
  sort_order int not null default 100,
  updated_at timestamptz not null default now()
);
insert into v2.product_prices (product, segment, sort_order) values
  ('LC', 'Cash', 10), ('MC', 'Cash', 20), ('SC', 'Cash', 30), ('FC', 'Cash', 40),
  ('Bronze', 'Multi', 50), ('Silver', 'Multi', 60), ('Palladium', 'Multi', 70),
  ('Platinum', 'Multi', 80), ('Gold', 'Multi', 90), ('Rhodium', 'Multi', 100);
alter table v2.product_prices enable row level security;
create policy product_prices_read on v2.product_prices for select to authenticated
  using (v2_private.is_role('admin', 'sales'));
create policy product_prices_update on v2.product_prices for update to authenticated
  using (v2_private.is_role('admin')) with check (v2_private.is_role('admin'));
grant select, update on v2.product_prices to authenticated;
grant all on v2.product_prices to service_role;

create or replace function v2.submit_client_application(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ref text := 'APP-' || nextval('v2_private.app_ref_seq');
  v_id uuid;
  v_name text := trim(payload ->> 'name');
  v_email text := trim(payload ->> 'email');
  v_segments text[] := coalesce(array(select jsonb_array_elements_text(payload -> 'segments')), '{}');
  v_services text[] := coalesce(array(select jsonb_array_elements_text(payload -> 'services')), '{}');
  v_products text[] := coalesce(array(select jsonb_array_elements_text(payload -> 'products')), '{}');
  v_accounts jsonb := coalesce(payload -> 'accounts', '[]');
  v_first jsonb := v_accounts -> 0;
  v_account jsonb;
  v_lines text := '';
  v_total numeric := 0;
  v_quote numeric;
begin
  if not v2_private.is_role('sales', 'admin') then
    raise exception 'Sales or Admin access required' using errcode = '42501';
  end if;
  if coalesce(v_name, '') = '' or coalesce(v_email, '') = '' then
    raise exception 'Name and email are required';
  end if;
  if coalesce(payload ->> 'pan', '') !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'PAN must look like ABCDE1234F';
  end if;
  if coalesce((payload ->> 'consent')::boolean, false) is not true then
    raise exception 'Confirm that the details can be sent to the client';
  end if;
  if cardinality(v_segments) = 0 then
    raise exception 'Tick at least one market segment';
  end if;
  if jsonb_typeof(v_accounts) <> 'array' or jsonb_array_length(v_accounts) <> cardinality(v_segments) then
    raise exception 'Fill in a broker for each ticked market segment';
  end if;

  for v_account in select * from jsonb_array_elements(v_accounts) loop
    if coalesce(v_account ->> 'broker', '') = '' or coalesce(v_account ->> 'demat', '') = ''
       or coalesce(v_account ->> 'tradingId', '') = '' or coalesce(v_account ->> 'bank', '') = ''
       or coalesce(nullif(v_account ->> 'amount', '')::numeric, 0) <= 0 then
      raise exception 'Complete the broker details and amount for %', v_account ->> 'segment';
    end if;
    v_total := v_total + (v_account ->> 'amount')::numeric;
    v_lines := v_lines || E'\n\n' || (v_account ->> 'segment') ||
      E'\nBroker: ' || (v_account ->> 'broker') ||
      E'\nDepository: ' || coalesce(v_account ->> 'depository', '-') ||
      E'\nDemat / BO ID: XXXX' || right(v_account ->> 'demat', 4) ||
      E'\nTrading client ID: ' || (v_account ->> 'tradingId') ||
      E'\nProposed investment amount: ' || (v_account ->> 'amount');
  end loop;

  select sum(price_annual) into v_quote from v2.product_prices where product = any (v_products);

  insert into v2.client_applications (
    app_ref, submitted_by, full_name, pan, dob, email, mobile, occupation, income_band,
    tax_residency, city, broker, depository, demat_id, trading_client_id, bank,
    mf_experience, stock_experience, fo_experience, segments, services, products, broker_accounts,
    quoted_annual, horizon, objective, proposed_amount, loss_tolerance, consent
  ) values (
    v_ref, (select auth.uid()), v_name, payload ->> 'pan', nullif(payload ->> 'dob', '')::date,
    v_email, payload ->> 'mobile', payload ->> 'occupation', payload ->> 'income',
    payload ->> 'residency', payload ->> 'city', v_first ->> 'broker', v_first ->> 'depository',
    v_first ->> 'demat', v_first ->> 'tradingId', v_first ->> 'bank',
    v_first ->> 'mfExperience', v_first ->> 'stockExperience', v_first ->> 'foExperience',
    v_segments, v_services, v_products, v_accounts, v_quote,
    payload ->> 'horizon', payload ->> 'objective', v_total, payload ->> 'loss', true
  ) returning id into v_id;

  insert into v2.email_log (mail_ref, application_ref, recipient_email, recipient_name, subject,
                            mail_type, body, created_by)
  values ('MAIL-' || nextval('v2_private.mail_ref_seq'), v_ref, v_email, v_name,
          'We received your Sampadha client application', 'Submission confirmation',
          'Your client onboarding application ' || v_ref ||
          ' has been received and is pending Admin review. We will notify you after a decision.' ||
          E'\n\nPlease check the details below and tell your Sampadha contact if anything is wrong.' ||
          E'\n\nPAN: XXXXXX' || right(payload ->> 'pan', 4) ||
          E'\nMobile: ' || coalesce(payload ->> 'mobile', '-') ||
          E'\nMarket segments: ' || array_to_string(v_segments, ', ') ||
          E'\nServices: ' || coalesce(nullif(array_to_string(v_services, ', '), ''), '-') ||
          E'\nProducts: ' || coalesce(nullif(array_to_string(v_products, ', '), ''), '-') ||
          E'\nHolding horizon: ' || coalesce(payload ->> 'horizon', '-') ||
          E'\nInvestment objective: ' || coalesce(payload ->> 'objective', '-') ||
          E'\nMaximum loss tolerance: ' || coalesce(payload ->> 'loss', '-') ||
          v_lines,
          (select auth.uid()));

  perform v2_private.log_audit('application.submitted', 'client_application', v_ref,
                               jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_id, 'app_ref', v_ref);
end $$;

-- ───────────────────────── broker auto-email ─────────────────────────
alter table v2.broker_email_consents
  add column requested_at timestamptz,
  add column request_count int not null default 0;

-- Same as 20261107000000, except that a client can no longer add or change the details.
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
  if v_is_client and (v_old.client_id is null or v_old.broker is distinct from v_broker
       or v_old.broker_client_id is distinct from v_code or v_old.to_email is distinct from v_to
       or v_old.cc_emails is distinct from v_cc) then
    raise exception 'Your Sampadha contact sets up these details. Ask them to make any change.'
      using errcode = '42501';
  end if;
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

-- A withdrawn consent goes back to Pending so the client can give it again. Nothing is sent until
-- the client does: orders need Active.
create function v2.send_broker_consent_request(p_login_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client v2.profiles;
  v_row v2.broker_email_consents;
  v_ref text := 'MAIL-' || nextval('v2_private.mail_ref_seq');
begin
  if not v2_private.is_role('admin', 'sales') then
    raise exception 'Sales or Admin access required' using errcode = '42501';
  end if;
  select * into v_client from v2.profiles
   where upper(login_id) = upper(trim(coalesce(p_login_id, ''))) and role = 'client';
  if not found then
    raise exception 'Client not found';
  end if;
  select * into v_row from v2.broker_email_consents where client_id = v_client.id for update;
  if not found then
    raise exception 'Enter the client''s broker details first';
  end if;
  if v_row.status = 'Active' and exists (
       select 1 from v2.client_gmail_links where client_id = v_client.id and status = 'Connected') then
    raise exception 'Broker auto-email is already on for this client';
  end if;

  update v2.broker_email_consents
     set status = case when status = 'Revoked' then 'Pending' else status end,
         revoked_at = null, requested_at = now(), request_count = request_count + 1,
         updated_by = (select auth.uid()), updated_at = now()
   where client_id = v_client.id;

  insert into v2.email_log (mail_ref, recipient_id, client_id, recipient_email, recipient_name,
                            subject, mail_type, body, created_by)
  values (v_ref, v_client.id, v_client.id, v_client.email, v_client.full_name,
          'Please approve broker auto-email for your Sampadha account', 'Consent request',
          'Your Sampadha contact has set up broker auto-email for your account.' ||
          E'\n\nBroker: ' || v_row.broker ||
          E'\nBroker client ID: ' || v_row.broker_client_id ||
          E'\nOrder email: ' || v_row.to_email ||
          E'\n\nTo switch it on, sign in at https://racrm.fintecindia.com, open Broker auto-email, ' ||
          'connect your Gmail and give your consent. Nothing is sent to your broker until you do, ' ||
          'and you can withdraw your consent there at any time.',
          (select auth.uid()));
  insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
  values ('ALT-' || nextval('v2_private.mail_ref_seq'), v_client.id, 'In-app',
          'Please approve broker auto-email',
          'Your Sampadha contact set up order emails to ' || v_row.broker ||
          '. Open Broker auto-email, connect your Gmail and give your consent.');

  perform v2_private.log_audit('broker_email.consent_requested', 'broker_email_consent',
                               v_client.login_id, jsonb_build_object('count', v_row.request_count + 1));
  return jsonb_build_object('mail_ref', v_ref);
end $$;
revoke all on function v2.send_broker_consent_request(text) from public, anon;
grant execute on function v2.send_broker_consent_request(text) to authenticated;

drop function v2.list_broker_email_clients();
create function v2.list_broker_email_clients()
returns table (client_id uuid, login_id text, full_name text, broker text, broker_client_id text,
               to_email text, cc_emails text[], status text, consented_at timestamptz,
               updated_at timestamptz, gmail_status text, gmail_address text,
               requested_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.client_id, p.login_id, p.full_name, c.broker, c.broker_client_id, c.to_email,
         c.cc_emails, c.status, c.consented_at, c.updated_at,
         coalesce(g.status, 'Disconnected'), g.gmail_address, c.requested_at
  from v2.broker_email_consents c join v2.profiles p on p.id = c.client_id
  left join v2.client_gmail_links g on g.client_id = c.client_id
  where v2_private.is_role('admin', 'sales', 'ra')
  order by p.login_id
$$;
revoke all on function v2.list_broker_email_clients() from public, anon;
grant execute on function v2.list_broker_email_clients() to authenticated;

drop policy email_log_read on v2.email_log;
create policy email_log_read on v2.email_log for select to authenticated using (
  v2_private.is_role('admin')
  or recipient_id = (select auth.uid())
  or client_id = (select auth.uid())
  or (v2_private.is_role('sales')
      and (application_ref is not null
           or mail_type in ('Broker test', 'Research report', 'Consent request')))
);

create or replace function v2.mail_meta() returns table (mail_ref text, sender text, segment text)
language sql stable security definer set search_path = '' as $$
  select e.mail_ref,
         case p.role when 'admin' then 'Admin' when 'ra' then 'RA' when 'sales' then 'Sales'
                     else 'System' end,
         r.segment
    from v2.email_log e
    left join v2.profiles p on p.id = e.created_by
    left join v2.research_reports r on r.id = e.report_id
   where v2_private.is_role('admin')
      or (v2_private.is_role('sales')
          and (e.application_ref is not null
               or e.mail_type in ('Broker test', 'Research report', 'Consent request')))
$$;

-- ───────────────────────── report delivery ─────────────────────────
-- What reached each client: the portal, the email notice, and the broker order.
create function v2.report_delivery_status(p_report_id uuid)
returns table (login_id text, full_name text, delivered_at timestamptz, notice_status text,
               notice_at timestamptz, order_status text, order_to text, order_at timestamptz,
               order_via text, order_note text)
language sql stable security definer set search_path = '' as $$
  select p.login_id, p.full_name, d.delivered_at, n.status, n.sent_at, o.status,
         o.recipient_email, o.sent_at, o.send_via, o.provider_message
    from v2.research_deliveries d
    join v2.profiles p on p.id = d.client_id
    left join lateral (select e.status, e.sent_at from v2.email_log e
                        where e.report_id = d.report_id and e.recipient_id = d.client_id
                          and e.mail_type = 'Research report'
                        order by e.sent_at desc limit 1) n on true
    left join lateral (select e.status, e.recipient_email, e.sent_at, e.send_via, e.provider_message
                         from v2.email_log e
                        where e.report_id = d.report_id and e.client_id = d.client_id
                          and e.mail_type = 'Broker order'
                        order by e.sent_at desc limit 1) o on true
   where d.report_id = p_report_id and v2_private.owns_report(p_report_id)
   order by p.login_id
$$;
revoke all on function v2.report_delivery_status(uuid) from public, anon;
grant execute on function v2.report_delivery_status(uuid) to authenticated;

-- ───────────────────────── replace a sent report's PDF ─────────────────────────
alter table v2.research_reports
  add column replacing boolean not null default false,
  add column pdf_version int not null default 1;

create table v2.report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references v2.research_reports (id) on delete cascade,
  version int not null,
  archive_path text not null,
  was_signed boolean not null,
  reason text not null,
  replaced_by uuid references v2.profiles (id) on delete set null,
  replaced_at timestamptz not null default now(),
  unique (report_id, version)
);
alter table v2.report_versions enable row level security;
create policy report_versions_read on v2.report_versions for select to authenticated
  using (v2_private.owns_report(report_id));
grant select on v2.report_versions to authenticated;
grant all on v2.report_versions to service_role;

-- While a replacement is open the owner may archive the current PDF and overwrite preview.pdf.
create or replace function v2_private.author_may_write(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select ((p_name ~ '^[0-9a-f-]{36}/attachments/[0-2]$' or p_name ~ '^[0-9a-f-]{36}/preview\.pdf$')
          and v2_private.can_edit_draft(v2_private.object_report_id(p_name)))
      or ((p_name ~ '^[0-9a-f-]{36}/preview\.pdf$' or p_name ~ '^[0-9a-f-]{36}/archive/v[0-9]+\.pdf$')
          and v2_private.owns_report(v2_private.object_report_id(p_name))
          and exists (select 1 from v2.research_reports r
                       where r.id = v2_private.object_report_id(p_name) and r.replacing))
$$;

-- A replaced Cash report is unsigned until it is signed again, so clients read its stored PDF too.
create or replace function v2_private.may_read_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select v2_private.owns_report(v2_private.object_report_id(p_name))
      or (p_name ~ '^[0-9a-f-]{36}/signed\.pdf$'
          and v2_private.can_see_report(v2_private.object_report_id(p_name)))
      or (p_name ~ '^[0-9a-f-]{36}/preview\.pdf$'
          and v2_private.can_see_report(v2_private.object_report_id(p_name))
          and exists (select 1 from v2.research_reports r
                       where r.id = v2_private.object_report_id(p_name)
                         and r.esign_status <> 'Signed'))
$$;

create function v2.begin_report_replacement(p_report_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_report v2.research_reports;
begin
  if not v2_private.owns_report(p_report_id) then
    raise exception 'Only the report''s author or Admin can replace it' using errcode = '42501';
  end if;
  select * into v_report from v2.research_reports where id = p_report_id for update;
  if not exists (select 1 from v2.research_deliveries where report_id = p_report_id) then
    raise exception 'This report has not been sent to any client';
  end if;
  update v2.research_reports set replacing = true where id = p_report_id;
  return jsonb_build_object('version', v_report.pdf_version,
                            'source', coalesce(v_report.signed_pdf_path, p_report_id || '/preview.pdf'));
end $$;

create function v2.finish_report_replacement(p_report_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_report v2.research_reports;
  v_reason text := trim(coalesce(p_reason, ''));
  v_client record;
  v_count int := 0;
begin
  if not v2_private.owns_report(p_report_id) then
    raise exception 'Only the report''s author or Admin can replace it' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 5 and 300 then
    raise exception 'Say why the report is being replaced (5 to 300 characters)';
  end if;
  select * into v_report from v2.research_reports where id = p_report_id for update;
  if not v_report.replacing then
    raise exception 'Start the replacement again';
  end if;

  insert into v2.report_versions (report_id, version, archive_path, was_signed, reason, replaced_by)
  values (p_report_id, v_report.pdf_version,
          p_report_id || '/archive/v' || v_report.pdf_version || '.pdf',
          v_report.esign_status = 'Signed', v_reason, (select auth.uid()));
  update v2.research_reports
     set replacing = false, pdf_version = pdf_version + 1, esign_status = 'Unsigned',
         signed_at = null, signer_name = null, signed_pdf_path = null
   where id = p_report_id;

  for v_client in
    select p.id, p.full_name, p.email from v2.research_deliveries d
      join v2.profiles p on p.id = d.client_id where d.report_id = p_report_id
  loop
    v_count := v_count + 1;
    insert into v2.email_log (mail_ref, report_id, recipient_id, recipient_email, recipient_name,
                              subject, mail_type, body, created_by)
    values ('MAIL-' || nextval('v2_private.mail_ref_seq'), p_report_id, v_client.id, v_client.email,
            v_client.full_name, 'Updated report: ' || v_report.title, 'Research report',
            'Your research report ' || v_report.title || ' has been updated. Reason: ' || v_reason ||
            E'\n\nThe new PDF is available under Reports received. No new broker order has been sent.',
            (select auth.uid()));
    insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
    values ('ALT-' || nextval('v2_private.mail_ref_seq'), v_client.id, 'In-app',
            'Research report updated',
            v_report.title || ' has a new PDF under Reports received. Reason: ' || v_reason);
  end loop;

  perform v2_private.log_audit('report.replaced', 'research_report', v_report.report_ref,
                               jsonb_build_object('version', v_report.pdf_version + 1,
                                                  'was_signed', v_report.esign_status = 'Signed',
                                                  'clients', v_count, 'reason', v_reason));
  return jsonb_build_object('clients', v_count);
end $$;
revoke all on function v2.begin_report_replacement(uuid) from public, anon;
revoke all on function v2.finish_report_replacement(uuid, text) from public, anon;
grant execute on function v2.begin_report_replacement(uuid) to authenticated;
grant execute on function v2.finish_report_replacement(uuid, text) to authenticated;

commit;
