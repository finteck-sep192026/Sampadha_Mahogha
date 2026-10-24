// Digio Aadhaar eSign for Sampadha v2 research reports.
//
//   POST { action: 'start',  reportId, identifier }  → uploads <reportId>/preview.pdf to Digio and
//        returns { documentId, identifier, environment } for the Digio Web SDK to open the signing.
//   POST { action: 'verify', reportId }              → asks Digio whether the document is signed;
//        if so stores the signed PDF at <reportId>/signed.pdf and marks the report Signed.
//
// Only this function (service role) can mark a report signed; send_research_report() refuses
// unsigned reports. Digio credentials live in Edge Function secrets, never in the browser:
//   supabase secrets set DIGIO_CLIENT_ID=... DIGIO_CLIENT_SECRET=... DIGIO_ENV=sandbox
import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'v2-research';
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const DIGIO_ENV = Deno.env.get('DIGIO_ENV') === 'production' ? 'production' : 'sandbox';
const DIGIO_BASE = DIGIO_ENV === 'production' ? 'https://api.digio.in' : 'https://ext.digio.in:444';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const v2 = admin.schema('v2');

function digioAuth() {
  const id = Deno.env.get('DIGIO_CLIENT_ID'),
    secret = Deno.env.get('DIGIO_CLIENT_SECRET');
  if (!id || !secret) throw new HttpError(503, 'Digio eSign is not configured on the server yet.');
  return 'Basic ' + btoa(id + ':' + secret);
}
async function digio(path: string, init: RequestInit = {}) {
  const res = await fetch(DIGIO_BASE + path, {
    ...init,
    headers: { Authorization: digioAuth(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {
      /* plain-text error */
    }
    throw new HttpError(502, 'Digio: ' + (message || res.statusText));
  }
  return res;
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const sha256 = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

// Digio identifies a signer by email or 10-digit Indian mobile number.
function normaliseIdentifier(value: unknown) {
  const raw = String(value ?? '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) && raw.length <= 120) return raw.toLowerCase();
  const digits = raw.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  if (/^[6-9]\d{9}$/.test(digits)) return digits;
  throw new HttpError(400, 'Enter the email or 10-digit mobile number you use for Aadhaar eSign.');
}

async function caller(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Sign in again.');
  const { data: profile } = await v2
    .from('profiles')
    .select('id, login_id, role, full_name, is_active')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile?.is_active || !['ra', 'admin'].includes(profile.role))
    throw new HttpError(403, 'Research workspace access required.');
  return profile;
}

async function ownedReport(profile: { id: string; role: string }, reportId: unknown) {
  if (typeof reportId !== 'string' || !/^[0-9a-f-]{36}$/.test(reportId))
    throw new HttpError(400, 'Unknown report.');
  const { data: report } = await v2
    .from('research_reports')
    .select('id, report_ref, title, author_id, esign_status, signed_at')
    .eq('id', reportId)
    .maybeSingle();
  if (!report || (profile.role !== 'admin' && report.author_id !== profile.id))
    throw new HttpError(404, 'Report not found.');
  return report;
}

const audit = (
  profile: { id: string; login_id: string },
  action: string,
  ref: string,
  detail: Record<string, unknown>,
) =>
  v2.from('audit_log').insert({
    actor_id: profile.id,
    actor_login: profile.login_id,
    action,
    entity: 'research_report',
    entity_ref: ref,
    detail,
  });

async function start(profile: Awaited<ReturnType<typeof caller>>, body: Record<string, unknown>) {
  const report = await ownedReport(profile, body.reportId);
  if (report.esign_status === 'Signed') throw new HttpError(409, 'This report is already signed.');
  const identifier = normaliseIdentifier(body.identifier);

  const { data: file, error } = await admin.storage
    .from(BUCKET)
    .download(report.id + '/preview.pdf');
  if (error || !file) throw new HttpError(400, 'Generate the report PDF before signing.');
  const pdf = new Uint8Array(await file.arrayBuffer());
  if (pdf.length > MAX_PDF_BYTES) throw new HttpError(400, 'The report PDF is larger than 10 MB.');
  if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-')
    throw new HttpError(400, 'The uploaded preview is not a PDF.');

  const res = await digio('/v2/client/document/uploadpdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signers: [
        {
          identifier,
          name: profile.full_name,
          reason: 'Research report ' + report.report_ref,
          sign_type: 'aadhaar',
        },
      ],
      expire_in_days: 1,
      display_on_page: 'last',
      notify_signers: false,
      send_sign_link: false,
      file_name: report.report_ref + '.pdf',
      file_data: toBase64(pdf),
    }),
  });
  const doc = await res.json();
  if (!doc?.id) throw new HttpError(502, 'Digio did not return a document ID.');

  const hash = await sha256(pdf);
  const { error: insertError } = await v2.from('esign_requests').insert({
    report_id: report.id,
    document_id: doc.id,
    signer_identifier: identifier,
    pdf_sha256: hash,
    requested_by: profile.id,
    provider_status: { agreement_status: doc.agreement_status ?? 'requested' },
  });
  if (insertError) throw new HttpError(500, insertError.message);
  await v2.from('research_reports').update({ esign_status: 'Requested' }).eq('id', report.id);
  await audit(profile, 'report.esign_requested', report.report_ref, {
    document_id: doc.id,
    pdf_sha256: hash,
    environment: DIGIO_ENV,
  });
  return { documentId: doc.id, identifier, environment: DIGIO_ENV };
}

async function verify(profile: Awaited<ReturnType<typeof caller>>, body: Record<string, unknown>) {
  const report = await ownedReport(profile, body.reportId);
  if (report.esign_status === 'Signed') return { status: 'Signed', signedAt: report.signed_at };
  const { data: request } = await v2
    .from('esign_requests')
    .select('id, document_id, signer_identifier')
    .eq('report_id', report.id)
    .eq('status', 'Requested')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!request) throw new HttpError(400, 'Start the Aadhaar eSign first.');

  const doc = await (await digio('/v2/client/document/' + request.document_id)).json();
  const party = (doc.signing_parties ?? []).find(
    (p: { identifier?: string }) =>
      String(p.identifier ?? '').toLowerCase() === request.signer_identifier,
  );
  const providerStatus = {
    agreement_status: doc.agreement_status,
    signer_status: party?.status,
    signer_updated_at: party?.updated_at,
  };

  if (doc.agreement_status === 'completed' && party?.status === 'signed') {
    const signed = new Uint8Array(
      await (
        await digio('/v2/client/document/download?document_id=' + encodeURIComponent(request.document_id))
      ).arrayBuffer(),
    );
    const path = report.id + '/signed.pdf';
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, signed, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw new HttpError(500, uploadError.message);
    const signedAt = new Date().toISOString(),
      signerName = party.name || profile.full_name;
    await v2
      .from('esign_requests')
      .update({ status: 'Signed', signed_at: signedAt, signer_name: signerName, provider_status: providerStatus })
      .eq('id', request.id);
    await v2
      .from('research_reports')
      .update({ esign_status: 'Signed', signed_at: signedAt, signer_name: signerName, signed_pdf_path: path })
      .eq('id', report.id);
    await audit(profile, 'report.esigned', report.report_ref, {
      document_id: request.document_id,
      signed_pdf_sha256: await sha256(signed),
    });
    return { status: 'Signed', signedAt };
  }

  if (['expired', 'failed'].includes(doc.agreement_status) || party?.status === 'failed') {
    await v2
      .from('esign_requests')
      .update({ status: doc.agreement_status === 'expired' ? 'Expired' : 'Failed', provider_status: providerStatus })
      .eq('id', request.id);
    await v2.from('research_reports').update({ esign_status: 'Unsigned' }).eq('id', report.id);
    return { status: 'Unsigned', message: 'The signing request ' + (doc.agreement_status ?? 'failed') + '. Start again.' };
  }

  await v2.from('esign_requests').update({ provider_status: providerStatus }).eq('id', request.id);
  return { status: 'Requested' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const profile = await caller(req);
    const body = await req.json().catch(() => ({}));
    if (body.action === 'start') return reply(200, await start(profile, body));
    if (body.action === 'verify') return reply(200, await verify(profile, body));
    return reply(400, { error: 'Unknown action.' });
  } catch (error) {
    if (error instanceof HttpError) return reply(error.status, { error: error.message });
    console.error(error);
    return reply(500, { error: 'eSign service error.' });
  }
});
