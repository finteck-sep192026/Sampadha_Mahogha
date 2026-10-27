// Aadhaar eSign (NSDL, via the FinAnalyz gateway) of client documents for Sampadha v2: the client
// agreement or any other PDF that Admin/Sales sent to a client (v2.client_documents).
//
//   POST { action: 'start', documentId, mobile, returnUrl }   (the client the document is for)
//        → sends the PDF for signing and returns { url } of the hosted signing page; afterwards the
//          client is sent back to returnUrl.
//   POST { action: 'verify', documentId }                      (that client, Admin or Sales)
//        → asks FinAnalyz whether signing finished; if so stores the signed PDF at
//          clients/<client id>/<document id>-signed.pdf and marks the document Signed.
//
// Only this function (service role) can mark a document signed. Secrets as for the esign function:
//   FINANALYZ_API_KEY (required), ESIGN_RETURN_ORIGINS (optional)
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
  if (!profile?.is_active) throw new HttpError(403, 'This account is not active.');
  return profile;
}
type Profile = Awaited<ReturnType<typeof caller>>;

async function document(profile: Profile, documentId: unknown, staffMayRead: boolean) {
  if (typeof documentId !== 'string' || !/^[0-9a-f-]{36}$/.test(documentId))
    throw new HttpError(400, 'Unknown document.');
  const { data: doc } = await v2
    .from('client_documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle();
  const allowed =
    doc &&
    (doc.client_id === profile.id || (staffMayRead && ['admin', 'sales'].includes(profile.role)));
  if (!allowed) throw new HttpError(404, 'Document not found.');
  return doc;
}

const audit = (profile: Profile, action: string, ref: string, detail: Record<string, unknown>) =>
  v2.from('audit_log').insert({
    actor_id: profile.id,
    actor_login: profile.login_id,
    action,
    entity: 'client_document',
    entity_ref: ref,
    detail,
  });

async function start(profile: Profile, body: Record<string, unknown>) {
  const doc = await document(profile, body.documentId, false);
  if (doc.status === 'Signed') throw new HttpError(409, 'This document is already signed.');
  if (doc.status === 'Cancelled') throw new HttpError(409, 'This document was withdrawn.');
  const mobile = normaliseMobile(body.mobile);
  const returnUrl = allowedReturnUrl(body.returnUrl);

  const { data: file, error } = await admin.storage.from(BUCKET).download(doc.original_path);
  if (error || !file) throw new HttpError(400, 'The document file is missing.');
  const pdf = new Uint8Array(await file.arrayBuffer());
  if (pdf.length > MAX_PDF_BYTES) throw new HttpError(400, 'The PDF is larger than 10 MB.');
  if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-')
    throw new HttpError(400, 'The document is not a PDF.');
  const pages = Math.max(
    1,
    (new TextDecoder().decode(pdf).match(/\/Type \/Page\b(?!s)/g) ?? []).length,
  );
  // Signature at the bottom right of every page, or of the last page only.
  const spot = [{ x: 560, y: 40 }];
  const positions: Record<number, typeof spot> = {};
  for (let page = doc.sign_pages === 'All' ? 1 : pages; page <= pages; page++) positions[page] = spot;

  const session = await gateway('/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdf_pre_uploaded: true,
      callback_url: returnUrl,
      config: {
        auth_mode: '1',
        reason: doc.title + ' (' + doc.doc_ref + ')',
        accept_selfie: false,
        allow_selfie_upload: false,
        accept_virtual_sign: false,
        track_location: false,
        positions,
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
    .createSignedUrl(doc.original_path, 15 * 60);
  if (linkError || !link) throw new HttpError(500, 'Could not share the PDF for signing.');
  const uploaded = await gateway('/upload-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: session.client_id, link: link.signedUrl }),
  });
  if (uploaded?.uploaded !== true) throw new HttpError(502, 'eSign: the PDF was not accepted.');

  const hash = await sha256(pdf);
  const { error: updateError } = await v2
    .from('client_documents')
    .update({
      status: 'Signing',
      provider_document_id: session.client_id,
      pdf_sha256: hash,
      provider_status: { status: 'initiated', mobile },
    })
    .eq('id', doc.id);
  if (updateError) throw new HttpError(500, updateError.message);
  await audit(profile, 'document.esign_requested', doc.doc_ref, {
    provider_document_id: session.client_id,
    pdf_sha256: hash,
    pages,
  });
  return { url: session.url };
}

async function verify(profile: Profile, body: Record<string, unknown>) {
  const doc = await document(profile, body.documentId, true);
  if (doc.status === 'Signed') return { status: 'Signed', signedAt: doc.signed_at };
  if (doc.status !== 'Signing' || !doc.provider_document_id)
    throw new HttpError(400, 'Start the Aadhaar eSign first.');

  const id = encodeURIComponent(doc.provider_document_id);
  const state = await gateway('/status?client_id=' + id);
  const providerStatus = {
    status: state?.status,
    completed: state?.completed,
    esign_error: state?.esign_error,
    nsdl_error: state?.error_message_from_nsdl,
  };

  if (state?.completed === true && !state?.esign_error) {
    const download = await gateway('/download?client_id=' + id);
    if (!download?.url) throw new HttpError(502, 'eSign: no download link for the signed PDF.');
    const res = await fetch(download.url);
    const signed = new Uint8Array(await res.arrayBuffer());
    if (!res.ok || new TextDecoder().decode(signed.subarray(0, 5)) !== '%PDF-')
      throw new HttpError(502, 'eSign: the signed PDF could not be downloaded.');
    const path = doc.original_path.replace(/\.pdf$/, '-signed.pdf');
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, signed, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw new HttpError(500, uploadError.message);
    const { data: client } = await v2
      .from('profiles')
      .select('full_name')
      .eq('id', doc.client_id)
      .maybeSingle();
    const signedAt = new Date().toISOString();
    const signedHash = await sha256(signed);
    await v2
      .from('client_documents')
      .update({
        status: 'Signed',
        signed_at: signedAt,
        signed_path: path,
        signed_sha256: signedHash,
        signer_name: client?.full_name ?? null,
        provider_status: providerStatus,
      })
      .eq('id', doc.id);
    await audit(profile, 'document.esigned', doc.doc_ref, {
      provider_document_id: doc.provider_document_id,
      signed_pdf_sha256: signedHash,
    });
    return { status: 'Signed', signedAt };
  }

  if (state?.esign_error) {
    await v2
      .from('client_documents')
      .update({ status: 'Awaiting signature', provider_status: providerStatus })
      .eq('id', doc.id);
    return {
      status: 'Awaiting signature',
      message:
        'Signing failed' +
        (state.error_message_from_nsdl ? ': ' + state.error_message_from_nsdl : '') +
        '. Start again.',
    };
  }

  await v2.from('client_documents').update({ provider_status: providerStatus }).eq('id', doc.id);
  return { status: 'Signing' };
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
