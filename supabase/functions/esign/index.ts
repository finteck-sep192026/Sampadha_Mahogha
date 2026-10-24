// Aadhaar eSign (NSDL, via the FinAnalyz gateway) for Sampadha v2 research reports.
//
//   POST { action: 'start', reportId, mobile, returnUrl }
//        → sends <reportId>/preview.pdf for signing and returns { url } of the hosted signing
//          page. After signing, the signer is sent back to returnUrl.
//   POST { action: 'verify', reportId }
//        → asks FinAnalyz whether signing finished; if so stores the signed PDF at
//          <reportId>/signed.pdf and marks the report Signed.
//
// Only this function (service role) can mark a report signed; send_research_report() refuses
// unsigned reports. The API key lives in an Edge Function secret, never in the browser:
//   FINANALYZ_API_KEY   (required)
//   ESIGN_RETURN_ORIGINS  comma-separated origins allowed as returnUrl (optional)
import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'v2-research';
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const API_BASE = 'https://console.finanalyz.com/production/esign';
// The eSign service fails on non-HTTPS callback URLs, so only HTTPS origins are accepted.
const RETURN_ORIGINS = (Deno.env.get('ESIGN_RETURN_ORIGINS') ?? 'https://racrm.fintecindia.com')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o.startsWith('https://'));

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
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const v2 = admin.schema('v2');

// Calls the gateway and unwraps its { data: { data: ... } } / { data: ... } envelopes.
async function gateway(path: string, init: RequestInit = {}) {
  const key = Deno.env.get('FINANALYZ_API_KEY');
  if (!key) throw new HttpError(503, 'Aadhaar eSign is not configured on the server yet.');
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: { XApiKey: key, Accept: 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const messages: Record<number, string> = {
      401: 'The eSign API key was rejected.',
      402: 'Not enough eSign credits. Top up the FinAnalyz account.',
      403: 'eSign is not enabled for this FinAnalyz account.',
    };
    throw new HttpError(502, 'eSign: ' + (messages[res.status] ?? body.message ?? res.statusText));
  }
  return body.data?.data ?? body.data ?? body;
}

const sha256 = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

// NSDL Aadhaar eSign sends the OTP to the Aadhaar-linked mobile; the gateway wants a
// 10-digit mobile number for the signer.
function normaliseMobile(value: unknown) {
  const digits = String(value ?? '')
    .replace(/[\s-]/g, '')
    .replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  if (/^[6-9]\d{9}$/.test(digits)) return digits;
  throw new HttpError(400, 'Enter a 10-digit mobile number.');
}
function allowedReturnUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? ''));
    if (RETURN_ORIGINS.includes(url.origin)) return url.toString();
  } catch {
    /* fall through */
  }
  throw new HttpError(400, 'This website is not allowed to receive eSign results.');
}

async function caller(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Sign in again.');
  const { data: profile } = await v2
    .from('profiles')
    .select('id, login_id, role, full_name, email, is_active')
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
  const mobile = normaliseMobile(body.mobile);
  const returnUrl = allowedReturnUrl(body.returnUrl);

  const path = report.id + '/preview.pdf';
  const { data: file, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !file) throw new HttpError(400, 'Generate the report PDF before signing.');
  const pdf = new Uint8Array(await file.arrayBuffer());
  if (pdf.length > MAX_PDF_BYTES) throw new HttpError(400, 'The report PDF is larger than 10 MB.');
  if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-')
    throw new HttpError(400, 'The uploaded preview is not a PDF.');
  // The signature goes at the bottom right of the last page.
  const pages = Math.max(
    1,
    (new TextDecoder().decode(pdf).match(/\/Type \/Page\b(?!s)/g) ?? []).length,
  );

  const session = await gateway('/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdf_pre_uploaded: true,
      callback_url: returnUrl,
      config: {
        auth_mode: '1',
        reason: 'Research report ' + report.report_ref,
        accept_selfie: false,
        allow_selfie_upload: false,
        accept_virtual_sign: false,
        track_location: false,
        positions: { [pages]: [{ x: 560, y: 40 }] },
      },
      prefill_options: {
        full_name: profile.full_name,
        mobile_number: mobile,
        user_email: profile.email,
      },
    }),
  });
  if (!session?.client_id || !session?.url)
    throw new HttpError(502, 'eSign: the gateway did not return a signing session.');

  // The gateway fetches the PDF itself; give it a short-lived link to the private file.
  const { data: link, error: linkError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, 15 * 60);
  if (linkError || !link) throw new HttpError(500, 'Could not share the PDF for signing.');
  const uploaded = await gateway('/upload-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: session.client_id, link: link.signedUrl }),
  });
  if (uploaded?.uploaded !== true) throw new HttpError(502, 'eSign: the PDF was not accepted.');

  const hash = await sha256(pdf);
  const { error: insertError } = await v2.from('esign_requests').insert({
    report_id: report.id,
    provider: 'finanalyz',
    document_id: session.client_id,
    signer_identifier: mobile,
    pdf_sha256: hash,
    requested_by: profile.id,
    provider_status: { status: 'initiated' },
  });
  if (insertError) throw new HttpError(500, insertError.message);
  await v2.from('research_reports').update({ esign_status: 'Requested' }).eq('id', report.id);
  await audit(profile, 'report.esign_requested', report.report_ref, {
    client_id: session.client_id,
    pdf_sha256: hash,
    provider: 'finanalyz',
  });
  return { url: session.url };
}

async function verify(profile: Awaited<ReturnType<typeof caller>>, body: Record<string, unknown>) {
  const report = await ownedReport(profile, body.reportId);
  if (report.esign_status === 'Signed') return { status: 'Signed', signedAt: report.signed_at };
  const { data: request } = await v2
    .from('esign_requests')
    .select('id, document_id')
    .eq('report_id', report.id)
    .eq('status', 'Requested')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!request) throw new HttpError(400, 'Start the Aadhaar eSign first.');

  const clientId = encodeURIComponent(request.document_id);
  const state = await gateway('/status?client_id=' + clientId);
  const providerStatus = {
    status: state?.status,
    completed: state?.completed,
    esign_error: state?.esign_error,
    nsdl_error: state?.error_message_from_nsdl,
  };

  if (state?.completed === true && !state?.esign_error) {
    const download = await gateway('/download?client_id=' + clientId);
    if (!download?.url) throw new HttpError(502, 'eSign: no download link for the signed PDF.');
    const res = await fetch(download.url);
    const signed = new Uint8Array(await res.arrayBuffer());
    if (!res.ok || new TextDecoder().decode(signed.subarray(0, 5)) !== '%PDF-')
      throw new HttpError(502, 'eSign: the signed PDF could not be downloaded.');
    const path = report.id + '/signed.pdf';
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, signed, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw new HttpError(500, uploadError.message);
    const signedAt = new Date().toISOString();
    await v2
      .from('esign_requests')
      .update({
        status: 'Signed',
        signed_at: signedAt,
        signer_name: profile.full_name,
        provider_status: providerStatus,
      })
      .eq('id', request.id);
    await v2
      .from('research_reports')
      .update({
        esign_status: 'Signed',
        signed_at: signedAt,
        signer_name: profile.full_name,
        signed_pdf_path: path,
      })
      .eq('id', report.id);
    await audit(profile, 'report.esigned', report.report_ref, {
      client_id: request.document_id,
      signed_pdf_sha256: await sha256(signed),
    });
    return { status: 'Signed', signedAt };
  }

  if (state?.esign_error) {
    await v2
      .from('esign_requests')
      .update({ status: 'Failed', provider_status: providerStatus })
      .eq('id', request.id);
    await v2.from('research_reports').update({ esign_status: 'Unsigned' }).eq('id', report.id);
    return {
      status: 'Unsigned',
      message:
        'Signing failed' +
        (state.error_message_from_nsdl ? ': ' + state.error_message_from_nsdl : '') +
        '. Start again.',
    };
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
