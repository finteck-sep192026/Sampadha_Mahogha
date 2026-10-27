// Outbound mail for Sampadha v2: sends the rows the database queued in v2.email_log over SMTP.
//
//   POST { action: 'flush' }   → sends up to 25 queued emails (any signed-in user; the browser calls it
//                                right after an action that queues mail). Returns { sent, failed, … }.
//   POST { action: 'status' }  → { configured, host, from } for the Admin Email delivery page.
//
// Secrets (Edge Functions → Secrets):
//   SMTP_HOST (e.g. smtp.hostinger.com), SMTP_USERNAME, SMTP_PASSWORD,
//   optional SMTP_PORT (465 = implicit TLS, the default; Supabase blocks outgoing 25 and 587),
//   optional MAIL_FROM (default SMTP_USERNAME), e.g. "Sampadha Research <research@sampadha.com>",
//   optional MAIL_REPLY_TO.
// While SMTP is not set up, queued rows are marked 'Simulated' (logged only), so nothing is sent late
// once it is. Broker orders queued more than 30 minutes ago are marked 'Expired' instead of sent.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const HOST = Deno.env.get('SMTP_HOST')?.trim();
const PORT = Number(Deno.env.get('SMTP_PORT') ?? 465);
const USERNAME = Deno.env.get('SMTP_USERNAME')?.trim();
const PASSWORD = Deno.env.get('SMTP_PASSWORD');
const FROM = Deno.env.get('MAIL_FROM')?.trim() || USERNAME;
const REPLY_TO = Deno.env.get('MAIL_REPLY_TO')?.trim() || undefined;
const CONFIGURED = Boolean(HOST && USERNAME && PASSWORD);
const PORTAL_URL = 'https://racrm.fintecindia.com';
const BATCH = 25;
const BROKER_ORDER_MAX_AGE_MS = 30 * 60 * 1000;

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

const transport = CONFIGURED
  ? nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465,
      auth: { user: USERNAME, pass: PASSWORD },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    })
  : null;

async function caller(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Sign in again.');
  const { data: profile } = await v2
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile?.is_active) throw new HttpError(403, 'This account is not active.');
  return profile;
}

type Mail = {
  id: string;
  mail_ref: string;
  recipient_email: string;
  recipient_name: string | null;
  cc_emails: string[] | null;
  subject: string;
  mail_type: string;
  body: string;
  sent_at: string;
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const isBroker = (m: Mail) => m.mail_type === 'Broker order' || m.mail_type === 'Broker test';

// Client mails get a greeting and the portal link; broker mails are sent exactly as the database wrote them.
function text(m: Mail) {
  if (isBroker(m)) return m.body;
  return `Hello ${m.recipient_name || 'there'},\n\n${m.body}\n\nSign in: ${PORTAL_URL}\n\nRegards,\nSampadha Client Services\n\nReference: ${m.mail_ref}`;
}
const html = (m: Mail) =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2933"><pre style="font-family:inherit;white-space:pre-wrap;margin:0">${escapeHtml(text(m))}</pre></div>`;

async function setStatus(ids: string[], status: string, message: string | null = null) {
  if (!ids.length) return;
  await v2
    .from('email_log')
    .update({
      status,
      provider_message: message,
      delivered_at: status === 'Sent' ? new Date().toISOString() : null,
    })
    .in('id', ids);
}

async function flush() {
  const { data: queued, error } = await v2
    .from('email_log')
    .select('id')
    .eq('status', 'Queued')
    .order('sent_at')
    .limit(BATCH);
  if (error) throw error;
  if (!queued?.length) return { sent: 0, failed: 0, expired: 0, simulated: 0, configured: CONFIGURED };

  // Claim the rows first, so two flushes running at once never send the same email twice.
  const { data: claimed, error: claimError } = await v2
    .from('email_log')
    .update({ status: 'Sending' })
    .eq('status', 'Queued')
    .in('id', queued.map((r) => r.id))
    .select('id, mail_ref, recipient_email, recipient_name, cc_emails, subject, mail_type, body, sent_at');
  if (claimError) throw claimError;
  const mails = (claimed ?? []) as Mail[];

  if (!transport) {
    await setStatus(mails.map((m) => m.id), 'Simulated', 'Mail sending is not set up (SMTP secrets).');
    return { sent: 0, failed: 0, expired: 0, simulated: mails.length, configured: false };
  }

  const now = Date.now();
  const expired = mails.filter(
    (m) => m.mail_type === 'Broker order' && now - Date.parse(m.sent_at) > BROKER_ORDER_MAX_AGE_MS,
  );
  await setStatus(expired.map((m) => m.id), 'Expired', 'Not sent: the order was more than 30 minutes old.');

  let sent = 0,
    failed = 0;
  for (const m of mails.filter((x) => !expired.includes(x))) {
    try {
      const info = await transport.sendMail({
        from: FROM,
        replyTo: REPLY_TO,
        to: m.recipient_name && !isBroker(m)
          ? { name: m.recipient_name, address: m.recipient_email }
          : m.recipient_email,
        cc: m.cc_emails?.length ? m.cc_emails : undefined,
        subject: m.subject,
        text: text(m),
        html: html(m),
        headers: { 'X-Sampadha-Ref': m.mail_ref },
      });
      await setStatus([m.id], 'Sent', String(info.response ?? '').slice(0, 300) || null);
      sent++;
    } catch (err) {
      console.error('mailer', m.mail_ref, err);
      await setStatus([m.id], 'Failed', String((err as Error)?.message ?? err).slice(0, 300));
      failed++;
    }
  }
  return { sent, failed, expired: expired.length, simulated: 0, configured: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const profile = await caller(req);
    const body = await req.json().catch(() => ({}));
    if (body.action === 'flush') return reply(200, await flush());
    if (body.action === 'status') {
      if (profile.role !== 'admin') throw new HttpError(403, 'Admin access required.');
      return reply(200, { configured: CONFIGURED, host: HOST ?? null, port: PORT, from: FROM ?? null });
    }
    return reply(400, { error: 'Unknown action.' });
  } catch (error) {
    if (error instanceof HttpError) return reply(error.status, { error: error.message });
    console.error(error);
    return reply(500, { error: 'Mail service error.' });
  }
});
