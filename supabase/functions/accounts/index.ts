// Sampadha v2 accounts: real logins for staff and approved clients (Admin only).
//
//   POST { action: 'invite', role: 'admin'|'ra'|'sales', fullName, email, mobile? }
//        → creates a staff login and emails a link to set the password.
//   POST { action: 'invite', role: 'client', applicationRef, plan, products: [...], multiTier? }
//        → creates the login for an approved client application, with its subscription, and emails
//          the client a link to set the password.
//   POST { action: 'resend', loginId }             → emails a fresh set-password link.
//   POST { action: 'set-active', loginId, active } → turns a person's portal access off or on.
//
// The set-password link is generated here (service role) and goes straight to the person by SMTP;
// it is never stored or shown to staff. Email uses the mailer's secrets: SMTP_HOST, SMTP_PORT,
// SMTP_USERNAME, SMTP_PASSWORD, MAIL_FROM. PORTAL_URL (optional) is where the link lands.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const PORTAL_URL = Deno.env.get('PORTAL_URL') ?? 'https://racrm.fintecindia.com/';
const HOST = Deno.env.get('SMTP_HOST')?.trim();
const PORT = Number(Deno.env.get('SMTP_PORT') ?? 465);
const USERNAME = Deno.env.get('SMTP_USERNAME')?.trim();
const PASSWORD = Deno.env.get('SMTP_PASSWORD');
const FROM = Deno.env.get('MAIL_FROM')?.trim() || USERNAME;
const STAFF_ROLES = ['admin', 'ra', 'sales'];
const PREFIX: Record<string, [string, number, number]> = {
  // role → [login ID prefix, first number, digits]
  admin: ['ADM', 1, 3],
  ra: ['RA', 1, 3],
  sales: ['SAL', 1, 3],
  client: ['CL', 1001, 4],
};
const PRODUCTS = ['Cash', 'Multi', 'All'];
const TIERS = ['Nano', 'Micro', 'Mini', 'Mega', 'Giga'];

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

const validEmail = (v: unknown) =>
  typeof v === 'string' && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v) && v.length <= 254;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

// The sign-in code (login-code function) must be done for this session, unless the session was
// opened from an emailed link: the same rule the database applies (migration 20261028010000).
async function signInCodeDone(token: string, userId: string) {
  const part = token.split('.')[1] ?? '';
  const claims = JSON.parse(
    atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')),
  );
  const viaEmail = ['otp', 'recovery', 'magiclink', 'invite', 'email/signup'];
  if ((claims.amr ?? []).some((a: { method?: string }) => viaEmail.includes(a.method ?? '')))
    return true;
  const { data } = await v2.rpc('login_session_verified', {
    p_session: claims.session_id,
    p_user: userId,
  });
  return data === true;
}

async function caller(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Sign in again.');
  if (!(await signInCodeDone(token, data.user.id)))
    throw new HttpError(401, 'Enter the sign-in code we emailed you, then try again.');
  const { data: profile } = await v2
    .from('profiles')
    .select('id, login_id, role, is_active')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile?.is_active || profile.role !== 'admin') throw new HttpError(403, 'Admin access required.');
  return profile;
}
type Caller = Awaited<ReturnType<typeof caller>>;

const audit = (who: Caller, action: string, ref: string, detail: Record<string, unknown>) =>
  v2.from('audit_log').insert({
    actor_id: who.id,
    actor_login: who.login_id,
    action,
    entity: 'account',
    entity_ref: ref,
    detail,
  });

async function nextLoginId(role: string) {
  const [prefix, first, digits] = PREFIX[role];
  const { data } = await v2.from('profiles').select('login_id').ilike('login_id', prefix + '-%');
  const used = (data ?? [])
    .map((r) => Number(String(r.login_id).slice(prefix.length + 1)))
    .filter((n) => Number.isInteger(n));
  return `${prefix}-${String(Math.max(first - 1, ...used) + 1).padStart(digits, '0')}`;
}

// The auth user for this email: a new one, or the existing one (an email can already have a login
// from the older portal, which shares sign-in).
async function authUser(email: string, fullName: string) {
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.data.user) return { id: created.data.user.id, isNew: true };
  const existing = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (existing.data?.user) return { id: existing.data.user.id, isNew: false };
  throw new HttpError(500, 'Could not create the login: ' + (created.error?.message ?? 'unknown error'));
}

async function sendSetPasswordLink(profile: { id: string; login_id: string; role: string; full_name: string; email: string }, kind: 'invite' | 'reset', who: Caller) {
  if (!transport) throw new HttpError(503, 'Email sending is not set up, so the link could not be sent.');
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: profile.email,
    options: { redirectTo: PORTAL_URL },
  });
  const link = data?.properties?.action_link;
  if (error || !link) throw new HttpError(500, 'Could not create the set-password link.');
  const subject = kind === 'invite' ? 'Your Sampadha portal account' : 'Set a new password for the Sampadha portal';
  const intro =
    kind === 'invite'
      ? `An account has been created for you on the Sampadha portal.`
      : `A new link to set your Sampadha portal password was requested for you.`;
  const text = `Hello ${profile.full_name},\n\n${intro}\n\nYour login ID: ${profile.login_id}\n\nSet your password here (the link works once and expires in an hour):\n${link}\n\nThen sign in at ${PORTAL_URL} with your login ID or this email address.\n\nIf you were not expecting this email, ignore it.\n\nSampadha`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#13233a"><p>Hello ${esc(profile.full_name)},</p><p>${esc(intro)}</p><p>Your login ID: <b>${esc(profile.login_id)}</b></p><p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;background:#1556d0;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Set your password</a></p><p style="color:#5b6b80">The link works once and expires in an hour. Then sign in at ${esc(PORTAL_URL)} with your login ID or this email address.</p><p style="color:#5b6b80">If you were not expecting this email, ignore it.</p><p>Sampadha</p></div>`;
  const ref = 'MAIL-' + crypto.randomUUID().slice(0, 8).toUpperCase();
  let status = 'Sent',
    note: string | null = null;
  try {
    const info = await transport.sendMail({ from: FROM, to: { name: profile.full_name, address: profile.email }, subject, text, html, headers: { 'X-Sampadha-Ref': ref } });
    note = String(info.response ?? '').slice(0, 300) || null;
  } catch (err) {
    status = 'Failed';
    note = String((err as Error)?.message ?? err).slice(0, 300);
  }
  await v2.from('email_log').insert({
    mail_ref: ref,
    recipient_id: profile.id,
    client_id: profile.role === 'client' ? profile.id : null,
    recipient_email: profile.email,
    recipient_name: profile.full_name,
    subject,
    mail_type: kind === 'invite' ? 'Account invitation' : 'Password link',
    body: `${intro} Login ID ${profile.login_id}. A one-time set-password link was emailed; the link itself is not stored.`,
    status,
    provider_message: note,
    delivered_at: status === 'Sent' ? new Date().toISOString() : null,
    created_by: who.id,
  });
  if (status !== 'Sent') throw new HttpError(502, 'The account is ready but the email failed: ' + note);
}

async function invite(who: Caller, body: Record<string, unknown>) {
  const role = String(body.role ?? '');
  if (!PREFIX[role]) throw new HttpError(400, 'Choose a role.');
  let fullName = String(body.fullName ?? '').trim(),
    email = String(body.email ?? '').trim().toLowerCase(),
    mobile = String(body.mobile ?? '').trim() || null,
    pan: string | null = null,
    risk: string | null = null,
    application: Record<string, unknown> | null = null,
    subscription: Record<string, unknown> | null = null;

  if (role === 'client') {
    const ref = String(body.applicationRef ?? '');
    const { data: app } = await v2.from('client_applications').select('*').eq('app_ref', ref).maybeSingle();
    if (!app) throw new HttpError(404, 'Application not found.');
    if (app.status !== 'Approved') throw new HttpError(409, 'Approve the application first.');
    if (app.client_id) throw new HttpError(409, 'This client already has a login.');
    application = app;
    fullName = app.full_name;
    email = String(app.email).toLowerCase();
    mobile = app.mobile;
    pan = app.pan;
    risk = app.risk_profile;
    const plan = String(body.plan ?? '');
    const { data: planRow } = await v2.from('plans').select('code').eq('code', plan).maybeSingle();
    if (!planRow) throw new HttpError(400, 'Choose a plan.');
    const products = Array.isArray(body.products) ? body.products.map(String).filter((p) => PRODUCTS.includes(p)) : [];
    if (!products.length) throw new HttpError(400, 'Choose at least one product.');
    const tier = body.multiTier ? String(body.multiTier) : null;
    if ((products.includes('Multi') || products.includes('All')) && !TIERS.includes(tier ?? ''))
      throw new HttpError(400, 'Choose the Multi tier.');
    const start = new Date();
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    subscription = {
      plan_code: plan,
      products,
      multi_tier: tier,
      billing: body.billing === 'Annual' ? 'Annual' : 'Quarterly',
      starts_on: start.toISOString().slice(0, 10),
      ends_on: end.toISOString().slice(0, 10),
      status: 'Active',
    };
  } else if (!STAFF_ROLES.includes(role)) {
    throw new HttpError(400, 'Choose a role.');
  }
  if (fullName.length < 2 || fullName.length > 120) throw new HttpError(400, 'Enter the full name.');
  if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');

  const { data: clash } = await v2.from('profiles').select('login_id').ilike('email', email).maybeSingle();
  if (clash) throw new HttpError(409, `This email already has an account (${clash.login_id}).`);

  const user = await authUser(email, fullName);
  const loginId = await nextLoginId(role);
  const profile = {
    id: user.id,
    login_id: loginId,
    role,
    full_name: fullName,
    initials: initials(fullName),
    email,
    mobile,
    pan,
    risk_profile: risk,
    kyc_status: role === 'client' ? 'Pending' : 'Employee verified',
    is_active: true,
  };
  const { error: profileError } = await v2.from('profiles').insert(profile);
  if (profileError) {
    if (user.isNew) await admin.auth.admin.deleteUser(user.id);
    throw new HttpError(500, 'Could not save the account: ' + profileError.message);
  }
  if (subscription) {
    await v2.from('subscriptions').insert({ client_id: user.id, ...subscription });
    await v2.from('client_applications').update({ client_id: user.id }).eq('id', application!.id);
  }
  await audit(who, 'account.created', loginId, { role, email, application: application?.app_ref ?? null });
  await sendSetPasswordLink(profile, 'invite', who);
  return { loginId, email };
}

async function profileByLogin(loginId: unknown) {
  const { data } = await v2
    .from('profiles')
    .select('id, login_id, role, full_name, email, is_active')
    .ilike('login_id', String(loginId ?? ''))
    .maybeSingle();
  if (!data) throw new HttpError(404, 'Account not found.');
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const who = await caller(req);
    const body = await req.json().catch(() => ({}));
    if (body.action === 'invite') return reply(200, await invite(who, body));
    if (body.action === 'resend') {
      const p = await profileByLogin(body.loginId);
      if (!p.is_active) throw new HttpError(409, 'Turn access back on first.');
      await sendSetPasswordLink(p, 'reset', who);
      await audit(who, 'account.link_sent', p.login_id, {});
      return reply(200, { loginId: p.login_id, email: p.email });
    }
    if (body.action === 'set-active') {
      const p = await profileByLogin(body.loginId);
      if (p.id === who.id) throw new HttpError(409, 'You cannot turn off your own access.');
      const active = body.active === true;
      await v2.from('profiles').update({ is_active: active }).eq('id', p.id);
      await audit(who, active ? 'account.enabled' : 'account.disabled', p.login_id, {});
      return reply(200, { loginId: p.login_id, active });
    }
    return reply(400, { error: 'Unknown action.' });
  } catch (error) {
    if (error instanceof HttpError) return reply(error.status, { error: error.message });
    console.error(error);
    return reply(500, { error: 'Account service error.' });
  }
});
