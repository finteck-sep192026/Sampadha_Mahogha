// The client's one link: opening it signs them in and lands on the consent page, with no password.
// The link is our own token, so it can last days, while the sign-in link behind it is made fresh on
// each click (client-link function). It goes straight to the client by SMTP and is never stored or
// logged, so staff cannot open a client's account with it.
import { Buffer } from 'node:buffer';

export const LINK_DAYS = 7;

export async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Client = { id: string; login_id: string; full_name: string; email: string };
type Deps = {
  // deno-lint-ignore no-explicit-any
  admin: any;
  // deno-lint-ignore no-explicit-any
  v2: any;
  // deno-lint-ignore no-explicit-any
  transport: any;
  from: string | undefined;
  portalUrl: string;
};

export async function sendClientLink(deps: Deps, client: Client, senderId: string) {
  const { admin, v2, transport, from, portalUrl } = deps;
  if (!transport) throw new Error('Email sending is not set up, so the link could not be sent.');

  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const expires = new Date(Date.now() + LINK_DAYS * 86400000).toISOString();
  const { error } = await v2.from('client_access_links').upsert({
    client_id: client.id,
    token_hash: await sha256(token),
    expires_at: expires,
    created_at: new Date().toISOString(),
    last_opened_at: null,
  });
  if (error) {
    // The mail log is the one place staff can see why a link did not go.
    await v2.from('email_log').insert({
      mail_ref: 'MAIL-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
      recipient_id: client.id,
      client_id: client.id,
      recipient_email: client.email,
      recipient_name: client.full_name,
      subject: 'Please review and approve your Sampadha details',
      mail_type: 'Consent request',
      body: 'The personal link could not be created.',
      status: 'Failed',
      provider_message: String(error.message).slice(0, 300),
      created_by: senderId,
    });
    throw new Error('Could not create the link: ' + error.message);
  }

  const link = `${portalUrl.replace(/\/$/, '')}/client-access?t=${token}`;
  const { data: app } = await v2
    .from('client_applications')
    .select('pdf_path, details_accepted_at')
    .eq('client_id', client.id)
    .maybeSingle();
  const attach = app?.pdf_path && !app.details_accepted_at;
  const file = attach ? await admin.storage.from('v2-research').download(app.pdf_path) : null;

  const subject = 'Please review and approve your Sampadha details';
  const intro =
    'Your Sampadha account is ready. Open the link below to review your onboarding details and give your consent, including broker auto-email if it is set up for you. No password is needed.';
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const ref = 'MAIL-' + crypto.randomUUID().slice(0, 8).toUpperCase();
  let status = 'Sent',
    note: string | null = null;
  try {
    const info = await transport.sendMail({
      from,
      to: { name: client.full_name, address: client.email },
      subject,
      text: `Hello ${client.full_name},\n\n${intro}\n\nYour login ID: ${client.login_id}\n\n${link}\n\nThe link works for ${LINK_DAYS} days and is for you alone, so please do not forward it. After that, sign in at ${portalUrl} with an email code.`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#13233a"><p>Hello ${esc(client.full_name)},</p><p>${esc(intro)}</p><p>Your login ID: <b>${esc(client.login_id)}</b></p><p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;background:#0b1f3a;color:#ffffff;border-radius:6px;text-decoration:none">Review and consent</a></p><p>The link works for ${LINK_DAYS} days and is for you alone, so please do not forward it. After that, sign in at ${esc(portalUrl)} with an email code.</p></div>`,
      headers: { 'X-Sampadha-Ref': ref },
      attachments: file?.data
        ? [
            {
              filename: 'Sampadha-client-onboarding.pdf',
              content: Buffer.from(await file.data.arrayBuffer()),
              contentType: 'application/pdf',
            },
          ]
        : undefined,
    });
    note = String(info.response ?? '').slice(0, 300) || null;
  } catch (err) {
    status = 'Failed';
    note = String((err as Error)?.message ?? err).slice(0, 300);
  }
  await v2.from('email_log').insert({
    mail_ref: ref,
    recipient_id: client.id,
    client_id: client.id,
    recipient_email: client.email,
    recipient_name: client.full_name,
    subject,
    mail_type: 'Consent request',
    body: `${intro} A personal link was emailed; the link itself is not stored.`,
    status,
    provider_message: note,
    delivered_at: status === 'Sent' ? new Date().toISOString() : null,
    created_by: senderId,
  });
  if (status !== 'Sent') throw new Error('The email could not be sent: ' + note);
}
