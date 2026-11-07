// Helpers for sending broker orders from a client's own Gmail (supabase/GMAIL-SEND.md). Used by the
// client-gmail and mailer functions.
//
// Nothing here reads the environment or the database: keys and tokens are passed in. Results of the
// Google calls never carry Google's response bodies, so callers cannot log a token by accident. The
// one thing taken from a body is the short reason code of a Gmail 403, which holds no token.
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TOKEN_TIMEOUT_MS = 15000;
const SEND_TIMEOUT_MS = 20000;
const REVOKE_TIMEOUT_MS = 10000;
const ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/; // same as v2_private.valid_email

type Fetcher = typeof fetch;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
const toBase64Url = (bytes: Uint8Array) =>
  toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const binaryToBytes = (binary: string) => Uint8Array.from(binary, (c) => c.charCodeAt(0));
function fromBase64Url(text: string) {
  const plain = text.replace(/-/g, '+').replace(/_/g, '/');
  return binaryToBytes(atob(plain.padEnd(Math.ceil(plain.length / 4) * 4, '=')));
}

// ───────────────────────── encryption and comparison ─────────────────────────

async function aesKey(keyBase64: string) {
  const raw = binaryToBytes(atob(keyBase64.trim()));
  if (raw.length !== 32) throw new Error('The token key must be base64 of 32 bytes.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// AES-256-GCM, stored as v1.<iv>.<cipher> in base64url. The cipher part includes the GCM tag.
export async function encryptToken(plain: string, keyBase64: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(keyBase64),
    encoder.encode(plain),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`;
}

export async function decryptToken(stored: string, keyBase64: string) {
  const [version, iv, cipher, ...extra] = stored.split('.');
  if (version !== 'v1' || !iv || !cipher || extra.length) {
    throw new Error('Unknown token format.');
  }
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(iv) },
    await aesKey(keyBase64),
    fromBase64Url(cipher),
  );
  return new TextDecoder().decode(plain);
}

export async function sha256Hex(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Takes the same time wherever the strings differ, so a guess cannot be improved byte by byte.
export function constantTimeEqual(a: string, b: string) {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let difference = x.length ^ y.length;
  for (let i = 0, n = Math.max(x.length, y.length); i < n; i++) {
    difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return difference === 0;
}

export const sameAddress = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();

export const randomState = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

// ───────────────────────── the email itself ─────────────────────────

// Line breaks and other control characters are what would let a value add a header of its own.
const headerValue = (value: string) => value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, '');

function address(value: string) {
  const clean = headerValue(value).trim();
  if (!ADDRESS.test(clean) || clean.length > 254) throw new Error('Not a valid email address.');
  return clean;
}

// ASCII passes through. Anything else (or text that would read as an encoded word) becomes RFC 2047
// encoded words of at most 75 characters, split between characters and folded onto new lines.
function encodedWords(text: string) {
  const words: string[] = [];
  let word = '';
  for (const character of text) {
    if (encoder.encode(word + character).length > 45) {
      words.push(word);
      word = '';
    }
    word += character;
  }
  words.push(word);
  return words.map((w) => `=?UTF-8?B?${toBase64(encoder.encode(w))}?=`).join('\r\n ');
}
const needsEncoding = (text: string) => /[^\x20-\x7e]|=\?/.test(text);
const headerText = (value: string) => {
  const clean = headerValue(value);
  return needsEncoding(clean) ? encodedWords(clean) : clean;
};
function mailbox(name: string, email: string) {
  const clean = headerValue(name).trim();
  if (!clean) return `<${email}>`;
  if (needsEncoding(clean)) return `${encodedWords(clean)} <${email}>`;
  return `"${clean.replace(/[\\"]/g, '\\$&')}" <${email}>`;
}

export type GmailMessage = {
  fromName: string;
  fromEmail: string;
  to: string;
  cc?: string[] | null;
  subject: string;
  body: string;
};

const normalBreaks = (text: string) => text.replace(/\r\n|\r/g, '\n');
const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Blank lines end a paragraph and single line breaks stay inside one.
export function plainToHtml(text: string) {
  return normalBreaks(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('');
}

// Base64 has no "-", so no encoded line can read as the boundary line.
function bodyPart(type: 'plain' | 'html', text: string) {
  const encoded = toBase64(encoder.encode(text.replace(/\n/g, '\r\n')));
  return [
    `Content-Type: text/${type}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    ...(encoded.match(/.{1,76}/g) ?? []),
  ];
}

// RFC 2822 message as base64url, for the `raw` field of messages.send. Throws on a bad address, so
// nothing can be sent to a recipient that was not meant. The text goes as plain and HTML versions of
// the same words, like the order emails that reach broker inboxes from Mahogha.
export function buildRawMessage(message: GmailMessage) {
  const from = mailbox(message.fromName, address(message.fromEmail));
  const to = address(message.to);
  const cc = (message.cc ?? []).map(address);
  const boundary = `0000000000${crypto.randomUUID().replace(/-/g, '')}`;
  const plain = normalBreaks(message.body);
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${headerText(message.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    ...bodyPart('plain', plain),
    `--${boundary}`,
    ...bodyPart('html', plainToHtml(plain)),
    `--${boundary}--`,
    '',
  ];
  return toBase64Url(encoder.encode(lines.join('\r\n')));
}

// ───────────────────────── Google sign-in ─────────────────────────

const postForm = (doFetch: Fetcher, url: string, fields: Record<string, string>, timeoutMs: number) =>
  doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(timeoutMs),
  });

export function googleAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  loginHint: string;
}) {
  const query = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    login_hint: input.loginHint,
    scope: `openid email ${GMAIL_SEND_SCOPE}`,
    state: input.state,
  });
  return `${AUTH_URL}?${query}`;
}

export type CodeResult =
  | { ok: true; accessToken: string | null; refreshToken: string | null; idToken: string | null; scope: string }
  | { ok: false };

export async function exchangeCode(
  input: { clientId: string; clientSecret: string; redirectUri: string; code: string },
  doFetch: Fetcher = fetch,
): Promise<CodeResult> {
  try {
    const res = await postForm(
      doFetch,
      TOKEN_URL,
      {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        code: input.code,
        grant_type: 'authorization_code',
      },
      TOKEN_TIMEOUT_MS,
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false };
    return {
      ok: true,
      accessToken: typeof body.access_token === 'string' ? body.access_token : null,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
      idToken: typeof body.id_token === 'string' ? body.id_token : null,
      scope: typeof body.scope === 'string' ? body.scope : '',
    };
  } catch {
    return { ok: false };
  }
}

export const scopeIncludes = (granted: string, scope: string) =>
  granted.split(/\s+/).includes(scope);

// The id_token came straight from Google's token endpoint over TLS, so it is decoded without
// checking its signature. Never use this on a token that arrived any other way.
export function idTokenEmail(idToken: string): { email: string; verified: boolean } | null {
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(idToken.split('.')[1] ?? '')));
    if (typeof claims.email !== 'string' || !claims.email) return null;
    return {
      email: claims.email.trim().toLowerCase(),
      verified: claims.email_verified === true || claims.email_verified === 'true',
    };
  } catch {
    return null;
  }
}

export type AccessResult = { ok: true; accessToken: string } | { ok: false; invalidGrant: boolean };

// A failure here means no access token, so nothing can have been sent.
export async function refreshAccessToken(
  input: { clientId: string; clientSecret: string; refreshToken: string },
  doFetch: Fetcher = fetch,
): Promise<AccessResult> {
  try {
    const res = await postForm(
      doFetch,
      TOKEN_URL,
      {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        refresh_token: input.refreshToken,
        grant_type: 'refresh_token',
      },
      TOKEN_TIMEOUT_MS,
    );
    const body = await res.json().catch(() => ({}));
    if (res.ok && typeof body.access_token === 'string' && body.access_token) {
      return { ok: true, accessToken: body.access_token };
    }
    return { ok: false, invalidGrant: body.error === 'invalid_grant' };
  } catch {
    return { ok: false, invalidGrant: false };
  }
}

// Revoking any token of a grant ends the whole grant at Google. Returns whether Google confirmed it.
export async function revokeToken(token: string, doFetch: Fetcher = fetch) {
  try {
    const res = await postForm(doFetch, REVOKE_URL, { token }, REVOKE_TIMEOUT_MS);
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

// ───────────────────────── sending ─────────────────────────

export type SendResult =
  | { outcome: 'sent'; id: string | null } // Gmail accepted it
  | { outcome: 'status'; status: number; reason?: string | null } // Gmail answered with an error
  | { outcome: 'unknown' }; // no answer (timeout or dropped connection): it may have been delivered

// Google's own code for a refusal, e.g. rateLimitExceeded. Null if the body has none.
async function refusalReason(res: Response) {
  const body = await res.json().catch(() => null);
  const reason = body?.error?.errors?.[0]?.reason;
  return typeof reason === 'string' && /^\w{1,64}$/.test(reason) ? reason : null;
}

// One attempt only. Whether to try again is the caller's decision.
export async function sendGmail(
  accessToken: string,
  raw: string,
  doFetch: Fetcher = fetch,
): Promise<SendResult> {
  let res: Response;
  try {
    res = await doFetch(SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    return { outcome: 'unknown' };
  }
  if (res.status === 403) return { outcome: 'status', status: 403, reason: await refusalReason(res) };
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { outcome: 'status', status: res.status };
  }
  // The 2xx status is the acceptance; losing the rest of the answer must not read as a failure.
  const body = await res.json().catch(() => ({}));
  return { outcome: 'sent', id: typeof body.id === 'string' ? body.id : null };
}
