-- Sampadha v2: the client and Sales pages from the 27 Oct prototype.
--
-- * Add client: separate mutual fund, stock and F&O experience, and the application email now
--   carries the details so the client can check them. PAN and demat are masked in that email.
-- * Client Communication: Sales can read report notices, and v2.mail_meta says who sent each
--   email and whether it is Cash or Multi. Broker orders stay out of the Sales view.
-- * Uploads: Cash working files, stored privately at cash-files/<uuid>.<ext> in bucket v2-research.

begin;

alter table v2.client_applications
  add column mf_experience text,
  add column stock_experience text,
  add column fo_experience text;

create or replace function v2.submit_client_application(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ref text := 'APP-' || nextval('v2_private.app_ref_seq');
  v_id uuid;
  v_name text := trim(payload ->> 'name');
  v_email text := trim(payload ->> 'email');
  v_segments text[] := coalesce(array(select jsonb_array_elements_text(payload -> 'segments')), '{}');
  v_products text[] := coalesce(array(select jsonb_array_elements_text(payload -> 'products')), '{}');
  v_mask text := 'XXXXXX' || right(coalesce(payload ->> 'pan', ''), 4);
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

  insert into v2.client_applications (
    app_ref, submitted_by, full_name, pan, dob, email, mobile, occupation, income_band,
    tax_residency, city, broker, depository, demat_id, trading_client_id, bank,
    mf_experience, stock_experience, fo_experience, segments, products, horizon, objective,
    proposed_amount, loss_tolerance, consent
  ) values (
    v_ref, (select auth.uid()), v_name, payload ->> 'pan', nullif(payload ->> 'dob', '')::date,
    v_email, payload ->> 'mobile', payload ->> 'occupation', payload ->> 'income',
    payload ->> 'residency', payload ->> 'city', payload ->> 'broker', payload ->> 'depository',
    payload ->> 'demat', payload ->> 'tradingId', payload ->> 'bank',
    payload ->> 'mfExperience', payload ->> 'stockExperience', payload ->> 'foExperience',
    v_segments, v_products, payload ->> 'horizon', payload ->> 'objective',
    nullif(payload ->> 'amount', '')::numeric, payload ->> 'loss', true
  ) returning id into v_id;

  insert into v2.email_log (mail_ref, application_ref, recipient_email, recipient_name, subject,
                            mail_type, body, created_by)
  values ('MAIL-' || nextval('v2_private.mail_ref_seq'), v_ref, v_email, v_name,
          'We received your Sampadha client application', 'Submission confirmation',
          'Your client onboarding application ' || v_ref ||
          ' has been received and is pending Admin review. We will notify you after a decision.' ||
          E'\n\nPlease check the details below and tell your Sampadha contact if anything is wrong.' ||
          E'\n\nPAN: ' || v_mask ||
          E'\nMobile: ' || coalesce(payload ->> 'mobile', '-') ||
          E'\nBroker: ' || coalesce(payload ->> 'broker', '-') ||
          E'\nDepository: ' || coalesce(payload ->> 'depository', '-') ||
          E'\nDemat / BO ID: XXXX' || right(coalesce(payload ->> 'demat', ''), 4) ||
          E'\nTrading client ID: ' || coalesce(payload ->> 'tradingId', '-') ||
          E'\nMarket segments: ' || coalesce(nullif(array_to_string(v_segments, ', '), ''), '-') ||
          E'\nProducts: ' || coalesce(nullif(array_to_string(v_products, ', '), ''), '-') ||
          E'\nHolding horizon: ' || coalesce(payload ->> 'horizon', '-') ||
          E'\nInvestment objective: ' || coalesce(payload ->> 'objective', '-') ||
          E'\nProposed investment amount: ' || coalesce(nullif(payload ->> 'amount', ''), '-') ||
          E'\nMaximum loss tolerance: ' || coalesce(payload ->> 'loss', '-'),
          (select auth.uid()));

  perform v2_private.log_audit('application.submitted', 'client_application', v_ref,
                               jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_id, 'app_ref', v_ref);
end $$;

-- Sales reads the same notices the client receives. Broker orders hold the client's trades and
-- stay with Admin, the report's author and the client.
drop policy email_log_read on v2.email_log;
create policy email_log_read on v2.email_log for select to authenticated using (
  v2_private.is_role('admin')
  or recipient_id = (select auth.uid())
  or client_id = (select auth.uid())
  or (v2_private.is_role('sales')
      and (application_ref is not null or mail_type in ('Broker test', 'Research report')))
);

-- Sales cannot read staff profiles or reports, so this gives only the sender's role and the
-- report's segment, and only for emails the caller can already see.
create function v2.mail_meta() returns table (mail_ref text, sender text, segment text)
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
               or e.mail_type in ('Broker test', 'Research report')))
$$;
revoke all on function v2.mail_meta() from public, anon;
grant execute on function v2.mail_meta() to authenticated;

create function v2_private.is_cash_file_object(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select p_name ~ '^cash-files/[0-9a-f-]{36}\.(csv|xls|xlsx)$'
$$;

create policy v2_cash_files_read on storage.objects for select to authenticated
  using (bucket_id = 'v2-research' and v2_private.is_cash_file_object(name)
         and v2_private.is_role('ra', 'admin'));
create policy v2_cash_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'v2-research' and v2_private.is_cash_file_object(name)
              and v2_private.is_role('ra', 'admin'));
create policy v2_cash_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'v2-research' and v2_private.is_cash_file_object(name)
         and v2_private.is_role('ra', 'admin'));

create table v2.cash_files (
  id uuid primary key default gen_random_uuid(),
  file_name text not null check (char_length(file_name) between 1 and 200),
  storage_path text not null unique,
  size_bytes int not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid not null default auth.uid() references v2.profiles (id),
  uploaded_at timestamptz not null default now()
);
create index v2_cash_files_latest_idx on v2.cash_files (uploaded_at desc);
alter table v2.cash_files enable row level security;
create policy cash_files_read on v2.cash_files for select to authenticated
  using (v2_private.is_role('ra', 'admin'));
create policy cash_files_insert on v2.cash_files for insert to authenticated
  with check (v2_private.is_role('ra', 'admin') and uploaded_by = (select auth.uid())
              and v2_private.is_cash_file_object(storage_path));
create policy cash_files_delete on v2.cash_files for delete to authenticated
  using (v2_private.is_role('ra', 'admin'));
grant select, insert, delete on v2.cash_files to authenticated;
grant all on v2.cash_files to service_role;

commit;
