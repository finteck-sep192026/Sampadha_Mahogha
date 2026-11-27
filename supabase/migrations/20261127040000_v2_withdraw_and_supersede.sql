-- Withdraw a call, and link the corrected one to it.
--
-- A report could be published and never corrected: there was no way to pull back a wrong call or
-- to throw away a draft. A signed, filed or delivered report cannot honestly be edited, so the
-- correction is in two steps:
-- * withdraw (void) the report with a reason: it is frozen, its open legs leave Positions, queued
--   broker orders for it are stopped, and every client who received it is told at once;
-- * create the corrected report as usual and mark it as replacing the withdrawn one, so both
--   reports point at each other for the analyst and the client.
-- A draft that never left the desk is discarded the same way, without telling anyone.
-- Nothing here reaches CARE PaRRVA: a filing made there has to be corrected with NSE directly.
begin;

alter table v2.research_reports
  add column voided_at timestamptz,
  add column voided_by uuid references v2.profiles (id),
  add column void_reason text,
  add column supersedes uuid references v2.research_reports (id);
create index v2_research_reports_supersedes_idx on v2.research_reports (supersedes)
  where supersedes is not null;

create function v2.void_research_report(p_report_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_r v2.research_reports;
  v_reason text := trim(coalesce(p_reason, ''));
  v_left_desk boolean;
  v_client uuid;
  v_clients int := 0;
  v_stopped int := 0;
  v_broker_sent int := 0;
begin
  if not v2_private.owns_report(p_report_id) then
    raise exception 'Report not found' using errcode = '42501';
  end if;
  select * into v_r from v2.research_reports where id = p_report_id for update;
  if v_r.voided_at is not null then
    raise exception 'This report is already withdrawn';
  end if;
  if v_r.parrva_status = 'Submitting' then
    raise exception 'This report is being sent to CARE PaRRVA. Try again in a few minutes.';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 300 then
    raise exception 'Give the reason (10 to 300 characters). Clients who received the report will see it.';
  end if;
  v_left_desk := v_r.status = 'Sent' or v_r.parrva_status in ('Submitted', 'Failed');

  update v2.research_reports
     set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
   where id = p_report_id;

  -- Broker orders not yet sent are stopped; the ones already sent cannot be recalled.
  with stopped as (
    update v2.email_log
       set status = 'Expired', provider_message = 'Not sent: the report was withdrawn.'
     where report_id = p_report_id and mail_type = 'Broker order' and status = 'Queued'
    returning 1
  )
  select count(*) into v_stopped from stopped;
  select count(*) into v_broker_sent from v2.email_log
   where report_id = p_report_id and mail_type = 'Broker order' and status in ('Sending', 'Sent');

  for v_client in select d.client_id from v2.research_deliveries d where d.report_id = p_report_id
  loop
    v_clients := v_clients + 1;
    perform v2_private.tell_client(v_client, 'Withdrawn: research report ' || v_r.report_ref,
      'Sampadha has withdrawn research report ' || v_r.report_ref || ' (' || v_r.title || ').'
      || ' Please do not act on it. Reason: ' || v_reason
      || ' If you have already acted on it, review that position yourself. If a corrected report'
      || ' follows, it will reach you separately and will say that it replaces this one.',
      'Report withdrawn', p_report_id);
  end loop;

  perform v2_private.log_audit(case when v_left_desk then 'report.withdrawn' else 'report.discarded' end,
    'research_report', v_r.report_ref,
    jsonb_build_object('reason', v_reason, 'clients_told', v_clients, 'status', v_r.status,
                       'parrva', v_r.parrva_status, 'signed', v_r.esign_status = 'Signed',
                       'broker_orders_stopped', v_stopped, 'broker_orders_already_sent', v_broker_sent));
  return jsonb_build_object('report_ref', v_r.report_ref, 'clients_told', v_clients,
                            'broker_orders_stopped', v_stopped,
                            'broker_orders_already_sent', v_broker_sent,
                            'filed_with_parrva', v_r.parrva_status = 'Submitted');
end $$;

-- Mark a report not yet sent as the corrected version of a withdrawn one (or clear it with null).
create function v2.set_report_supersedes(p_report_id uuid, p_old_report_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_new v2.research_reports;
  v_old v2.research_reports;
begin
  if not v2_private.owns_report(p_report_id) then
    raise exception 'Report not found' using errcode = '42501';
  end if;
  select * into v_new from v2.research_reports where id = p_report_id for update;
  if v_new.voided_at is not null then
    raise exception 'This report is withdrawn';
  end if;
  if v_new.status = 'Sent' then
    raise exception 'This report has already been sent, so what it replaces can no longer change';
  end if;
  if p_old_report_id is not null then
    if p_old_report_id = p_report_id or not v2_private.owns_report(p_old_report_id) then
      raise exception 'Choose one of your withdrawn reports';
    end if;
    select * into v_old from v2.research_reports where id = p_old_report_id;
    if v_old.voided_at is null then
      raise exception 'Withdraw % first: only a withdrawn report can be replaced', v_old.report_ref;
    end if;
    if v_old.segment <> v_new.segment then
      raise exception 'A % report cannot replace a % report', v_new.segment, v_old.segment;
    end if;
  end if;
  update v2.research_reports set supersedes = p_old_report_id where id = p_report_id;
  perform v2_private.log_audit('report.supersedes_set', 'research_report', v_new.report_ref,
                               jsonb_build_object('replaces', v_old.report_ref));
  return jsonb_build_object('report_ref', v_new.report_ref, 'replaces', v_old.report_ref);
end $$;

-- A withdrawn report is frozen: it cannot be signed, filed, sent, replaced or changed again.
create function v2_private.withdrawn_report_is_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Report % is withdrawn and cannot be changed', old.report_ref;
end $$;
create trigger research_reports_withdrawn_frozen
  before update on v2.research_reports
  for each row when (old.voided_at is not null)
  execute function v2_private.withdrawn_report_is_frozen();

create function v2_private.withdrawn_report_blocks() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_report uuid;
  v_ref text;
begin
  if tg_table_name = 'research_leg_exits' then
    select l.report_id into v_report from v2.research_legs l where l.id = new.leg_id;
  else
    v_report := new.report_id;
  end if;
  select r.report_ref into v_ref from v2.research_reports r
   where r.id = v_report and r.voided_at is not null;
  if v_ref is not null then
    raise exception 'Report % is withdrawn', v_ref;
  end if;
  return new;
end $$;
create trigger research_deliveries_not_withdrawn
  before insert on v2.research_deliveries
  for each row execute function v2_private.withdrawn_report_blocks();
create trigger research_leg_exits_not_withdrawn
  before insert on v2.research_leg_exits
  for each row execute function v2_private.withdrawn_report_blocks();

-- When the corrected report is delivered, the client is told which report it replaces.
create function v2_private.tell_client_of_replacement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_new v2.research_reports;
  v_old v2.research_reports;
begin
  select * into v_new from v2.research_reports where id = new.report_id;
  if v_new.supersedes is null then
    return new;
  end if;
  select * into v_old from v2.research_reports where id = v_new.supersedes;
  if exists (select 1 from v2.research_deliveries d
              where d.report_id = v_old.id and d.client_id = new.client_id) then
    perform v2_private.tell_client(new.client_id,
      'Corrected report ' || v_new.report_ref || ' replaces ' || v_old.report_ref,
      'Research report ' || v_new.report_ref || ' (' || v_new.title || ') replaces the withdrawn report '
      || v_old.report_ref || ' (' || v_old.title || '). Use ' || v_new.report_ref
      || ' and disregard ' || v_old.report_ref || '. Both are listed under Reports in the portal.',
      'Report replaced', v_new.id);
  end if;
  return new;
end $$;
create trigger research_deliveries_replacement_notice
  after insert on v2.research_deliveries
  for each row execute function v2_private.tell_client_of_replacement();

revoke all on function v2.void_research_report(uuid, text) from public, anon, authenticated;
revoke all on function v2.set_report_supersedes(uuid, uuid) from public, anon, authenticated;
grant execute on function v2.void_research_report(uuid, text) to authenticated;
grant execute on function v2.set_report_supersedes(uuid, uuid) to authenticated;

commit;
