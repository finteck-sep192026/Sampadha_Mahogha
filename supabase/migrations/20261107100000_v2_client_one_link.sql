-- Sampadha v2: the client's one link, and broker auto-email on Add client.
--
-- * Creating a client login no longer sends a set-password link. The client gets one link that signs
--   them in and opens their consent page (client-link function). Only its hash is stored, and it
--   stops working after 7 days or once nothing is left to accept. It is never logged, so staff
--   cannot use a client's link.
-- * Add client now records whether the client wants broker auto-email, and its addresses.

begin;

create table v2.client_access_links (
  client_id uuid primary key references v2.profiles (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_opened_at timestamptz
);
alter table v2.client_access_links enable row level security;
revoke all on v2.client_access_links from public, anon, authenticated;
grant all on v2.client_access_links to service_role;

alter table v2.client_applications add column auto_email jsonb;

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
  v_total numeric := nullif(payload ->> 'amount', '')::numeric;
  v_mf text := coalesce(payload ->> 'mfExperience', v_first ->> 'mfExperience');
  v_stock text := coalesce(payload ->> 'stockExperience', v_first ->> 'stockExperience');
  v_fo text := coalesce(payload ->> 'foExperience', v_first ->> 'foExperience');
  v_quote numeric;
  v_pdf text := nullif(payload ->> 'pdfPath', '');
  v_auto jsonb := payload -> 'autoEmail';
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
  if v_pdf is not null and not v2_private.is_application_pdf(v_pdf) then
    raise exception 'The onboarding PDF was not stored correctly';
  end if;
  if coalesce((v_auto ->> 'wanted')::boolean, false) then
    if not v2_private.valid_email(v_auto ->> 'to') then
      raise exception 'Enter the broker order email (TO) for auto-email';
    end if;
    if upper(trim(coalesce(v_auto ->> 'tradingId', ''))) !~ '^[A-Z0-9._/-]{2,30}$' then
      raise exception 'The trading client ID can use only letters, digits and . _ / -';
    end if;
  end if;
  if cardinality(v_segments) = 0 then
    raise exception 'Tick at least one market segment';
  end if;
  if cardinality(v_products) = 0 then
    raise exception 'Tick at least one product';
  end if;
  if jsonb_typeof(v_accounts) <> 'array' or jsonb_array_length(v_accounts) <> cardinality(v_products) then
    raise exception 'Fill in a broker for each ticked product';
  end if;
  if v_total is null then
    select sum((a ->> 'amount')::numeric) into v_total from jsonb_array_elements(v_accounts) a;
  end if;
  if coalesce(v_total, 0) <= 0 then
    raise exception 'Enter the proposed investment amount';
  end if;

  for v_account in select * from jsonb_array_elements(v_accounts) loop
    if coalesce(v_account ->> 'broker', '') = '' or coalesce(v_account ->> 'demat', '') = ''
       or coalesce(v_account ->> 'tradingId', '') = '' or coalesce(v_account ->> 'bank', '') = '' then
      raise exception 'Complete the broker details for %', v_account ->> 'product';
    end if;
    if coalesce(v_account ->> 'ifsc', '') !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
      raise exception 'Enter a valid bank IFSC code for %', v_account ->> 'product';
    end if;
    if coalesce(v_account ->> 'accountNumber', '') !~ '^[0-9]{9,18}$' then
      raise exception 'Enter a valid bank account number for %', v_account ->> 'product';
    end if;
    v_lines := v_lines || E'\n\n' || (v_account ->> 'product') ||
      E'\nBroker: ' || (v_account ->> 'broker') ||
      E'\nDepository: ' || coalesce(v_account ->> 'depository', '-') ||
      E'\nDemat / BO ID: XXXX' || right(v_account ->> 'demat', 4) ||
      E'\nTrading client ID: ' || (v_account ->> 'tradingId') ||
      E'\nBank: ' || (v_account ->> 'bank') ||
      E'\nBank IFSC code: ' || (v_account ->> 'ifsc') ||
      E'\nBank account number: XXXX' || right(v_account ->> 'accountNumber', 4) ||
      E'\nHolding horizon: ' || coalesce(v_account ->> 'horizon', '-') ||
      E'\nInvestment objective: ' || coalesce(v_account ->> 'objective', '-') ||
      E'\nMaximum loss tolerance: ' || coalesce(v_account ->> 'loss', '-');
  end loop;

  select sum(price_annual) into v_quote from v2.product_prices where product = any (v_products);

  insert into v2.client_applications (
    app_ref, submitted_by, full_name, pan, dob, email, mobile, occupation, income_band, net_worth,
    tax_residency, city, broker, depository, demat_id, trading_client_id, bank,
    mf_experience, stock_experience, fo_experience, segments, services, products, broker_accounts,
    quoted_annual, horizon, objective, proposed_amount, loss_tolerance, consent, pdf_path, auto_email
  ) values (
    v_ref, (select auth.uid()), v_name, payload ->> 'pan', nullif(payload ->> 'dob', '')::date,
    v_email, payload ->> 'mobile', payload ->> 'occupation', payload ->> 'income',
    payload ->> 'netWorth', payload ->> 'residency', payload ->> 'city', v_first ->> 'broker',
    v_first ->> 'depository', v_first ->> 'demat', v_first ->> 'tradingId', v_first ->> 'bank',
    v_mf, v_stock, v_fo,
    v_segments, v_services, v_products, v_accounts, v_quote,
    v_first ->> 'horizon', v_first ->> 'objective', v_total, v_first ->> 'loss', true, v_pdf, v_auto
  ) returning id into v_id;

  insert into v2.email_log (mail_ref, application_ref, recipient_email, recipient_name, subject,
                            mail_type, body, created_by, attachment_path, attachment_name)
  values ('MAIL-' || nextval('v2_private.mail_ref_seq'), v_ref, v_email, v_name,
          'We received your Sampadha client application', 'Submission confirmation',
          'Your client onboarding application ' || v_ref ||
          ' has been received and is pending Admin review. We will notify you after a decision.' ||
          E'\n\nYour full details are in the attached PDF. Please check them and tell your Sampadha contact if anything is wrong. Once your login is ready you will be asked to accept them.' ||
          E'\n\nPAN: XXXXXX' || right(payload ->> 'pan', 4) ||
          E'\nMobile: ' || coalesce(payload ->> 'mobile', '-') ||
          E'\nAnnual income: ' || coalesce(payload ->> 'income', '-') ||
          E'\nNet worth: ' || coalesce(payload ->> 'netWorth', '-') ||
          E'\nTax residency: ' || coalesce(payload ->> 'residency', '-') ||
          E'\nMutual fund investment experience: ' || coalesce(v_mf, '-') ||
          E'\nStocks investment experience: ' || coalesce(v_stock, '-') ||
          E'\nF&O trading experience: ' || coalesce(v_fo, '-') ||
          E'\nProposed investment amount: ' || v_total ||
          E'\nMarket segments: ' || array_to_string(v_segments, ', ') ||
          E'\nServices: ' || coalesce(nullif(array_to_string(v_services, ', '), ''), '-') ||
          E'\nProducts: ' || array_to_string(v_products, ', ') ||
          v_lines,
          (select auth.uid()), v_pdf, case when v_pdf is not null then 'Sampadha-client-onboarding.pdf' end);

  perform v2_private.log_audit('application.submitted', 'client_application', v_ref,
                               jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_id, 'app_ref', v_ref);
end $$;


create or replace function v2_private.on_client_login_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_account jsonb;
  v_to text;
  v_cc text[];
  v_code text;
begin
  begin
    if coalesce((new.auto_email ->> 'wanted')::boolean, false) then
      -- Sales filled in the auto-email section on Add client.
      insert into v2.broker_email_consents (client_id, broker, broker_client_id, to_email, cc_emails,
                                            status, updated_by, requested_at, request_count)
      values (new.client_id, new.auto_email ->> 'broker', upper(trim(new.auto_email ->> 'tradingId')),
              lower(new.auto_email ->> 'to'),
              coalesce(array(select jsonb_array_elements_text(new.auto_email -> 'cc')), '{}'),
              'Pending', new.decided_by, now(), 1)
      on conflict (client_id) do nothing;
    end if;
    -- Applications from before that section existed use the Multi product's broker.
    select a into v_account from jsonb_array_elements(new.broker_accounts) a
     where a ->> 'product' in ('Bronze', 'Silver', 'Palladium', 'Platinum', 'Gold', 'Rhodium') limit 1;
    if v_account is not null and new.auto_email is null then
      select order_email, order_cc into v_to, v_cc
        from v2.broker_desks where name = v_account ->> 'broker';
      v_code := upper(trim(v_account ->> 'tradingId'));
      if v_to is not null and v_code ~ '^[A-Z0-9._/-]{2,30}$' then
        insert into v2.broker_email_consents (client_id, broker, broker_client_id, to_email, cc_emails,
                                              status, updated_by, requested_at, request_count)
        values (new.client_id, v_account ->> 'broker', v_code, lower(v_to), coalesce(v_cc, '{}'),
                'Pending', new.decided_by, now(), 1)
        on conflict (client_id) do nothing;
      end if;
    end if;
    insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
    values ('ALT-' || nextval('v2_private.mail_ref_seq'), new.client_id, 'In-app',
            'Please review your details and consent',
            'Open Broker auto-email to accept your onboarding details and approve order emails to your broker.');
  exception when others then
    raise warning 'on_client_login_created: %', sqlerrm;
  end;
  return new;
end $$;


create or replace function v2.client_pending() returns table (app_ref text, login_id text, pending text)
language sql stable security definer set search_path = '' as $$
  select a.app_ref, p.login_id,
         case
           when a.status = 'Pending' then 'Admin: approval'
           when a.status = 'Rejected' then 'Rejected by Admin'
           when a.client_id is null then 'Admin: create login'
           when a.pdf_path is not null and a.details_accepted_at is null then 'Client: accept details'
           when c.client_id is null and a.auto_email ->> 'wanted' = 'false' then 'Complete'
           when c.client_id is null then 'Sales: auto-email set-up'
           when coalesce(g.status, 'Disconnected') <> 'Connected' then 'Client: connect Gmail'
           when c.status <> 'Active' then 'Client: auto-email consent'
           else 'Complete'
         end
    from v2.client_applications a
    left join v2.profiles p on p.id = a.client_id
    left join v2.broker_email_consents c on c.client_id = a.client_id
    left join v2.client_gmail_links g on g.client_id = a.client_id
   where v2_private.is_role('admin', 'sales')
$$;


-- The client-link function now sends the email, because the link must never be stored.
create or replace function v2.send_broker_consent_request(p_login_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client v2.profiles;
  v_row v2.broker_email_consents;
  v_app v2.client_applications;
  v_details boolean;
begin
  if not v2_private.is_role('admin', 'sales') then
    raise exception 'Sales or Admin access required' using errcode = '42501';
  end if;
  select * into v_client from v2.profiles
   where upper(login_id) = upper(trim(coalesce(p_login_id, ''))) and role = 'client';
  if not found then
    raise exception 'Client not found';
  end if;
  select * into v_app from v2.client_applications where client_id = v_client.id limit 1;
  v_details := v_app.pdf_path is not null and v_app.details_accepted_at is null;
  select * into v_row from v2.broker_email_consents where client_id = v_client.id for update;
  if v_row.client_id is null and not v_details then
    raise exception 'Enter the client''s broker details first';
  end if;
  if not v_details and v_row.status = 'Active' and exists (
       select 1 from v2.client_gmail_links where client_id = v_client.id and status = 'Connected') then
    raise exception 'Broker auto-email is already on for this client';
  end if;

  update v2.broker_email_consents
     set status = case when status = 'Revoked' then 'Pending' else status end,
         revoked_at = null, requested_at = now(), request_count = request_count + 1,
         updated_by = (select auth.uid()), updated_at = now()
   where client_id = v_client.id;

  insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
  values ('ALT-' || nextval('v2_private.mail_ref_seq'), v_client.id, 'In-app',
          'Please review your details and consent',
          'Open Broker auto-email to accept your onboarding details and approve order emails to your broker.');

  perform v2_private.log_audit('broker_email.consent_requested', 'broker_email_consent',
                               v_client.login_id, jsonb_build_object('details', v_details));
  return jsonb_build_object('client', v_client.login_id);
end $$;


commit;
