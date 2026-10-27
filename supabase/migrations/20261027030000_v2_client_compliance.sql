-- Sampadha v2: client compliance, as in Mahogha (risk assessment, contract, KYC per client; E-Sign of
-- documents), with the client doing their own parts in the portal.
--
-- * Risk profile: the client answers the questionnaire in v2_private.risk_questionnaire(); the score
--   and category are worked out here, never in the browser. Every submission is kept.
-- * Client documents: Admin/Sales upload a PDF (the client agreement or any other document) for one
--   client; the client signs it with Aadhaar eSign (Edge Function client-esign, which alone marks it
--   Signed and stores the signed copy).
-- * KYC: Admin records Verified / Pending / Rejected.
-- * list_client_compliance(): one row per client for the Compliance page and the RA send screens.
--
-- Storage (bucket v2-research):
--   clients/<client id>/<document id>.pdf          original (Admin/Sales upload)
--   clients/<client id>/<document id>-signed.pdf   signed copy (client-esign only)

-- ───────────────────────── risk profile ─────────────────────────
-- Bump the version whenever a question, option or score changes.
create function v2_private.risk_questionnaire() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'version', 'RP-2026-10-27',
    'questions', jsonb_build_array(
      jsonb_build_object('key', 'age', 'text', 'Your age', 'options', jsonb_build_array(
        jsonb_build_array('Under 30', 4), jsonb_build_array('30 to 45', 3),
        jsonb_build_array('46 to 60', 2), jsonb_build_array('Over 60', 1))),
      jsonb_build_object('key', 'horizon', 'text', 'How long can this money stay invested before you need it?', 'options', jsonb_build_array(
        jsonb_build_array('Less than 1 year', 1), jsonb_build_array('1 to 3 years', 2),
        jsonb_build_array('3 to 5 years', 3), jsonb_build_array('More than 5 years', 4))),
      jsonb_build_object('key', 'objective', 'text', 'What do you want this money to do?', 'options', jsonb_build_array(
        jsonb_build_array('Keep my capital safe', 1), jsonb_build_array('Earn a regular income', 2),
        jsonb_build_array('Grow steadily with some ups and downs', 3),
        jsonb_build_array('Grow as much as possible, accepting large swings', 4))),
      jsonb_build_object('key', 'income', 'text', 'How stable is your income, and how many people depend on it?', 'options', jsonb_build_array(
        jsonb_build_array('Irregular income, others depend on me', 1),
        jsonb_build_array('Stable income, others depend on me', 2),
        jsonb_build_array('Stable income, few or no dependants', 3),
        jsonb_build_array('High, stable income and no dependants', 4))),
      jsonb_build_object('key', 'savings_share', 'text', 'What share of your total savings will you invest using our research?', 'options', jsonb_build_array(
        jsonb_build_array('More than half', 1), jsonb_build_array('A quarter to a half', 2),
        jsonb_build_array('A tenth to a quarter', 3), jsonb_build_array('Less than a tenth', 4))),
      jsonb_build_object('key', 'experience', 'text', 'Your investing experience', 'options', jsonb_build_array(
        jsonb_build_array('None, or bank deposits only', 1),
        jsonb_build_array('Mainly mutual funds', 2),
        jsonb_build_array('Shares for 1 to 3 years', 3),
        jsonb_build_array('Shares for more than 3 years', 4))),
      jsonb_build_object('key', 'derivatives', 'text', 'Have you traded futures and options (F&O)?', 'options', jsonb_build_array(
        jsonb_build_array('Never', 1), jsonb_build_array('A few times', 2),
        jsonb_build_array('Regularly, for under 2 years', 3),
        jsonb_build_array('Regularly, for 2 years or more', 4))),
      jsonb_build_object('key', 'fall', 'text', 'Your investments fall 20% in a few weeks. What do you do?', 'options', jsonb_build_array(
        jsonb_build_array('Sell everything', 1), jsonb_build_array('Move part of it somewhere safer', 2),
        jsonb_build_array('Hold and wait', 3), jsonb_build_array('Invest more at the lower price', 4))),
      jsonb_build_object('key', 'loss', 'text', 'The largest loss in a year you could accept', 'options', jsonb_build_array(
        jsonb_build_array('Up to 5%', 1), jsonb_build_array('Up to 10%', 2),
        jsonb_build_array('Up to 20%', 3), jsonb_build_array('More than 20%', 4)))
    ),
    -- score (9–36) → category
    'bands', jsonb_build_array(
      jsonb_build_array(9, 'Conservative'), jsonb_build_array(17, 'Moderate'),
      jsonb_build_array(24, 'Growth'), jsonb_build_array(31, 'Aggressive'))
  )
$$;

create table v2.risk_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references v2.profiles (id) on delete cascade,
  version text not null,
  answers jsonb not null,
  score int not null,
  category text not null check (category in ('Conservative', 'Moderate', 'Growth', 'Aggressive')),
  derivatives_suitable boolean not null,
  submitted_by uuid references v2.profiles (id) on delete set null,
  submitted_at timestamptz not null default now()
);
create index v2_risk_profiles_client_idx on v2.risk_profiles (client_id, submitted_at desc);
alter table v2.risk_profiles enable row level security;
create policy risk_profiles_read on v2.risk_profiles for select to authenticated
  using (client_id = (select auth.uid()) or v2_private.is_role('admin', 'sales', 'ra'));
grant select on v2.risk_profiles to authenticated;
grant all on v2.risk_profiles to service_role;

create function v2.risk_questionnaire() returns jsonb
language sql stable security definer set search_path = '' as $$
  select v2_private.risk_questionnaire() where (select auth.uid()) is not null
$$;

-- p_answers: { "<question key>": <option index from 0>, … } for every question.
create function v2.submit_risk_profile(p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_q jsonb := v2_private.risk_questionnaire();
  v_question jsonb;
  v_pick int;
  v_option jsonb;
  v_answers jsonb := '{}';
  v_score int := 0;
  v_category text;
  v_band jsonb;
  v_derivatives int;
begin
  if not v2_private.is_role('client') then
    raise exception 'Only the client can complete their risk profile' using errcode = '42501';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Answer every question';
  end if;
  for v_question in select * from jsonb_array_elements(v_q -> 'questions') loop
    if jsonb_typeof(p_answers -> (v_question ->> 'key')) is distinct from 'number' then
      raise exception 'Answer every question (%)', v_question ->> 'text';
    end if;
    v_pick := (p_answers ->> (v_question ->> 'key'))::int;
    v_option := v_question -> 'options' -> v_pick;
    if v_pick < 0 or v_option is null then
      raise exception 'Unknown answer for "%"', v_question ->> 'text';
    end if;
    v_score := v_score + (v_option ->> 1)::int;
    v_answers := v_answers || jsonb_build_object(v_question ->> 'key',
      jsonb_build_object('question', v_question ->> 'text', 'answer', v_option ->> 0,
                         'points', (v_option ->> 1)::int));
    if v_question ->> 'key' = 'derivatives' then
      v_derivatives := (v_option ->> 1)::int;
    end if;
  end loop;
  for v_band in select * from jsonb_array_elements(v_q -> 'bands') loop
    if v_score >= (v_band ->> 0)::int then
      v_category := v_band ->> 1;
    end if;
  end loop;

  insert into v2.risk_profiles (client_id, version, answers, score, category, derivatives_suitable,
                                submitted_by)
  values ((select auth.uid()), v_q ->> 'version', v_answers, v_score, v_category,
          v_category in ('Growth', 'Aggressive') and v_derivatives >= 2, (select auth.uid()));
  update v2.profiles set risk_profile = v_category where id = (select auth.uid());
  perform v2_private.log_audit('risk_profile.submitted', 'client_profile',
                               (select login_id from v2.profiles where id = (select auth.uid())),
                               jsonb_build_object('score', v_score, 'category', v_category,
                                                  'version', v_q ->> 'version'));
  return jsonb_build_object('score', v_score, 'category', v_category,
                            'derivatives_suitable', v_category in ('Growth', 'Aggressive') and v_derivatives >= 2);
end $$;

-- ───────────────────────── client documents (E-Sign) ─────────────────────────
create sequence v2_private.doc_ref_seq start 27800;

create table v2.client_documents (
  id uuid primary key,
  doc_ref text not null unique,
  client_id uuid not null references v2.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  kind text not null check (kind in ('Client agreement', 'Other')),
  file_name text not null,
  original_path text not null unique,
  pdf_sha256 text,
  sign_pages text not null default 'All' check (sign_pages in ('All', 'Last')),
  status text not null default 'Awaiting signature'
    check (status in ('Awaiting signature', 'Signing', 'Signed', 'Cancelled')),
  provider_document_id text,
  provider_status jsonb,
  signed_path text,
  signed_sha256 text,
  signer_name text,
  signed_at timestamptz,
  requested_by uuid references v2.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index v2_client_documents_client_idx on v2.client_documents (client_id, created_at desc);
alter table v2.client_documents enable row level security;
create policy client_documents_read on v2.client_documents for select to authenticated
  using (client_id = (select auth.uid()) or v2_private.is_role('admin', 'sales'));
grant select on v2.client_documents to authenticated;
grant all on v2.client_documents to service_role;

create function v2_private.client_object_owner(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^clients/[0-9a-f-]{36}/[0-9a-f-]{36}(-signed)?\.pdf$'
              then split_part(p_name, '/', 2)::uuid end
$$;
create policy v2_client_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'v2-research' and v2_private.client_object_owner(name) is not null
         and (v2_private.client_object_owner(name) = (select auth.uid())
              or v2_private.is_role('admin', 'sales')));
create policy v2_client_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'v2-research' and name ~ '^clients/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'
              and v2_private.is_role('admin', 'sales'));

-- Registers a PDF the caller has just uploaded to clients/<client id>/<p_id>.pdf.
create function v2.create_client_document(p_id uuid, p_login_id text, p_title text, p_kind text,
                                          p_file_name text, p_sign_pages text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client v2.profiles;
  v_path text;
  v_size bigint;
  v_ref text;
  v_title text := trim(coalesce(p_title, ''));
begin
  if not v2_private.is_role('admin', 'sales') then
    raise exception 'Admin or Sales access required' using errcode = '42501';
  end if;
  select * into v_client from v2.profiles
   where role = 'client' and is_active and upper(login_id) = upper(trim(coalesce(p_login_id, '')));
  if not found then
    raise exception 'Client % not found', p_login_id;
  end if;
  if char_length(v_title) not between 3 and 120 then
    raise exception 'Give the document a title (3 to 120 characters)';
  end if;
  if p_kind is null or p_kind not in ('Client agreement', 'Other') then
    raise exception 'Choose the document type';
  end if;
  if p_sign_pages is null or p_sign_pages not in ('All', 'Last') then
    raise exception 'Choose which pages are signed';
  end if;
  v_path := 'clients/' || v_client.id || '/' || p_id || '.pdf';
  select (metadata ->> 'size')::bigint into v_size from storage.objects
   where bucket_id = 'v2-research' and name = v_path and owner_id = (select auth.uid())::text;
  if not found then
    raise exception 'Upload the PDF before sending it for signature';
  end if;
  if v_size is null or v_size not between 1 and 10485760 then
    raise exception 'The PDF must be 10 MB or smaller';
  end if;
  v_ref := 'DOC-' || nextval('v2_private.doc_ref_seq');
  insert into v2.client_documents (id, doc_ref, client_id, title, kind, file_name, original_path,
                                   sign_pages, requested_by)
  values (p_id, v_ref, v_client.id, v_title, p_kind,
          left(coalesce(nullif(trim(p_file_name), ''), 'document.pdf'), 200), v_path,
          p_sign_pages, (select auth.uid()));

  insert into v2.client_notifications (alert_ref, client_id, channel, title, detail)
  values ('ALT-' || nextval('v2_private.mail_ref_seq'), v_client.id, 'In-app',
          'Document to sign: ' || v_title,
          'Open Compliance and sign ' || v_title || ' with Aadhaar eSign.');
  insert into v2.email_log (mail_ref, recipient_id, client_id, recipient_email, recipient_name,
                            subject, mail_type, body, created_by)
  values ('MAIL-' || nextval('v2_private.mail_ref_seq'), v_client.id, v_client.id, v_client.email,
          v_client.full_name, 'Please sign: ' || v_title, 'Document to sign',
          'Sampadha has sent you "' || v_title || '" (' || v_ref || ') to sign. Sign in, open '
            || 'Compliance and sign it with Aadhaar eSign (OTP to your Aadhaar-linked mobile).',
          (select auth.uid()));
  perform v2_private.log_audit('document.sent_for_signature', 'client_document', v_ref,
                               jsonb_build_object('client', v_client.login_id, 'title', v_title,
                                                  'kind', p_kind));
  return jsonb_build_object('id', p_id, 'doc_ref', v_ref);
end $$;

create function v2.cancel_client_document(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ref text;
begin
  if not v2_private.is_role('admin', 'sales') then
    raise exception 'Admin or Sales access required' using errcode = '42501';
  end if;
  update v2.client_documents set status = 'Cancelled'
   where id = p_id and status in ('Awaiting signature', 'Signing')
  returning doc_ref into v_ref;
  if v_ref is null then
    raise exception 'Only unsigned documents can be cancelled';
  end if;
  perform v2_private.log_audit('document.cancelled', 'client_document', v_ref, '{}');
  return jsonb_build_object('doc_ref', v_ref, 'status', 'Cancelled');
end $$;

-- ───────────────────────── KYC ─────────────────────────
create function v2.set_client_kyc(p_login_id text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_text text;
  v_login text;
begin
  if not v2_private.is_role('admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('Verified', 'Pending', 'Rejected') then
    raise exception 'KYC status must be Verified, Pending or Rejected';
  end if;
  v_text := p_status || ' • ' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY');
  update v2.profiles set kyc_status = v_text
   where role = 'client' and upper(login_id) = upper(trim(coalesce(p_login_id, '')))
  returning login_id into v_login;
  if v_login is null then
    raise exception 'Client % not found', p_login_id;
  end if;
  perform v2_private.log_audit('kyc.' || lower(p_status), 'client_profile', v_login, '{}');
  return jsonb_build_object('login_id', v_login, 'kyc_status', v_text);
end $$;

-- ───────────────────────── overview ─────────────────────────
create function v2.list_client_compliance()
returns table (client_id uuid, login_id text, full_name text, email text, is_active boolean,
               kyc_status text, risk_category text, risk_score int, derivatives_suitable boolean,
               risk_at timestamptz, agreement_signed_at timestamptz, documents_pending int,
               broker_email_status text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.login_id, p.full_name, p.email, p.is_active, p.kyc_status,
         rp.category, rp.score, rp.derivatives_suitable, rp.submitted_at,
         (select max(d.signed_at) from v2.client_documents d
           where d.client_id = p.id and d.kind = 'Client agreement' and d.status = 'Signed'),
         (select count(*)::int from v2.client_documents d
           where d.client_id = p.id and d.status in ('Awaiting signature', 'Signing')),
         (select c.status from v2.broker_email_consents c where c.client_id = p.id)
  from v2.profiles p
  left join lateral (select r.category, r.score, r.derivatives_suitable, r.submitted_at
                       from v2.risk_profiles r where r.client_id = p.id
                      order by r.submitted_at desc limit 1) rp on true
  where p.role = 'client' and v2_private.is_role('admin', 'sales', 'ra')
  order by p.login_id
$$;

-- ───────────────────────── privileges ─────────────────────────
revoke all on function v2_private.risk_questionnaire() from public, anon, authenticated;
revoke all on function v2_private.client_object_owner(text) from public, anon;
revoke all on function v2.risk_questionnaire() from public, anon, authenticated;
revoke all on function v2.submit_risk_profile(jsonb) from public, anon, authenticated;
revoke all on function v2.create_client_document(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function v2.cancel_client_document(uuid) from public, anon, authenticated;
revoke all on function v2.set_client_kyc(text, text) from public, anon, authenticated;
revoke all on function v2.list_client_compliance() from public, anon, authenticated;
grant execute on function v2_private.client_object_owner(text) to authenticated;
grant execute on function v2.risk_questionnaire() to authenticated;
grant execute on function v2.submit_risk_profile(jsonb) to authenticated;
grant execute on function v2.create_client_document(uuid, text, text, text, text, text) to authenticated;
grant execute on function v2.cancel_client_document(uuid) to authenticated;
grant execute on function v2.set_client_kyc(text, text) to authenticated;
grant execute on function v2.list_client_compliance() to authenticated;
