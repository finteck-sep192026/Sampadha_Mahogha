-- Sampadha v2 — 25 Oct 2026 prototype update.
--   * Multi Segment legs now come from a 19-column advice CSV (AdviceName, StrategyName, StopLoss,
--     LegId, …) instead of the typed-in leg form.
--   * New Cash Segment: LC/MC/SC reports (Monthly/Quarterly/Half-Yearly) built from a 12-column
--     CSV. Cash reports live in v2.research_reports (segment = 'Cash'), so signing, PDF storage,
--     delivery and the client "Reports received" view are shared with Multi reports.
-- Additive: existing reports keep working (new columns are nullable).

-- ───────────────────────── Multi: CSV leg columns ─────────────────────────
alter table v2.research_legs drop constraint if exists research_legs_product_check;
alter table v2.research_legs drop constraint if exists research_legs_symbol_check;
alter table v2.research_legs
  add constraint research_legs_product_len check (char_length(product) between 1 and 60),
  add constraint research_legs_symbol_len check (char_length(symbol) between 1 and 40),
  add column advice_name text,
  add column exchange_name text,
  add column strategy_name text,
  add column if_intraday text,
  add column price_type text,
  add column contract_name text,
  add column entry_price_end numeric(12, 2) check (entry_price_end > 0),
  add column stop_loss numeric(12, 2) check (stop_loss > 0),
  add column exit_price numeric(12, 2) check (exit_price > 0),
  add column leg_ref text;
create unique index v2_research_legs_leg_ref_key on v2.research_legs (report_id, lower(leg_ref))
  where leg_ref is not null;

-- ───────────────────────── Cash: report fields and rows ─────────────────────────
alter table v2.research_reports
  add column segment text not null default 'Multi' check (segment in ('Multi', 'Cash')),
  add column cash_product text check (cash_product in ('LC', 'MC', 'SC')),
  add column frequency text check (frequency in ('Monthly', 'Quarterly', 'Half-Yearly')),
  add column source_file text,
  add constraint research_reports_cash_fields check (
    segment = 'Multi' or (cash_product is not null and frequency is not null)
  );
create index v2_research_reports_segment_idx on v2.research_reports (segment);

create table v2.cash_report_rows (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references v2.research_reports (id) on delete cascade,
  position int not null,
  product_name text not null,
  portfolio_name text not null,
  portfolio_type text not null,
  stop_portfolio text not null check (stop_portfolio in ('YES', 'NO')),
  isin text not null check (isin ~ '^[A-Z]{2}[A-Z0-9]{10}$'),
  weightage numeric(9, 6) not null check (weightage > 0 and weightage <= 1),
  exchange_name text not null,
  if_mutual_fund text not null check (if_mutual_fund in ('YES', 'NO')),
  stock text not null,
  action text not null check (action in ('BUY', 'SELL', 'HOLD')),
  initiation_price numeric(12, 2) not null check (initiation_price > 0),
  quantity int not null check (quantity > 0),
  unique (report_id, position)
);
create index v2_cash_report_rows_report_idx on v2.cash_report_rows (report_id);
alter table v2.cash_report_rows enable row level security;
create policy cash_rows_read on v2.cash_report_rows for select to authenticated
  using (v2_private.can_see_report(report_id));
grant select on v2.cash_report_rows to authenticated;
grant all on v2.cash_report_rows to service_role;

-- ───────────────────────── shared validation helpers ─────────────────────────
create function v2_private.csv_text(p_row jsonb, p_key text, p_label text, p_line int, p_max int default 100)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := trim(coalesce(p_row ->> p_key, ''));
begin
  if v = '' or char_length(v) > p_max then
    raise exception 'CSV row %: % is required (up to % characters)', p_line, p_label, p_max;
  end if;
  return v;
end $$;

create function v2_private.csv_price(p_row jsonb, p_key text, p_label text, p_line int,
                                     p_optional boolean default false)
returns numeric language plpgsql immutable set search_path = '' as $$
declare
  v text := trim(coalesce(p_row ->> p_key, ''));
begin
  if v = '' and p_optional then
    return null;
  end if;
  if v !~ '^[0-9]{1,9}(\.[0-9]{1,4})?$' or v::numeric <= 0 then
    raise exception 'CSV row %: % must be a positive number', p_line, p_label;
  end if;
  return round(v::numeric, 2);
end $$;

-- ───────────────────────── Multi: create from CSV rows ─────────────────────────
-- p_legs: one object per CSV row with keys productName … legId (as sent by research-reports.js).
-- CSV rows are row 2 onwards in the file, so errors quote the spreadsheet row number.
create or replace function v2.create_research_draft(p_title text, p_sections jsonb, p_legs jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ref text := 'RPT-' || nextval('v2_private.report_ref_seq');
  v_leg jsonb;
  v_pos int := 0;
  v_line int;
  v_name text;
  v_now timestamptz := now();
  v_expiry date;
  v_intraday text;
  v_side text;
  v_option text;
  v_lot int;
  v_entry numeric;
  v_entry_end numeric;
  v_title text := trim(coalesce(p_title, ''));
begin
  if not v2_private.is_role('ra', 'admin') then
    raise exception 'Research workspace access required' using errcode = '42501';
  end if;
  if char_length(v_title) not between 1 and 150 then
    raise exception 'Enter a report title of up to 150 characters';
  end if;
  foreach v_name in array array['Technical', 'Derivatives', 'Quantitative', 'Risks'] loop
    if jsonb_typeof(p_sections -> v_name) is distinct from 'string'
       or char_length(trim(p_sections ->> v_name)) not between 1 and 5000 then
      raise exception 'Section % must be 1 to 5000 characters', v_name;
    end if;
  end loop;
  if jsonb_typeof(p_legs) is distinct from 'array'
     or jsonb_array_length(p_legs) not between 1 and 50 then
    raise exception 'Upload a CSV with 1 to 50 recommendation rows';
  end if;

  insert into v2.research_reports (report_ref, author_id, title, sections, content_hash)
  values (v_ref, (select auth.uid()), v_title,
          jsonb_build_object('Technical', trim(p_sections ->> 'Technical'),
                             'Derivatives', trim(p_sections ->> 'Derivatives'),
                             'Quantitative', trim(p_sections ->> 'Quantitative'),
                             'Risks', trim(p_sections ->> 'Risks')),
          encode(extensions.digest(convert_to(v_title || p_sections::text || p_legs::text, 'utf8'),
                                   'sha256'), 'hex'))
  returning id into v_id;

  for v_leg in select value from jsonb_array_elements(p_legs) loop
    v_pos := v_pos + 1;
    v_line := v_pos + 1;
    v_intraday := upper(v2_private.csv_text(v_leg, 'ifIntraday', 'IfIntraday', v_line, 10));
    if v_intraday not in ('YES', 'NO', 'TRUE', 'FALSE', 'Y', 'N') then
      raise exception 'CSV row %: IfIntraday must be YES/NO or TRUE/FALSE', v_line;
    end if;
    v_side := upper(v2_private.csv_text(v_leg, 'buyOrSell', 'BuyOrSell', v_line, 10));
    if v_side not in ('BUY', 'SELL') then
      raise exception 'CSV row %: BuyOrSell must be BUY or SELL', v_line;
    end if;
    v_option := upper(v2_private.csv_text(v_leg, 'ceOrPe', 'CEorPE', v_line, 10));
    if v_option not in ('CE', 'PE') then
      raise exception 'CSV row %: CEorPE must be CE or PE', v_line;
    end if;
    begin
      v_expiry := v2_private.csv_text(v_leg, 'contractExpiryDate', 'ContractExpiryDate', v_line, 30)::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'CSV row %: ContractExpiryDate must be a valid date (YYYY-MM-DD)', v_line;
    end;
    if v_expiry < (v_now at time zone 'Asia/Kolkata')::date then
      raise exception 'CSV row %: ContractExpiryDate is in the past', v_line;
    end if;
    if coalesce(v_leg ->> 'lot', '') !~ '^[0-9]{1,6}$' or (v_leg ->> 'lot')::int < 1 then
      raise exception 'CSV row %: Lot must be a positive whole number', v_line;
    end if;
    v_lot := (v_leg ->> 'lot')::int;
    v_entry := v2_private.csv_price(v_leg, 'entryPriceStart', 'EntryPriceStart', v_line);
    v_entry_end := v2_private.csv_price(v_leg, 'entryPriceEnd', 'EntryPriceEnd', v_line);
    if v_entry_end < v_entry then
      raise exception 'CSV row %: EntryPriceEnd must be greater than or equal to EntryPriceStart', v_line;
    end if;

    begin
      insert into v2.research_legs (
        report_id, position, product, symbol, expiry, strike, option_type, side, lots, lot_size,
        initiation_price, t1, published_at, advice_name, exchange_name, strategy_name, if_intraday,
        price_type, contract_name, entry_price_end, stop_loss, exit_price, leg_ref)
      values (
        v_id, v_pos,
        v2_private.csv_text(v_leg, 'productName', 'ProductName', v_line, 60),
        upper(v2_private.csv_text(v_leg, 'instrument', 'Instrument', v_line, 40)),
        v_expiry,
        v2_private.csv_price(v_leg, 'optionStrikePrice', 'OptionStrikePrice', v_line),
        v_option, v_side, v_lot, 1, v_entry,
        v2_private.csv_price(v_leg, 'targetPrice', 'TargetPrice', v_line),
        v_now,
        v2_private.csv_text(v_leg, 'adviceName', 'AdviceName', v_line),
        upper(v2_private.csv_text(v_leg, 'exchangeName', 'ExchangeName', v_line, 20)),
        v2_private.csv_text(v_leg, 'strategyName', 'StrategyName', v_line),
        v_intraday,
        upper(v2_private.csv_text(v_leg, 'priceType', 'PriceType', v_line, 20)),
        v2_private.csv_text(v_leg, 'contractName', 'ContractName', v_line),
        v_entry_end,
        v2_private.csv_price(v_leg, 'stopLoss', 'StopLoss', v_line),
        v2_private.csv_price(v_leg, 'exitPrice', 'ExitPrice', v_line, true),
        v2_private.csv_text(v_leg, 'legId', 'LegId', v_line, 40));
    exception when unique_violation then
      raise exception 'CSV row %: LegId % is used more than once', v_line, v_leg ->> 'legId';
    end;
  end loop;

  perform v2_private.log_audit('report.created', 'research_report', v_ref,
                               jsonb_build_object('legs', v_pos, 'segment', 'Multi'));
  return jsonb_build_object('id', v_id, 'report_ref', v_ref);
end $$;

-- Tier-based delivery is for Multi reports only; Cash reports use send_cash_report.
create or replace function v2_private.require_segment(p_report_id uuid, p_segment text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from v2.research_reports where id = p_report_id and segment = p_segment) then
    raise exception 'This is not a % report', p_segment;
  end if;
end $$;

create or replace function v2.send_research_report(p_report_id uuid, p_client_ids text[], p_types text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_report v2.research_reports;
  v_ids text[];
  v_client record;
  v_sent int := 0;
begin
  if not v2_private.owns_report(p_report_id) then
    raise exception 'Report not found' using errcode = '42501';
  end if;
  perform v2_private.require_segment(p_report_id, 'Multi');
  select * into v_report from v2.research_reports where id = p_report_id for update;
  if v_report.esign_status <> 'Signed' or v_report.signed_pdf_path is null then
    raise exception 'Complete the Aadhaar eSign before sending' using errcode = '28000';
  end if;

  select array_agg(distinct upper(trim(x))) into v_ids
  from unnest(coalesce(p_client_ids, '{}')) x where trim(x) <> '';
  if v_ids is null then
    raise exception 'Select at least one client';
  end if;
  if coalesce(array_length(p_types, 1), 0) = 0 then
    raise exception 'Choose at least one product type';
  end if;
  if (select count(distinct p.id) from v2.profiles p
        join v2.subscriptions s on s.client_id = p.id and s.status = 'Active'
       where p.role = 'client' and p.is_active and upper(p.login_id) = any (v_ids)
         and s.multi_tier = any (p_types)) <> array_length(v_ids, 1) then
    raise exception 'Choose only active clients subscribed to the selected product types';
  end if;

  for v_client in
    select p.id, p.full_name, p.email from v2.profiles p where upper(p.login_id) = any (v_ids)
  loop
    insert into v2.research_deliveries (report_id, client_id) values (p_report_id, v_client.id)
    on conflict do nothing;
    if found then
      v_sent := v_sent + 1;
      insert into v2.email_log (mail_ref, report_id, recipient_id, recipient_email,
                                recipient_name, subject, mail_type, body, created_by)
      values ('MAIL-' || nextval('v2_private.mail_ref_seq'), p_report_id, v_client.id, v_client.email,
              v_client.full_name, v_report.title, 'Research report',
              'Your Multi research report ' || v_report.title || ' is available under Reports received.',
              v_uid);
      insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
      values ('ALT-' || nextval('v2_private.mail_ref_seq'), v_client.id, 'In-app',
              'Multi research report published',
              v_report.title || ' is available under Reports received.');
    end if;
  end loop;
  if v_sent = 0 then
    raise exception 'These clients have already received this report';
  end if;

  update v2.research_legs
     set delivered_at = coalesce(delivered_at, now()),
         status = case when status = 'Generated' then 'Open' else status end
   where report_id = p_report_id;
  update v2.research_reports set status = 'Sent', sent_at = coalesce(sent_at, now())
   where id = p_report_id;
  perform v2_private.log_audit('report.sent', 'research_report', v_report.report_ref,
                               jsonb_build_object('clients', v_sent));
  return jsonb_build_object('delivered', v_sent, 'report_ref', v_report.report_ref);
end $$;

-- ───────────────────────── Cash: create, recipients, send ─────────────────────────
create function v2.create_cash_report_draft(p_product text, p_frequency text, p_file_name text,
                                            p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ref text := 'CASH-' || nextval('v2_private.report_ref_seq');
  v_product text := upper(trim(coalesce(p_product, '')));
  v_frequency text := trim(coalesce(p_frequency, ''));
  v_file text := trim(coalesce(p_file_name, ''));
  v_row jsonb;
  v_pos int := 0;
  v_line int;
  v_flag text;
  v_isin text;
  v_weight text;
  v_action text;
begin
  if not v2_private.is_role('ra', 'admin') then
    raise exception 'Research workspace access required' using errcode = '42501';
  end if;
  if v_product not in ('LC', 'MC', 'SC') then
    raise exception 'Select LC, MC or SC';
  end if;
  if v_frequency not in ('Monthly', 'Quarterly', 'Half-Yearly') then
    raise exception 'Select Monthly, Quarterly or Half-Yearly';
  end if;
  if char_length(v_file) not between 1 and 200 then
    raise exception 'The CSV file name is missing';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Upload a CSV with 1 to 100 recommendation rows';
  end if;

  insert into v2.research_reports (report_ref, author_id, title, product, sections, content_hash,
                                   segment, cash_product, frequency, source_file)
  values (v_ref, (select auth.uid()), v_product || ' Cash ' || v_frequency || ' Report', 'Cash',
          '{}'::jsonb,
          encode(extensions.digest(convert_to(v_product || v_frequency || p_rows::text, 'utf8'),
                                   'sha256'), 'hex'),
          'Cash', v_product, v_frequency, v_file)
  returning id into v_id;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_pos := v_pos + 1;
    v_line := v_pos + 1;
    v_flag := upper(v2_private.csv_text(v_row, 'stopPortfolio', 'StopPortfolio', v_line, 3));
    if v_flag not in ('YES', 'NO') then
      raise exception 'CSV row %: StopPortfolio must be YES or NO', v_line;
    end if;
    v_isin := upper(v2_private.csv_text(v_row, 'isin', 'ISIN', v_line, 12));
    if v_isin !~ '^[A-Z]{2}[A-Z0-9]{10}$' then
      raise exception 'CSV row %: ISIN must contain 12 characters, starting with a two-letter country code', v_line;
    end if;
    v_weight := trim(coalesce(v_row ->> 'weightage', ''));
    if v_weight !~ '^[0-9]{0,1}(\.[0-9]{1,6})?$' or v_weight in ('', '.')
       or v_weight::numeric <= 0 or v_weight::numeric > 1 then
      raise exception 'CSV row %: Weightage must be greater than 0 and not more than 1', v_line;
    end if;
    v_action := upper(v2_private.csv_text(v_row, 'action', 'Action', v_line, 4));
    if v_action not in ('BUY', 'SELL', 'HOLD') then
      raise exception 'CSV row %: Action must be BUY, SELL or HOLD', v_line;
    end if;
    if coalesce(v_row ->> 'quantity', '') !~ '^[0-9]{1,9}$' or (v_row ->> 'quantity')::int < 1 then
      raise exception 'CSV row %: Quantity must be a positive whole number', v_line;
    end if;

    insert into v2.cash_report_rows (
      report_id, position, product_name, portfolio_name, portfolio_type, stop_portfolio, isin,
      weightage, exchange_name, if_mutual_fund, stock, action, initiation_price, quantity)
    values (
      v_id, v_pos,
      v2_private.csv_text(v_row, 'productName', 'ProductName', v_line),
      v2_private.csv_text(v_row, 'portfolioName', 'PortfolioName', v_line),
      v2_private.csv_text(v_row, 'portfolioType', 'PortfolioType', v_line),
      v_flag, v_isin, v_weight::numeric,
      upper(v2_private.csv_text(v_row, 'exchangeName', 'ExchangeName', v_line, 20)),
      upper(v2_private.csv_text(v_row, 'ifMutualFund', 'IfMutualFund', v_line, 3)),
      upper(v2_private.csv_text(v_row, 'stock', 'Stock', v_line, 40)),
      v_action,
      v2_private.csv_price(v_row, 'price', 'Initiation Price', v_line),
      (v_row ->> 'quantity')::int);
  end loop;

  perform v2_private.log_audit('report.created', 'research_report', v_ref,
                               jsonb_build_object('rows', v_pos, 'segment', 'Cash',
                                                  'product', v_product, 'frequency', v_frequency));
  return jsonb_build_object('id', v_id, 'report_ref', v_ref);
end $$;

-- Clients whose active plan includes the Cash product (every current plan does).
create function v2.list_cash_clients()
returns table (id uuid, login_id text, full_name text, email text)
language sql stable security definer set search_path = '' as $$
  select distinct p.id, p.login_id, p.full_name, p.email
  from v2.profiles p
  join v2.subscriptions s on s.client_id = p.id and s.status = 'Active' and 'Cash' = any (s.products)
  where v2_private.is_role('ra', 'admin') and p.role = 'client' and p.is_active
  order by p.login_id
$$;

create function v2.send_cash_report(p_report_id uuid, p_client_ids text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_report v2.research_reports;
  v_ids text[];
  v_client record;
  v_sent int := 0;
begin
  if not v2_private.owns_report(p_report_id) then
    raise exception 'Report not found' using errcode = '42501';
  end if;
  perform v2_private.require_segment(p_report_id, 'Cash');
  select * into v_report from v2.research_reports where id = p_report_id for update;
  if v_report.esign_status <> 'Signed' or v_report.signed_pdf_path is null then
    raise exception 'Complete the Aadhaar eSign before sending' using errcode = '28000';
  end if;
  select array_agg(distinct upper(trim(x))) into v_ids
  from unnest(coalesce(p_client_ids, '{}')) x where trim(x) <> '';
  if v_ids is null then
    raise exception 'Select at least one client';
  end if;
  if (select count(distinct p.id) from v2.profiles p
        join v2.subscriptions s on s.client_id = p.id and s.status = 'Active'
                                and 'Cash' = any (s.products)
       where p.role = 'client' and p.is_active and upper(p.login_id) = any (v_ids))
     <> array_length(v_ids, 1) then
    raise exception 'Choose only active clients whose plan includes Cash';
  end if;

  for v_client in
    select p.id, p.full_name, p.email from v2.profiles p where upper(p.login_id) = any (v_ids)
  loop
    insert into v2.research_deliveries (report_id, client_id) values (p_report_id, v_client.id)
    on conflict do nothing;
    if found then
      v_sent := v_sent + 1;
      insert into v2.email_log (mail_ref, report_id, recipient_id, recipient_email,
                                recipient_name, subject, mail_type, body, created_by)
      values ('MAIL-' || nextval('v2_private.mail_ref_seq'), p_report_id, v_client.id, v_client.email,
              v_client.full_name, v_report.title, 'Research report',
              'Your Cash research report ' || v_report.title || ' is available under Reports received.',
              v_uid);
      insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
      values ('ALT-' || nextval('v2_private.mail_ref_seq'), v_client.id, 'In-app',
              'Cash research report published',
              v_report.title || ' is available under Reports received.');
    end if;
  end loop;
  if v_sent = 0 then
    raise exception 'These clients have already received this report';
  end if;

  update v2.research_reports set status = 'Sent', sent_at = coalesce(sent_at, now())
   where id = p_report_id;
  perform v2_private.log_audit('report.sent', 'research_report', v_report.report_ref,
                               jsonb_build_object('clients', v_sent, 'segment', 'Cash'));
  return jsonb_build_object('delivered', v_sent, 'report_ref', v_report.report_ref);
end $$;

-- ───────────────────────── privileges ─────────────────────────
revoke all on function v2.create_cash_report_draft(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function v2.list_cash_clients() from public, anon, authenticated;
revoke all on function v2.send_cash_report(uuid, text[]) from public, anon, authenticated;
revoke all on function v2_private.csv_text(jsonb, text, text, int, int) from public, anon, authenticated;
revoke all on function v2_private.csv_price(jsonb, text, text, int, boolean) from public, anon, authenticated;
revoke all on function v2_private.require_segment(uuid, text) from public, anon, authenticated;
grant execute on function v2.create_cash_report_draft(text, text, text, jsonb) to authenticated;
grant execute on function v2.list_cash_clients() to authenticated;
grant execute on function v2.send_cash_report(uuid, text[]) to authenticated;
