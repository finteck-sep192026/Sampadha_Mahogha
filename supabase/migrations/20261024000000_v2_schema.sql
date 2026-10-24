-- Sampadha Wealth Portal v2 — separate schema for the Sampadha-v2 front end.
-- Lives beside the v1 tables (schema public) in the same project; nothing here touches v1.
-- Logins are shared (auth.users) but access is decided only by v2.profiles.
--
-- Security model (same as v1): tables are read-only through the Data API (RLS); every write goes
-- through a SECURITY DEFINER function that checks the caller's role on the server. Report signing
-- is a Digio Aadhaar eSign, recorded only by the 'digio-esign' Edge Function (service role).
--
-- After running: Dashboard → Project Settings → Data API → Exposed schemas → add 'v2'.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists v2;
create schema if not exists v2_private;
revoke all on schema v2_private from public;
grant usage on schema v2 to anon, authenticated, service_role;
grant usage on schema v2_private to authenticated, service_role;

create type v2.app_role as enum ('admin', 'ra', 'sales', 'client');

-- ───────────────────────── sequences ─────────────────────────
create sequence v2_private.app_ref_seq start 27100;
create sequence v2_private.mail_ref_seq start 27100;
create sequence v2_private.report_ref_seq start 27200;
create sequence v2_private.exit_ref_seq start 27500;

-- ───────────────────────── identity ─────────────────────────
create table v2.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  login_id text not null,
  role v2.app_role not null,
  full_name text not null,
  initials text not null,
  email text not null,
  mobile text,
  pan text,
  risk_profile text,
  kyc_status text,
  -- Email or 10-digit mobile the signer uses at Digio (Aadhaar eSign). Staff who sign reports need it.
  esign_identifier text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index v2_profiles_login_id_key on v2.profiles (lower(login_id));
create unique index v2_profiles_email_key on v2.profiles (lower(email));
create index v2_profiles_role_idx on v2.profiles (role);

create function v2_private.user_role() returns v2.app_role
language sql stable security definer set search_path = '' as $$
  select role from v2.profiles where id = (select auth.uid()) and is_active
$$;

create function v2_private.is_role(variadic p_roles v2.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(v2_private.user_role() = any (p_roles), false)
$$;

-- ───────────────────────── commercial ─────────────────────────
create table v2.plans (
  code text primary key,
  name text not null,
  price_annual numeric(12, 2) not null check (price_annual >= 0),
  summary text not null,
  sort_order int not null default 0
);

create table v2.subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references v2.profiles (id) on delete cascade,
  plan_code text not null references v2.plans (code),
  products text[] not null default '{}',
  multi_tier text check (multi_tier in ('Nano', 'Micro', 'Mini', 'Mega', 'Giga')),
  billing text not null default 'Quarterly' check (billing in ('Quarterly', 'Annual')),
  starts_on date not null,
  ends_on date,
  status text not null default 'Active' check (status in ('Active', 'Expired', 'Cancelled'))
);
create index v2_subscriptions_client_idx on v2.subscriptions (client_id);

create table v2.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  client_id uuid not null references v2.profiles (id) on delete cascade,
  plan_code text not null references v2.plans (code),
  period_label text not null,
  billing text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  paid_on date,
  due_on date,
  status text not null check (status in ('Paid', 'Upcoming', 'Overdue'))
);
create index v2_payments_client_idx on v2.payments (client_id);

-- ───────────────────────── onboarding ─────────────────────────
create table v2.client_applications (
  id uuid primary key default gen_random_uuid(),
  app_ref text not null unique,
  submitted_by uuid not null references v2.profiles (id),
  full_name text not null,
  pan text not null check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  dob date,
  email text not null,
  mobile text not null,
  occupation text,
  income_band text,
  tax_residency text,
  city text,
  broker text,
  depository text,
  demat_id text,
  trading_client_id text,
  bank text,
  experience text,
  segments text[] not null default '{}',
  products text[] not null default '{}',
  risk_profile text,
  horizon text,
  objective text,
  proposed_amount numeric(14, 2),
  loss_tolerance text,
  preferred_plan text,
  consent boolean not null check (consent),
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  decided_by uuid references v2.profiles (id),
  decided_at timestamptz,
  submitted_at timestamptz not null default now()
);

-- Simulated outbound mail log. No mail leaves the system yet (status = 'Simulated').
create table v2.email_log (
  id uuid primary key default gen_random_uuid(),
  mail_ref text not null unique,
  application_ref text,
  report_id uuid,
  recipient_id uuid references v2.profiles (id) on delete set null,
  recipient_email text not null,
  recipient_name text,
  subject text not null,
  mail_type text not null,
  status text not null default 'Simulated',
  body text not null,
  created_by uuid references v2.profiles (id) on delete set null,
  sent_at timestamptz not null default now()
);
create index v2_email_log_recipient_idx on v2.email_log (recipient_id);

create table v2.client_notifications (
  id uuid primary key default gen_random_uuid(),
  alert_ref text not null unique,
  client_id uuid not null references v2.profiles (id) on delete cascade,
  channel text not null check (channel in ('Email', 'WhatsApp', 'In-app')),
  title text not null,
  detail text not null,
  unread boolean not null default true,
  created_at timestamptz not null default now()
);
create index v2_client_notifications_client_idx on v2.client_notifications (client_id);

-- ───────────────────────── research content ─────────────────────────
create table v2.strategies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  universe text not null,
  risk text not null,
  analyst_name text not null,
  status text not null check (status in ('Published', 'Draft', 'Review')),
  updated_at timestamptz not null default now()
);

create table v2.cash_recommendations (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  product text not null check (product in ('LC', 'MC', 'SC', 'All')),
  stock text not null,
  price numeric(12, 2) not null,
  qty int not null check (qty > 0),
  published_at timestamptz not null,
  delivered_at timestamptz,
  status text not null check (status in ('Active', 'Review', 'Closed'))
);

create table v2.multi_recommendations (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  product text not null check (product in ('Nano', 'Micro', 'Mini', 'Mega', 'Giga')),
  symbol text not null,
  expiry date not null,
  strike numeric(12, 2) not null,
  option_type text not null check (option_type in ('CE', 'PE')),
  side text not null check (side in ('BUY', 'SELL')),
  lots int not null check (lots > 0),
  lot_size int not null check (lot_size > 0),
  qty int generated always as (lots * lot_size) stored,
  price numeric(12, 2) not null,
  published_at timestamptz not null,
  delivered_at timestamptz,
  status text not null check (status in ('Active', 'Review', 'Closed'))
);

-- ───────────────────────── research reports ─────────────────────────
-- Lifecycle: Draft (attachments + preview PDF may change) → eSign Requested → Signed (locked) → Sent.
create table v2.research_reports (
  id uuid primary key default gen_random_uuid(),
  report_ref text not null unique,
  author_id uuid not null references v2.profiles (id),
  title text not null check (char_length(title) between 1 and 150),
  product text not null default 'Multi',
  sections jsonb not null,
  content_hash text not null,
  status text not null default 'Draft' check (status in ('Draft', 'Sent')),
  esign_status text not null default 'Unsigned'
    check (esign_status in ('Unsigned', 'Requested', 'Signed')),
  signed_at timestamptz,
  signer_name text,
  signed_pdf_path text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index v2_research_reports_author_idx on v2.research_reports (author_id);

create table v2.research_legs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references v2.research_reports (id) on delete cascade,
  position int not null,
  product text not null check (product in ('Nano', 'Micro', 'Mini', 'Mega', 'Giga')),
  symbol text not null check (symbol in ('NIFTY', 'SENSEX')),
  expiry date not null,
  strike numeric(12, 2) not null check (strike > 0),
  option_type text not null check (option_type in ('CE', 'PE')),
  side text not null check (side in ('BUY', 'SELL')),
  lots int not null check (lots > 0),
  lot_size int not null check (lot_size > 0),
  quantity int generated always as (lots * lot_size) stored,
  initiation_price numeric(12, 2) not null check (initiation_price > 0),
  t1 numeric(12, 2) check (t1 > 0),
  t2 numeric(12, 2) check (t2 > 0),
  t3 numeric(12, 2) check (t3 > 0),
  published_at timestamptz not null,
  delivered_at timestamptz,
  status text not null default 'Generated'
    check (status in ('Generated', 'Open', 'Partially Closed', 'Closed')),
  closed_lots int not null default 0 check (closed_lots >= 0),
  closed_qty int generated always as (closed_lots * lot_size) stored,
  remaining_lots int generated always as (lots - closed_lots) stored,
  remaining_qty int generated always as ((lots - closed_lots) * lot_size) stored,
  avg_closing_price numeric(14, 4),
  last_exit_at timestamptz,
  closed_at timestamptz,
  check (closed_lots <= lots)
);
create index v2_research_legs_report_idx on v2.research_legs (report_id);

-- Every partial or full exit is kept as its own row (Position Exit History).
create table v2.research_leg_exits (
  id uuid primary key default gen_random_uuid(),
  exit_ref text not null unique,
  leg_id uuid not null references v2.research_legs (id) on delete cascade,
  sequence int not null,
  lots int not null check (lots > 0),
  quantity int not null check (quantity > 0),
  price numeric(12, 2) not null check (price > 0),
  remaining_lots_after int not null,
  remaining_qty_after int not null,
  status_after text not null,
  recorded_by uuid references v2.profiles (id),
  at timestamptz not null default now(),
  unique (leg_id, sequence)
);
create index v2_research_leg_exits_leg_idx on v2.research_leg_exits (leg_id);

-- Up to three uploads per report (image or PDF, 5 MB). Files live in storage bucket v2-research
-- at <report_id>/attachments/<slot>; this row is the register the UI reads.
create table v2.research_attachments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references v2.research_reports (id) on delete cascade,
  slot int not null check (slot between 0 and 2),
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type ~ '^image/[a-z0-9.+-]+$' or mime_type = 'application/pdf'),
  size_bytes int not null check (size_bytes between 1 and 5242880),
  storage_path text not null,
  uploaded_at timestamptz not null default now(),
  unique (report_id, slot)
);

create table v2.research_deliveries (
  report_id uuid not null references v2.research_reports (id) on delete cascade,
  client_id uuid not null references v2.profiles (id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (report_id, client_id)
);
create index v2_research_deliveries_client_idx on v2.research_deliveries (client_id);

-- One row per Digio signing request. Written only by the digio-esign Edge Function.
create table v2.esign_requests (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references v2.research_reports (id) on delete cascade,
  provider text not null default 'digio',
  document_id text not null unique,
  signer_identifier text not null,
  pdf_sha256 text not null,
  status text not null default 'Requested' check (status in ('Requested', 'Signed', 'Failed', 'Expired')),
  requested_by uuid not null references v2.profiles (id),
  requested_at timestamptz not null default now(),
  signed_at timestamptz,
  signer_name text,
  provider_status jsonb
);
create index v2_esign_requests_report_idx on v2.esign_requests (report_id);

-- ───────────────────────── audit ─────────────────────────
create table v2.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_login text,
  action text not null,
  entity text not null,
  entity_ref text,
  detail jsonb not null default '{}'
);
create index v2_audit_log_at_idx on v2.audit_log (at desc);

create function v2_private.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_change before update or delete on v2.audit_log
  for each row execute function v2_private.audit_log_immutable();

create function v2_private.log_audit(p_action text, p_entity text, p_ref text, p_detail jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into v2.audit_log (actor_id, actor_login, action, entity, entity_ref, detail)
  select (select auth.uid()), (select login_id from v2.profiles where id = (select auth.uid())),
         p_action, p_entity, p_ref, p_detail
$$;

-- ───────────────────────── row level security ─────────────────────────
alter table v2.profiles enable row level security;
alter table v2.plans enable row level security;
alter table v2.subscriptions enable row level security;
alter table v2.payments enable row level security;
alter table v2.client_applications enable row level security;
alter table v2.email_log enable row level security;
alter table v2.client_notifications enable row level security;
alter table v2.strategies enable row level security;
alter table v2.cash_recommendations enable row level security;
alter table v2.multi_recommendations enable row level security;
alter table v2.research_reports enable row level security;
alter table v2.research_legs enable row level security;
alter table v2.research_leg_exits enable row level security;
alter table v2.research_attachments enable row level security;
alter table v2.research_deliveries enable row level security;
alter table v2.esign_requests enable row level security;
alter table v2.audit_log enable row level security;

create function v2_private.owns_report(p_report_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from v2.research_reports r
    where r.id = p_report_id
      and (v2_private.is_role('admin')
           or (v2_private.is_role('ra') and r.author_id = (select auth.uid())))
  )
$$;

create function v2_private.can_see_report(p_report_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select v2_private.owns_report(p_report_id)
      or exists (select 1 from v2.research_deliveries d
                 where d.report_id = p_report_id and d.client_id = (select auth.uid()))
$$;

-- Attachments and the preview PDF can change only until the report is signed.
create function v2_private.can_edit_draft(p_report_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select v2_private.owns_report(p_report_id)
     and exists (select 1 from v2.research_reports r
                 where r.id = p_report_id and r.status = 'Draft' and r.esign_status <> 'Signed')
$$;

create policy profiles_read on v2.profiles for select to authenticated using (
  id = (select auth.uid()) or v2_private.is_role('admin')
  or (v2_private.is_role('sales') and role = 'client')
);
create policy plans_read on v2.plans for select to authenticated
  using (v2_private.user_role() is not null);
create policy subscriptions_read on v2.subscriptions for select to authenticated using (
  client_id = (select auth.uid()) or v2_private.is_role('admin', 'sales')
);
create policy payments_read on v2.payments for select to authenticated using (
  client_id = (select auth.uid()) or v2_private.is_role('admin')
);
create policy applications_read on v2.client_applications for select to authenticated using (
  v2_private.is_role('admin') or (v2_private.is_role('sales') and submitted_by = (select auth.uid()))
);
create policy email_log_read on v2.email_log for select to authenticated using (
  v2_private.is_role('admin')
  or recipient_id = (select auth.uid())
  or (v2_private.is_role('sales') and application_ref is not null)
);
create policy notifications_read on v2.client_notifications for select to authenticated
  using (client_id = (select auth.uid()));
create policy strategies_read on v2.strategies for select to authenticated
  using (v2_private.is_role('admin', 'ra'));
create policy cash_recs_read on v2.cash_recommendations for select to authenticated
  using (v2_private.user_role() is not null);
create policy multi_recs_read on v2.multi_recommendations for select to authenticated
  using (v2_private.user_role() is not null);
create policy reports_read on v2.research_reports for select to authenticated
  using (v2_private.can_see_report(id));
create policy legs_read on v2.research_legs for select to authenticated
  using (v2_private.can_see_report(report_id));
create policy exits_read on v2.research_leg_exits for select to authenticated using (
  exists (select 1 from v2.research_legs l where l.id = leg_id and v2_private.can_see_report(l.report_id))
);
create policy attachments_read on v2.research_attachments for select to authenticated
  using (v2_private.can_see_report(report_id));
create policy deliveries_read on v2.research_deliveries for select to authenticated using (
  client_id = (select auth.uid()) or v2_private.owns_report(report_id)
);
create policy esign_read on v2.esign_requests for select to authenticated
  using (v2_private.owns_report(report_id));
create policy audit_read on v2.audit_log for select to authenticated
  using (v2_private.is_role('admin'));

-- Read-only Data API access. Writes happen only through the functions below.
grant select on all tables in schema v2 to authenticated;

-- ───────────────────────── storage: bucket v2-research (private) ─────────────────────────
-- <report_id>/attachments/<slot>   uploads (author, while Draft and unsigned)
-- <report_id>/preview.pdf          generated PDF that is sent to Digio (author, while unsigned)
-- <report_id>/signed.pdf           Digio-signed PDF (written by the Edge Function only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('v2-research', 'v2-research', false, 10485760, array['image/*', 'application/pdf'])
on conflict (id) do nothing;

create function v2_private.object_report_id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$'
              then split_part(p_name, '/', 1)::uuid end
$$;

create function v2_private.author_may_write(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_name ~ '^[0-9a-f-]{36}/attachments/[0-2]$' or p_name ~ '^[0-9a-f-]{36}/preview\.pdf$')
     and v2_private.can_edit_draft(v2_private.object_report_id(p_name))
$$;

-- Owners read everything for their reports; delivered clients read only the signed PDF.
create function v2_private.may_read_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select v2_private.owns_report(v2_private.object_report_id(p_name))
      or (p_name ~ '^[0-9a-f-]{36}/signed\.pdf$'
          and v2_private.can_see_report(v2_private.object_report_id(p_name)))
$$;

create policy v2_research_read on storage.objects for select to authenticated
  using (bucket_id = 'v2-research' and v2_private.may_read_object(name));
create policy v2_research_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'v2-research' and v2_private.author_may_write(name));
create policy v2_research_update on storage.objects for update to authenticated
  using (bucket_id = 'v2-research' and v2_private.author_may_write(name))
  with check (bucket_id = 'v2-research' and v2_private.author_may_write(name));

-- ───────────────────────── functions (the only write path) ─────────────────────────

create function v2.resolve_login(identifier text) returns text
language sql stable security definer set search_path = '' as $$
  select p.email from v2.profiles p
  where p.is_active
    and (lower(p.login_id) = lower(trim(identifier)) or lower(p.email) = lower(trim(identifier)))
  limit 1
$$;

create function v2.submit_client_application(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ref text := 'APP-' || nextval('v2_private.app_ref_seq');
  v_id uuid;
  v_name text := trim(payload ->> 'name');
  v_email text := trim(payload ->> 'email');
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
    raise exception 'Client consent is required';
  end if;

  insert into v2.client_applications (
    app_ref, submitted_by, full_name, pan, dob, email, mobile, occupation, income_band,
    tax_residency, city, broker, depository, demat_id, trading_client_id, bank, experience,
    segments, products, risk_profile, horizon, objective, proposed_amount, loss_tolerance,
    preferred_plan, consent
  ) values (
    v_ref, (select auth.uid()), v_name, payload ->> 'pan', nullif(payload ->> 'dob', '')::date,
    v_email, payload ->> 'mobile', payload ->> 'occupation', payload ->> 'income',
    payload ->> 'residency', payload ->> 'city', payload ->> 'broker', payload ->> 'depository',
    payload ->> 'demat', payload ->> 'tradingId', payload ->> 'bank', payload ->> 'experience',
    coalesce(array(select jsonb_array_elements_text(payload -> 'segments')), '{}'),
    coalesce(array(select jsonb_array_elements_text(payload -> 'products')), '{}'),
    payload ->> 'risk', payload ->> 'horizon', payload ->> 'objective',
    nullif(payload ->> 'amount', '')::numeric, payload ->> 'loss', payload ->> 'plan', true
  ) returning id into v_id;

  insert into v2.email_log (mail_ref, application_ref, recipient_email, recipient_name, subject,
                            mail_type, body, created_by)
  values ('MAIL-' || nextval('v2_private.mail_ref_seq'), v_ref, v_email, v_name,
          'We received your Sampadha client application', 'Submission confirmation',
          'Your client onboarding application ' || v_ref ||
          ' has been received and is pending Admin review. We will notify you after a decision.',
          (select auth.uid()));

  perform v2_private.log_audit('application.submitted', 'client_application', v_ref,
                               jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_id, 'app_ref', v_ref);
end $$;

create function v2.decide_client_application(p_app_ref text, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_app v2.client_applications;
begin
  if not v2_private.is_role('admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  update v2.client_applications
     set status = case when p_approve then 'Approved' else 'Rejected' end,
         decided_by = (select auth.uid()), decided_at = now()
   where app_ref = p_app_ref and status = 'Pending'
  returning * into v_app;
  if not found then
    raise exception 'Application % is not pending', p_app_ref;
  end if;

  insert into v2.email_log (mail_ref, application_ref, recipient_email, recipient_name, subject,
                            mail_type, body, created_by)
  values ('MAIL-' || nextval('v2_private.mail_ref_seq'), v_app.app_ref, v_app.email, v_app.full_name,
          case when p_approve then 'Your Sampadha client account is approved'
               else 'Update required for your Sampadha application' end,
          case when p_approve then 'Approval confirmation' else 'Decision notification' end,
          case when p_approve
               then 'Your client account has been approved. You may sign in after your access credentials are activated.'
               else 'Your application requires changes before approval. Please contact your Sampadha representative for the required corrections.' end,
          (select auth.uid()));

  perform v2_private.log_audit(case when p_approve then 'application.approved' else 'application.rejected' end,
                               'client_application', v_app.app_ref, '{}');
  return jsonb_build_object('app_ref', v_app.app_ref, 'status', v_app.status);
end $$;

create function v2.list_research_clients()
returns table (id uuid, login_id text, full_name text, email text, multi_tier text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.login_id, p.full_name, p.email, s.multi_tier
  from v2.profiles p
  join v2.subscriptions s on s.client_id = p.id and s.status = 'Active'
  where v2_private.is_role('ra', 'admin') and p.role = 'client' and p.is_active
    and s.multi_tier is not null
  order by p.login_id
$$;

create function v2_private.optional_price(p_leg jsonb, p_key text, p_pos int) returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  v text := trim(coalesce(p_leg ->> p_key, ''));
begin
  if v = '' then
    return null;
  end if;
  if v !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' or v::numeric <= 0 then
    raise exception 'Leg %: % must be a positive number when entered', p_pos, upper(p_key);
  end if;
  return v::numeric;
end $$;

create function v2.create_research_draft(p_title text, p_sections jsonb, p_legs jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ref text := 'RPT-' || nextval('v2_private.report_ref_seq');
  v_leg jsonb;
  v_pos int := 0;
  v_name text;
  v_pub timestamptz;
  v_expiry date;
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
    raise exception 'Add between 1 and 50 recommendation legs';
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
    if initcap(trim(coalesce(v_leg ->> 'product', ''))) not in ('Nano', 'Micro', 'Mini', 'Mega', 'Giga') then
      raise exception 'Leg %: enter Nano, Micro, Mini, Mega or Giga', v_pos;
    end if;
    if upper(trim(coalesce(v_leg ->> 'symbol', ''))) not in ('NIFTY', 'SENSEX') then
      raise exception 'Leg %: enter NIFTY or SENSEX', v_pos;
    end if;
    if upper(trim(coalesce(v_leg ->> 'option', ''))) not in ('CE', 'PE')
       or upper(trim(coalesce(v_leg ->> 'side', ''))) not in ('BUY', 'SELL') then
      raise exception 'Leg %: use CE/PE and BUY/SELL', v_pos;
    end if;
    if coalesce(v_leg ->> 'lots', '') !~ '^[0-9]{1,6}$'
       or coalesce(v_leg ->> 'lotSize', '') !~ '^[0-9]{1,6}$'
       or (v_leg ->> 'lots')::int < 1 or (v_leg ->> 'lotSize')::int < 1 then
      raise exception 'Leg %: lots and lot size must be positive whole numbers', v_pos;
    end if;
    if coalesce(v_leg ->> 'strike', '') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$'
       or coalesce(v_leg ->> 'price', '') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$'
       or (v_leg ->> 'strike')::numeric <= 0 or (v_leg ->> 'price')::numeric <= 0 then
      raise exception 'Leg %: strike and initiation price must be positive numbers', v_pos;
    end if;
    if coalesce(v_leg ->> 'published', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'
       or coalesce(v_leg ->> 'expiry', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Leg %: enter a published date/time and an expiry date', v_pos;
    end if;
    v_pub := ((v_leg ->> 'published')::timestamp) at time zone 'Asia/Kolkata';
    v_expiry := (v_leg ->> 'expiry')::date;
    if v_expiry < (v_pub at time zone 'Asia/Kolkata')::date then
      raise exception 'Leg %: expiry must be on or after the published date', v_pos;
    end if;

    insert into v2.research_legs (report_id, position, product, symbol, expiry, strike,
                                  option_type, side, lots, lot_size, initiation_price,
                                  t1, t2, t3, published_at)
    values (v_id, v_pos, initcap(trim(v_leg ->> 'product')), upper(trim(v_leg ->> 'symbol')),
            v_expiry, (v_leg ->> 'strike')::numeric, upper(trim(v_leg ->> 'option')),
            upper(trim(v_leg ->> 'side')), (v_leg ->> 'lots')::int, (v_leg ->> 'lotSize')::int,
            (v_leg ->> 'price')::numeric,
            v2_private.optional_price(v_leg, 't1', v_pos),
            v2_private.optional_price(v_leg, 't2', v_pos),
            v2_private.optional_price(v_leg, 't3', v_pos), v_pub);
  end loop;

  perform v2_private.log_audit('report.created', 'research_report', v_ref,
                               jsonb_build_object('legs', v_pos));
  return jsonb_build_object('id', v_id, 'report_ref', v_ref);
end $$;

-- Registers an uploaded attachment. The file itself must already be in storage at the
-- expected path (the storage policy only lets the author write there while the draft is open).
create function v2.register_research_attachment(p_report_id uuid, p_slot int, p_file_name text,
                                                p_mime_type text, p_size int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_path text := p_report_id::text || '/attachments/' || p_slot;
begin
  if not v2_private.can_edit_draft(p_report_id) then
    raise exception 'Attachments can be changed only on your unsigned draft' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'v2-research' and name = v_path) then
    raise exception 'Upload the file before registering it';
  end if;
  insert into v2.research_attachments (report_id, slot, file_name, mime_type, size_bytes, storage_path)
  values (p_report_id, p_slot, trim(p_file_name), p_mime_type, p_size, v_path)
  on conflict (report_id, slot) do update
     set file_name = excluded.file_name, mime_type = excluded.mime_type,
         size_bytes = excluded.size_bytes, uploaded_at = now();
  perform v2_private.log_audit('report.attachment', 'research_report', p_report_id::text,
                               jsonb_build_object('slot', p_slot, 'name', p_file_name));
  return jsonb_build_object('slot', p_slot, 'path', v_path);
end $$;

-- Delivers a report. Requires a completed Digio Aadhaar eSign on the report (recorded only by the
-- digio-esign Edge Function). Clients receive the signed PDF. Re-sending to new clients is allowed;
-- positions are the report legs, so repeat delivery never duplicates them.
create function v2.send_research_report(p_report_id uuid, p_client_ids text[], p_types text[])
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

-- Records a partial or full exit by number of lots.
create function v2.close_research_leg(p_leg_id uuid, p_lots int, p_price numeric)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_leg v2.research_legs;
  v_closed int;
  v_avg numeric;
  v_status text;
  v_seq int;
  v_ref text;
begin
  select * into v_leg from v2.research_legs where id = p_leg_id for update;
  if not found or not v2_private.owns_report(v_leg.report_id) then
    raise exception 'This position is unavailable' using errcode = '42501';
  end if;
  if v_leg.delivered_at is null then
    raise exception 'Positions exist only after the report is sent';
  end if;
  if v_leg.status = 'Closed' then
    raise exception 'This position is already closed';
  end if;
  if p_lots is null or p_lots < 1 then
    raise exception 'No. of lots must be a positive whole number';
  end if;
  if p_lots > v_leg.remaining_lots then
    raise exception 'No. of lots cannot exceed the remaining % lot(s)', v_leg.remaining_lots;
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Enter a valid closing price';
  end if;

  v_closed := v_leg.closed_lots + p_lots;
  v_avg := (coalesce(v_leg.avg_closing_price, 0) * v_leg.closed_lots + round(p_price, 2) * p_lots) / v_closed;
  v_status := case when v_closed = v_leg.lots then 'Closed' else 'Partially Closed' end;
  select coalesce(max(sequence), 0) + 1 into v_seq from v2.research_leg_exits where leg_id = p_leg_id;
  v_ref := 'EXIT-' || nextval('v2_private.exit_ref_seq');

  insert into v2.research_leg_exits (exit_ref, leg_id, sequence, lots, quantity, price,
                                     remaining_lots_after, remaining_qty_after, status_after,
                                     recorded_by)
  values (v_ref, p_leg_id, v_seq, p_lots, p_lots * v_leg.lot_size, round(p_price, 2),
          v_leg.lots - v_closed, (v_leg.lots - v_closed) * v_leg.lot_size, v_status,
          (select auth.uid()));
  update v2.research_legs
     set closed_lots = v_closed, avg_closing_price = v_avg, last_exit_at = now(),
         status = v_status, closed_at = case when v_status = 'Closed' then now() end
   where id = p_leg_id;

  perform v2_private.log_audit('position.exit', 'research_leg', v_ref,
                               jsonb_build_object('leg', p_leg_id, 'lots', p_lots, 'price', p_price));
  return jsonb_build_object('exit_ref', v_ref, 'closed_lots', v_closed,
                            'remaining_lots', v_leg.lots - v_closed,
                            'remaining_qty', (v_leg.lots - v_closed) * v_leg.lot_size,
                            'status', v_status);
end $$;

create function v2.mark_notifications_read() returns void
language sql security definer set search_path = '' as $$
  update v2.client_notifications set unread = false
  where client_id = (select auth.uid()) and unread
$$;

-- ───────────────────────── function privileges ─────────────────────────
revoke all on all functions in schema v2 from public, anon, authenticated;
revoke all on all functions in schema v2_private from public, anon, authenticated;

grant execute on function v2.resolve_login(text) to anon, authenticated;
grant execute on function v2.submit_client_application(jsonb) to authenticated;
grant execute on function v2.decide_client_application(text, boolean) to authenticated;
grant execute on function v2.list_research_clients() to authenticated;
grant execute on function v2.create_research_draft(text, jsonb, jsonb) to authenticated;
grant execute on function v2.register_research_attachment(uuid, int, text, text, int) to authenticated;
grant execute on function v2.send_research_report(uuid, text[], text[]) to authenticated;
grant execute on function v2.close_research_leg(uuid, int, numeric) to authenticated;
grant execute on function v2.mark_notifications_read() to authenticated;
-- RLS and storage policies call these helpers as the signed-in user:
grant execute on function v2_private.user_role() to authenticated;
grant execute on function v2_private.is_role(v2.app_role[]) to authenticated;
grant execute on function v2_private.owns_report(uuid) to authenticated;
grant execute on function v2_private.can_see_report(uuid) to authenticated;
grant execute on function v2_private.can_edit_draft(uuid) to authenticated;
grant execute on function v2_private.object_report_id(text) to authenticated;
grant execute on function v2_private.author_may_write(text) to authenticated;
grant execute on function v2_private.may_read_object(text) to authenticated;

-- Seed script and the digio-esign Edge Function run as service_role.
grant all on all tables in schema v2 to service_role;
grant all on all sequences in schema v2 to service_role;
grant usage on all sequences in schema v2_private to service_role;
