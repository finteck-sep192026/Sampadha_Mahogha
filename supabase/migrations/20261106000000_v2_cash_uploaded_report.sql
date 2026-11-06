-- Cash Segment reports are made outside the portal: the analyst chooses the product and frequency,
-- uploads the finished PDF, signs it with Aadhaar eSign, then chooses clients (cash_kind 'upload').
-- The PDF is stored at <report id>/preview.pdf, the file the esign function signs.
-- The portal holds no recommendation rows for these reports, so they cannot go to CARE PaRRVA and
-- do not trigger broker auto-emails. Reports already made from a CSV keep working as they did.

alter table v2.research_reports drop constraint research_reports_cash_kind_check;
alter table v2.research_reports add constraint research_reports_cash_kind_check
  check (cash_kind in ('portfolio', 'pack', 'upload'));

alter table v2.research_reports drop constraint research_reports_pack_fields;
alter table v2.research_reports add constraint research_reports_pack_fields check (
  cash_kind = 'portfolio'
  or (cash_kind = 'upload' and segment = 'Cash')
  or (segment = 'Cash' and pack_month is not null and pack_stocks is not null));

create function v2.create_cash_upload_draft(p_product text, p_frequency text, p_file_name text,
                                            p_pdf_sha256 text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ref text := 'CASH-' || nextval('v2_private.report_ref_seq');
  v_product text := upper(trim(coalesce(p_product, '')));
  v_frequency text := trim(coalesce(p_frequency, ''));
  v_file text := trim(coalesce(p_file_name, ''));
  v_title text;
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
    raise exception 'The PDF file name is missing';
  end if;
  if coalesce(p_pdf_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'The PDF fingerprint is missing';
  end if;
  v_title := v_product || ' Cash ' || v_frequency || ' Report';

  insert into v2.research_reports (report_ref, author_id, title, product, sections, content_hash,
                                   segment, cash_product, frequency, source_file, cash_kind)
  values (v_ref, (select auth.uid()), v_title, 'Cash', '{}'::jsonb, p_pdf_sha256,
          'Cash', v_product, v_frequency, v_file, 'upload')
  returning id into v_id;

  perform v2_private.log_audit('report.created', 'research_report', v_ref,
                               jsonb_build_object('segment', 'Cash', 'kind', 'uploaded PDF',
                                                  'product', v_product, 'frequency', v_frequency,
                                                  'file', v_file));
  return jsonb_build_object('id', v_id, 'report_ref', v_ref, 'title', v_title);
end $$;

revoke all on function v2.create_cash_upload_draft(text, text, text, text) from public, anon, authenticated;
grant execute on function v2.create_cash_upload_draft(text, text, text, text) to authenticated;
