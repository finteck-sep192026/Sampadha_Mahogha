// Connects a client's own Gmail, so broker orders go from their address (supabase/GMAIL-SEND.md).
//
//   POST { action: 'start' }       (the client) → { url } of Google's approval page.
//   GET  ?code&state               Google's redirect. Carries no Supabase token, so everything rests on
//                                  the single-use state. Always redirects to PORTAL_URL/?gmail=<result>.
//   POST { action: 'disconnect' }  (the client) → revokes at Google, deletes the token, withdraws the
//                                  broker consent.
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GMAIL_TOKEN_KEY (base64 of 32
// random bytes), optional PORTAL_URL. Deploy with --no-verify-jwt; this function checks callers itself.
// Refresh tokens leave Google only into v2.client_gmail_tokens, encrypted. Never log a token, a code or
// anything Google sends back, and never put them or an email address in a redirect.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  decryptToken,
  encryptToken,
  exchangeCode,
  GMAIL_SEND_SCOPE,
  googleAuthUrl,
  idTokenEmail,
  randomState,
  revokeToken,
  sameAddress,
  scopeIncludes,
  sha256Hex,
} from '../_shared/gmail.ts';

const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')?.trim();
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')?.trim();
const REDIRECT_URI = Deno.env.get('GOOGLE_REDIRECT_URI')?.trim();
const TOKEN_KEY = Deno.env.get('GMAIL_TOKEN_KEY')?.trim();
const PORTAL_URL = (Deno.env.get('PORTAL_URL')?.trim() || 'https://racrm.fintecindia.com').replace(/\/+$/, '');
const STATE_LIFE_MS = 10 * 60 * 1000;

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
    .select('id, login_id, role, email, is_active')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile?.is_active) throw new HttpError(403, 'This account is not active.');
  if (profile.role !== 'client') throw new HttpError(403, 'Only the client can connect their own Gmail.');
  return profile;
}

const audit = (who: { id: string; login_id: string }, action: string, detail: Record<string, unknown>) =>
  v2.from('audit_log').insert({
    actor_id: who.id,
    actor_login: who.login_id,
    action,
    entity: 'client_gmail',
    entity_ref: who.login_id,
    detail,
  });

async function start(who: Awaited<ReturnType<typeof caller>>) {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !TOKEN_KEY)
    throw new HttpError(503, 'Gmail connection is not set up on the server yet.');
  const state = randomState();
  await v2.from('gmail_oauth_states').delete().lt('expires_at', new Date().toISOString());
  const { error } = await v2.from('gmail_oauth_states').insert({
    state_hash: await sha256Hex(state),
    client_id: who.id,
    expires_at: new Date(Date.now() + STATE_LIFE_MS).toISOString(),
  });
  if (error) throw error;
  return {
    url: googleAuthUrl({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      state,
      loginHint: who.email,
    }),
  };
}

// Deleting and reading in one statement means a state can be taken once, even by two requests at once.
async function takeState(state: string) {
  const { data, error } = await v2
    .from('gmail_oauth_states')
    .delete()
    .eq('state_hash', await sha256Hex(state))
    .select('client_id, expires_at')
    .maybeSingle();
  if (error) throw error;
  if (!data || !(Date.parse(data.expires_at) > Date.now())) return null;
  return data.client_id as string;
}

type ConnectResult = 'connected' | 'mismatch' | 'denied' | 'failed';

// If this cannot be read, the answer is yes: a grant left in place harms nobody, a revoked one might.
async function addressInUse(address: string) {
  const { data, error } = await v2
    .from('client_gmail_links')
    .select('client_id')
    .eq('gmail_address', address)
    .eq('status', 'Connected')
    .limit(1);
  return Boolean(error || data?.length);
}

async function connect(url: URL): Promise<ConnectResult> {
  const state = url.searchParams.get('state');
  if (!state) return 'failed';
  const clientId = await takeState(state);
  if (!clientId) return 'failed';
  if (url.searchParams.get('error')) return 'denied';
  const code = url.searchParams.get('code');
  if (!code || !CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !TOKEN_KEY) return 'failed';

  const tokens = await exchangeCode({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    code,
  });
  if (!tokens.ok) return 'failed';
  const identity = tokens.idToken ? idTokenEmail(tokens.idToken) : null;
  // From here Google has granted something: anything but success takes it back. Revoking ends the whole
  // grant of that Google account, so an address that is working for a client is left alone: otherwise
  // one client could end another's connection by signing in with their Gmail. The new token is simply
  // not stored.
  const undo = async (result: ConnectResult) => {
    const token = tokens.refreshToken ?? tokens.accessToken;
    if (token && !(identity && (await addressInUse(identity.email)))) await revokeToken(token);
    return result;
  };

  try {
    const { data: profile, error } = await v2
      .from('profiles')
      .select('id, login_id, role, email, is_active')
      .eq('id', clientId)
      .maybeSingle();
    if (error || !profile?.is_active || profile.role !== 'client') return await undo('failed');
    if (!scopeIncludes(tokens.scope, GMAIL_SEND_SCOPE)) return await undo('denied');
    if (!identity || !tokens.refreshToken) return await undo('failed');
    if (!identity.verified || !sameAddress(identity.email, profile.email)) return await undo('mismatch');

    const now = new Date().toISOString();
    const { error: tokenError } = await v2.from('client_gmail_tokens').upsert(
      {
        client_id: clientId,
        gmail_address: identity.email,
        refresh_token_enc: await encryptToken(tokens.refreshToken, TOKEN_KEY),
        scope: tokens.scope,
        updated_at: now,
      },
      { onConflict: 'client_id' },
    );
    if (tokenError) return await undo('failed');
    const { error: linkError } = await v2.from('client_gmail_links').upsert(
      {
        client_id: clientId,
        gmail_address: identity.email,
        status: 'Connected',
        connected_at: now,
        disconnected_at: null,
        last_error: null,
        updated_at: now,
      },
      { onConflict: 'client_id' },
    );
    if (linkError) {
      await v2.from('client_gmail_tokens').delete().eq('client_id', clientId);
      return await undo('failed');
    }
    await audit(profile, 'client_gmail.connected', { gmail_address: identity.email });
    return 'connected';
  } catch (error) {
    console.error('client-gmail connect', (error as Error)?.name);
    return await undo('failed');
  }
}

// Only the result goes in the URL.
async function googleRedirect(req: Request) {
  const result = await connect(new URL(req.url)).catch((error): ConnectResult => {
    console.error('client-gmail redirect', (error as Error)?.name);
    return 'failed';
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${PORTAL_URL}/?gmail=${result}`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

// The link and consent change first, so an order about to go out fails its last check even if Google
// is slow to answer. A failed revoke does not stop the disconnect: the token is deleted here anyway.
async function disconnect(who: Awaited<ReturnType<typeof caller>>) {
  const { data: stored, error: readError } = await v2
    .from('client_gmail_tokens')
    .select('refresh_token_enc')
    .eq('client_id', who.id)
    .maybeSingle();
  if (readError) throw readError;

  const now = new Date().toISOString();
  const { error: linkError } = await v2
    .from('client_gmail_links')
    .update({ status: 'Disconnected', disconnected_at: now, last_error: null, updated_at: now })
    .eq('client_id', who.id);
  if (linkError) throw linkError;
  const { error: consentError } = await v2
    .from('broker_email_consents')
    .update({ status: 'Revoked', revoked_at: now, updated_by: who.id, updated_at: now })
    .eq('client_id', who.id)
    .in('status', ['Active', 'Pending']);
  if (consentError) throw consentError;
  const { error: deleteError } = await v2.from('client_gmail_tokens').delete().eq('client_id', who.id);
  if (deleteError) throw deleteError;

  let revoked = false;
  if (stored && TOKEN_KEY) {
    try {
      revoked = await revokeToken(await decryptToken(stored.refresh_token_enc, TOKEN_KEY));
    } catch (error) {
      console.error('client-gmail disconnect', (error as Error)?.name);
    }
  }
  await audit(who, 'client_gmail.disconnected', { revoked_at_google: revoked });
  return { status: 'Disconnected', revokedAtGoogle: revoked };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET') return await googleRedirect(req);
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const who = await caller(req);
    const body = await req.json().catch(() => ({}));
    if (body.action === 'start') return reply(200, await start(who));
    if (body.action === 'disconnect') return reply(200, await disconnect(who));
    return reply(400, { error: 'Unknown action.' });
  } catch (error) {
    if (error instanceof HttpError) return reply(error.status, { error: error.message });
    console.error('client-gmail', (error as Error)?.message);
    return reply(500, { error: 'Gmail service error.' });
  }
});
