-- Go-live, step 1 (read-only): what the demo clean-up would remove. Run in the SQL editor.
-- "Demo" = every v2 profile on an @sampadha.demo address, everything that belongs to them, the
-- sample tables nothing in the app writes to (strategies, cash/multi recommendations), and the test
-- reports written by the demo Research Analyst.
with demo as (select id from v2.profiles where email ilike '%@sampadha.demo'),
     demo_reports as (select id from v2.research_reports where author_id in (select id from demo))
select 'demo logins (v2 profiles)' as item, count(*) from demo
union all select 'real logins kept', count(*) from v2.profiles where email not ilike '%@sampadha.demo'
union all select 'real active admins (need at least 1)', count(*) from v2.profiles
  where role = 'admin' and is_active and email not ilike '%@sampadha.demo'
union all select 'test reports by demo staff', count(*) from demo_reports
union all select 'report legs', count(*) from v2.research_legs where report_id in (select id from demo_reports)
union all select 'Cash report rows', count(*) from v2.cash_report_rows where report_id in (select id from demo_reports)
union all select 'applications', count(*) from v2.client_applications
  where submitted_by in (select id from demo) or decided_by in (select id from demo) or client_id in (select id from demo)
union all select 'subscriptions', count(*) from v2.subscriptions where client_id in (select id from demo)
union all select 'payments', count(*) from v2.payments where client_id in (select id from demo)
union all select 'notifications', count(*) from v2.client_notifications where client_id in (select id from demo)
union all select 'emails in the log', count(*) from v2.email_log
  where recipient_id in (select id from demo) or client_id in (select id from demo) or created_by in (select id from demo)
union all select 'broker auto-email consents', count(*) from v2.broker_email_consents where client_id in (select id from demo)
union all select 'risk profiles', count(*) from v2.risk_profiles where client_id in (select id from demo)
union all select 'client documents', count(*) from v2.client_documents where client_id in (select id from demo)
union all select 'weekly masters uploaded by demo staff', count(*) from v2.symbol_masters where uploaded_by in (select id from demo)
union all select 'sample strategies', count(*) from v2.strategies
union all select 'sample Cash recommendations', count(*) from v2.cash_recommendations
union all select 'sample Multi recommendations', count(*) from v2.multi_recommendations
union all select 'files in storage for those reports and clients', count(*) from storage.objects
  where bucket_id = 'v2-research'
    and (split_part(name, '/', 1) in (select id::text from demo_reports)
         or (split_part(name, '/', 1) = 'clients' and split_part(name, '/', 2) in (select id::text from demo)));
