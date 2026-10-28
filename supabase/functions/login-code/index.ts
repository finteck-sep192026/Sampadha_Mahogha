// Sampadha v2 sign-in code: the second step after the password.
//
//   POST { action: 'send' }          → emails a 6-digit code to the signed-in person's own address.
//   POST { action: 'verify', code }  → checks it; on success this session may use the portal.
//   POST { action: 'request', identifier }
//        → sign in with an email code, no password: nobody is signed in yet. Emails a one-time
//          Supabase Auth code to the active account with that login ID or email; the sign-in page
//          verifies it itself (auth.verifyOtp). The answer is the same whether or not an account
//          matched. This caller has only the publishable key (the gateway lets it through);
//          'send' and 'verify' check the person's JWT themselves.
//
// For 'send' and 'verify' the caller has just signed in with their password (their JWT). The code is
// sent by SMTP with the mailer's secrets (SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD,
// MAIL_FROM) and stored only as an HMAC; it lasts 10 minutes and allows 5 tries. Enforcement is in
// the database (migration 20261028010000_v2_login_code.sql): until verify succeeds, every v2 API
// request and file in v2-research is refused for this session.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const HOST = Deno.env.get('SMTP_HOST')?.trim();
const PORT = Number(Deno.env.get('SMTP_PORT') ?? 465);
const USERNAME = Deno.env.get('SMTP_USERNAME')?.trim();
const PASSWORD = Deno.env.get('SMTP_PASSWORD');
const FROM = Deno.env.get('MAIL_FROM')?.trim() || USERNAME;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const v2 = admin.schema('v2');
const transport =
  HOST && USERNAME && PASSWORD
    ? nodemailer.createTransport({
        host: HOST,
        port: PORT,
        secure: PORT === 465,
        auth: { user: USERNAME, pass: PASSWORD },
        connectionTimeout: 15000,
        socketTimeout: 20000,
      })
    : null;

// The JWT was already checked by auth.getUser; this only reads its session_id claim.
function sessionId(token: string) {
  const part = token.split('.')[1] ?? '';
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
  const id = JSON.parse(json).session_id;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(401, 'Sign in again.');
  return id;
}

async function caller(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Sign in again.');
  const { data: profile } = await v2
    .from('profiles')
    .select('id, login_id, full_name, email, is_active')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile?.is_active) throw new HttpError(403, 'This account has no portal access.');
  return { profile, session: sessionId(token) };
}

// HMAC of session + code with the service key: a stolen table row is useless on its own.
async function codeHash(session: string, code: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SERVICE_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(session + ':' + code));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function send(who: Awaited<ReturnType<typeof caller>>) {
  if (!transport) throw new HttpError(503, 'Email is not set up on the server, so no code can be sent.');
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  const { data: stored, error } = await v2.rpc('login_code_store', {
    p_session: who.session,
    p_user: who.profile.id,
    p_hash: await codeHash(who.session, code),
  });
  if (error) throw new HttpError(500, 'Could not prepare a sign-in code.');
  if (!stored?.stored)
    throw new HttpError(
      429,
      stored?.reason === 'too_soon'
        ? 'A code was sent a moment ago. Check your email, or ask for a new one in 30 seconds.'
        : 'Too many codes were requested. Wait 15 minutes and sign in again.',
    );
  const { profile } = who;
  const subject = `${code} is your Sampadha sign-in code`;
  const text = `Hello ${profile.full_name},\n\nYour Sampadha sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not just sign in, someone may know your password: change it and tell your Sampadha administrator.\n\nSampadha`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#13233a"><p>Hello ${profile.full_name.replace(/[&<>"]/g, '')},</p><p>Your Sampadha sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:8px 0 14px">${code}</p><p style="color:#5b6b80">It expires in 10 minutes. If you did not just sign in, someone may know your password: change it and tell your Sampadha administrator.</p><p>Sampadha</p></div>`;
  try {
    await transport.sendMail({ from: FROM, to: { name: profile.full_name, address: profile.email }, subject, text, html });
  } catch (err) {
    throw new HttpError(502, 'The sign-in code could not be emailed: ' + String((err as Error)?.message ?? err).slice(0, 200));
  }
  return { sentTo: profile.email.replace(/^(.)[^@]*/, '$1•••'), expiresInSeconds: 600 };
}

async function verify(who: Awaited<ReturnType<typeof caller>>, body: Record<string, unknown>) {
  const code = String(body.code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the 6-digit code from the email.');
  const { data: result, error } = await v2.rpc('login_code_check', {
    p_session: who.session,
    p_user: who.profile.id,
    p_hash: await codeHash(who.session, code),
  });
  if (error) throw new HttpError(500, 'Could not check the code.');
  if (result === 'ok') return { verified: true };
  throw new HttpError(
    result === 'wrong' ? 400 : 410,
    {
      wrong: 'That code is not right. Check the latest email and try again.',
      expired: 'That code has expired. Send a new one.',
      locked: 'Too many wrong tries. Send a new code.',
      none: 'No code is waiting for this sign-in. Send a new one.',
    }[result as string] ?? 'Could not check the code.',
  );
}

// Sign in with an email code (no password). Supabase Auth makes the code (a magic-link OTP, so it
// works once and lasts Auth's email OTP expiry: 8 digits, 5 minutes on this project); we email it
// from the Sampadha mailbox.
async function request(body: Record<string, unknown>) {
  const identifier = String(body.identifier ?? '').trim();
  if (!identifier || identifier.length > 200)
    throw new HttpError(400, 'Enter your client ID, staff ID or email address.');
  if (!transport) throw new HttpError(503, 'Email is not set up on the server, so no code can be sent.');
  const answer = { requested: true };
  const { data: email } = await v2.rpc('resolve_login', { identifier });
  if (!email) return answer;
  const { data: profile } = await v2
    .from('profiles')
    .select('id, full_name, email')
    .eq('email', email)
    .eq('is_active', true)
    .maybeSingle();
  if (!profile) return answer;
  const { data: allowed, error } = await v2.rpc('login_email_send', { p_user: profile.id });
  if (error) throw new HttpError(500, 'Could not prepare a sign-in code.');
  if (allowed !== 'ok') return answer;
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: profile.email,
  });
  const code = link?.properties?.email_otp;
  if (linkError || !code) throw new HttpError(500, 'Could not prepare a sign-in code.');
  const subject = `${code} is your Sampadha sign-in code`;
  const text = `Hello ${profile.full_name},\n\nYour Sampadha sign-in code is ${code}. Enter it on the sign-in page; it works once and expires in 5 minutes.\n\nIf you did not ask to sign in, ignore this email: nobody can use the code without your mailbox.\n\nSampadha`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#13233a"><p>Hello ${profile.full_name.replace(/[&<>"]/g, '')},</p><p>Your Sampadha sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:8px 0 14px">${code}</p><p style="color:#5b6b80">Enter it on the sign-in page; it works once and expires in 5 minutes. If you did not ask to sign in, ignore this email: nobody can use the code without your mailbox.</p><p>Sampadha</p></div>`;
  try {
    await transport.sendMail({ from: FROM, to: { name: profile.full_name, address: profile.email }, subject, text, html });
  } catch (err) {
    console.error('email sign-in code not sent', err);
  }
  return answer;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === 'request') return reply(200, await request(body));
    const who = await caller(req);
    if (body.action === 'send') return reply(200, await send(who));
    if (body.action === 'verify') return reply(200, await verify(who, body));
    return reply(400, { error: 'Unknown action.' });
  } catch (error) {
    if (error instanceof HttpError) return reply(error.status, { error: error.message });
    console.error(error);
    return reply(500, { error: 'Sign-in code service error.' });
  }
});
