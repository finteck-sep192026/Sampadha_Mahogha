-- Sampadha v2: each broker on Add client now needs a bank IFSC code and account number. They are
-- kept with the broker account, and the client's email shows only the last four digits.
-- Publish the pages first: this refuses the older form, which does not send them.

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
    quoted_annual, horizon, objective, proposed_amount, loss_tolerance, consent
  ) values (
    v_ref, (select auth.uid()), v_name, payload ->> 'pan', nullif(payload ->> 'dob', '')::date,
    v_email, payload ->> 'mobile', payload ->> 'occupation', payload ->> 'income',
    payload ->> 'netWorth', payload ->> 'residency', payload ->> 'city', v_first ->> 'broker',
    v_first ->> 'depository', v_first ->> 'demat', v_first ->> 'tradingId', v_first ->> 'bank',
    v_mf, v_stock, v_fo,
    v_segments, v_services, v_products, v_accounts, v_quote,
    v_first ->> 'horizon', v_first ->> 'objective', v_total, v_first ->> 'loss', true
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
          (select auth.uid()));

  perform v2_private.log_audit('application.submitted', 'client_application', v_ref,
                               jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_id, 'app_ref', v_ref);
end $$;
