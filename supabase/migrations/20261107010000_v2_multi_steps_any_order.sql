-- Multi reports: CARE PaRRVA, Aadhaar eSign and Send to clients can now happen in any order.
--
-- A report may reach clients before it is signed. It then goes out as the PDF stored at
-- <report id>/preview.pdf. That file can no longer change once the report is Sent (can_edit_draft
-- stops writes), so a later signature covers exactly what clients already hold, and the signed copy
-- then replaces it for them.
--
-- Cash reports keep their rule: send_cash_report still needs the signature.
begin;

create or replace function v2.send_research_report(p_report_id uuid, p_client_ids text[], p_types text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_report v2.research_reports;
  v_ids text[];
  v_client record;
  v_sent int := 0;
begin
  if not v2_private.owns_report(p_report_id) then
    raise exception 'Report not found' using errcode = '42501';
  end if;
  perform v2_private.require_segment(p_report_id, 'Multi');
  select * into v_report from v2.research_reports where id = p_report_id for update;
  -- Clients must always have a PDF to open: the signed one, or the stored unsigned one.
  if (v_report.esign_status <> 'Signed' or v_report.signed_pdf_path is null)
     and not exists (select 1 from storage.objects
                      where bucket_id = 'v2-research' and name = p_report_id::text || '/preview.pdf') then
    raise exception 'The report PDF is not stored yet. Open the report and send again.';
  end if;

  select array_agg(distinct upper(trim(x))) into v_ids
  from unnest(coalesce(p_client_ids, '{}')) x where trim(x) <> '';
  if v_ids is null then
    raise exception 'Select at least one client';
  end if;
  if coalesce(array_length(p_types, 1), 0) = 0 then
    raise exception 'Choose at least one product type';
  end if;
  if (select count(distinct p.id) from v2.profiles p
        join v2.subscriptions s on s.client_id = p.id and s.status = 'Active'
       where p.role = 'client' and p.is_active and upper(p.login_id) = any (v_ids)
         and s.multi_tier = any (p_types)) <> array_length(v_ids, 1) then
    raise exception 'Choose only active clients subscribed to the selected product types';
  end if;

  for v_client in
    select p.id, p.full_name, p.email from v2.profiles p where upper(p.login_id) = any (v_ids)
  loop
    insert into v2.research_deliveries (report_id, client_id) values (p_report_id, v_client.id)
    on conflict do nothing;
    if found then
      v_sent := v_sent + 1;
      insert into v2.email_log (mail_ref, report_id, recipient_id, recipient_email,
                                recipient_name, subject, mail_type, body, created_by)
      values ('MAIL-' || nextval('v2_private.mail_ref_seq'), p_report_id, v_client.id, v_client.email,
              v_client.full_name, v_report.title, 'Research report',
              'Your Multi research report ' || v_report.title || ' is available under Reports received.',
              v_uid);
      insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
      values ('ALT-' || nextval('v2_private.mail_ref_seq'), v_client.id, 'In-app',
              'Multi research report published',
              v_report.title || ' is available under Reports received.');
    end if;
  end loop;
  if v_sent = 0 then
    raise exception 'These clients have already received this report';
  end if;

  update v2.research_legs
     set delivered_at = coalesce(delivered_at, now()),
         status = case when status = 'Generated' then 'Open' else status end
   where report_id = p_report_id;
  update v2.research_reports set status = 'Sent', sent_at = coalesce(sent_at, now())
   where id = p_report_id;
  perform v2_private.log_audit('report.sent', 'research_report', v_report.report_ref,
                               jsonb_build_object('clients', v_sent,
                                                  'signed', v_report.esign_status = 'Signed',
                                                  'parrva', v_report.parrva_status));
  return jsonb_build_object('delivered', v_sent, 'report_ref', v_report.report_ref);
end $$;

-- Delivered clients may read the signed PDF, and the stored unsigned PDF only while the report is
-- unsigned. Owners can read everything for their own reports, as before.
create or replace function v2_private.may_read_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select v2_private.owns_report(v2_private.object_report_id(p_name))
      or (p_name ~ '^[0-9a-f-]{36}/signed\.pdf$'
          and v2_private.can_see_report(v2_private.object_report_id(p_name)))
      or (p_name ~ '^[0-9a-f-]{36}/preview\.pdf$'
          and v2_private.can_see_report(v2_private.object_report_id(p_name))
          and exists (select 1 from v2.research_reports r
                       where r.id = v2_private.object_report_id(p_name)
                         and r.segment = 'Multi' and r.esign_status <> 'Signed'))
$$;

commit;
