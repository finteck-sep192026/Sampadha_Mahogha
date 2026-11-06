// Outbound mail for Sampadha v2: sends the rows the database queued in v2.email_log. Rows with
// send_via 'smtp' go over SMTP. Rows with send_via 'client_gmail' go only through the Gmail API from
// the client's own address, with no fallback (rules in supabase/GMAIL-SEND.md).
//
//   POST { action: 'flush' }   → sends what is queued, broker orders first, until the queue is empty or
//                                the run's time is up (any signed-in user; the browser calls it right
//                                after an action that queues mail). Returns { sent, failed, … }.
//   POST { action: 'status' }  → SMTP and Gmail set-up, the last scheduled run and the count of orders
//                                still waiting, for the Admin mail status panel.
//   POST { action: 'cron' }    → header x-cron-secret, no user token: records the heartbeat, settles
//                                rows stuck in 'Sending', retries failed Order alerts, flushes, then
//                                raises any order alert still missing.
//
// Secrets (Edge Functions → Secrets):
//   SMTP_HOST (e.g. smtp.hostinger.com), SMTP_USERNAME, SMTP_PASSWORD,
//   optional SMTP_PORT (465 = implicit TLS, the default; Supabase blocks outgoing 25 and 587),
//   optional MAIL_FROM (default SMTP_USERNAME), e.g. "Sampadha Research <research@sampadha.com>",
//   optional MAIL_REPLY_TO,
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_TOKEN_KEY, MAILER_CRON_SECRET.
// While SMTP is not set up, queued smtp rows are marked 'Simulated' (logged only), so nothing is sent
// late once it is. Broker rows are never simulated, and Order alerts stay 'Failed' where people can
// see them. Broker orders queued more than 30 minutes ago are marked 'Expired' instead of sent.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';
import {
  buildRawMessage,
  constantTimeEqual,
  decryptToken,
  refreshAccessToken,
  sameAddress,
  sendGmail,
} from '../_shared/gmail.ts';

const HOST = Deno.env.get('SMTP_HOST')?.trim();
const PORT = Number(Deno.env.get('SMTP_PORT') ?? 465);
const USERNAME = Deno.env.get('SMTP_USERNAME')?.trim();
const PASSWORD = Deno.env.get('SMTP_PASSWORD');
const FROM = Deno.env.get('MAIL_FROM')?.trim() || USERNAME;
const REPLY_TO = Deno.env.get('MAIL_REPLY_TO')?.trim() || undefined;
const CONFIGURED = Boolean(HOST && USERNAME && PASSWORD);
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')?.trim();
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')?.trim();
const GMAIL_TOKEN_KEY = Deno.env.get('GMAIL_TOKEN_KEY')?.trim();
const GMAIL_CONFIGURED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GMAIL_TOKEN_KEY);
const CRON_SECRET = Deno.env.get('MAILER_CRON_SECRET');
const PORTAL_URL = 'https://racrm.fintecindia.com';
// Only as many rows as go out together are claimed at once: if the function dies, few rows are left
// in 'Sending' with an unknown result. Gmail rows of a batch go in parallel, and nextIds() lets a batch
// hold only one row per client, so they are always different mailboxes.
const BATCH = 5;
// How far down the queue nextIds() looks for rows it may send.
const QUEUE_LOOKAHEAD = 200;
// No new send starts after this, so an ordinary run ends inside the schedule's 55 second request
// timeout, with room for 60 clients. The slowest Gmail send started just before it takes under a minute
// (15s token, 20s send, 2s wait, 20s retry), still well under the platform's 150 seconds. Rows left
// over stay Queued for the next run.
const RUN_LIMIT_MS = 45 * 1000;
const RETRY_WAIT_MS = 2000;
const STALE_SENDING_MS = 5 * 60 * 1000;
// A stuck smtp row older than this is not sent again: it may well have gone.
const RESEND_MAX_AGE_MS = 60 * 60 * 1000;
const BROKER_ORDER_MAX_AGE_MS = 30 * 60 * 1000;
const ORDER_ALERT_TRIES = 5;
// email_log has no claim-time column, and sent_at is the time the row was queued, so a claim writes its
// time here until the row settles. Stale rows are judged by this, not by how long they queued.
const CLAIMED = 'Claimed at ';

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
  send_via: string;
  client_id: string | null;
  attempts: number;
};
const MAIL_COLUMNS =
  'id, mail_ref, recipient_email, recipient_name, cc_emails, subject, mail_type, body, sent_at, send_via, client_id, attempts';

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const isBroker = (m: Pick<Mail, 'mail_type'>) => m.mail_type === 'Broker order' || m.mail_type === 'Broker test';
const isOrder = (m: Pick<Mail, 'mail_type'>) => m.mail_type === 'Broker order';
const isOrderAlert = (m: Pick<Mail, 'mail_type'>) => m.mail_type === 'Order alert';
const isViaGmail = (m: Pick<Mail, 'send_via'>) => m.send_via === 'client_gmail';
// SMTP only for a row that says smtp and is not broker mail. Anything else is refused, never guessed.
const mayUseSmtp = (m: Pick<Mail, 'mail_type' | 'send_via'>) => m.send_via === 'smtp' && !isBroker(m);
const isLateOrder = (m: Mail) =>
  isOrder(m) && Date.now() - Date.parse(m.sent_at) > BROKER_ORDER_MAX_AGE_MS;

// Client mails get a greeting and the portal link; broker mails are sent exactly as the database wrote them.
function text(m: Mail) {
  if (isBroker(m)) return m.body;
  return `Hello ${m.recipient_name || 'there'},\n\n${m.body}\n\nSign in: ${PORTAL_URL}\n\nRegards,\nSampadha Client Services\n\nReference: ${m.mail_ref}`;
}
const html = (m: Mail) =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2933"><pre style="font-family:inherit;white-space:pre-wrap;margin:0">${escapeHtml(text(m))}</pre></div>`;

async function setStatus(
  ids: string[],
  status: string,
  message: string | null = null,
  extra: Record<string, unknown> = {},
) {
  if (!ids.length) return;
  const { error } = await v2
    .from('email_log')
    .update({
      status,
      provider_message: message,
      delivered_at: status === 'Sent' ? new Date().toISOString() : null,
      ...extra,
    })
    .in('id', ids);
  // A row that could not be settled stays in 'Sending', and the stale check deals with it.
  if (error) console.error('mailer status', status, error.message);
}

// Tells the client and the report's author. If this fails, alerted_at stays empty and cron tries again.
async function alertOrder(id: string, reason: string) {
  const { error } = await v2.rpc('broker_mail_alert', {
    p_mail_id: id,
    p_reason: reason.replace(/\.+$/, ''), // the alert wording adds its own full stop
  });
  if (error) console.error('mailer alert', error.message);
}

type Outcome = { status: 'Sent' | 'Failed' | 'Expired'; message: string | null };
const failed = (message: string): Outcome => ({ status: 'Failed', message });
const TOO_LATE: Outcome = { status: 'Expired', message: 'Not sent: the order was more than 30 minutes old.' };
const deliveryUnknown = (what: string) =>
  `${what} It may or may not have been delivered. Check the client's Sent folder in Gmail before sending it again.`;
// Gmail 403 reasons: the first set is a limit, the second a real problem with the client's approval.
// A 403 with no readable reason counts as the second. Any other reason leaves the link alone.
const GMAIL_LIMIT_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded'];
const GMAIL_AUTH_REASONS = ['insufficientPermissions', 'authError', 'forbidden'];

type Sender = { name: string; address: string };

// The last word on whether this mail may leave, read fresh each time. Returns the reason if not; a
// failed read is a reason too, never a pass.
async function senderOrReason(m: Mail): Promise<Sender | string> {
  if (!m.client_id) return 'Not sent: the client is no longer on the portal.';
  const [profile, link, consent] = await Promise.all([
    v2.from('profiles').select('full_name, email, is_active').eq('id', m.client_id).maybeSingle(),
    v2.from('client_gmail_links').select('status, gmail_address').eq('client_id', m.client_id).maybeSingle(),
    v2.from('broker_email_consents').select('status, to_email, consented_at').eq('client_id', m.client_id).maybeSingle(),
  ]);
  if (profile.error || link.error || consent.error)
    return "Not sent: the client's consent and Gmail connection could not be checked.";
  if (!profile.data?.is_active) return "Not sent: the client's account is no longer active.";
  if (isOrder(m)) {
    if (consent.data?.status !== 'Active') return "Not sent: the client's broker consent is not Active.";
    if (!sameAddress(consent.data.to_email, m.recipient_email))
      return "Not sent: the client's broker address changed after this order was queued.";
    // Any change the client confirms (broker ID, CC, a new consent) renews this date. An order queued
    // before it was built on terms that no longer stand. A missing date is a stop too.
    if (!(Date.parse(consent.data.consented_at ?? '') <= Date.parse(m.sent_at)))
      return "Not sent: the client's consent changed after this order was queued.";
  }
  if (link.data?.status !== 'Connected') return "Not sent: the client's Gmail is not connected.";
  if (!sameAddress(link.data.gmail_address, profile.data?.email))
    return "Not sent: the connected Gmail is not the client's portal email.";
  return { name: profile.data!.full_name ?? '', address: link.data.gmail_address };
}

async function linkNeedsReconnect(clientId: string, reason: string, removeToken: boolean) {
  if (removeToken) {
    const { error } = await v2.from('client_gmail_tokens').delete().eq('client_id', clientId);
    if (error) console.error('mailer token', error.message);
  }
  const { error } = await v2
    .from('client_gmail_links')
    .update({ status: 'Reconnect needed', last_error: reason, updated_at: new Date().toISOString() })
    .eq('client_id', clientId);
  if (error) console.error('mailer link', error.message);
}

// Only ever calls the Gmail API. Every path out of here is an Outcome for this row: there is no
// other route for it, and no way back to the queue.
async function sendViaGmail(m: Mail): Promise<Outcome> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GMAIL_TOKEN_KEY)
    return failed('Not sent: Gmail sending is not set up on the server.');
  const checked = await senderOrReason(m);
  if (typeof checked === 'string') return failed(checked);
  const clientId = m.client_id!;

  const { data: stored, error } = await v2
    .from('client_gmail_tokens')
    .select('gmail_address, refresh_token_enc')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) return failed("Not sent: the client's Gmail connection could not be read.");
  if (!sameAddress(stored?.gmail_address, checked.address))
    return failed('Not sent: the client needs to connect their Gmail again.');
  let refreshToken: string;
  try {
    refreshToken = await decryptToken(stored!.refresh_token_enc, GMAIL_TOKEN_KEY);
  } catch {
    const reason = 'The stored Gmail connection could not be read. Connect Gmail again.';
    await linkNeedsReconnect(clientId, reason, false);
    return failed(`Not sent: ${reason}`);
  }

  const access = await refreshAccessToken({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    refreshToken,
  });
  if (!access.ok) {
    if (!access.invalidGrant) return failed("Not sent: Google did not give access to the client's Gmail.");
    const reason = 'Google no longer accepts this connection. Connect Gmail again.';
    await linkNeedsReconnect(clientId, reason, true);
    return failed(`Not sent: ${reason}`);
  }

  for (let attempt = 1; ; attempt++) {
    if (isLateOrder(m)) return TOO_LATE;
    const sender = await senderOrReason(m);
    if (typeof sender === 'string') return failed(sender);
    let raw: string;
    try {
      raw = buildRawMessage({
        fromName: sender.name,
        fromEmail: sender.address,
        to: m.recipient_email,
        cc: m.cc_emails,
        subject: m.subject,
        body: m.body,
      });
    } catch {
      return failed('Not sent: the To or Cc address, or the Gmail address, is not valid.');
    }

    const result = await sendGmail(access.accessToken, raw);
    if (result.outcome === 'sent') return { status: 'Sent', message: result.id ?? 'Accepted by Gmail.' };
    if (result.outcome === 'unknown') {
      console.error('mailer gmail', m.mail_ref, 'no answer from Gmail');
      return failed(deliveryUnknown('Gmail did not answer.'));
    }
    console.error('mailer gmail', m.mail_ref, result.status, result.reason ?? '');
    if (result.status === 429) {
      if (attempt === 1) {
        await new Promise((done) => setTimeout(done, RETRY_WAIT_MS));
        continue;
      }
      return failed('Not sent: Gmail was busy (HTTP 429) and refused it twice.');
    }
    if (result.status === 403 && GMAIL_LIMIT_REASONS.includes(result.reason ?? ''))
      return failed(`Not sent: this Gmail has reached a sending limit (${result.reason}).`);
    if (result.status === 403 && result.reason && !GMAIL_AUTH_REASONS.includes(result.reason))
      return failed(`Not sent: Gmail refused it (${result.reason}).`);
    if (result.status === 401 || result.status === 403) {
      const reason = `Gmail refused this connection (HTTP ${result.status}). Connect Gmail again.`;
      await linkNeedsReconnect(clientId, reason, false);
      return failed(result.status === 403 ? `Not sent: ${reason}` : deliveryUnknown(reason));
    }
    return failed(deliveryUnknown(`Gmail answered HTTP ${result.status}.`));
  }
}

type Tally = { sent: number; failed: number; expired: number; simulated: number };

async function settle(m: Mail, outcome: Outcome, tally: Tally) {
  await setStatus([m.id], outcome.status, outcome.message);
  if (outcome.status === 'Sent') {
    tally.sent++;
    const now = new Date().toISOString();
    const { error } = await v2
      .from('client_gmail_links')
      .update({ last_sent_at: now, last_error: null, updated_at: now })
      .eq('client_id', m.client_id);
    if (error) console.error('mailer link', error.message);
    return;
  }
  if (outcome.status === 'Expired') tally.expired++;
  else tally.failed++;
  if (isOrder(m)) await alertOrder(m.id, outcome.message!);
}

async function sendOverSmtp(m: Mail, tally: Tally) {
  if (!transport) {
    if (isOrderAlert(m)) {
      await setStatus([m.id], 'Failed', 'Not sent: mail sending is not set up (SMTP secrets).');
      tally.failed++;
      return;
    }
    await setStatus([m.id], 'Simulated', 'Mail sending is not set up (SMTP secrets).');
    tally.simulated++;
    return;
  }
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
    tally.sent++;
  } catch (err) {
    console.error('mailer', m.mail_ref, err);
    await setStatus(
      [m.id],
      'Failed',
      String((err as Error)?.message ?? err).slice(0, 300),
      isOrderAlert(m) ? { attempts: m.attempts + 1 } : {},
    );
    tally.failed++;
  }
}

// One row, start to finish. Never throws, so one bad row cannot stop the others.
async function sendOne(m: Mail, tally: Tally) {
  try {
    if (isLateOrder(m)) await settle(m, TOO_LATE, tally);
    else if (isViaGmail(m)) {
      const outcome = await sendViaGmail(m).catch((err): Outcome => {
        console.error('mailer gmail', m.mail_ref, (err as Error)?.name);
        return failed(deliveryUnknown('The send stopped with an error.'));
      });
      await settle(m, outcome, tally);
    } else if (mayUseSmtp(m)) await sendOverSmtp(m, tally);
    else await settle(m, failed("Not sent: broker mail goes only from the client's own Gmail."), tally);
  } catch (err) {
    console.error('mailer', m.mail_ref, (err as Error)?.name);
  }
}

type Waiting = Pick<Mail, 'id' | 'client_id' | 'send_via'>;

// The next rows to send: broker orders before anything else, oldest first. A client's Gmail rows go
// strictly one at a time, so a buy and its exit keep their order: one per batch, and none while a row
// of theirs is still 'Sending' in this or another run. The rest wait for a later batch.
async function nextIds() {
  const sending = await v2
    .from('email_log')
    .select('client_id')
    .eq('status', 'Sending')
    .eq('send_via', 'client_gmail');
  if (sending.error) throw sending.error;
  const busy = new Set((sending.data ?? []).map((r) => r.client_id));
  const pick = (rows: Waiting[]) => {
    const ids: string[] = [];
    for (const row of rows) {
      if (ids.length === BATCH) break;
      if (isViaGmail(row)) {
        if (busy.has(row.client_id)) continue;
        busy.add(row.client_id);
      }
      ids.push(row.id);
    }
    return ids;
  };
  const queued = () => v2.from('email_log').select('id, client_id, send_via').eq('status', 'Queued');
  const orders = await queued().eq('mail_type', 'Broker order').order('sent_at').limit(QUEUE_LOOKAHEAD);
  if (orders.error) throw orders.error;
  const ids = pick((orders.data ?? []) as Waiting[]);
  if (ids.length) return ids;
  const others = await queued().order('sent_at').limit(QUEUE_LOOKAHEAD);
  if (others.error) throw others.error;
  return pick((others.data ?? []) as Waiting[]);
}

async function flush() {
  const deadline = Date.now() + RUN_LIMIT_MS;
  const tally: Tally = { sent: 0, failed: 0, expired: 0, simulated: 0 };
  while (Date.now() < deadline) {
    const ids = await nextIds();
    if (!ids.length) break;

    // Claim the rows first, so two flushes running at once never send the same email twice.
    const { data: claimed, error: claimError } = await v2
      .from('email_log')
      .update({ status: 'Sending', provider_message: CLAIMED + new Date().toISOString() })
      .eq('status', 'Queued')
      .in('id', ids)
      .select(MAIL_COLUMNS);
    if (claimError) throw claimError;
    const mails = (claimed ?? []) as unknown as Mail[];

    await Promise.all(mails.filter(isViaGmail).map((m) => sendOne(m, tally)));
    const rest = mails.filter((m) => !isViaGmail(m));
    while (rest.length && Date.now() < deadline) await sendOne(rest.shift()!, tally);
    if (rest.length) {
      // No send was started for these, so they can safely wait for the next run.
      await v2
        .from('email_log')
        .update({ status: 'Queued', provider_message: null })
        .eq('status', 'Sending')
        .in('id', rest.map((m) => m.id));
    }
  }
  return { ...tally, configured: CONFIGURED };
}

type StuckRow = Pick<Mail, 'id' | 'mail_type' | 'send_via' | 'sent_at'> & { provider_message: string | null };

function claimedAt(row: StuckRow) {
  const note = row.provider_message ?? '';
  const stamped = note.startsWith(CLAIMED) ? Date.parse(note.slice(CLAIMED.length)) : NaN;
  return Number.isNaN(stamped) ? Date.parse(row.sent_at) : stamped;
}

// A run that stopped mid-send leaves rows in 'Sending'. SMTP mail is resent, unless it is over an hour
// old. A broker row may already be with the broker, so it is never put back: it fails, and people are
// told.
async function settleStale() {
  const { data, error } = await v2
    .from('email_log')
    .select('id, mail_type, send_via, sent_at, provider_message')
    .eq('status', 'Sending');
  if (error) throw error;
  const cutoff = Date.now() - STALE_SENDING_MS;
  const reason = deliveryUnknown('The send did not finish, so delivery is unknown.');
  const tooOld = 'The send did not finish and the mail is over an hour old, so it was not sent again.';
  let requeued = 0,
    marked = 0;
  for (const row of ((data ?? []) as StuckRow[]).filter((r) => claimedAt(r) < cutoff)) {
    const resend = mayUseSmtp(row) && Date.now() - Date.parse(row.sent_at) <= RESEND_MAX_AGE_MS;
    const change = resend
      ? { status: 'Queued', provider_message: null }
      : mayUseSmtp(row)
        ? { status: 'Failed', provider_message: tooOld, attempts: ORDER_ALERT_TRIES }
        : { status: 'Failed', provider_message: reason };
    const { data: changed, error: changeError } = await v2
      .from('email_log')
      .update(change)
      .eq('id', row.id)
      .eq('status', 'Sending')
      .select('id');
    if (changeError) console.error('mailer stale', changeError.message);
    if (!changed?.length) continue;
    if (resend) requeued++;
    else {
      marked++;
      if (isOrder(row)) await alertOrder(row.id, reason);
    }
  }
  return { requeued, marked };
}

// An Order alert that failed on SMTP tries again on each scheduled run, ORDER_ALERT_TRIES in all, then
// stays Failed. Without SMTP there is nothing to try with, so it stays Failed until there is.
async function retryOrderAlerts() {
  if (!transport) return;
  const { error } = await v2
    .from('email_log')
    .update({ status: 'Queued', provider_message: null })
    .eq('mail_type', 'Order alert')
    .eq('status', 'Failed')
    .lt('attempts', ORDER_ALERT_TRIES);
  if (error) console.error('mailer alert retry', error.message);
}

// Any failed or expired order nobody has been told about yet, however it got that way.
async function raiseMissedAlerts() {
  const { data, error } = await v2
    .from('email_log')
    .select('id, provider_message')
    .eq('mail_type', 'Broker order')
    .in('status', ['Failed', 'Expired'])
    .is('alerted_at', null)
    .order('sent_at')
    .limit(100);
  if (error) throw error;
  for (const row of data ?? []) {
    await alertOrder(row.id, row.provider_message ?? 'The order was not sent.');
  }
  return data?.length ?? 0;
}

// Written first, so a run that fails later still shows the schedule is alive; the count of orders
// still waiting in mailerStatus() shows the rest.
async function beat() {
  const { error } = await v2
    .from('mailer_heartbeat')
    .upsert({ id: true, last_cron_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) console.error('mailer heartbeat', error.message);
}

async function cron() {
  await beat();
  const stale = await settleStale();
  await retryOrderAlerts();
  const result = await flush();
  const alerted = await raiseMissedAlerts();
  return { ...result, staleRequeued: stale.requeued, staleFailed: stale.marked, alerted };
}

// What the Admin panel shows. A failed read comes back as nothing known, which the panel warns about.
async function mailerStatus() {
  const [heartbeat, waiting] = await Promise.all([
    v2.from('mailer_heartbeat').select('last_cron_at').eq('id', true).maybeSingle(),
    v2
      .from('email_log')
      .select('id', { count: 'exact', head: true })
      .eq('mail_type', 'Broker order')
      .in('status', ['Queued', 'Sending'])
      .lt('sent_at', new Date(Date.now() - STALE_SENDING_MS).toISOString()),
  ]);
  if (heartbeat.error) console.error('mailer status', heartbeat.error.message);
  if (waiting.error) console.error('mailer status', waiting.error.message);
  return {
    configured: CONFIGURED,
    host: HOST ?? null,
    port: PORT,
    from: FROM ?? null,
    gmailConfigured: GMAIL_CONFIGURED,
    cronSecretConfigured: Boolean(CRON_SECRET),
    lastCronAt: heartbeat.data?.last_cron_at ?? null,
    stuckBrokerOrders: waiting.error ? null : (waiting.count ?? 0),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === 'cron') {
      const given = req.headers.get('x-cron-secret');
      if (!CRON_SECRET || !given || !constantTimeEqual(given, CRON_SECRET))
        throw new HttpError(401, 'Not allowed.');
      return reply(200, await cron());
    }
    const profile = await caller(req);
    if (body.action === 'flush') return reply(200, await flush());
    if (body.action === 'status') {
      if (profile.role !== 'admin') throw new HttpError(403, 'Admin access required.');
      return reply(200, await mailerStatus());
    }
    return reply(400, { error: 'Unknown action.' });
  } catch (error) {
    if (error instanceof HttpError) return reply(error.status, { error: error.message });
    console.error(error);
    return reply(500, { error: 'Mail service error.' });
  }
});
