// Broker auto-email: when a signed report reaches a client who has consented, the database queues an
// order email to that client's broker (dealing-desk TO address, with CC copies). It is sent from the
// client's own Gmail (client-gmail and mailer Edge Functions), never from Sampadha's mailbox. This
// file adds
//   • the client page "Broker auto-email" (connect Gmail, then enter details, give or withdraw
//     consent, test email from their Gmail);
//   • the Admin / Sales page of the same name (enter details for a client, who then connects Gmail
//     and consents in their own portal);
//   • the return from Google (?gmail=connected|mismatch|denied|failed);
//   • the delivery status of real mail on the Email delivery page.
// Rules (who may consent, what is sent) live in supabase/GMAIL-SEND.md and migrations
// 20261027020000_v2_broker_email.sql and 20261107000000_v2_client_gmail.sql.

const BROKER_NAMES = [
  'Kotak Securities',
  'Angel One',
  'Zerodha',
  'ICICI Direct',
  'HDFC Securities',
  'Motilal Oswal',
  'Upstox',
];
// Keep in step with v2_private.broker_consent_version() in the migration.
const BROKER_CONSENT_VERSION = 'BAE-2026-11-07';
const BROKER_CONSENT_TEXT =
  'I authorise Sampadha, a SEBI-registered Research Analyst, to send each Multi research recommendation I receive in this portal from my connected Gmail account to my broker at the address above, with copies to the CC addresses, so that my broker can act on it under my standing instructions with them. This access can only send email; it cannot read my mailbox. Cash reports uploaded as PDFs are not sent. I understand that Sampadha does not place orders, hold my funds or securities, or guarantee execution, that I remain responsible for my trades, and that I can withdraw this consent here at any time, which stops sending immediately.';
const BROKER_STATUS = {
  Active: ['green', 'Active'],
  Pending: ['gold', 'Waiting for client confirmation'],
  Revoked: ['red', 'Withdrawn'],
};
const BROKER_GMAIL_STATUS = {
  Connected: ['green', 'Connected'],
  'Reconnect needed': ['gold', 'Reconnect needed'],
};
const MAIL_STATUS_CLASS = {
  Sent: 'green',
  Queued: 'gold',
  Sending: 'gold',
  Simulated: 'gold',
  Failed: 'red',
  Expired: 'red',
};
const MAILER_LATE_MS = 5 * 60 * 1000; // the schedule runs every minute
const BROKER_GMAIL_PARAM = 'gmail'; // set by the client-gmail function when Google sends the client back
let brokerSetupLogin = '';
let brokerMailTestNote = ''; // result of the last test email, kept across re-renders
let brokerGmailNote = ''; // result of the return from Google, kept until the client leaves the page

const brokerRows = () => state.ws?.brokerEmails || [];
const brokerRowFor = (clientId) => brokerRows().find((r) => r.client_id === clientId);
// A client reads their own link row; staff get the same two facts on list_broker_email_clients.
const brokerGmailOf = (clientId) => {
  const own = state.ws?.gmailLink,
    row = brokerRowFor(clientId);
  return own?.client_id === clientId
    ? { status: own.status, address: own.gmail_address }
    : { status: row?.gmail_status, address: row?.gmail_address };
};
const brokerGmailConnected = (clientId) => brokerGmailOf(clientId).status === 'Connected';
// For the RA send screens: true when the client's broker will get the order email.
const brokerAutoEmailActive = (clientId) =>
  brokerRowFor(clientId)?.status === 'Active' && brokerGmailConnected(clientId);
// The client consented, but their Gmail cannot send, so an order to them will fail.
const brokerNeedsGmail = (clientId) =>
  brokerRowFor(clientId)?.status === 'Active' && !brokerGmailConnected(clientId);
// Waiting for the client: consent ended by the move to Gmail, or details staff entered. Staff rows do
// not carry updated_by, so these two read the same here.
const brokerNeedsConsent = (clientId) => brokerRowFor(clientId)?.status === 'Pending';
// For the RA send screen: names the clients whose broker will not get the order email.
const brokerGmailWarning = () => {
  const names = (test) =>
      brokerRows()
        .filter((r) => test(r.client_id))
        .map((r) => esc(r.full_name)),
    gmail = names(brokerNeedsGmail),
    consent = names(brokerNeedsConsent);
  return (
    (gmail.length
      ? `<p class="research-notice"><b>Gmail not connected:</b> ${gmail.join(', ')}. They have consented, but no order email can reach their broker until they connect Gmail in their own portal.</p>`
      : '') +
    (consent.length
      ? `<p class="research-notice"><b>Consent needed:</b> ${consent.join(', ')}. No order email can reach their broker until they connect Gmail and consent in their own portal.</p>`
      : '')
  );
};
const brokerStatusBadge = (row) => {
  const [tone, label] = BROKER_STATUS[row?.status] || ['gray', 'Not set up'];
  return `<span class="status ${tone}">${label}</span>`;
};
const brokerGmailBadge = (status) => {
  const [tone, label] = BROKER_GMAIL_STATUS[status] || ['gray', 'Not connected'];
  return `<span class="status ${tone}">${label}</span>`;
};

// Names come from Admin's list, with the built-in names until it loads.
const brokerDesks = () => state.ws?.brokerDesks || [];
const brokerDeskEmail = (name) => brokerDesks().find((d) => d.name === name)?.order_email || '';
// Sales has already entered the client's brokers on Add client; Multi orders use a Multi product's.
function brokerPrefill(person) {
  const accounts = state.submissions.find((a) => a.email === person.email)?.accounts || [],
    account = accounts.find((a) => CLIENT_MULTI_PRODUCTS.includes(a.product)) || accounts[0];
  return account
    ? { broker: account.broker, broker_client_id: account.tradingId, to_email: brokerDeskEmail(account.broker) }
    : null;
}
function brokerForm(row, { client, loginId }) {
  const value = (v) => esc(v || ''),
    readOnly = client ? ' readonly' : '',
    names = brokerDesks().length ? brokerDesks().map((d) => d.name) : BROKER_NAMES,
    gmailStatus = client ? brokerGmailOf(state.user.uid).status : '',
    locked = client && gmailStatus !== 'Connected' ? ' disabled' : '';
  return `<form id="brokerEmailForm" data-login="${esc(loginId || '')}"><datalist id="brokerNames">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist><div class="form-grid"><label class="field">Broker *<input name="broker"${client ? '' : ' list="brokerNames"'} required maxlength="80" value="${value(row?.broker)}" placeholder="e.g. Kotak Securities"${readOnly}></label><label class="field">Broker client ID *<input name="brokerClientId" required maxlength="30" value="${value(row?.broker_client_id)}" placeholder="Client code at the broker"${readOnly}></label><label class="field">Broker order email (TO) *<input name="toEmail" type="email" required value="${value(row?.to_email)}" placeholder="Dealing desk address"${readOnly}></label><label class="field">CC emails<input name="ccEmails" value="${value((row?.cc_emails || []).join('; '))}" placeholder="Separate with ;  e.g. you and your advisor"${readOnly}></label></div>${
    client
      ? `<label class="consent broker-consent"><input name="consent" type="checkbox" required${locked}><span><b>My consent *</b><small>${esc(BROKER_CONSENT_TEXT)}</small><small>Wording ${BROKER_CONSENT_VERSION}</small></span></label>${locked ? `<p class="muted broker-gmail-needed">${gmailStatus === 'Reconnect needed' ? 'Reconnect' : 'Connect'} your Gmail in step 1 before giving consent.</p>` : ''}`
      : '<div class="notice">Saving emails the client a consent request and shows it in their portal. Only the client can connect Gmail and give consent, and no order email goes until they do.</div>'
  }<div class="actions"><button class="btn primary"${locked}>${client ? (row?.status === 'Active' ? 'Save and confirm consent' : 'Give consent and save') : 'Save and send consent request'}</button>${row?.status && row.status !== 'Revoked' ? '<button type="button" class="btn secondary" data-broker-revoke>Withdraw</button>' : ''}</div></form>${client ? brokerTestForm(row) : ''}<p id="brokerEmailMessage" class="research-message" role="status"></p>`;
}

function brokerTestForm(row) {
  const connected = brokerGmailConnected(state.user.uid),
    off = connected && row ? '' : ' disabled',
    waiting = !connected
      ? ' Available once your Gmail is connected.'
      : row
        ? ''
        : ' Available once your broker details are saved.';
  return `<form id="brokerTestForm" class="broker-test" data-login=""><label class="field">Send a sample order from your Gmail to<input name="testEmail" type="email" value="${esc(state.user.email)}"${off}></label><button class="btn secondary"${off}>Send test from your Gmail</button><p class="muted broker-test-note">Send this to your own address, not a real dealing desk, because this is a real email.${waiting}</p></form>`;
}

// Sent on a Gmail row means Gmail took it, not that the broker has it.
const brokerMailStatus = (m) => (m.status === 'Sent' && m.sendVia === 'client_gmail' ? 'Accepted by Gmail' : m.status);

const brokerMailRows = (mails) =>
  mails.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>Email</th><th>To / CC</th><th>Queued</th><th>Status</th></tr></thead><tbody>${mails
        .map((m) => {
          const gmail = m.status === 'Sent' && m.sendVia === 'client_gmail' ? brokerGmailOf(m.clientId).address : '';
          return `<tr><td><b>${esc(m.subject)}</b><small>${esc(m.id)} · ${esc(m.type)}</small>${gmail ? `<small>Sent from ${esc(gmail)}</small>` : ''}</td><td>${esc(m.to)}<small>${esc(m.cc.join('; ') || '—')}</small></td><td class="stamp">${esc(m.sent)}</td><td><span class="status ${MAIL_STATUS_CLASS[m.status] || 'red'}">${esc(brokerMailStatus(m))}</span>${m.note && m.status !== 'Sent' ? `<small>${esc(m.note)}</small>` : ''}</td></tr>`;
        })
        .join('')}</tbody></table></div>`
    : '<p class="muted">No broker emails yet.</p>';

// last_error is written by the mailer; say what it means to the client, without the HTTP code.
function brokerGmailProblem(lastError) {
  const text = String(lastError || '');
  if (!text) return 'Google no longer accepts your approval.';
  if (/no longer accepts|invalid_grant|expired|revoked/i.test(text))
    return 'Your Google approval has ended or was removed.';
  if (/\b40[13]\b|forbidden|unauthori[sz]ed|insufficient|permission|scope/i.test(text))
    return 'Google refused permission to send from this Gmail.';
  return text;
}

function brokerGmailCard() {
  const link = state.ws?.gmailLink,
    connected = link?.status === 'Connected',
    reconnect = link?.status === 'Reconnect needed',
    note = brokerGmailNote ? `<div class="notice broker-gmail-note">${esc(brokerGmailNote)}</div>` : '',
    points = `<ul class="broker-gmail-points"><li>You approve once on Google's page. Nothing more is needed for each order.</li><li>Order emails go from your own Gmail.</li><li>Sampadha can send only. It cannot read your mail.</li><li>Use the Gmail that is registered with your broker. It must be the same as your portal email, ${esc(state.user.email)}.</li></ul>`;
  return `<article class="card panel"><div class="panel-head"><div><h3>Step 1: Connect your Gmail</h3><p>Order emails go to your broker from your own Gmail address.</p></div>${brokerGmailBadge(link?.status)}</div>${note}${
    connected
      ? `<div class="notice">Order emails go from <b>${esc(link.gmail_address)}</b>. Sampadha can send only. It cannot read your mail.</div><div class="actions"><button type="button" class="btn secondary" data-gmail-disconnect>Disconnect</button></div>`
      : reconnect
        ? `<div class="notice"><b>Order emails cannot be sent right now.</b> ${esc(brokerGmailProblem(link.last_error))} Reconnect to start sending again.</div>${points}<div class="actions"><button type="button" class="btn primary" data-gmail-connect>Reconnect</button></div>`
        : `${points}<div class="actions"><button type="button" class="btn primary" data-gmail-connect>Connect Gmail</button></div>`
  }<p id="brokerGmailMessage" class="research-message" role="status"></p></article>`;
}

function brokerConsentBanner(row) {
  const uid = state.user.uid,
    first = brokerGmailConnected(uid) ? 'Check' : 'Connect your Gmail, then check';
  if (row?.status === 'Active')
    return brokerGmailConnected(uid)
      ? `<div class="notice"><b>On since ${esc(Api.fmt.stamp(row.consented_at))} IST.</b> Multi recommendations go from ${esc(brokerGmailOf(uid).address)} to ${esc(row.broker)} at ${esc(row.to_email)}. Cash PDF reports are not sent.</div>`
      : '<div class="notice"><b>Order emails are stopped.</b> Your consent is on, but your Gmail is not connected. Connect it in step 1 to start sending again.</div>';
  // The migration that asked everyone to consent again left updated_by empty; staff entries fill it.
  if (row?.status === 'Pending')
    return !row.updated_by
      ? `<div class="notice"><b>Please consent again.</b> Order emails now go from your own Gmail, so your earlier consent has ended. ${first} these details, tick your consent and save.</div>`
      : `<div class="notice"><b>Your Sampadha contact entered these details.</b> ${first} them, tick your consent and save to switch broker auto-email on. If anything is wrong, ask them to change it.</div>`;
  return '';
}

// Gmail can file a client's first orders as spam at the desk, and only the desk can stop that.
const brokerDeskNote = () =>
  `<div class="notice"><b>Ask your broker's dealing desk to mark your email address as safe.</b> Without this, your order emails may land in their spam folder. "Accepted by Gmail" means Gmail took the email, not that it reached their inbox, so please confirm with your broker that your orders are arriving.</div>`;

function brokerClientPage() {
  const row = brokerRowFor(state.user.uid),
    mails = state.emails.filter((m) => m.clientId === state.user.uid && /^Broker/.test(m.type));
  return `${onboardingClientCard()}${brokerGmailCard()}<article class="card panel"><div class="panel-head"><div><h3>Step 2: Broker details and consent</h3><p>Have each Multi recommendation emailed to your broker as soon as you receive it.</p></div>${brokerStatusBadge(row)}</div>${brokerConsentBanner(row)}${brokerDeskNote()}${row ? brokerForm(row, { client: true }) : '<div class="notice">Your Sampadha contact will enter your broker details. You will get an email and a portal alert when they are ready for your consent.</div>'}</article><article class="card panel"><div class="panel-head"><div><h3>Emails sent to your broker</h3><p>Order emails and test emails for your account.</p></div><span class="badge">${mails.length}</span></div>${brokerMailRows(mails)}</article>`;
}

// r is the row from list_broker_email_clients. A client without one has no Gmail facts here.
function brokerGmailCell(r) {
  if (!r) return '—';
  const known = BROKER_GMAIL_STATUS[r.gmail_status] && r.gmail_address;
  return `${brokerGmailBadge(r.gmail_status)}${known ? `<small>${esc(r.gmail_address)}</small>` : ''}`;
}

const brokerResendButton = (clientId, loginId) =>
  (brokerRowFor(clientId) && !brokerAutoEmailActive(clientId)) ||
  (state.ws?.clientPending || []).some((p) => p.login_id === loginId && p.pending === 'Client: accept details')
    ? `<button class="btn secondary" data-broker-resend="${esc(loginId)}">Resend consent</button>`
    : '';
// The Auto email column on the Clients page.
function brokerAutoEmailCell(loginId) {
  const person = (state.ws?.directory || []).find((p) => p.login_id === loginId);
  if (!person) return '—';
  const row = brokerRowFor(person.id);
  return row
    ? `${brokerStatusBadge(row)}${row.requested_at ? `<small>Requested ${esc(Api.fmt.stamp(row.requested_at))} IST</small>` : ''}${brokerResendButton(person.id, loginId)}`
    : `<button class="btn secondary" data-broker-client="${esc(loginId)}">Set up</button>`;
}
function brokerDesksCard() {
  return `<article class="card panel"><div class="panel-head"><div><h3>Broker order addresses</h3><p>Choosing a broker fills in this TO address, and Sales can still change it for one client. These names also appear on the Add client form. Clear a name to remove it.</p></div></div><form id="brokerDesksForm"><div class="table-wrap"><table class="table"><thead><tr><th>Broker</th><th>Order email</th></tr></thead><tbody>${[...brokerDesks(), { name: '', order_email: '' }].map((d, i) => `<tr data-desk="${esc(d.name)}"><td><input name="name" value="${esc(d.name)}" maxlength="80" placeholder="Add a broker" aria-label="Broker ${i + 1}"></td><td><input name="email" type="email" value="${esc(d.order_email || '')}" placeholder="Dealing desk address" aria-label="Order email ${i + 1}"></td></tr>`).join('')}</tbody></table></div><div class="actions"><button class="btn primary">Save addresses</button></div></form></article>`;
}

function brokerStaffPage() {
  const clientsList = (state.ws?.directory || []).filter((p) => p.role === 'client'),
    chosen = clientsList.find((p) => p.login_id === brokerSetupLogin),
    row = chosen && brokerRowFor(chosen.id);
  return `${state.role === 'admin' ? '<article class="card panel" id="mailerStatus"><p class="muted">Checking mail set-up…</p></article>' : ''}<article class="card panel"><div class="panel-head"><div><h3>Broker auto-email</h3><p>Clients whose Multi recommendations go to their broker from their own Gmail. Only the client can connect Gmail and give the consent.</p></div><span class="badge">${brokerRows().filter((r) => brokerAutoEmailActive(r.client_id)).length} active</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th>Broker</th><th>Order email</th><th>Gmail</th><th>Status</th><th></th></tr></thead><tbody>${
    clientsList
      .map((p) => {
        const r = brokerRowFor(p.id);
        return `<tr><td><b>${esc(p.full_name)}</b><small>${esc(p.login_id)}</small></td><td>${esc(r?.broker || '—')}<small>${esc(r?.broker_client_id || '')}</small></td><td>${esc(r?.to_email || '—')}<small>${esc((r?.cc_emails || []).join('; '))}</small></td><td>${brokerGmailCell(r)}</td><td>${brokerStatusBadge(r)}${r?.consented_at && r.status === 'Active' ? `<small>Since ${esc(Api.fmt.stamp(r.consented_at))} IST</small>` : ''}${brokerNeedsGmail(p.id) ? '<small>Orders stopped until Gmail is connected</small>' : ''}</td><td><button class="btn secondary" data-broker-client="${esc(p.login_id)}">${r ? 'Edit' : 'Set up'}</button>${brokerResendButton(p.id, p.login_id)}</td></tr>`;
      })
      .join('') || '<tr><td colspan="6" class="empty">No clients yet.</td></tr>'
  }</tbody></table></div></article>${
    chosen
      ? `<article class="card panel" id="brokerSetupPanel"><div class="panel-head"><div><h3>${esc(chosen.full_name)}</h3><p>${esc(chosen.login_id)} · ${esc(chosen.email)}</p></div>${brokerStatusBadge(row)}</div>${brokerForm(row || brokerPrefill(chosen), { client: false, loginId: chosen.login_id })}</article>`
      : ''
  }${state.role === 'admin' ? brokerDesksCard() : ''}`;
}

// What is wrong with order sending, as a red block; SMTP being on says nothing about any of this.
function brokerMailerWarning(s) {
  const problems = [];
  if (!(Date.now() - Date.parse(s.lastCronAt ?? '') <= MAILER_LATE_MS))
    problems.push(
      (s.lastCronAt
        ? `The scheduled mail run last ran at ${esc(Api.fmt.stamp(s.lastCronAt))} IST.`
        : 'The scheduled mail run has not reported in.') +
        ' Broker orders may not be going out.' +
        (s.cronSecretConfigured ? '' : ' MAILER_CRON_SECRET is not set on the mailer.'),
    );
  if (s.stuckBrokerOrders > 0)
    problems.push(`${esc(s.stuckBrokerOrders)} broker order(s) have been waiting for more than 5 minutes.`);
  else if (s.stuckBrokerOrders !== 0) problems.push('The broker orders waiting to go could not be counted.');
  return problems.length
    ? `<div class="notice mailer-warning" role="alert"><b>Broker order sending needs attention.</b> ${problems.join(' ')}</div>`
    : '';
}

async function brokerRenderMailerStatus() {
  const target = document.querySelector('#mailerStatus');
  if (!target) return;
  try {
    const s = await Api.mailerStatus();
    target.innerHTML =
      brokerMailerWarning(s) +
      (s.configured
        ? `<div class="panel-head"><div><h3>Portal email (SMTP) is on</h3><p>Portal emails go through ${esc(s.host)}:${esc(s.port)} from ${esc(s.from)}. Client orders do not use this.</p></div><span class="status green">Live</span></div>`
        : '<div class="panel-head"><div><h3>Portal email (SMTP) is not set up yet</h3><p>Emails are logged in the portal only (status Simulated), and Order alerts stay Failed. Add the SMTP secrets to the mailer Edge Function to send them.</p></div><span class="status gold">Simulated</span></div>') +
      (s.gmailConfigured
        ? '<div class="panel-head"><div><h3>Client order sending (Gmail) is set up</h3><p>Broker orders go from each client\'s own Gmail.</p></div><span class="status green">Set up</span></div>'
        : '<div class="panel-head"><div><h3>Client order sending (Gmail) is not set up</h3><p>No broker order can go out. Add the GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GMAIL_TOKEN_KEY secrets to the mailer Edge Function.</p></div><span class="status red">Not set up</span></div>') +
      `<form id="mailTestForm" class="broker-test"><label class="field">Send a test email to<input name="to" type="email" required value="${esc(state.user.email)}"></label><button class="btn secondary">Send test email</button></form><p id="mailTestMessage" class="research-message" role="status">${esc(brokerMailTestNote)}</p>`;
  } catch (error) {
    target.innerHTML = `<p class="muted">${esc(error.message)} Deploy the mailer Edge Function.</p>`;
  }
}

pages.brokerEmail = () => (state.role === 'client' ? brokerClientPage() : brokerStaffPage());
titles.brokerEmail = 'Broker auto-email';
nav.client.splice(3, 0, ['brokerEmail', '⇄', 'Broker auto-email']);
for (const role of ['admin', 'sales']) {
  const at = nav[role].findIndex((x) => x[0] === 'emails');
  nav[role].splice(at + 1, 0, ['brokerEmail', '⇄', 'Broker auto-email']);
}
const brokerOriginalShow = show;
show = function (page) {
  if (page !== 'brokerEmail') brokerGmailNote = '';
  brokerOriginalShow(page);
  // Admin sees whether sending is on (and can send a test) on both mail pages.
  if (page === 'emails' && state.role === 'admin')
    document
      .querySelector('#content')
      .insertAdjacentHTML('afterbegin', '<article class="card panel" id="mailerStatus"><p class="muted">Checking mail set-up…</p></article>');
  if (page === 'brokerEmail' || page === 'emails') brokerRenderMailerStatus();
};

// Back from Google: the client-gmail function has already done the work, so the address bar is
// only told what to say. "connected" is believed only if the link row agrees. Runs after sign-in,
// so a client whose session had ended still gets the message once they are back in.
const BROKER_GMAIL_RETURN = {
  connected: () => ['Gmail connected', 'Your Gmail is connected. Now check your broker details and give your consent in step 2.'],
  mismatch: () => ['Gmail not connected', `Gmail not connected. You must choose the same Gmail as your portal email, ${state.user.email}. Please try again with that account.`],
  denied: () => ['Gmail not connected', 'Gmail not connected. Google approval was not given, so nothing has changed. To connect, press the button below and allow sending.'],
  failed: () => ['Gmail not connected', 'Gmail not connected. Something went wrong during the Google approval. Please try again. If it keeps failing, contact Sampadha.'],
};
function brokerResumeGmail() {
  const params = new URLSearchParams(location.search),
    result = params.get(BROKER_GMAIL_PARAM);
  if (result === null) return;
  params.delete(BROKER_GMAIL_PARAM);
  history.replaceState(null, '', location.pathname + (params.size ? '?' + params : ''));
  if (state.role !== 'client' || !Object.hasOwn(BROKER_GMAIL_RETURN, result)) return;
  const unconfirmed = result === 'connected' && !brokerGmailConnected(state.user.uid),
    [title, text] = BROKER_GMAIL_RETURN[unconfirmed ? 'failed' : result]();
  brokerGmailNote = text;
  show('brokerEmail');
  toast(title);
}
const brokerOriginalEnterPortal = enterPortal;
enterPortal = async function (profile) {
  await brokerOriginalEnterPortal(profile);
  brokerResumeGmail();
};

// text may be a function, to word the message from the refreshed data.
async function brokerAfterChange(message, text) {
  await refreshWorkspace();
  show('brokerEmail');
  const target = document.querySelector('#brokerEmailMessage');
  if (target) target.textContent = typeof text === 'function' ? text() : text;
  if (message) toast(message);
}

// Straight to the database, so the consent stops even when the client-gmail function is down.
// Nothing left to withdraw is fine: Disconnect can follow an earlier Withdraw, or come with no consent.
async function brokerStopConsent() {
  try {
    await Api.revokeBrokerEmail();
  } catch (error) {
    if (!/no broker auto-email to withdraw/i.test(error.message)) throw error;
  }
}

async function brokerConnectGmail(button) {
  const message = document.querySelector('#brokerGmailMessage');
  button.disabled = true;
  message.textContent = 'Opening Google…';
  try {
    const { url } = await Api.clientGmail('start');
    if (!url) throw new Error('Google approval could not be started. Please try again.');
    location.href = url;
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
}

document.querySelector('#content').addEventListener('change', (event) => {
  const form = event.target.closest('#brokerEmailForm');
  if (!form || event.target.name !== 'broker' || !form.dataset.login) return;
  const address = brokerDeskEmail(event.target.value.trim());
  if (address) form.elements.toEmail.value = address;
});
document.querySelector('#content').addEventListener('click', async (event) => {
  const resend = event.target.closest('[data-broker-resend]');
  if (resend) {
    resend.disabled = true;
    try {
      await Api.sendBrokerConsent(resend.dataset.brokerResend);
      await refreshWorkspace();
      show(state.page);
      toast('Consent request sent to the client');
    } catch (error) {
      toast(error.message);
      resend.disabled = false;
    }
    return;
  }
  const pick = event.target.closest('[data-broker-client]');
  if (pick) {
    brokerSetupLogin = pick.dataset.brokerClient;
    show('brokerEmail');
    document.querySelector('#brokerSetupPanel')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const connect = event.target.closest('[data-gmail-connect]');
  if (connect) return brokerConnectGmail(connect);
  const revoke = event.target.closest('[data-broker-revoke], [data-gmail-disconnect]');
  if (!revoke) return;
  const client = state.role === 'client';
  if (
    !confirm(
      client
        ? 'This disconnects your Gmail and withdraws your consent. No more order emails will go to your broker. Continue?'
        : 'Stop emailing recommendations to the broker?',
    )
  )
    return;
  revoke.disabled = true;
  try {
    if (client) {
      await brokerStopConsent();
      brokerGmailNote = '';
      try {
        await Api.clientGmail('disconnect');
      } catch (error) {
        await brokerAfterChange('Consent withdrawn', `Consent withdrawn, so no more order emails will be sent, but your Gmail is still linked. ${error.message} Use Disconnect in step 1 to try again.`);
        return;
      }
      await brokerAfterChange('Gmail disconnected', 'Gmail disconnected and consent withdrawn. No more order emails will be sent.');
    } else {
      await Api.revokeBrokerEmail(revoke.closest('form').dataset.login);
      await brokerAfterChange('Broker auto-email withdrawn', 'Withdrawn. No more order emails will be sent.');
    }
  } catch (error) {
    revoke.disabled = false;
    document.querySelector('#brokerEmailMessage').textContent = error.message;
  }
});

document.querySelector('#content').addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id === 'mailTestForm') {
    event.preventDefault();
    const button = form.querySelector('button'),
      message = document.querySelector('#mailTestMessage');
    button.disabled = true;
    message.textContent = 'Sending…';
    try {
      const result = await Api.sendTestEmail(form.elements.to.value.trim());
      await refreshWorkspace();
      const mail = state.emails.find((m) => m.id === result.mail_ref);
      brokerMailTestNote =
        result.mail_ref + ' to ' + result.to + ': ' + (mail ? mail.status : 'queued') +
        (mail?.note ? ' (' + mail.note + ')' : '');
      show(state.page);
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
    return;
  }
  if (form.id === 'brokerDesksForm') {
    event.preventDefault();
    const button = form.querySelector('button'),
      lines = [...form.querySelectorAll('tbody tr')].map((row, i) => ({
        old: row.dataset.desk,
        name: row.querySelector('[name=name]').value.trim(),
        order_email: row.querySelector('[name=email]').value.trim().toLowerCase() || null,
        sort_order: (i + 1) * 10,
      })),
      keep = lines.filter((l) => l.name);
    button.disabled = true;
    try {
      await Api.saveBrokerDesks(
        keep.map(({ name, order_email, sort_order }) => ({ name, order_email, sort_order })),
        lines.filter((l) => l.old && l.old !== l.name).map((l) => l.old),
      );
      await brokerAfterChange('Addresses saved', '');
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
    return;
  }
  if (form.id !== 'brokerEmailForm' && form.id !== 'brokerTestForm') return;
  event.preventDefault();
  const button = form.querySelector('button:not([type=button])'),
    message = document.querySelector('#brokerEmailMessage'),
    loginId = form.dataset.login;
  button.disabled = true;
  try {
    if (form.id === 'brokerTestForm') {
      const result = await Api.sendBrokerTestEmail(loginId, form.elements.testEmail.value.trim());
      await brokerAfterChange('Test email queued', 'Test email ' + result.mail_ref + ' to ' + result.to + ' from your Gmail: see its status in the list.');
      return;
    }
    const e = form.elements,
      result = await Api.saveBrokerEmail(
        loginId,
        {
          broker: e.broker.value.trim(),
          brokerClientId: e.brokerClientId.value.trim(),
          toEmail: e.toEmail.value.trim(),
          ccEmails: e.ccEmails.value,
        },
        Boolean(e.consent?.checked),
      );
    const clientId = loginId ? state.ws?.directory?.find((p) => p.login_id === loginId)?.id : state.user.uid;
    if (loginId && !(result.status === 'Active' && brokerGmailConnected(clientId)))
      await Api.sendBrokerConsent(loginId);
    await brokerAfterChange('Broker details saved', () =>
      result.status !== 'Active'
        ? 'Saved. The consent request went to the client by email and in their portal.'
        : brokerGmailConnected(clientId)
          ? 'Saved. Broker auto-email is on.'
          : 'Saved. The consent stands, but no order email can go until the client connects Gmail in their own portal.',
    );
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
});
