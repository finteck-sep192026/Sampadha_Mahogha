// CARE PaRRVA reporting for Sampadha v2 Multi Segment reports (RA API document 0.0.3).
//
//   POST { action: 'submit', reportId }
//        → builds the Strategy API payload from the report's saved legs (rows sharing an AdviceName
//          are one strategy), gets a PaRRVA token, and posts the encrypted payload to the PDC
//          Strategy API. Every attempt is stored in v2.parrva_submissions.
//
// Requests are JWE-encrypted (RSA-OAEP-256 + A256GCM) exactly as in PaRRVA's Postman collection:
// the token request with the PaRRVA public key, the Strategy request with the PDC public key.
// Credentials live in Edge Function secrets, never in the browser:
//   PARRVA_USERNAME (Enrolment ID), PARRVA_PASSWORD
//   optional PARRVA_AUTH_URL, PARRVA_STRATEGY_URL to override the documented endpoints
import { createClient } from 'npm:@supabase/supabase-js@2';

const AUTH_URL =
  Deno.env.get('PARRVA_AUTH_URL') ?? 'https://careparrva.com/api/parrva/pdc/auth/authenticate';
const STRATEGY_URL =
  Deno.env.get('PARRVA_STRATEGY_URL') ?? 'https://pdc.nseindia.com/advice/rainput/strategy';
// Public keys from the PaRRVA API pack (parrva.pem and pdc_public_key.pem).
const PARRVA_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtCTj4Oo+RbfXCWXuLLMIMSZVwy6nG4a0T3y5ALW2w7nDCk/SWmd1HMvj6R92Pk8ta1P3HNgmGvWikUMiAOgPNBe35mT0SUv7mFTcSQeTKnhto7tbr2R+hnwA/7o2Fn1iEqcqNdz4fSSULGaloVv/amwPVwKH1z0RQgaLjtvBTKwKxP6LUOJnUo0G9BuH0eNHfmG4En9sYZgs4sAyKK1a6oz+qDYatp2Bv/JRf0Kjnxi7GtiiKhCUWgW5jDIY42Q5D1Gsld8xeUeYYS6A1D/wu0WqJp1oJ9pEV5D+oRdQotYKQqoTllBaJ4NmsigfNr5a9/3UvDY5F7s7MnYhuMSkDQIDAQAB';
const PDC_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAojQVs6yFZR/Gs46x6wqc8m1aeaSX3hXHvRDGKeEsJ7/Umb5GmPkUdlximFEPTyhCYSfR4WwtO4B3VaUStX35JbUoeRwFFuz+z4ZR1Dr1CyKrnLthhcyG7WFxZ1nITXVI32ZTBZFskpcQ/JGO0y/d9KbuVoLRU2r6IIoK3sfh4FhOkpmnyZA+jbuAU0ayUsjjHvbBcGja0Q3MOLlasxavlmPWLrUkVV7Gp79p4edONXw81yG6b+WeJhjUqs8M3hxmFJpPA4GfOYze8q0kA++ieEZIe30L4Te8GwkDYcNk1SBDScVHEcr+pwGoJB4DoCBODvSSzKn4G42z7ZKdmi1ppQIDAQAB';

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

// ───────────── JWE (compact): RSA-OAEP-256 key wrap, A256GCM content ─────────────
const b64url = (bytes: Uint8Array) => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
async function encryptJwe(plaintext: string, spkiBase64: string) {
  const spki = Uint8Array.from(atob(spkiBase64), (c) => c.charCodeAt(0));
  const publicKey = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const cek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const encryptedKey = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      await crypto.subtle.exportKey('raw', cek),
    ),
  );
  const header = b64url(
    new TextEncoder().encode(JSON.stringify({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })),
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(header) },
      cek,
      new TextEncoder().encode(plaintext),
    ),
  );
  const ciphertext = sealed.slice(0, sealed.length - 16),
    tag = sealed.slice(sealed.length - 16);
  return [header, b64url(encryptedKey), b64url(iv), b64url(ciphertext), b64url(tag)].join('.');
}

async function readBody(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}
const parrvaMessage = (body: Record<string, unknown>) => {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return (
    messages
      .map((m: Record<string, unknown>) =>
        [m.errcode, m.field, m.message].filter(Boolean).join(' '),
      )
      .filter(Boolean)
      .join('; ') ||
    (typeof body?.message === 'string' ? body.message : '') ||
    (typeof body?.raw === 'string' ? body.raw.slice(0, 200) : '')
  );
};

// ───────────── PaRRVA calls ─────────────
async function parrvaToken() {
  const username = Deno.env.get('PARRVA_USERNAME'),
    password = Deno.env.get('PARRVA_PASSWORD');
  if (!username || !password)
    throw new HttpError(503, 'CARE PaRRVA is not configured on the server yet.');
  const jwe = await encryptJwe(
    JSON.stringify({ username, password, role: 'RA' }),
    PARRVA_PUBLIC_KEY,
  );
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { accept: '*/*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: jwe }),
  });
  const body = await readBody(res);
  const token = body?.data?.jwe ?? body?.data?.token;
  if (!res.ok || body?.status === 'error' || !token)
    throw new HttpError(
      502,
      'CARE PaRRVA sign-in failed' +
        (parrvaMessage(body) ? ': ' + parrvaMessage(body) : ' (HTTP ' + res.status + ')'),
    );
  return token as string;
}

// Rows sharing an AdviceName are one strategy; each row is a leg (Strategy API, section 6.6).
function strategyPayload(legs: Record<string, unknown>[]) {
  const groups = new Map<string, Record<string, unknown>>();
  for (const l of legs) {
    let group = groups.get(l.advice_name as string);
    if (!group) {
      group = {
        ProductName: l.product,
        AdviceName: l.advice_name,
        ExchangeName: l.exchange_name,
        StrategyName: l.strategy_name,
        IfIntraday: l.if_intraday,
        strategyDetails: [] as Record<string, unknown>[],
      };
      groups.set(l.advice_name as string, group);
    }
    (group.strategyDetails as Record<string, unknown>[]).push({
      PriceType: l.price_type,
      BuyOrSell: l.side,
      Instrument: l.instrument,
      CEorPE: l.option_type ?? null,
      ContractName: l.contract_name,
      ContractExpiryDate: l.expiry,
      EntryPriceStart: Number(l.initiation_price),
      EntryPriceEnd: Number(l.entry_price_end),
      Lot: l.lots,
      TargetPrice: Number(l.t1),
      StopLoss: Number(l.stop_loss),
      ExitPrice: l.exit_price == null ? null : Number(l.exit_price),
      OptionStrikePrice: l.strike == null ? null : Number(l.strike),
      LegId: Number(l.leg_ref),
    });
  }
  return [...groups.values()];
}

// ───────────── caller and report checks ─────────────
async function caller(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Sign in again.');
  const { data: profile } = await v2
    .from('profiles')
    .select('id, login_id, role, is_active')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile?.is_active || !['ra', 'admin'].includes(profile.role))
    throw new HttpError(403, 'Research workspace access required.');
  return profile;
}

async function submit(profile: Awaited<ReturnType<typeof caller>>, body: Record<string, unknown>) {
  const reportId = body.reportId;
  if (typeof reportId !== 'string' || !/^[0-9a-f-]{36}$/.test(reportId))
    throw new HttpError(400, 'Unknown report.');
  const { data: report } = await v2
    .from('research_reports')
    .select('id, report_ref, author_id, segment, esign_status, parrva_status')
    .eq('id', reportId)
    .maybeSingle();
  if (!report || (profile.role !== 'admin' && report.author_id !== profile.id))
    throw new HttpError(404, 'Report not found.');
  if (report.segment !== 'Multi')
    throw new HttpError(400, 'Only Multi Segment reports are sent to CARE PaRRVA.');
  if (report.esign_status !== 'Signed')
    throw new HttpError(409, 'Complete the Aadhaar eSign before sending to CARE PaRRVA.');
  if (report.parrva_status === 'Submitted')
    throw new HttpError(409, 'This report was already submitted to CARE PaRRVA.');

  const { data: legs } = await v2
    .from('research_legs')
    .select('*')
    .eq('report_id', report.id)
    .order('position');
  if (!legs?.length) throw new HttpError(400, 'This report has no recommendation legs.');
  const missing = legs.find(
    (l) =>
      !l.advice_name ||
      !l.strategy_name ||
      !l.instrument ||
      !l.price_type ||
      !l.leg_ref ||
      l.stop_loss == null ||
      l.t1 == null,
  );
  if (missing)
    throw new HttpError(
      400,
      'Leg ' +
        missing.position +
        ' is missing PaRRVA Strategy fields. Recreate the report from the advice CSV.',
    );

  const payload = strategyPayload(legs);
  let httpStatus: number | null = null,
    response: Record<string, unknown> = {},
    ok = false,
    message = '';
  try {
    const token = await parrvaToken();
    const jwe = await encryptJwe(JSON.stringify(payload), PDC_PUBLIC_KEY);
    const res = await fetch(STRATEGY_URL, {
      method: 'POST',
      headers: {
        accept: '*/*',
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify([{ data: jwe }]),
    });
    httpStatus = res.status;
    response = await readBody(res);
    ok = res.ok && response?.status !== 'error' && response?.success !== false;
    message = ok
      ? 'Accepted by CARE PaRRVA'
      : 'CARE PaRRVA rejected the submission' +
        (parrvaMessage(response) ? ': ' + parrvaMessage(response) : ' (HTTP ' + res.status + ')');
  } catch (error) {
    message = error instanceof HttpError ? error.message : 'Could not reach CARE PaRRVA.';
    response = { error: message };
    if (error instanceof HttpError && error.status === 503) throw error;
  }

  await v2.from('parrva_submissions').insert({
    report_id: report.id,
    endpoint: STRATEGY_URL,
    request_payload: payload,
    http_status: httpStatus,
    response,
    ok,
    submitted_by: profile.id,
  });
  const submittedAt = new Date().toISOString();
  await v2
    .from('research_reports')
    .update({
      parrva_status: ok ? 'Submitted' : 'Failed',
      parrva_submitted_at: ok ? submittedAt : null,
      parrva_message: message.slice(0, 500),
    })
    .eq('id', report.id);
  await v2.from('audit_log').insert({
    actor_id: profile.id,
    actor_login: profile.login_id,
    action: ok ? 'report.parrva_submitted' : 'report.parrva_failed',
    entity: 'research_report',
    entity_ref: report.report_ref,
    detail: { strategies: payload.length, legs: legs.length, http_status: httpStatus },
  });
  if (!ok) throw new HttpError(502, message);
  return { status: 'Submitted', submittedAt, strategies: payload.length, legs: legs.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const profile = await caller(req);
    const body = await req.json().catch(() => ({}));
    if (body.action === 'submit') return reply(200, await submit(profile, body));
    return reply(400, { error: 'Unknown action.' });
  } catch (error) {
    if (error instanceof HttpError) return reply(error.status, { error: error.message });
    console.error(error);
    return reply(500, { error: 'PaRRVA service error.' });
  }
});
