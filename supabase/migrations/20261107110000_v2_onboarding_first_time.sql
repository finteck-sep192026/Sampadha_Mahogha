-- Sampadha v2: every client accepts their onboarding details the first time, with or without a PDF,
-- and sees them on the page. Once accepted, the consent page holds only broker auto-email.

begin;

drop function v2.my_onboarding();
create function v2.my_onboarding()
returns table (pdf_path text, details_accepted_at timestamptz, details jsonb)
language sql stable security definer set search_path = '' as $$
  select a.pdf_path, a.details_accepted_at,
         jsonb_build_object('full_name', a.full_name, 'pan', a.pan, 'dob', a.dob, 'email', a.email,
           'mobile', a.mobile, 'occupation', a.occupation, 'income_band', a.income_band,
           'net_worth', a.net_worth, 'tax_residency', a.tax_residency, 'city', a.city,
           'mf_experience', a.mf_experience, 'stock_experience', a.stock_experience,
           'fo_experience', a.fo_experience, 'proposed_amount', a.proposed_amount,
           'segments', a.segments, 'services', a.services, 'products', a.products,
           'broker_accounts', a.broker_accounts, 'auto_email', a.auto_email)
    from v2.client_applications a
   where a.client_id = (select auth.uid())
$$;
revoke all on function v2.my_onboarding() from public, anon;
grant execute on function v2.my_onboarding() to authenticated;

create or replace function v2.accept_onboarding_details() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ref text;
begin
  update v2.client_applications set details_accepted_at = now()
   where client_id = (select auth.uid()) and details_accepted_at is null
  returning app_ref into v_ref;
  if not found then
    raise exception 'There are no details waiting for you to accept';
  end if;
  perform v2_private.log_audit('application.details_accepted', 'client_application', v_ref, '{}');
  return jsonb_build_object('app_ref', v_ref);
end $$;

create or replace function v2.client_pending() returns table (app_ref text, login_id text, pending text)
language sql stable security definer set search_path = '' as $$
  select a.app_ref, p.login_id,
         case
           when a.status = 'Pending' then 'Admin: approval'
           when a.status = 'Rejected' then 'Rejected by Admin'
           when a.client_id is null then 'Admin: create login'
           when a.details_accepted_at is null then 'Client: accept details'
           when c.client_id is null and a.auto_email ->> 'wanted' = 'false' then 'Complete'
           when c.client_id is null then 'Sales: auto-email set-up'
           when coalesce(g.status, 'Disconnected') <> 'Connected' then 'Client: connect Gmail'
           when c.status <> 'Active' then 'Client: auto-email consent'
           else 'Complete'
         end
    from v2.client_applications a
    left join v2.profiles p on p.id = a.client_id
    left join v2.broker_email_consents c on c.client_id = a.client_id
    left join v2.client_gmail_links g on g.client_id = a.client_id
   where v2_private.is_role('admin', 'sales')
$$;



create or replace function v2.send_broker_consent_request(p_login_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client v2.profiles;
  v_row v2.broker_email_consents;
  v_app v2.client_applications;
  v_details boolean;
begin
  if not v2_private.is_role('admin', 'sales') then
    raise exception 'Sales or Admin access required' using errcode = '42501';
  end if;
  select * into v_client from v2.profiles
   where upper(login_id) = upper(trim(coalesce(p_login_id, ''))) and role = 'client';
  if not found then
    raise exception 'Client not found';
  end if;
  select * into v_app from v2.client_applications where client_id = v_client.id limit 1;
  v_details := v_app.client_id is not null and v_app.details_accepted_at is null;
  select * into v_row from v2.broker_email_consents where client_id = v_client.id for update;
  if v_row.client_id is null and not v_details then
    raise exception 'Enter the client''s broker details first';
  end if;
  if not v_details and v_row.status = 'Active' and exists (
       select 1 from v2.client_gmail_links where client_id = v_client.id and status = 'Connected') then
    raise exception 'Broker auto-email is already on for this client';
  end if;

  update v2.broker_email_consents
     set status = case when status = 'Revoked' then 'Pending' else status end,
         revoked_at = null, requested_at = now(), request_count = request_count + 1,
         updated_by = (select auth.uid()), updated_at = now()
   where client_id = v_client.id;

  insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
  values ('ALT-' || nextval('v2_private.mail_ref_seq'), v_client.id, 'In-app',
          'Please review your details and consent',
          'Open Broker auto-email to accept your onboarding details and approve order emails to your broker.');

  perform v2_private.log_audit('broker_email.consent_requested', 'broker_email_consent',
                               v_client.login_id, jsonb_build_object('details', v_details));
  return jsonb_build_object('client', v_client.login_id);
end $$;



commit;
