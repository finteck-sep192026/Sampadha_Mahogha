-- Sampadha Wealth Portal — initial schema
-- Security model: tables are read-only through the Data API (RLS); every write goes through a
-- SECURITY DEFINER function that checks the caller's role on the server.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.app_role as enum ('admin', 'ra', 'sales', 'client');

-- ───────────────────────── sequences ─────────────────────────
create sequence private.app_ref_seq start 26100;
create sequence private.mail_ref_seq start 26100;
create sequence private.report_ref_seq start 26200;

-- ───────────────────────── identity ─────────────────────────
-- One row per auth.users row. No profile = no access (default deny).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  login_id text not null,
  role public.app_role not null,
  full_name text not null,
  initials text not null,
  email text not null,
  mobile text,
  pan text,
  risk_profile text,
  kyc_status text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index profiles_login_id_key on public.profiles (lower(login_id));
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_role_idx on public.profiles (role);

create function private.user_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and is_active
$$;

create function private.is_role(variadic p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.user_role() = any (p_roles), false)
$$;

-- ───────────────────────── commercial ─────────────────────────
create table public.plans (
  code text primary key,
  name text not null,
  price_annual numeric(12, 2) not null check (price_annual >= 0),
  summary text not null,
  sort_order int not null default 0
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  plan_code text not null references public.plans (code),
  products text[] not null default '{}',
  multi_tier text check (multi_tier in ('Nano', 'Micro', 'Mini', 'Mega', 'Giga')),
  billing text not null default 'Quarterly' check (billing in ('Quarterly', 'Annual')),
  starts_on date not null,
  ends_on date,
  status text not null default 'Active' check (status in ('Active', 'Expired', 'Cancelled'))
);
create index subscriptions_client_idx on public.subscriptions (client_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  client_id uuid not null references public.profiles (id) on delete cascade,
  plan_code text not null references public.plans (code),
  period_label text not null,
  billing text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  paid_on date,
  due_on date,
  status text not null check (status in ('Paid', 'Upcoming', 'Overdue'))
);
create index payments_client_idx on public.payments (client_id);

-- ───────────────────────── onboarding ─────────────────────────
create table public.client_applications (
  id uuid primary key default gen_random_uuid(),
  app_ref text not null unique,
  submitted_by uuid not null references public.profiles (id),
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
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  submitted_at timestamptz not null default now()
);

-- Simulated outbound mail log. No mail leaves the system yet (status = 'Simulated').
create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  mail_ref text not null unique,
  application_ref text,
  report_id uuid,
  recipient_id uuid references public.profiles (id) on delete set null,
  recipient_email text not null,
  recipient_name text,
  subject text not null,
  mail_type text not null,
  status text not null default 'Simulated',
  body text not null,
  created_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz not null default now()
);
create index email_log_recipient_idx on public.email_log (recipient_id);

create table public.client_notifications (
  id uuid primary key default gen_random_uuid(),
  alert_ref text not null unique,
  client_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('Email', 'WhatsApp', 'In-app')),
  title text not null,
  detail text not null,
  unread boolean not null default true,
  created_at timestamptz not null default now()
);
create index client_notifications_client_idx on public.client_notifications (client_id);

-- ───────────────────────── research content ─────────────────────────
create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  universe text not null,
  risk text not null,
  analyst_name text not null,
  status text not null check (status in ('Published', 'Draft', 'Review')),
  updated_at timestamptz not null default now()
);

create table public.cash_recommendations (
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

create table public.multi_recommendations (
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
create table public.research_reports (
  id uuid primary key default gen_random_uuid(),
  report_ref text not null unique,
  author_id uuid not null references public.profiles (id),
  title text not null check (char_length(title) between 1 and 150),
  product text not null default 'Multi',
  sections jsonb not null,
  content_hash text not null,
  status text not null default 'Draft' check (status in ('Draft', 'Sent')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index research_reports_author_idx on public.research_reports (author_id);

create table public.research_legs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.research_reports (id) on delete cascade,
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
  published_at timestamptz not null,
  delivered_at timestamptz,
  status text not null default 'Open' check (status in ('Open', 'Partially Closed', 'Closed')),
  closed_qty int not null default 0 check (closed_qty >= 0),
  remaining_qty int generated always as (lots * lot_size - closed_qty) stored,
  avg_closing_price numeric(14, 4),
  last_exit_at timestamptz,
  closed_at timestamptz,
  check (closed_qty <= lots * lot_size)
);
create index research_legs_report_idx on public.research_legs (report_id);

create table public.research_leg_exits (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references public.research_legs (id) on delete cascade,
  quantity int not null check (quantity > 0),
  price numeric(12, 2) not null check (price > 0),
  recorded_by uuid references public.profiles (id),
  at timestamptz not null default now()
);
create index research_leg_exits_leg_idx on public.research_leg_exits (leg_id);

create table public.research_deliveries (
  report_id uuid not null references public.research_reports (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (report_id, client_id)
);
create index research_deliveries_client_idx on public.research_deliveries (client_id);

-- A verified one-time code can authorise exactly one send. No policies: function-only.
create table public.otp_consumptions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  otp_at timestamptz not null,
  report_id uuid not null references public.research_reports (id) on delete cascade,
  consumed_at timestamptz not null default now(),
  primary key (user_id, otp_at)
);

-- ───────────────────────── audit ─────────────────────────
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_login text,
  action text not null,
  entity text not null,
  entity_ref text,
  detail jsonb not null default '{}'
);
create index audit_log_at_idx on public.audit_log (at desc);

create function private.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

create function private.log_audit(p_action text, p_entity text, p_ref text, p_detail jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, actor_login, action, entity, entity_ref, detail)
  select (select auth.uid()), (select login_id from public.profiles where id = (select auth.uid())),
         p_action, p_entity, p_ref, p_detail
$$;

-- ───────────────────────── row level security ─────────────────────────
alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.client_applications enable row level security;
alter table public.email_log enable row level security;
alter table public.client_notifications enable row level security;
alter table public.strategies enable row level security;
alter table public.cash_recommendations enable row level security;
alter table public.multi_recommendations enable row level security;
alter table public.research_reports enable row level security;
alter table public.research_legs enable row level security;
alter table public.research_leg_exits enable row level security;
alter table public.research_deliveries enable row level security;
alter table public.otp_consumptions enable row level security;
alter table public.audit_log enable row level security;

create function private.can_see_report(p_report_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.research_reports r
    where r.id = p_report_id
      and (
        private.is_role('admin')
        or (private.is_role('ra') and r.author_id = (select auth.uid()))
        or exists (select 1 from public.research_deliveries d
                   where d.report_id = r.id and d.client_id = (select auth.uid()))
      )
  )
$$;

create policy profiles_read on public.profiles for select to authenticated using (
  id = (select auth.uid()) or private.is_role('admin')
  or (private.is_role('sales') and role = 'client')
);
create policy plans_read on public.plans for select to authenticated
  using (private.user_role() is not null);
create policy subscriptions_read on public.subscriptions for select to authenticated using (
  client_id = (select auth.uid()) or private.is_role('admin', 'sales')
);
create policy payments_read on public.payments for select to authenticated using (
  client_id = (select auth.uid()) or private.is_role('admin')
);
create policy applications_read on public.client_applications for select to authenticated using (
  private.is_role('admin') or (private.is_role('sales') and submitted_by = (select auth.uid()))
);
create policy email_log_read on public.email_log for select to authenticated using (
  private.is_role('admin')
  or recipient_id = (select auth.uid())
  or (private.is_role('sales') and application_ref is not null)
);
create policy notifications_read on public.client_notifications for select to authenticated
  using (client_id = (select auth.uid()));
create policy strategies_read on public.strategies for select to authenticated
  using (private.is_role('admin', 'ra'));
create policy cash_recs_read on public.cash_recommendations for select to authenticated
  using (private.user_role() is not null);
create policy multi_recs_read on public.multi_recommendations for select to authenticated
  using (private.user_role() is not null);
create policy reports_read on public.research_reports for select to authenticated
  using (private.can_see_report(id));
create policy legs_read on public.research_legs for select to authenticated
  using (private.can_see_report(report_id));
create policy exits_read on public.research_leg_exits for select to authenticated using (
  exists (select 1 from public.research_legs l where l.id = leg_id and private.can_see_report(l.report_id))
);
create policy deliveries_read on public.research_deliveries for select to authenticated using (
  client_id = (select auth.uid()) or private.is_role('admin')
  or exists (select 1 from public.research_reports r
             where r.id = report_id and r.author_id = (select auth.uid()))
);
create policy audit_read on public.audit_log for select to authenticated
  using (private.is_role('admin'));

-- Read-only Data API access. Writes happen only through the functions below.
grant select on
  public.profiles, public.plans, public.subscriptions, public.payments, public.client_applications,
  public.email_log, public.client_notifications, public.strategies, public.cash_recommendations,
  public.multi_recommendations, public.research_reports, public.research_legs,
  public.research_leg_exits, public.research_deliveries, public.audit_log
  to authenticated;

-- ───────────────────────── functions (the only write path) ─────────────────────────

-- Login helper: maps a staff/client ID or an email to the auth email. Callable before sign-in.
create function public.resolve_login(identifier text) returns text
language sql stable security definer set search_path = '' as $$
  select p.email from public.profiles p
  where p.is_active
    and (lower(p.login_id) = lower(trim(identifier)) or lower(p.email) = lower(trim(identifier)))
  limit 1
$$;

create function public.submit_client_application(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ref text := 'APP-' || nextval('private.app_ref_seq');
  v_id uuid;
  v_name text := trim(payload ->> 'name');
  v_email text := trim(payload ->> 'email');
begin
  if not private.is_role('sales', 'admin') then
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

  insert into public.client_applications (
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

  insert into public.email_log (mail_ref, application_ref, recipient_email, recipient_name, subject,
                                mail_type, body, created_by)
  values ('MAIL-' || nextval('private.mail_ref_seq'), v_ref, v_email, v_name,
          'We received your Sampadha client application', 'Submission confirmation',
          'Your client onboarding application ' || v_ref ||
          ' has been received and is pending Admin review. We will notify you after a decision.',
          (select auth.uid()));

  perform private.log_audit('application.submitted', 'client_application', v_ref,
                            jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_id, 'app_ref', v_ref);
end $$;

create function public.decide_client_application(p_app_ref text, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_app public.client_applications;
begin
  if not private.is_role('admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  update public.client_applications
     set status = case when p_approve then 'Approved' else 'Rejected' end,
         decided_by = (select auth.uid()), decided_at = now()
   where app_ref = p_app_ref and status = 'Pending'
  returning * into v_app;
  if not found then
    raise exception 'Application % is not pending', p_app_ref;
  end if;

  insert into public.email_log (mail_ref, application_ref, recipient_email, recipient_name, subject,
                                mail_type, body, created_by)
  values ('MAIL-' || nextval('private.mail_ref_seq'), v_app.app_ref, v_app.email, v_app.full_name,
          case when p_approve then 'Your Sampadha client account is approved'
               else 'Update required for your Sampadha application' end,
          case when p_approve then 'Approval confirmation' else 'Decision notification' end,
          case when p_approve
               then 'Your client account has been approved. You may sign in after your access credentials are activated.'
               else 'Your application requires changes before approval. Please contact your Sampadha representative for the required corrections.' end,
          (select auth.uid()));

  perform private.log_audit(case when p_approve then 'application.approved' else 'application.rejected' end,
                            'client_application', v_app.app_ref, '{}');
  return jsonb_build_object('app_ref', v_app.app_ref, 'status', v_app.status);
end $$;

-- Subscribed clients, so the analyst UI can offer recipients. RA/Admin only.
create function public.list_research_clients()
returns table (login_id text, full_name text, email text, multi_tier text)
language sql stable security definer set search_path = '' as $$
  select p.login_id, p.full_name, p.email, s.multi_tier
  from public.profiles p
  join public.subscriptions s on s.client_id = p.id and s.status = 'Active'
  where private.is_role('ra', 'admin') and p.role = 'client' and p.is_active
    and s.multi_tier is not null
  order by p.login_id
$$;

create function public.create_research_draft(p_title text, p_sections jsonb, p_legs jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ref text := 'RPT-' || nextval('private.report_ref_seq');
  v_leg jsonb;
  v_pos int := 0;
  v_name text;
  v_pub timestamptz;
  v_expiry date;
  v_title text := trim(coalesce(p_title, ''));
begin
  if not private.is_role('ra', 'admin') then
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

  insert into public.research_reports (report_ref, author_id, title, sections, content_hash)
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

    insert into public.research_legs (report_id, position, product, symbol, expiry, strike,
                                      option_type, side, lots, lot_size, initiation_price,
                                      published_at)
    values (v_id, v_pos, initcap(trim(v_leg ->> 'product')), upper(trim(v_leg ->> 'symbol')),
            v_expiry, (v_leg ->> 'strike')::numeric, upper(trim(v_leg ->> 'option')),
            upper(trim(v_leg ->> 'side')), (v_leg ->> 'lots')::int, (v_leg ->> 'lotSize')::int,
            (v_leg ->> 'price')::numeric, v_pub);
  end loop;

  perform private.log_audit('report.created', 'research_report', v_ref,
                            jsonb_build_object('legs', v_pos));
  return jsonb_build_object('id', v_id, 'report_ref', v_ref);
end $$;

-- Delivers a report to clients. Requires a one-time code (authenticator-app TOTP, or email OTP if
-- SMTP is configured later) that was verified AFTER the draft was created (so the content cannot
-- change after signing) and within the last 5 minutes. The JWT's `amr` claim is set by the auth
-- server when a code is verified; the browser cannot forge it. Each code authorises one send.
create function public.send_research_report(p_report_id uuid, p_client_ids text[], p_types text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_report public.research_reports;
  v_otp timestamptz;
  v_ids text[];
  v_client record;
  v_sent int := 0;
begin
  if not private.is_role('ra', 'admin') then
    raise exception 'Research workspace access required' using errcode = '42501';
  end if;
  select * into v_report from public.research_reports where id = p_report_id for update;
  if not found or (v_report.author_id <> v_uid and not private.is_role('admin')) then
    raise exception 'Report not found';
  end if;

  select max(to_timestamp((e ->> 'timestamp')::bigint)) into v_otp
  from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) e
  where e ->> 'method' in ('totp', 'otp');
  if v_otp is null or v_otp < v_report.created_at or v_otp < now() - interval '5 minutes' then
    raise exception 'Verify a fresh one-time code before sending' using errcode = '28000';
  end if;

  select array_agg(distinct upper(trim(x))) into v_ids
  from unnest(coalesce(p_client_ids, '{}')) x where trim(x) <> '';
  if v_ids is null then
    raise exception 'Select at least one client';
  end if;
  if coalesce(array_length(p_types, 1), 0) = 0 then
    raise exception 'Choose at least one product type';
  end if;
  if (select count(distinct p.id) from public.profiles p
        join public.subscriptions s on s.client_id = p.id and s.status = 'Active'
       where p.role = 'client' and p.is_active and upper(p.login_id) = any (v_ids)
         and s.multi_tier = any (p_types)) <> array_length(v_ids, 1) then
    raise exception 'Choose only active clients subscribed to the selected product types';
  end if;
  if not exists (select 1 from public.profiles p
                  where upper(p.login_id) = any (v_ids)
                    and not exists (select 1 from public.research_deliveries d
                                     where d.report_id = p_report_id and d.client_id = p.id)) then
    raise exception 'These clients have already received this report';
  end if;

  -- primary key (user_id, otp_at): a second use of the same code fails here
  insert into public.otp_consumptions (user_id, otp_at, report_id) values (v_uid, v_otp, p_report_id);

  for v_client in
    select p.id, p.full_name, p.email from public.profiles p where upper(p.login_id) = any (v_ids)
  loop
    insert into public.research_deliveries (report_id, client_id) values (p_report_id, v_client.id)
    on conflict do nothing;
    if found then
      v_sent := v_sent + 1;
      insert into public.email_log (mail_ref, report_id, recipient_id, recipient_email,
                                    recipient_name, subject, mail_type, body, created_by)
      values ('MAIL-' || nextval('private.mail_ref_seq'), p_report_id, v_client.id, v_client.email,
              v_client.full_name, v_report.title, 'Research report',
              'Your Multi research report ' || v_report.title || ' is available under Reports received.',
              v_uid);
      insert into public.client_notifications (alert_ref, client_id, channel, title, detail)
      values ('ALT-' || nextval('private.mail_ref_seq'), v_client.id, 'In-app',
              'Multi research report published',
              v_report.title || ' is available under Reports received.');
    end if;
  end loop;

  update public.research_legs set delivered_at = coalesce(delivered_at, now())
   where report_id = p_report_id;
  update public.research_reports set status = 'Sent', sent_at = coalesce(sent_at, now())
   where id = p_report_id;
  perform private.log_audit('report.sent', 'research_report', v_report.report_ref,
                            jsonb_build_object('clients', v_sent));
  return jsonb_build_object('delivered', v_sent, 'report_ref', v_report.report_ref);
end $$;

create function public.close_research_leg(p_leg_id uuid, p_qty int, p_price numeric)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_leg public.research_legs;
  v_author uuid;
  v_closed int;
  v_avg numeric;
begin
  if not private.is_role('ra', 'admin') then
    raise exception 'Research workspace access required' using errcode = '42501';
  end if;
  select * into v_leg from public.research_legs where id = p_leg_id for update;
  select author_id into v_author from public.research_reports where id = v_leg.report_id;
  if not found or (v_author <> (select auth.uid()) and not private.is_role('admin')) then
    raise exception 'This order is unavailable';
  end if;
  if v_leg.delivered_at is null then
    raise exception 'Orders exist only after the report is sent';
  end if;
  if v_leg.status = 'Closed' then
    raise exception 'This order is already closed';
  end if;
  if p_qty is null or p_qty < 1 then
    raise exception 'Closing quantity must be a positive whole number';
  end if;
  if p_qty > v_leg.remaining_qty then
    raise exception 'Closing quantity cannot exceed the remaining quantity of %', v_leg.remaining_qty;
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Enter a valid closing price';
  end if;

  v_closed := v_leg.closed_qty + p_qty;
  v_avg := (coalesce(v_leg.avg_closing_price, 0) * v_leg.closed_qty + p_price * p_qty) / v_closed;
  insert into public.research_leg_exits (leg_id, quantity, price, recorded_by)
  values (p_leg_id, p_qty, round(p_price, 2), (select auth.uid()));
  update public.research_legs
     set closed_qty = v_closed, avg_closing_price = v_avg, last_exit_at = now(),
         status = case when v_closed = quantity then 'Closed' else 'Partially Closed' end,
         closed_at = case when v_closed = quantity then now() end
   where id = p_leg_id;

  perform private.log_audit('order.exit', 'research_leg', p_leg_id::text,
                            jsonb_build_object('qty', p_qty, 'price', p_price));
  return jsonb_build_object('closed_qty', v_closed, 'remaining_qty', v_leg.quantity - v_closed);
end $$;

create function public.mark_notifications_read() returns void
language sql security definer set search_path = '' as $$
  update public.client_notifications set unread = false
  where client_id = (select auth.uid()) and unread
$$;

-- ───────────────────────── function privileges ─────────────────────────
-- Nothing is callable by default; grant only what each caller needs.
revoke all on function public.resolve_login(text) from public, anon, authenticated;
revoke all on function public.submit_client_application(jsonb) from public, anon, authenticated;
revoke all on function public.decide_client_application(text, boolean) from public, anon, authenticated;
revoke all on function public.list_research_clients() from public, anon, authenticated;
revoke all on function public.create_research_draft(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.send_research_report(uuid, text[], text[]) from public, anon, authenticated;
revoke all on function public.close_research_leg(uuid, int, numeric) from public, anon, authenticated;
revoke all on function public.mark_notifications_read() from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

grant execute on function public.resolve_login(text) to anon, authenticated;
grant execute on function public.submit_client_application(jsonb) to authenticated;
grant execute on function public.decide_client_application(text, boolean) to authenticated;
grant execute on function public.list_research_clients() to authenticated;
grant execute on function public.create_research_draft(text, jsonb, jsonb) to authenticated;
grant execute on function public.send_research_report(uuid, text[], text[]) to authenticated;
grant execute on function public.close_research_leg(uuid, int, numeric) to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
-- RLS policies call these helpers as the signed-in user:
grant execute on function private.user_role() to authenticated;
grant execute on function private.is_role(public.app_role[]) to authenticated;
grant execute on function private.can_see_report(uuid) to authenticated;

-- The seed script (scripts/seed-demo.mjs) runs with the secret key, i.e. as service_role.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
