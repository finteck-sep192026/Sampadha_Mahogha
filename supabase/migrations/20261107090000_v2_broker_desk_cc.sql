-- Sampadha v2: each broker on Admin's list now has default CC addresses as well as the TO address.
-- Saved here for Bajaj Broking and Motilal Oswal. Nothing reaches these desks until a client has
-- connected Gmail and consented.

begin;

alter table v2.broker_desks add column order_cc text[] not null default '{}';

update v2.broker_desks
   set order_email = 'samrddhidealing@gmail.com',
       order_cc = array['samrddhifinserv@gmail.com', 'backup@sampadha.com'],
       updated_at = now()
 where name = 'Bajaj Broking';
update v2.broker_desks
   set order_email = 'cloverdealing@gmail.com',
       order_cc = array['cloverfinserv@gmail.com', 'backup@sampadha.com'],
       updated_at = now()
 where name = 'Motilal Oswal';

-- Same as 20261107080000, with the desk's CC addresses.
create or replace function v2_private.on_client_login_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_account jsonb;
  v_to text;
  v_cc text[];
  v_code text;
begin
  begin
    select a into v_account from jsonb_array_elements(new.broker_accounts) a
     where a ->> 'product' in ('Bronze', 'Silver', 'Palladium', 'Platinum', 'Gold', 'Rhodium') limit 1;
    if v_account is not null then
      select order_email, order_cc into v_to, v_cc
        from v2.broker_desks where name = v_account ->> 'broker';
      v_code := upper(trim(v_account ->> 'tradingId'));
      if v_to is not null and v_code ~ '^[A-Z0-9._/-]{2,30}$' then
        insert into v2.broker_email_consents (client_id, broker, broker_client_id, to_email, cc_emails,
                                              status, updated_by, requested_at, request_count)
        values (new.client_id, v_account ->> 'broker', v_code, lower(v_to), coalesce(v_cc, '{}'),
                'Pending', new.decided_by, now(), 1)
        on conflict (client_id) do nothing;
      end if;
    end if;
    insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
    values ('ALT-' || nextval('v2_private.mail_ref_seq'), new.client_id, 'In-app',
            'Please review your details and consent',
            'Open Broker auto-email to accept your onboarding details and approve order emails to your broker.');
  exception when others then
    raise warning 'on_client_login_created: %', sqlerrm;
  end;
  return new;
end $$;

commit;
