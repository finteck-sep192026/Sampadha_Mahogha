-- Monthly research packs for Cash Segment (LC / MC / SC), made by the Sampadha Research Pack
-- Generator (github.com/content-cpu/sampadha-research-pack-generator). The generator runs on the
-- analyst's PC, because its Trendlyne data only loads from a home connection:
--   1. The analyst saves the month's stock list here (LC, MC and SC columns of NSE symbols) and
--      downloads it as YYYY-MM.csv for the generator's stock_lists/ folder.
--   2. The generator makes the three packs (Word + PDF). Each PDF is uploaded here as its own
--      Cash report (cash_kind 'pack', stored at <report id>/preview.pdf), then Aadhaar-signed and
--      sent to clients like any Cash report.
-- Packs have no portfolio rows and no recommendations, so they are never sent to CARE PaRRVA.

create table v2.cash_stock_lists (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  lc text[] not null default '{}',
  mc text[] not null default '{}',
  sc text[] not null default '{}',
  file_name text not null,
  uploaded_by uuid references v2.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now()
);
alter table v2.cash_stock_lists enable row level security;
create policy cash_stock_lists_read on v2.cash_stock_lists for select to authenticated
  using (v2_private.is_role('ra', 'admin'));
grant select on v2.cash_stock_lists to authenticated;
grant all on v2.cash_stock_lists to service_role;

alter table v2.research_reports
  add column cash_kind text not null default 'portfolio'
    check (cash_kind in ('portfolio', 'pack')),
  add column pack_month text check (pack_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  add column pack_stocks text[];
alter table v2.research_reports add constraint research_reports_pack_fields check (
  cash_kind = 'portfolio'
  or (segment = 'Cash' and pack_month is not null and pack_stocks is not null));

-- One column of the stock list: NSE symbols, at most 150, no repeats. Returns how many.
create function v2_private.pack_symbols_count(p_symbols text[], p_label text) returns int
language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(cardinality(p_symbols), 0) > 150 then
    raise exception '% has more than 150 stocks', p_label;
  end if;
  if exists (select 1 from unnest(coalesce(p_symbols, '{}')) s
              where s !~ '^[A-Z0-9][A-Z0-9&._-]{0,19}$') then
    raise exception '% has a symbol that is not an NSE symbol (letters, digits, & . _ -)', p_label;
  end if;
  if (select count(distinct s) from unnest(coalesce(p_symbols, '{}')) s)
     <> coalesce(cardinality(p_symbols), 0) then
    raise exception '% lists a stock twice', p_label;
  end if;
  return coalesce(cardinality(p_symbols), 0);
end $$;

-- Saves (or replaces) the stock list for a month. Packs already made keep their own copy.
create function v2.save_cash_stock_list(p_month text, p_file_name text,
                                        p_lc text[], p_mc text[], p_sc text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_file text := trim(coalesce(p_file_name, ''));
  v_lc int;
  v_mc int;
  v_sc int;
begin
  if not v2_private.is_role('ra', 'admin') then
    raise exception 'Research workspace access required' using errcode = '42501';
  end if;
  if coalesce(p_month, '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Choose the month';
  end if;
  if char_length(v_file) not between 1 and 200 then
    raise exception 'The stock list file name is missing';
  end if;
  v_lc := v2_private.pack_symbols_count(p_lc, 'LC');
  v_mc := v2_private.pack_symbols_count(p_mc, 'MC');
  v_sc := v2_private.pack_symbols_count(p_sc, 'SC');
  if v_lc + v_mc + v_sc = 0 then
    raise exception 'The stock list has no stocks';
  end if;
  insert into v2.cash_stock_lists (month, lc, mc, sc, file_name, uploaded_by)
  values (p_month, coalesce(p_lc, '{}'), coalesce(p_mc, '{}'), coalesce(p_sc, '{}'), v_file,
          (select auth.uid()))
  on conflict (month) do update
    set lc = excluded.lc, mc = excluded.mc, sc = excluded.sc, file_name = excluded.file_name,
        uploaded_by = excluded.uploaded_by, uploaded_at = now();
  perform v2_private.log_audit('cash.stock_list_saved', 'cash_stock_list', p_month,
                               jsonb_build_object('lc', v_lc, 'mc', v_mc, 'sc', v_sc,
                                                  'file', v_file));
  return jsonb_build_object('month', p_month, 'lc', v_lc, 'mc', v_mc, 'sc', v_sc);
end $$;

-- A new research pack report for one product and month, from that month's stock list. The browser
-- then uploads the PDF to <id>/preview.pdf, the file the esign function signs.
create function v2.create_cash_pack_draft(p_product text, p_month text, p_file_name text,
                                          p_pdf_sha256 text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ref text := 'CASH-' || nextval('v2_private.report_ref_seq');
  v_product text := upper(trim(coalesce(p_product, '')));
  v_file text := trim(coalesce(p_file_name, ''));
  v_list v2.cash_stock_lists;
  v_stocks text[];
  v_title text;
begin
  if not v2_private.is_role('ra', 'admin') then
    raise exception 'Research workspace access required' using errcode = '42501';
  end if;
  if v_product not in ('LC', 'MC', 'SC') then
    raise exception 'Select LC, MC or SC';
  end if;
  if coalesce(p_month, '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Choose the month';
  end if;
  if char_length(v_file) not between 1 and 200 then
    raise exception 'The PDF file name is missing';
  end if;
  if coalesce(p_pdf_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'The PDF fingerprint is missing';
  end if;
  select * into v_list from v2.cash_stock_lists where month = p_month;
  if not found then
    raise exception 'Save the stock list for this month first';
  end if;
  v_stocks := case v_product when 'LC' then v_list.lc when 'MC' then v_list.mc else v_list.sc end;
  if cardinality(v_stocks) = 0 then
    raise exception 'The % column of this month''s stock list is empty', v_product;
  end if;
  v_title := v_product || ' Research Pack — '
             || to_char(to_date(p_month || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');

  insert into v2.research_reports (report_ref, author_id, title, product, sections, content_hash,
                                   segment, cash_product, frequency, source_file,
                                   cash_kind, pack_month, pack_stocks)
  values (v_ref, (select auth.uid()), v_title, 'Cash', '{}'::jsonb, p_pdf_sha256,
          'Cash', v_product, 'Monthly', v_file, 'pack', p_month, v_stocks)
  returning id into v_id;

  perform v2_private.log_audit('report.created', 'research_report', v_ref,
                               jsonb_build_object('segment', 'Cash', 'kind', 'research pack',
                                                  'product', v_product, 'month', p_month,
                                                  'stocks', cardinality(v_stocks),
                                                  'file', v_file));
  return jsonb_build_object('id', v_id, 'report_ref', v_ref, 'title', v_title);
end $$;

-- A different PDF for a pack that is not signed yet (e.g. the wrong file was chosen).
create function v2.replace_cash_pack_pdf(p_report_id uuid, p_file_name text, p_pdf_sha256 text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_report v2.research_reports;
  v_file text := trim(coalesce(p_file_name, ''));
begin
  if not v2_private.owns_report(p_report_id) then
    raise exception 'Report not found' using errcode = '42501';
  end if;
  select * into v_report from v2.research_reports where id = p_report_id for update;
  if v_report.cash_kind <> 'pack' then
    raise exception 'Only a research pack takes an uploaded PDF';
  end if;
  if v_report.esign_status = 'Signed' then
    raise exception 'This pack is already signed; upload the new PDF as a new pack';
  end if;
  if char_length(v_file) not between 1 and 200 or coalesce(p_pdf_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'The PDF file name or fingerprint is missing';
  end if;
  update v2.research_reports set source_file = v_file, content_hash = p_pdf_sha256,
                                 esign_status = 'Unsigned'
   where id = p_report_id;
  perform v2_private.log_audit('report.pdf_replaced', 'research_report', v_report.report_ref,
                               jsonb_build_object('file', v_file));
  return jsonb_build_object('id', p_report_id, 'report_ref', v_report.report_ref);
end $$;

revoke all on function v2_private.pack_symbols_count(text[], text) from public, anon, authenticated;
revoke all on function v2.save_cash_stock_list(text, text, text[], text[], text[]) from public, anon, authenticated;
revoke all on function v2.create_cash_pack_draft(text, text, text, text) from public, anon, authenticated;
revoke all on function v2.replace_cash_pack_pdf(uuid, text, text) from public, anon, authenticated;
grant execute on function v2.save_cash_stock_list(text, text, text[], text[], text[]) to authenticated;
grant execute on function v2.create_cash_pack_draft(text, text, text, text) to authenticated;
grant execute on function v2.replace_cash_pack_pdf(uuid, text, text) to authenticated;
