-- Sampadha v2: Admin "Send test email" (Email delivery page) to check the mailer's SMTP set-up.
-- Queues one plain message; the mailer Edge Function sends it like any other email.
create function v2.send_test_email(p_to text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_to text := lower(trim(coalesce(p_to, '')));
  v_ref text;
begin
  if not v2_private.is_role('admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not v2_private.valid_email(v_to) then
    raise exception 'Enter a valid email address';
  end if;
  if (select count(*) from v2.email_log where mail_type = 'Test email'
        and created_by = (select auth.uid()) and sent_at > now() - interval '1 hour') >= 10 then
    raise exception 'At most 10 test emails an hour';
  end if;
  v_ref := 'MAIL-' || nextval('v2_private.mail_ref_seq');
  insert into v2.email_log (mail_ref, recipient_email, recipient_name, subject, mail_type, body,
                            created_by)
  values (v_ref, v_to, null, 'Sampadha portal test email', 'Test email',
          'This is a test email from the Sampadha portal. If you can read it, email sending works.',
          (select auth.uid()));
  perform v2_private.log_audit('mail.test_queued', 'email_log', v_ref, jsonb_build_object('to', v_to));
  return jsonb_build_object('mail_ref', v_ref, 'to', v_to);
end $$;

revoke all on function v2.send_test_email(text) from public, anon, authenticated;
grant execute on function v2.send_test_email(text) to authenticated;
