-- Remove all client data from v2 so the real clients can be created, keeping a full copy in
-- v2_private.demo_archive. Run in the SQL editor.
-- Removes: client profiles (role = 'client') and their subscriptions, payments, notifications,
-- report deliveries, broker consents, risk profiles and documents; every client application; and
-- the emails sent to or about clients.
-- Keeps: Admin, Research Analyst and Sales logins, research reports, strategies, recommendations,
-- weekly masters, plans, and the append-only audit trail. Use 2-remove-demo-data.sql for those.
-- Sign-in accounts (auth.users) are NOT deleted, so the older v1 portal keeps working; the clients
-- simply lose their v2 profile, which means no access to this portal.
-- Undo: every removed row is in v2_private.demo_archive (table_name, row) and can be re-inserted
-- with jsonb_populate_record.
-- Refuses to run if any client is on a real address, so it cannot wipe real clients later.
begin;

do $$
begin
  if exists (select 1 from v2.profiles
              where role = 'client' and email not ilike '%@sampadha.demo') then
    raise exception 'A client with a real email exists. This script is only for the demo clients.';
  end if;
end $$;

create table if not exists v2_private.demo_archive (
  id bigint generated always as identity primary key,
  table_name text not null,
  row jsonb not null,
  archived_at timestamptz not null default now()
);
revoke all on v2_private.demo_archive from public, anon, authenticated;

create temporary table client_ids on commit drop as
  select id, email from v2.profiles where role = 'client';

-- 1. Applications and every email to or about a client.
insert into v2_private.demo_archive (table_name, row)
  select 'v2.email_log', to_jsonb(x) from v2.email_log x
   where recipient_id in (select id from client_ids) or client_id in (select id from client_ids)
      or application_ref in (select app_ref from v2.client_applications)
      or recipient_email in (select email from client_ids)
  union all select 'v2.client_applications', to_jsonb(x) from v2.client_applications x;
delete from v2.email_log
 where recipient_id in (select id from client_ids) or client_id in (select id from client_ids)
    or application_ref in (select app_ref from v2.client_applications)
    or recipient_email in (select email from client_ids);
delete from v2.client_applications;

-- 2. Clients and what belongs to them (removed with the profile by on delete cascade).
insert into v2_private.demo_archive (table_name, row)
  select 'v2.subscriptions', to_jsonb(x) from v2.subscriptions x where client_id in (select id from client_ids)
  union all select 'v2.payments', to_jsonb(x) from v2.payments x where client_id in (select id from client_ids)
  union all select 'v2.client_notifications', to_jsonb(x) from v2.client_notifications x where client_id in (select id from client_ids)
  union all select 'v2.research_deliveries', to_jsonb(x) from v2.research_deliveries x where client_id in (select id from client_ids)
  union all select 'v2.broker_email_consents', to_jsonb(x) from v2.broker_email_consents x where client_id in (select id from client_ids)
  union all select 'v2.risk_profiles', to_jsonb(x) from v2.risk_profiles x where client_id in (select id from client_ids)
  union all select 'v2.client_documents', to_jsonb(x) from v2.client_documents x where client_id in (select id from client_ids)
  union all select 'v2.profiles', to_jsonb(x) from v2.profiles x where id in (select id from client_ids);
delete from v2.profiles where id in (select id from client_ids);

select table_name, count(*) as archived_rows from v2_private.demo_archive
 where archived_at = now() group by table_name order by table_name;
commit;
