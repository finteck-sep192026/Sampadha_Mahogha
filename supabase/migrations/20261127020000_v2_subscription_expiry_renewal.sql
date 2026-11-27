-- Subscriptions now end, and can be renewed, cancelled or corrected.
--
-- Before this, research went to every client whose subscription row said 'Active', and nothing ever
-- changed that word: the end date was stored and never read. Now:
-- * a subscription counts only while it is Active and its end date has not passed (dates in IST);
-- * an hourly job marks ended subscriptions Expired, tells the client, and reminds them 15 and 3
--   days before the end;
-- * a report cannot be delivered to a client without a live subscription, whatever the caller checked;
-- * Admin renews a subscription by recording the payment received, which extends the end date by the
--   billing period and writes an invoice row; Admin can also cancel one or correct its end date.
begin;

create function v2_private.today_ist() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

alter table v2.subscriptions
  add column last_reminder int,          -- days-before-end of the last reminder sent (15, then 3)
  add column cancelled_at timestamptz,
  add column cancel_reason text;

alter table v2.payments
  add column period_from date,
  add column period_to date,
  add column taxable numeric(12, 2),
  add column gst_rate numeric(5, 2),
  add column gst numeric(12, 2),
  add column mode text,
  add column reference text,
  add column recorded_by uuid references v2.profiles (id),
  add column recorded_at timestamptz not null default now();

-- Invoice numbers run without gaps inside a financial year (April to March): SMP/26-27/0001.
create table v2_private.invoice_counters (
  fy text primary key,
  last_no int not null
);

create function v2_private.next_invoice_no(p_on date) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_start int := extract(year from p_on)::int - case when extract(month from p_on) < 4 then 1 else 0 end;
  v_fy text := to_char(v_start % 100, 'FM00') || '-' || to_char((v_start + 1) % 100, 'FM00');
  v_no int;
begin
  insert into v2_private.invoice_counters as c (fy, last_no) values (v_fy, 1)
  on conflict (fy) do update set last_no = c.last_no + 1
  returning c.last_no into v_no;
  return 'SMP/' || v_fy || '/' || to_char(v_no, 'FM0000');
end $$;

-- One message to a client: in the portal and by email (the mailer sends Queued rows).
create function v2_private.tell_client(p_client uuid, p_title text, p_detail text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p v2.profiles;
begin
  select * into v_p from v2.profiles where id = p_client;
  if v_p.id is null then
    return;
  end if;
  insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
  values ('ALT-' || nextval('v2_private.mail_ref_seq'), p_client, 'In-app', p_title, p_detail);
  if v_p.is_active and v_p.email is not null then
    insert into v2.email_log (mail_ref, recipient_id, client_id, recipient_email, recipient_name,
                              subject, mail_type, body, created_by)
    values ('MAIL-' || nextval('v2_private.mail_ref_seq'), p_client, p_client, v_p.email, v_p.full_name,
            p_title, 'Subscription', p_detail, (select auth.uid()));
  end if;
end $$;

-- Hourly: expire what has ended, remind what is about to.
create function v2_private.subscription_housekeeping() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := v2_private.today_ist();
  v_s record;
  v_n int := 0;
  v_step int;
begin
  for v_s in
    update v2.subscriptions s set status = 'Expired'
     where s.status = 'Active' and s.ends_on is not null and s.ends_on < v_today
    returning s.client_id, s.ends_on
  loop
    v_n := v_n + 1;
    perform v2_private.tell_client(v_s.client_id, 'Your Sampadha subscription has ended',
      'Your subscription ended on ' || to_char(v_s.ends_on, 'DD Mon YYYY')
      || '. New research reports will not reach you until it is renewed. Reports you already'
      || ' received stay available in the portal. To renew, contact Sampadha.');
    insert into v2.audit_log (action, entity, entity_ref, detail)
    values ('subscription.expired', 'subscription',
            (select login_id from v2.profiles where id = v_s.client_id),
            jsonb_build_object('ended_on', v_s.ends_on));
  end loop;

  for v_s in
    select s.id, s.client_id, s.ends_on, s.last_reminder, (s.ends_on - v_today) as days_left
      from v2.subscriptions s
     where s.status = 'Active' and s.ends_on is not null and s.ends_on - v_today between 0 and 15
  loop
    v_step := case when v_s.days_left <= 3 then 3 else 15 end;
    if v_s.last_reminder is null or v_s.last_reminder > v_step then
      update v2.subscriptions set last_reminder = v_step where id = v_s.id;
      perform v2_private.tell_client(v_s.client_id, 'Your Sampadha subscription ends soon',
        'Your subscription ends on ' || to_char(v_s.ends_on, 'DD Mon YYYY')
        || case when v_s.days_left = 0 then ' (today)'
                when v_s.days_left = 1 then ' (tomorrow)'
                else ' (in ' || v_s.days_left || ' days)' end
        || '. To keep receiving research reports without a break, contact Sampadha to renew.');
    end if;
  end loop;
  return v_n;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'v2-subscription-housekeeping';
-- Minute 35 of each hour: 18:35 UTC is 00:05 IST, so a subscription expires five minutes into its
-- first day past the end date.
select cron.schedule('v2-subscription-housekeeping', '35 * * * *',
                     'select v2_private.subscription_housekeeping()');

-- ───────────────────────── who may receive research ─────────────────────────
create or replace function v2.list_research_clients()
returns table (id uuid, login_id text, full_name text, email text, multi_tier text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.login_id, p.full_name, p.email, s.multi_tier
  from v2.profiles p
  join v2.subscriptions s on s.client_id = p.id and s.status = 'Active'
   and (s.ends_on is null or s.ends_on >= v2_private.today_ist())
  where v2_private.is_role('ra', 'admin') and p.role = 'client' and p.is_active
    and s.multi_tier is not null
  order by p.login_id
$$;

create or replace function v2.list_cash_clients()
returns table (id uuid, login_id text, full_name text, email text)
language sql stable security definer set search_path = '' as $$
  select distinct p.id, p.login_id, p.full_name, p.email
  from v2.profiles p
  join v2.subscriptions s on s.client_id = p.id and s.status = 'Active' and 'Cash' = any (s.products)
   and (s.ends_on is null or s.ends_on >= v2_private.today_ist())
  where v2_private.is_role('ra', 'admin') and p.role = 'client' and p.is_active
  order by p.login_id
$$;

-- The last line of defence: no delivery row for a client whose subscription is not live, even in
-- the hour before the job above has marked it Expired.
create function v2_private.require_live_subscription() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_login text;
  v_end date;
begin
  if exists (select 1 from v2.subscriptions s
              where s.client_id = new.client_id and s.status = 'Active'
                and (s.ends_on is null or s.ends_on >= v2_private.today_ist())) then
    return new;
  end if;
  select p.login_id into v_login from v2.profiles p where p.id = new.client_id;
  select max(s.ends_on) into v_end from v2.subscriptions s where s.client_id = new.client_id;
  raise exception '% has no live subscription%. Renew it before sending.', coalesce(v_login, 'This client'),
    case when v_end is null then '' else ' (ended ' || to_char(v_end, 'DD Mon YYYY') || ')' end;
end $$;

create trigger research_deliveries_live_subscription
  before insert on v2.research_deliveries
  for each row execute function v2_private.require_live_subscription();

-- ───────────────────────── Admin actions ─────────────────────────
create function v2_private.subscription_for_update(p_login_id text) returns v2.subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  v_s v2.subscriptions;
begin
  if not v2_private.is_role('admin') then
    raise exception 'Only an administrator can change a subscription' using errcode = '42501';
  end if;
  select s.* into v_s
    from v2.subscriptions s join v2.profiles p on p.id = s.client_id
   where upper(p.login_id) = upper(trim(p_login_id)) and p.role = 'client'
   order by s.starts_on desc limit 1
   for update of s;
  if v_s.id is null then
    raise exception 'No subscription found for %', p_login_id;
  end if;
  return v_s;
end $$;

-- Renew: record what was received and extend the end date by one billing period. A subscription
-- that is still running is extended from its end date, so paying early loses no days; a lapsed or
-- cancelled one restarts today. Amount 0 renews without an invoice (a complimentary period).
create function v2.renew_subscription(p_login_id text, p_billing text, p_amount numeric,
                                      p_paid_on date, p_mode text, p_reference text,
                                      p_gst_rate numeric default 18)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_s v2.subscriptions := v2_private.subscription_for_update(p_login_id);
  v_today date := v2_private.today_ist();
  v_from date;
  v_to date;
  v_invoice text;
  v_taxable numeric(12, 2);
  v_mode text := trim(coalesce(p_mode, ''));
  v_ref text := nullif(trim(coalesce(p_reference, '')), '');
begin
  if p_billing not in ('Quarterly', 'Annual') then
    raise exception 'Choose Quarterly or Annual';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 99999999 then
    raise exception 'Enter the amount received, or 0 for a complimentary period';
  end if;
  if p_gst_rate is null or p_gst_rate < 0 or p_gst_rate > 28 then
    raise exception 'GST rate must be between 0 and 28';
  end if;
  if p_amount > 0 then
    if p_paid_on is null or p_paid_on > v_today or p_paid_on < v_today - 365 then
      raise exception 'Enter the date the payment was received (not in the future)';
    end if;
    if v_mode not in ('UPI', 'Bank transfer', 'Cheque', 'Card', 'Cash', 'Other') then
      raise exception 'Choose how the payment was received';
    end if;
    if length(coalesce(v_ref, '')) > 80 then
      raise exception 'The payment reference is too long';
    end if;
  end if;

  v_from := case when v_s.status = 'Active' and v_s.ends_on is not null and v_s.ends_on >= v_today
                 then v_s.ends_on + 1 else v_today end;
  v_to := (v_from + case when p_billing = 'Annual' then interval '1 year' else interval '3 months' end)::date - 1;

  update v2.subscriptions
     set status = 'Active', billing = p_billing, ends_on = v_to, last_reminder = null,
         cancelled_at = null, cancel_reason = null
   where id = v_s.id;

  if p_amount > 0 then
    v_invoice := v2_private.next_invoice_no(p_paid_on);
    v_taxable := round(p_amount / (1 + p_gst_rate / 100), 2);
    insert into v2.payments (invoice_no, client_id, plan_code, period_label, billing, amount, paid_on,
                             status, period_from, period_to, taxable, gst_rate, gst, mode, reference,
                             recorded_by)
    values (v_invoice, v_s.client_id, v_s.plan_code,
            to_char(v_from, 'DD Mon YYYY') || ' to ' || to_char(v_to, 'DD Mon YYYY'), p_billing,
            p_amount, p_paid_on, 'Paid', v_from, v_to, v_taxable, p_gst_rate, p_amount - v_taxable,
            v_mode, v_ref, (select auth.uid()));
  end if;

  perform v2_private.tell_client(v_s.client_id, 'Your Sampadha subscription is renewed',
    'Your subscription now runs until ' || to_char(v_to, 'DD Mon YYYY') || '.'
    || case when v_invoice is null then ''
            else ' Payment of Rs ' || to_char(p_amount, 'FM99,99,99,990.00') || ' received; invoice '
                 || v_invoice || ' is under Payment details in the portal.' end);
  perform v2_private.log_audit('subscription.renewed', 'subscription', upper(trim(p_login_id)),
    jsonb_build_object('billing', p_billing, 'from', v_from, 'to', v_to, 'amount', p_amount,
                       'invoice', v_invoice, 'was', v_s.status));
  return jsonb_build_object('ends_on', v_to, 'invoice_no', v_invoice);
end $$;

create function v2.cancel_subscription(p_login_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_s v2.subscriptions := v2_private.subscription_for_update(p_login_id);
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if v_s.status = 'Cancelled' then
    raise exception 'This subscription is already cancelled';
  end if;
  if length(v_reason) < 5 or length(v_reason) > 300 then
    raise exception 'Give the reason for cancelling (5 to 300 characters)';
  end if;
  update v2.subscriptions
     set status = 'Cancelled', cancelled_at = now(), cancel_reason = v_reason
   where id = v_s.id;
  perform v2_private.tell_client(v_s.client_id, 'Your Sampadha subscription is cancelled',
    'Your subscription was cancelled today. New research reports will not reach you. Reports you'
    || ' already received stay available in the portal. If this is unexpected, contact Sampadha.');
  perform v2_private.log_audit('subscription.cancelled', 'subscription', upper(trim(p_login_id)),
    jsonb_build_object('reason', v_reason, 'was', v_s.status, 'ends_on', v_s.ends_on));
  return jsonb_build_object('status', 'Cancelled');
end $$;

-- Correct an end date entered wrongly (for example a quarterly plan given a full year).
create function v2.set_subscription_end(p_login_id text, p_ends_on date, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_s v2.subscriptions := v2_private.subscription_for_update(p_login_id);
  v_today date := v2_private.today_ist();
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if v_s.status = 'Cancelled' then
    raise exception 'This subscription is cancelled. Renew it instead.';
  end if;
  if p_ends_on is null or p_ends_on < v_s.starts_on or p_ends_on > v_today + 1100 then
    raise exception 'Enter an end date after the start date and within three years';
  end if;
  if length(v_reason) < 5 or length(v_reason) > 300 then
    raise exception 'Give the reason for the change (5 to 300 characters)';
  end if;
  update v2.subscriptions
     set ends_on = p_ends_on, last_reminder = null,
         status = case when p_ends_on >= v_today then 'Active' else 'Expired' end
   where id = v_s.id;
  perform v2_private.log_audit('subscription.end_changed', 'subscription', upper(trim(p_login_id)),
    jsonb_build_object('from', v_s.ends_on, 'to', p_ends_on, 'reason', v_reason));
  return jsonb_build_object('ends_on', p_ends_on);
end $$;

revoke all on function v2.renew_subscription(text, text, numeric, date, text, text, numeric) from public, anon, authenticated;
revoke all on function v2.cancel_subscription(text, text) from public, anon, authenticated;
revoke all on function v2.set_subscription_end(text, date, text) from public, anon, authenticated;
grant execute on function v2.renew_subscription(text, text, numeric, date, text, text, numeric) to authenticated;
grant execute on function v2.cancel_subscription(text, text) to authenticated;
grant execute on function v2.set_subscription_end(text, date, text) to authenticated;
revoke all on function v2_private.subscription_housekeeping() from public, anon, authenticated;
revoke all on function v2_private.tell_client(uuid, text, text) from public, anon, authenticated;
revoke all on function v2_private.next_invoice_no(date) from public, anon, authenticated;
revoke all on function v2_private.subscription_for_update(text) from public, anon, authenticated;

commit;
