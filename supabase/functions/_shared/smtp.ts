// Two portal senders over one SMTP host (Edge Functions → Secrets):
//
//   kyc       client onboarding and account mail: sign-in codes, set-password and client links,
//             application received, approval or decision, documents to sign, consent requests.
//             SMTP_KYC_USERNAME, SMTP_KYC_PASSWORD, optional MAIL_FROM_KYC,
//             e.g. "Sampadha KYC <kyc@sampadha.com>" or just the name "Sampadha KYC".
//   research  recommendation mail: research reports, order alerts, test emails.
//             SMTP_RESEARCH_USERNAME, SMTP_RESEARCH_PASSWORD, optional MAIL_FROM_RESEARCH,
//             e.g. "Sampadha Research <research@sampadha.com>".
//
// Shared: SMTP_HOST (e.g. smtp.gmail.com), optional SMTP_PORT (465 = implicit TLS, the default;
// Supabase blocks outgoing 25 and 587). For Google Workspace mailboxes the password is an app
// password of that mailbox, and the From address must be that mailbox (or one of its aliases).
//
// A sender whose own USERNAME/PASSWORD are not set falls back to the older single-sender secrets
// SMTP_USERNAME, SMTP_PASSWORD and MAIL_FROM, so nothing stops sending while they are being moved.
import nodemailer from 'npm:nodemailer@6.9.16';

export type SenderKind = 'kyc' | 'research';
// deno-lint-ignore no-explicit-any
export type Sender = { transport: any; from: string; user: string };

const HOST = Deno.env.get('SMTP_HOST')?.trim() || undefined;
const PORT = Number(Deno.env.get('SMTP_PORT') ?? 465);
const env = (name: string) => Deno.env.get(name)?.trim() || undefined;

// Mail types the database queues in v2.email_log that belong to client onboarding. Every other
// type (Research report, Order alert, Test email, …) goes from the research mailbox.
const KYC_MAIL_TYPES = new Set([
  'Submission confirmation',
  'Approval confirmation',
  'Decision notification',
  'Document to sign',
  'Consent request',
  'Subscription',
]);

const cache = new Map<SenderKind, Sender | null>();

function build(kind: SenderKind): Sender | null {
  const k = kind.toUpperCase();
  const ownUser = env(`SMTP_${k}_USERNAME`);
  const ownPass = Deno.env.get(`SMTP_${k}_PASSWORD`) || undefined;
  const own = Boolean(ownUser && ownPass);
  const user = own ? ownUser : env('SMTP_USERNAME');
  const pass = own ? ownPass : Deno.env.get('SMTP_PASSWORD') || undefined;
  if (!HOST || !user || !pass) return null;
  // MAIL_FROM_<KIND> may be a full "Name <address>" or just a display name, which then sends from
  // the mailbox it signs in as.
  const fromSetting = env(`MAIL_FROM_${k}`);
  const from = fromSetting
    ? fromSetting.includes('@')
      ? fromSetting
      : `"${fromSetting.replace(/["\\]/g, '')}" <${user}>`
    : own
      ? user
      : (env('MAIL_FROM') ?? user);
  const transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: PORT === 465,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  return { transport, from, user };
}

export function sender(kind: SenderKind): Sender | null {
  if (!cache.has(kind)) cache.set(kind, build(kind));
  return cache.get(kind)!;
}

export const senderKindFor = (mailType: string): SenderKind =>
  KYC_MAIL_TYPES.has(mailType) ? 'kyc' : 'research';

export const senderFor = (mailType: string) => sender(senderKindFor(mailType));

export const smtpHost = () => HOST ?? null;
export const smtpPort = () => PORT;
