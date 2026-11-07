begin;

-- Sampadha v2: the onboarding workflow.
--
-- * Sales submits: Admin sees it in Client approvals, and the client is emailed the details as a PDF.
-- * Admin creates the login: the set-password email is the one link. It opens the client's page
--   holding both consents: accepting the details and broker auto-email.
-- * v2.client_pending: who each client is waiting for, for the Clients page.
--
-- Sales asked for the PDF to carry full PAN, demat and bank details. It is stored privately at
-- applications/<uuid>.pdf and the email body stays masked.

alter table v2.client_applications
  add column pdf_path text,
  add column details_accepted_at timestamptz;
alter table v2.email_log
  add column attachment_path text,
  add column attachment_name text;

create function v2_private.is_application_pdf(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select p_name ~ '^applications/[0-9a-f-]{36}\.pdf$'
$$;
-- Sales stores the PDF just before submitting, so an unclaimed path is theirs to read back only.
create function v2_private.may_read_application_pdf(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select v2_private.is_role('admin')
      or exists (select 1 from v2.client_applications a
                  where a.pdf_path = p_name
                    and (a.client_id = (select auth.uid())
                         or (v2_private.is_role('sales') and a.submitted_by = (select auth.uid()))))
$$;
create policy v2_application_pdf_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'v2-research' and v2_private.is_application_pdf(name)
              and v2_private.is_role('admin', 'sales'));
create policy v2_application_pdf_read on storage.objects for select to authenticated
  using (bucket_id = 'v2-research' and v2_private.is_application_pdf(name)
         and v2_private.may_read_application_pdf(name));

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
    quoted_annual, horizon, objective, proposed_amount, loss_tolerance, consent, pdf_path
  ) values (
    v_ref, (select auth.uid()), v_name, payload ->> 'pan', nullif(payload ->> 'dob', '')::date,
    v_email, payload ->> 'mobile', payload ->> 'occupation', payload ->> 'income',
    payload ->> 'netWorth', payload ->> 'residency', payload ->> 'city', v_first ->> 'broker',
    v_first ->> 'depository', v_first ->> 'demat', v_first ->> 'tradingId', v_first ->> 'bank',
    v_mf, v_stock, v_fo,
    v_segments, v_services, v_products, v_accounts, v_quote,
    v_first ->> 'horizon', v_first ->> 'objective', v_total, v_first ->> 'loss', true, v_pdf
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

-- Multi orders use the first Multi product's broker. Nothing here may stop the login being created.
create function v2_private.on_client_login_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_account jsonb;
  v_to text;
  v_code text;
begin
  begin
    select a into v_account from jsonb_array_elements(new.broker_accounts) a
     where a ->> 'product' in ('Bronze', 'Silver', 'Palladium', 'Platinum', 'Gold', 'Rhodium') limit 1;
    if v_account is not null then
      select order_email into v_to from v2.broker_desks where name = v_account ->> 'broker';
      v_code := upper(trim(v_account ->> 'tradingId'));
      if v_to is not null and v_code ~ '^[A-Z0-9._/-]{2,30}$' then
        insert into v2.broker_email_consents (client_id, broker, broker_client_id, to_email, status,
                                              updated_by, requested_at, request_count)
        values (new.client_id, v_account ->> 'broker', v_code, lower(v_to), 'Pending',
                new.decided_by, now(), 1)
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
revoke all on function v2_private.on_client_login_created() from public, anon, authenticated;
create trigger client_applications_login_created
  after update of client_id on v2.client_applications
  for each row when (old.client_id is null and new.client_id is not null)
  execute function v2_private.on_client_login_created();

create function v2.my_onboarding() returns table (pdf_path text, details_accepted_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.pdf_path, a.details_accepted_at from v2.client_applications a
   where a.client_id = (select auth.uid())
$$;
create function v2.accept_onboarding_details() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ref text;
begin
  update v2.client_applications set details_accepted_at = now()
   where client_id = (select auth.uid()) and pdf_path is not null and details_accepted_at is null
  returning app_ref into v_ref;
  if not found then
    raise exception 'There are no details waiting for you to accept';
  end if;
  perform v2_private.log_audit('application.details_accepted', 'client_application', v_ref, '{}');
  return jsonb_build_object('app_ref', v_ref);
end $$;

create function v2.client_pending() returns table (app_ref text, login_id text, pending text)
language sql stable security definer set search_path = '' as $$
  select a.app_ref, p.login_id,
         case
           when a.status = 'Pending' then 'Admin: approval'
           when a.status = 'Rejected' then 'Rejected by Admin'
           when a.client_id is null then 'Admin: create login'
           when a.pdf_path is not null and a.details_accepted_at is null then 'Client: accept details'
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

-- Resending now also covers a client with only the details to accept, and carries the PDF.
create or replace function v2.send_broker_consent_request(p_login_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client v2.profiles;
  v_row v2.broker_email_consents;
  v_app v2.client_applications;
  v_details boolean;
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

  insert into v2.email_log (mail_ref, recipient_id, client_id, recipient_email, recipient_name,
                            subject, mail_type, body, created_by, attachment_path, attachment_name)
  values (v_ref, v_client.id, v_client.id, v_client.email, v_client.full_name,
          'Please review your details and consent for your Sampadha account', 'Consent request',
          'Your Sampadha contact is waiting for your consent.' ||
          case when v_details then E'\n\nYour onboarding details are in the attached PDF.' else '' end ||
          case when v_row.client_id is not null
               then E'\n\nBroker: ' || v_row.broker ||
                    E'\nBroker client ID: ' || v_row.broker_client_id ||
                    E'\nOrder email: ' || v_row.to_email
               else '' end ||
          E'\n\nOne link does it all: sign in at https://racrm.fintecindia.com and the portal opens your consent page. ' ||
          'Nothing is sent to your broker until you consent, and you can withdraw at any time.',
          (select auth.uid()),
          case when v_details then v_app.pdf_path end,
          case when v_details then 'Sampadha-client-onboarding.pdf' end);
  insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
  values ('ALT-' || nextval('v2_private.mail_ref_seq'), v_client.id, 'In-app',
          'Please review your details and consent',
          'Open Broker auto-email to accept your onboarding details and approve order emails to your broker.');

  perform v2_private.log_audit('broker_email.consent_requested', 'broker_email_consent',
                               v_client.login_id, jsonb_build_object('details', v_details));
  return jsonb_build_object('mail_ref', v_ref);
end $$;

revoke all on function v2.my_onboarding() from public, anon;
revoke all on function v2.accept_onboarding_details() from public, anon;
revoke all on function v2.client_pending() from public, anon;
grant execute on function v2.my_onboarding() to authenticated;
grant execute on function v2.accept_onboarding_details() to authenticated;
grant execute on function v2.client_pending() to authenticated;

commit;
