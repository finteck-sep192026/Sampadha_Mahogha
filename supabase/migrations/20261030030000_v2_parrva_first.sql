-- Multi workflow (user's order, 30 Oct 2026): 1. send to CARE PaRRVA, 2. Aadhaar eSign,
-- 3. send to clients. A report's legs become open positions as soon as it is sent to CARE PaRRVA
-- (accepted or failed; the Positions page shows which), not only when clients receive it.

-- Legs open when the CARE PaRRVA status first becomes Submitted or Failed.
create or replace function v2_private.open_legs_on_parrva() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update v2.research_legs set status = 'Open'
   where report_id = new.id and status = 'Generated';
  return new;
end $$;
revoke all on function v2_private.open_legs_on_parrva() from public, anon, authenticated;

drop trigger if exists research_reports_open_legs_on_parrva on v2.research_reports;
create trigger research_reports_open_legs_on_parrva
  after update of parrva_status on v2.research_reports
  for each row
  when (new.parrva_status in ('Submitted', 'Failed')
        and old.parrva_status is distinct from new.parrva_status)
  execute function v2_private.open_legs_on_parrva();

-- Exits can be recorded on those positions too.
create or replace function v2.close_research_leg(p_leg_id uuid, p_lots int, p_price numeric)
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
  -- A position exists once the report went to CARE PaRRVA (accepted or not) or to clients.
  if v_leg.delivered_at is null and not exists (
      select 1 from v2.research_reports r
       where r.id = v_leg.report_id and r.parrva_status in ('Submitted', 'Failed')) then
    raise exception 'Positions exist only after the report is sent to CARE PaRRVA or to clients';
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
