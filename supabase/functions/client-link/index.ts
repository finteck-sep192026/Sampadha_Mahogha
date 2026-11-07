// Sampadha v2: the client's one link.
//
//   GET ?t=<token>  (no sign-in; the site's /client-access forwards here)
//        → while the client has something to accept, signs them in and sends them to the portal,
//          which opens their consent page. Otherwise, or if the link has expired, goes to the
//          sign-in page. The sign-in link is made fresh on each click, so an email scanner
//          opening the link first cannot use it up.
//   POST { action: 'send', loginId }  (Admin or Sales)
//        → emails the client a new link, replacing any earlier one.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';
import { sendClientLink, sha256 } from '../_shared/client-link.ts';

const PORTAL_URL = Deno.env.get('PORTAL_URL') ?? 'https://racrm.fintecindia.com/';
const HOST = Deno.env.get('SMTP_HOST')?.trim();
const PORT = Number(Deno.env.get('SMTP_PORT') ?? 465);
const USERNAME = Deno.env.get('SMTP_USERNAME')?.trim();
const PASSWORD = Deno.env.get('SMTP_PASSWORD');
const FROM = Deno.env.get('MAIL_FROM')?.trim() || USERNAME;

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
const goTo = (url: string) =>
  new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });

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

async function hasSomethingToAccept(clientId: string) {
  const [{ data: app }, { data: consent }, { data: gmail }] = await Promise.all([
    v2.from('client_applications').select('pdf_path, details_accepted_at').eq('client_id', clientId).maybeSingle(),
    v2.from('broker_email_consents').select('status').eq('client_id', clientId).maybeSingle(),
    v2.from('client_gmail_links').select('status').eq('client_id', clientId).maybeSingle(),
  ]);
  if (app && !app.details_accepted_at) return true;
  return Boolean(consent && (consent.status !== 'Active' || gmail?.status !== 'Connected'));
}

async function open(url: URL) {
  const expired = PORTAL_URL + '?link=expired';
  const token = url.searchParams.get('t') ?? '';
  if (!/^[0-9a-f]{64}$/.test(token)) return goTo(expired);
  const { data: row } = await v2
    .from('client_access_links')
    .select('client_id, expires_at')
    .eq('token_hash', await sha256(token))
    .maybeSingle();
  if (!row || new Date(row.expires_at) < new Date()) return goTo(expired);
  const { data: client } = await v2
    .from('profiles')
    .select('id, login_id, email, is_active, role')
    .eq('id', row.client_id)
    .maybeSingle();
  if (!client?.is_active || client.role !== 'client') return goTo(expired);
  if (!(await hasSomethingToAccept(client.id))) return goTo(PORTAL_URL);
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: client.email,
    options: { redirectTo: PORTAL_URL },
  });
  const link = data?.properties?.action_link;
  if (error || !link) return goTo(expired);
  await v2
    .from('client_access_links')
    .update({ last_opened_at: new Date().toISOString() })
    .eq('client_id', client.id);
  return goTo(link);
}

async function staff(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const part = token.split('.')[1] ?? '';
  const claims = JSON.parse(
    atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')),
  );
  const viaEmail = ['otp', 'recovery', 'magiclink', 'invite', 'email/signup'];
  const verified =
    (claims.amr ?? []).some((a: { method?: string }) => viaEmail.includes(a.method ?? '')) ||
    (await v2.rpc('login_session_verified', { p_session: claims.session_id, p_user: data.user.id })).data === true;
  if (!verified) return null;
  const { data: profile } = await v2
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', data.user.id)
    .maybeSingle();
  return profile?.is_active && ['admin', 'sales'].includes(profile.role) ? profile : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method === 'GET') return await open(new URL(req.url));
    const who = await staff(req);
    if (!who) return reply(403, { error: 'Sales or Admin access required.' });
    const body = await req.json().catch(() => ({}));
    if (body.action !== 'send') return reply(400, { error: 'Unknown action.' });
    const { data: client } = await v2
      .from('profiles')
      .select('id, login_id, full_name, email, role, is_active')
      .ilike('login_id', String(body.loginId ?? ''))
      .maybeSingle();
    if (!client || client.role !== 'client') return reply(404, { error: 'Client not found.' });
    if (!client.is_active) return reply(409, { error: 'This client has no active access.' });
    await sendClientLink(
      { admin, v2, transport, from: FROM, portalUrl: PORTAL_URL },
      client,
      who.id,
    );
    return reply(200, { ok: true });
  } catch (error) {
    console.error('client-link', error);
    if (req.method === 'GET') return goTo(PORTAL_URL + '?link=expired');
    return reply(500, { error: (error as Error).message });
  }
});
