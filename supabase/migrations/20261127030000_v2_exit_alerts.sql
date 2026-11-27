-- Exit alerts: clients were told to enter a position and never told to exit.
--
-- Every exit the analyst records on a Multi leg now reaches each client who received that report,
-- in the portal and by email, saying what was exited, at what price, and what remains open. It goes
-- to a client whose subscription has since ended too: they still hold the position they were sent.
begin;

-- tell_client with the mail type chosen by the caller (the 3-argument form stays for subscriptions).
create function v2_private.tell_client(p_client uuid, p_title text, p_detail text, p_mail_type text,
                                       p_report uuid)
returns void
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
    insert into v2.email_log (mail_ref, report_id, recipient_id, client_id, recipient_email,
                              recipient_name, subject, mail_type, body, created_by)
    values ('MAIL-' || nextval('v2_private.mail_ref_seq'), p_report, p_client, p_client, v_p.email,
            v_p.full_name, p_title, p_mail_type, p_detail, (select auth.uid()));
  end if;
end $$;
revoke all on function v2_private.tell_client(uuid, text, text, text, uuid) from public, anon, authenticated;

create function v2_private.notify_leg_exit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_leg v2.research_legs;
  v_report v2.research_reports;
  v_what text;
  v_title text;
  v_detail text;
  v_client uuid;
begin
  select * into v_leg from v2.research_legs where id = new.leg_id;
  select * into v_report from v2.research_reports where id = v_leg.report_id;
  v_what := coalesce(nullif(trim(v_leg.contract_name), ''),
                     concat_ws(' ', coalesce(nullif(v_leg.instrument, ''), v_leg.symbol),
                               to_char(v_leg.expiry, 'DD Mon YYYY'),
                               v2_private.plain_number(v_leg.strike), v_leg.option_type));
  v_title := case when new.status_after = 'Closed' then 'Exit: ' else 'Partial exit: ' end || v_what;
  v_detail := 'Sampadha has recorded an exit on a position from research report '
    || v_report.report_ref || ' (' || v_report.title || '). '
    || v_what || ', ' || v_leg.side || ': ' || new.lots || ' of ' || v_leg.lots
    || case when v_leg.lots = 1 then ' lot' else ' lots' end
    || ' exited at Rs ' || v2_private.plain_number(new.price) || '. '
    || case when new.status_after = 'Closed' then 'The position is now fully closed.'
            else new.remaining_lots_after
                 || case when new.remaining_lots_after = 1 then ' lot remains' else ' lots remain' end
                 || ' open.' end
    || ' Recorded ' || to_char(new.at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') || ' IST.'
    || ' See All recommendations in the portal for the full position. This is research'
    || ' communication, not an order: any trade is your own decision.';
  for v_client in
    select d.client_id from v2.research_deliveries d where d.report_id = v_leg.report_id
  loop
    perform v2_private.tell_client(v_client, v_title, v_detail, 'Exit alert', v_leg.report_id);
  end loop;
  return new;
end $$;

create trigger research_leg_exits_notify
  after insert on v2.research_leg_exits
  for each row execute function v2_private.notify_leg_exit();

commit;
