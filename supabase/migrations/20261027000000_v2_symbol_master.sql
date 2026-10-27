-- Sampadha v2 — weekly contract master for the Multi Segment Quick input (compact basket).
-- The weekly Multisegment master (CSV/XLS/XLSX: MainExch, SubExch, FinInstrmTp, TckrSymb, XpryDt,
-- NewBrdLotQty, …) is uploaded by a Research Analyst on the Uploads page, stored privately at
-- masters/<uuid>.<ext> in bucket v2-research, and read back by the browser to fill in lot sizes,
-- exchange and instrument codes. Report legs can now carry the real lot size from that master.

-- ───────────────────────── storage: allow spreadsheet files under masters/ ─────────────────────────
update storage.buckets
   set allowed_mime_types = array[
     'image/*', 'application/pdf', 'text/csv', 'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
 where id = 'v2-research';

create function v2_private.is_master_object(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select p_name ~ '^masters/[0-9a-f-]{36}\.(csv|xls|xlsx)$'
$$;

create policy v2_masters_read on storage.objects for select to authenticated
  using (bucket_id = 'v2-research' and v2_private.is_master_object(name)
         and v2_private.is_role('ra', 'admin'));
create policy v2_masters_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'v2-research' and v2_private.is_master_object(name)
              and v2_private.is_role('ra', 'admin'));

-- ───────────────────────── register of uploaded masters ─────────────────────────
create table v2.symbol_masters (
  id uuid primary key default gen_random_uuid(),
  segment text not null default 'Multi' check (segment in ('Multi')),
  file_name text not null check (char_length(file_name) between 1 and 200),
  storage_path text not null unique,
  size_bytes int not null check (size_bytes between 1 and 10485760),
  symbols int not null check (symbols > 0),
  contracts int not null check (contracts > 0),
  format text not null check (format in ('standard-v2', 'legacy')),
  uploaded_by uuid not null references v2.profiles (id),
  uploaded_at timestamptz not null default now()
);
create index v2_symbol_masters_latest_idx on v2.symbol_masters (segment, uploaded_at desc);
alter table v2.symbol_masters enable row level security;
create policy symbol_masters_read on v2.symbol_masters for select to authenticated
  using (v2_private.is_role('ra', 'admin'));
grant select on v2.symbol_masters to authenticated;
grant all on v2.symbol_masters to service_role;

-- Registers a master the caller has just uploaded (the browser parsed it and counted the rows).
-- Idempotent: registering the same file again returns the existing entry. The size comes from
-- the stored object, not from the caller.
create function v2.register_symbol_master(p_path text, p_file_name text, p_symbols int,
                                          p_contracts int, p_format text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_size bigint;
  v_file_name text := trim(coalesce(p_file_name, ''));
begin
  if not v2_private.is_role('ra', 'admin') then
    raise exception 'Research workspace access required' using errcode = '42501';
  end if;
  select id into v_id from v2.symbol_masters where storage_path = p_path;
  if found then
    return jsonb_build_object('id', v_id, 'created', false);
  end if;
  if not v2_private.is_master_object(p_path) then
    raise exception 'Master files are stored as masters/<id>.csv, .xls or .xlsx';
  end if;
  select (metadata ->> 'size')::bigint into v_size
    from storage.objects
   where bucket_id = 'v2-research' and name = p_path and owner_id = (select auth.uid())::text;
  if not found then
    raise exception 'Upload the master file before registering it';
  end if;
  if v_size is null or v_size not between 1 and 10485760 then
    raise exception 'The weekly master must be 10 MB or smaller';
  end if;
  if char_length(v_file_name) not between 1 and 200 then
    raise exception 'The file name must be 1 to 200 characters';
  end if;
  if coalesce(p_symbols, 0) < 1 or coalesce(p_contracts, 0) < 1 then
    raise exception 'The weekly master has no contracts';
  end if;
  if p_format is null or p_format not in ('standard-v2', 'legacy') then
    raise exception 'Master format must be standard-v2 or legacy';
  end if;
  insert into v2.symbol_masters (file_name, storage_path, size_bytes, symbols, contracts, format,
                                 uploaded_by)
  values (v_file_name, p_path, v_size, p_symbols, p_contracts, p_format, (select auth.uid()))
  returning id into v_id;
  perform v2_private.log_audit('master.uploaded', 'symbol_master', v_file_name,
                               jsonb_build_object('symbols', p_symbols, 'contracts', p_contracts));
  return jsonb_build_object('id', v_id, 'created', true);
end $$;

revoke all on function v2.register_symbol_master(text, text, int, int, text) from public, anon, authenticated;
revoke all on function v2_private.is_master_object(text) from public, anon, authenticated;
grant execute on function v2.register_symbol_master(text, text, int, int, text) to authenticated;
grant execute on function v2_private.is_master_object(text) to authenticated;

-- ───────────────────────── legs: optional lot size from the master ─────────────────────────
-- Same rules as 20261025010000_v2_parrva.sql, plus an optional lotSize (contracts per lot) so
-- Positions show real quantities. CSV uploads without it keep lot size 1.
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
  v_advice text;
  v_exchange text;
  v_strategy text;
  v_product text;
  v_intraday text;
  v_price_type text;
  v_side text;
  v_instrument text;
  v_option text;
  v_strike numeric;
  v_expiry date;
  v_entry numeric;
  v_entry_end numeric;
  v_leg_id text;
  v_lot_size int;
  v_first record;
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
    v_product := v2_private.csv_text(v_leg, 'productName', 'ProductName', v_line, 60);
    v_advice := v2_private.csv_text(v_leg, 'adviceName', 'AdviceName', v_line);
    v_strategy := v2_private.csv_text(v_leg, 'strategyName', 'StrategyName', v_line);
    v_exchange := upper(v2_private.csv_text(v_leg, 'exchangeName', 'ExchangeName', v_line, 3));
    if v_exchange not in ('NSE', 'BSE') then
      raise exception 'CSV row %: ExchangeName must be NSE or BSE', v_line;
    end if;
    v_intraday := upper(v2_private.csv_text(v_leg, 'ifIntraday', 'IfIntraday', v_line, 5));
    v_intraday := case when v_intraday in ('YES', 'Y', 'TRUE') then 'YES'
                       when v_intraday in ('NO', 'N', 'FALSE') then 'NO' end;
    if v_intraday is null then
      raise exception 'CSV row %: IfIntraday must be YES or NO', v_line;
    end if;
    v_price_type := upper(v2_private.csv_text(v_leg, 'priceType', 'PriceType', v_line, 3));
    if v_price_type not in ('PR', 'CMP', 'FP') then
      raise exception 'CSV row %: PriceType must be PR, CMP or FP', v_line;
    end if;
    v_side := upper(v2_private.csv_text(v_leg, 'buyOrSell', 'BuyOrSell', v_line, 4));
    if v_side not in ('BUY', 'SELL') then
      raise exception 'CSV row %: BuyOrSell must be BUY or SELL', v_line;
    end if;
    v_instrument := upper(v2_private.csv_text(v_leg, 'instrument', 'Instrument', v_line, 6));
    if (v_exchange = 'NSE' and v_instrument not in ('FUTSTK', 'FUTIDX', 'OPTSTK', 'OPTIDX'))
       or (v_exchange = 'BSE' and v_instrument not in ('STF', 'IDF', 'STO', 'IDO')) then
      raise exception 'CSV row %: Instrument must be FUTSTK, FUTIDX, OPTSTK or OPTIDX on NSE (STF, IDF, STO or IDO on BSE)', v_line;
    end if;
    v_option := upper(trim(coalesce(v_leg ->> 'ceOrPe', '')));
    if v_instrument in ('OPTSTK', 'OPTIDX', 'STO', 'IDO') then
      if v_option not in ('CE', 'PE') then
        raise exception 'CSV row %: CEorPE must be CE or PE for options', v_line;
      end if;
      v_strike := v2_private.csv_price(v_leg, 'optionStrikePrice', 'OptionStrikePrice', v_line);
    else
      if v_option not in ('', 'NULL') or upper(trim(coalesce(v_leg ->> 'optionStrikePrice', ''))) not in ('', 'NULL') then
        raise exception 'CSV row %: leave CEorPE and OptionStrikePrice empty for futures', v_line;
      end if;
      v_option := null;
      v_strike := null;
    end if;
    begin
      v_expiry := v2_private.csv_text(v_leg, 'contractExpiryDate', 'ContractExpiryDate', v_line, 10)::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'CSV row %: ContractExpiryDate must be a date in YYYY-MM-DD format', v_line;
    end;
    if (v_leg ->> 'contractExpiryDate') !~ '^\s*\d{4}-\d{2}-\d{2}\s*$' then
      raise exception 'CSV row %: ContractExpiryDate must be a date in YYYY-MM-DD format', v_line;
    end if;
    if v_expiry < (v_now at time zone 'Asia/Kolkata')::date then
      raise exception 'CSV row %: ContractExpiryDate is in the past', v_line;
    end if;
    if coalesce(v_leg ->> 'lot', '') !~ '^\s*[0-9]{1,6}\s*$' or trim(v_leg ->> 'lot')::int < 1 then
      raise exception 'CSV row %: Lot must be a positive whole number', v_line;
    end if;
    v_lot_size := 1;
    if trim(coalesce(v_leg ->> 'lotSize', '')) <> '' then
      if trim(v_leg ->> 'lotSize') !~ '^[0-9]{1,6}$' or trim(v_leg ->> 'lotSize')::int < 1 then
        raise exception 'CSV row %: lot size must be a positive whole number', v_line;
      end if;
      v_lot_size := trim(v_leg ->> 'lotSize')::int;
    end if;
    v_entry := v2_private.csv_price(v_leg, 'entryPriceStart', 'EntryPriceStart', v_line);
    v_entry_end := v2_private.csv_price(v_leg, 'entryPriceEnd', 'EntryPriceEnd', v_line);
    if v_side = 'BUY' and v_entry > v_entry_end then
      raise exception 'CSV row %: for BUY, EntryPriceStart is the lower price (start must not exceed end)', v_line;
    end if;
    if v_side = 'SELL' and v_entry < v_entry_end then
      raise exception 'CSV row %: for SELL, EntryPriceStart is the higher price (start must not be below end)', v_line;
    end if;
    v_leg_id := trim(coalesce(v_leg ->> 'legId', ''));
    if v_leg_id !~ '^[0-9]{1,9}$' or v_leg_id::int < 1 then
      raise exception 'CSV row %: LegId must be a positive whole number', v_line;
    end if;
    select product, exchange_name, strategy_name, if_intraday into v_first
      from v2.research_legs where report_id = v_id and advice_name = v_advice
     order by position limit 1;
    if found and (v_first.product, v_first.exchange_name, v_first.strategy_name, v_first.if_intraday)
                 is distinct from (v_product, v_exchange, v_strategy, v_intraday) then
      raise exception 'CSV row %: rows with AdviceName % must have the same ProductName, ExchangeName, StrategyName and IfIntraday', v_line, v_advice;
    end if;

    begin
      insert into v2.research_legs (
        report_id, position, product, symbol, instrument, expiry, strike, option_type, side, lots,
        lot_size, initiation_price, t1, published_at, advice_name, exchange_name, strategy_name,
        if_intraday, price_type, contract_name, entry_price_end, stop_loss, exit_price, leg_ref)
      values (
        v_id, v_pos, v_product,
        upper(v2_private.csv_text(v_leg, 'contractName', 'ContractName', v_line, 40)),
        v_instrument, v_expiry, v_strike, v_option, v_side, trim(v_leg ->> 'lot')::int, v_lot_size,
        v_entry,
        v2_private.csv_price(v_leg, 'targetPrice', 'TargetPrice', v_line),
        v_now, v_advice, v_exchange, v_strategy, v_intraday, v_price_type,
        upper(trim(v_leg ->> 'contractName')), v_entry_end,
        v2_private.csv_price(v_leg, 'stopLoss', 'StopLoss', v_line),
        v2_private.csv_price(v_leg, 'exitPrice', 'ExitPrice', v_line, true),
        v_leg_id);
    exception when unique_violation then
      raise exception 'CSV row %: LegId % is used more than once in AdviceName %', v_line, v_leg_id, v_advice;
    end;
  end loop;

  perform v2_private.log_audit('report.created', 'research_report', v_ref,
                               jsonb_build_object('legs', v_pos, 'segment', 'Multi'));
  return jsonb_build_object('id', v_id, 'report_ref', v_ref);
end $$;
