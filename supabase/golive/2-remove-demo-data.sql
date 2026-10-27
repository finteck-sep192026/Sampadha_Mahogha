-- Go-live, step 2: remove the demo data from v2, keeping a full copy in v2_private.demo_archive.
-- Run step 1 first and check its numbers. Refuses to run until a real (non-demo) Admin login exists.
-- Sign-in accounts (auth.users) are NOT deleted, so the older v1 portal keeps working; the demo
-- logins simply lose their v2 profile, which means no access to this portal.
-- Undo: every removed row is in v2_private.demo_archive (table_name, row) and can be re-inserted
-- with jsonb_populate_record. The audit trail is append-only and is kept as it is.
-- Files in storage for the removed reports are not deleted here (step 1 counts them); remove them
-- in Storage, bucket v2-research, afterwards if wanted.
begin;

do $$
begin
  if not exists (select 1 from v2.profiles
                  where role = 'admin' and is_active and email not ilike '%@sampadha.demo') then
    raise exception 'Create and sign in with a real Admin login before removing the demo data';
  end if;
end $$;

create table if not exists v2_private.demo_archive (
  id bigint generated always as identity primary key,
  table_name text not null,
  row jsonb not null,
  archived_at timestamptz not null default now()
);
revoke all on v2_private.demo_archive from public, anon, authenticated;

create temporary table demo on commit drop as
  select id from v2.profiles where email ilike '%@sampadha.demo';
create temporary table demo_reports on commit drop as
  select id from v2.research_reports where author_id in (select id from demo);
create temporary table demo_apps on commit drop as
  select id, app_ref from v2.client_applications
   where submitted_by in (select id from demo) or decided_by in (select id from demo)
      or client_id in (select id from demo);

-- 1. Test reports by demo staff, and everything that hangs off them.
insert into v2_private.demo_archive (table_name, row)
  select 'v2.research_leg_exits', to_jsonb(x) from v2.research_leg_exits x
   where x.leg_id in (select id from v2.research_legs where report_id in (select id from demo_reports))
  union all select 'v2.research_legs', to_jsonb(x) from v2.research_legs x where report_id in (select id from demo_reports)
  union all select 'v2.research_attachments', to_jsonb(x) from v2.research_attachments x where report_id in (select id from demo_reports)
  union all select 'v2.research_deliveries', to_jsonb(x) from v2.research_deliveries x
   where report_id in (select id from demo_reports) or client_id in (select id from demo)
  union all select 'v2.esign_requests', to_jsonb(x) from v2.esign_requests x where report_id in (select id from demo_reports)
  union all select 'v2.cash_report_rows', to_jsonb(x) from v2.cash_report_rows x where report_id in (select id from demo_reports)
  union all select 'v2.parrva_submissions', to_jsonb(x) from v2.parrva_submissions x where report_id in (select id from demo_reports)
  union all select 'v2.research_reports', to_jsonb(x) from v2.research_reports x where id in (select id from demo_reports);
delete from v2.research_reports where id in (select id from demo_reports);

-- 2. Weekly masters uploaded by demo staff.
insert into v2_private.demo_archive (table_name, row)
  select 'v2.symbol_masters', to_jsonb(x) from v2.symbol_masters x where uploaded_by in (select id from demo);
delete from v2.symbol_masters where uploaded_by in (select id from demo);

-- 3. Applications and every email about demo people.
insert into v2_private.demo_archive (table_name, row)
  select 'v2.email_log', to_jsonb(x) from v2.email_log x
   where recipient_id in (select id from demo) or client_id in (select id from demo)
      or created_by in (select id from demo) or application_ref in (select app_ref from demo_apps)
      or report_id in (select id from demo_reports)
  union all select 'v2.client_applications', to_jsonb(x) from v2.client_applications x where id in (select id from demo_apps);
delete from v2.email_log
 where recipient_id in (select id from demo) or client_id in (select id from demo)
    or created_by in (select id from demo) or application_ref in (select app_ref from demo_apps)
    or report_id in (select id from demo_reports);
delete from v2.client_applications where id in (select id from demo_apps);

-- 4. Sample tables the app never writes to.
insert into v2_private.demo_archive (table_name, row)
  select 'v2.strategies', to_jsonb(x) from v2.strategies x
  union all select 'v2.cash_recommendations', to_jsonb(x) from v2.cash_recommendations x
  union all select 'v2.multi_recommendations', to_jsonb(x) from v2.multi_recommendations x;
delete from v2.strategies;
delete from v2.cash_recommendations;
delete from v2.multi_recommendations;

-- 5. Demo people and what belongs to them (removed with the profile).
insert into v2_private.demo_archive (table_name, row)
  select 'v2.subscriptions', to_jsonb(x) from v2.subscriptions x where client_id in (select id from demo)
  union all select 'v2.payments', to_jsonb(x) from v2.payments x where client_id in (select id from demo)
  union all select 'v2.client_notifications', to_jsonb(x) from v2.client_notifications x where client_id in (select id from demo)
  union all select 'v2.broker_email_consents', to_jsonb(x) from v2.broker_email_consents x where client_id in (select id from demo)
  union all select 'v2.risk_profiles', to_jsonb(x) from v2.risk_profiles x where client_id in (select id from demo)
  union all select 'v2.client_documents', to_jsonb(x) from v2.client_documents x where client_id in (select id from demo)
  union all select 'v2.profiles', to_jsonb(x) from v2.profiles x where id in (select id from demo);
delete from v2.profiles where id in (select id from demo);

select table_name, count(*) as archived_rows from v2_private.demo_archive
 where archived_at = now() group by table_name order by table_name;
commit;
