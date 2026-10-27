// Broker auto-email: when a signed report reaches a client who has consented, the database queues an
// order email to that client's broker (dealing-desk TO address, with CC copies); the mailer Edge
// Function sends it. This file adds
//   • the client page "Broker auto-email" (enter details, give or withdraw consent, test email);
//   • the Admin / Sales page of the same name (enter details for a client, who then confirms them);
//   • the delivery status of real mail on the Email delivery page.
// Rules (who may consent, what is sent) live in migration 20261027020000_v2_broker_email.sql.

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
const BROKER_CONSENT_VERSION = 'BAE-2026-10-27';
const BROKER_CONSENT_TEXT =
  'I authorise Sampadha, a SEBI-registered Research Analyst, to email every research recommendation I receive in this portal to my broker at the address above, with copies to the CC addresses, so that my broker can act on it under my standing instructions with them. I understand that Sampadha does not place orders, hold my funds or securities, or guarantee execution, that I remain responsible for my trades, and that I can withdraw this consent here at any time.';
const BROKER_STATUS = {
  Active: ['green', 'Active'],
  Pending: ['gold', 'Waiting for client confirmation'],
  Revoked: ['red', 'Withdrawn'],
};
const MAIL_STATUS_CLASS = { Sent: 'green', Queued: 'gold', Sending: 'gold', Simulated: 'gold' };
let brokerSetupLogin = '';
let brokerMailTestNote = ''; // result of the last test email, kept across re-renders

const brokerRows = () => state.ws?.brokerEmails || [];
const brokerRowFor = (clientId) => brokerRows().find((r) => r.client_id === clientId);
// For the RA send screens: true when the client's broker will get the order email.
const brokerAutoEmailActive = (clientId) => brokerRowFor(clientId)?.status === 'Active';
const brokerStatusBadge = (row) => {
  const [tone, label] = BROKER_STATUS[row?.status] || ['red', 'Not set up'];
  return `<span class="status ${tone}">${label}</span>`;
};

function brokerForm(row, { client, loginId }) {
  const value = (v) => esc(v || '');
  return `<form id="brokerEmailForm" data-login="${esc(loginId || '')}"><datalist id="brokerNames">${BROKER_NAMES.map((n) => `<option value="${esc(n)}">`).join('')}</datalist><div class="form-grid"><label class="field">Broker *<input name="broker" list="brokerNames" required maxlength="80" value="${value(row?.broker)}" placeholder="e.g. Kotak Securities"></label><label class="field">Broker client ID *<input name="brokerClientId" required maxlength="30" value="${value(row?.broker_client_id)}" placeholder="Client code at the broker"></label><label class="field">Broker order email (TO) *<input name="toEmail" type="email" required value="${value(row?.to_email)}" placeholder="Dealing desk address"></label><label class="field">CC emails<input name="ccEmails" value="${value((row?.cc_emails || []).join('; '))}" placeholder="Separate with ;  e.g. you and your advisor"></label></div>${
    client
      ? `<label class="consent broker-consent"><input name="consent" type="checkbox" required><span><b>My consent *</b><small>${esc(BROKER_CONSENT_TEXT)}</small><small>Wording ${BROKER_CONSENT_VERSION}</small></span></label>`
      : '<div class="notice">The client must confirm these details in their own portal before any order email is sent.</div>'
  }<div class="actions"><button class="btn primary">${client ? (row?.status === 'Active' ? 'Save and confirm consent' : 'Give consent and save') : 'Save for client confirmation'}</button>${row && row.status !== 'Revoked' ? '<button type="button" class="btn secondary" data-broker-revoke>Withdraw</button>' : ''}</div></form><form id="brokerTestForm" class="broker-test" data-login="${esc(loginId || '')}"><label class="field">Send a sample order email to<input name="testEmail" type="email" value="${esc(state.user.email)}"></label><button class="btn secondary"${row ? '' : ' disabled'}>Send test email</button></form><p id="brokerEmailMessage" class="research-message" role="status"></p>`;
}

const brokerMailRows = (mails) =>
  mails.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>Email</th><th>To / CC</th><th>Queued</th><th>Status</th></tr></thead><tbody>${mails
        .map(
          (m) =>
            `<tr><td><b>${esc(m.subject)}</b><small>${esc(m.id)} · ${esc(m.type)}</small></td><td>${esc(m.to)}<small>${esc(m.cc.join('; ') || '—')}</small></td><td class="stamp">${esc(m.sent)}</td><td><span class="status ${MAIL_STATUS_CLASS[m.status] || 'red'}">${esc(m.status)}</span>${m.note ? `<small>${esc(m.note)}</small>` : ''}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<p class="muted">No broker emails yet.</p>';

function brokerClientPage() {
  const row = brokerRowFor(state.user.uid),
    mails = state.emails.filter((m) => m.clientId === state.user.uid && /^Broker/.test(m.type));
  return `<article class="card panel"><div class="panel-head"><div><h3>Broker auto-email</h3><p>Have each recommendation emailed to your broker as soon as you receive it.</p></div>${brokerStatusBadge(row)}</div>${
    row?.status === 'Active'
      ? `<div class="notice"><b>On since ${esc(Api.fmt.stamp(row.consented_at))} IST.</b> Every Cash and Multi report you receive is also emailed to ${esc(row.broker)} at ${esc(row.to_email)}.</div>`
      : row?.status === 'Pending'
        ? '<div class="notice"><b>Your advisor entered these details.</b> Check them, tick your consent and save to switch broker auto-email on.</div>'
        : ''
  }${brokerForm(row, { client: true })}</article><article class="card panel"><div class="panel-head"><div><h3>Emails sent to your broker</h3><p>Order emails and test emails for your account.</p></div><span class="badge">${mails.length}</span></div>${brokerMailRows(mails)}</article>`;
}

function brokerStaffPage() {
  const clientsList = (state.ws?.directory || []).filter((p) => p.role === 'client'),
    chosen = clientsList.find((p) => p.login_id === brokerSetupLogin),
    row = chosen && brokerRowFor(chosen.id);
  return `${state.role === 'admin' ? '<article class="card panel" id="mailerStatus"><p class="muted">Checking mail set-up…</p></article>' : ''}<article class="card panel"><div class="panel-head"><div><h3>Broker auto-email</h3><p>Clients whose recommendations are emailed to their broker. Only the client can give the consent.</p></div><span class="badge">${brokerRows().filter((r) => r.status === 'Active').length} active</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th>Broker</th><th>Order email</th><th>Status</th><th></th></tr></thead><tbody>${
    clientsList
      .map((p) => {
        const r = brokerRowFor(p.id);
        return `<tr><td><b>${esc(p.full_name)}</b><small>${esc(p.login_id)}</small></td><td>${esc(r?.broker || '—')}<small>${esc(r?.broker_client_id || '')}</small></td><td>${esc(r?.to_email || '—')}<small>${esc((r?.cc_emails || []).join('; '))}</small></td><td>${brokerStatusBadge(r)}${r?.consented_at && r.status === 'Active' ? `<small>Since ${esc(Api.fmt.stamp(r.consented_at))} IST</small>` : ''}</td><td><button class="btn secondary" data-broker-client="${esc(p.login_id)}">${r ? 'Edit' : 'Set up'}</button></td></tr>`;
      })
      .join('') || '<tr><td colspan="5" class="empty">No clients yet.</td></tr>'
  }</tbody></table></div></article>${
    chosen
      ? `<article class="card panel" id="brokerSetupPanel"><div class="panel-head"><div><h3>${esc(chosen.full_name)}</h3><p>${esc(chosen.login_id)} · ${esc(chosen.email)}</p></div>${brokerStatusBadge(row)}</div>${brokerForm(row, { client: false, loginId: chosen.login_id })}</article>`
      : ''
  }`;
}

async function brokerRenderMailerStatus() {
  const target = document.querySelector('#mailerStatus');
  if (!target) return;
  try {
    const s = await Api.mailerStatus();
    target.innerHTML =
      (s.configured
        ? `<div class="panel-head"><div><h3>Email sending is on</h3><p>Sent through ${esc(s.host)}:${esc(s.port)} from ${esc(s.from)}.</p></div><span class="status green">Live</span></div>`
        : '<div class="panel-head"><div><h3>Email sending is not set up yet</h3><p>Emails are logged in the portal only (status Simulated). Add the SMTP secrets to the mailer Edge Function to send them.</p></div><span class="status gold">Simulated</span></div>') +
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
  brokerOriginalShow(page);
  // Admin sees whether sending is on (and can send a test) on both mail pages.
  if (page === 'emails' && state.role === 'admin')
    document
      .querySelector('#content')
      .insertAdjacentHTML('afterbegin', '<article class="card panel" id="mailerStatus"></article>');
  if (page === 'brokerEmail' || page === 'emails') brokerRenderMailerStatus();
};

async function brokerAfterChange(message, text) {
  await refreshWorkspace();
  show('brokerEmail');
  const target = document.querySelector('#brokerEmailMessage');
  if (target) target.textContent = text;
  if (message) toast(message);
}

document.querySelector('#content').addEventListener('click', async (event) => {
  const pick = event.target.closest('[data-broker-client]');
  if (pick) {
    brokerSetupLogin = pick.dataset.brokerClient;
    show('brokerEmail');
    document.querySelector('#brokerSetupPanel')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const revoke = event.target.closest('[data-broker-revoke]');
  if (!revoke) return;
  const loginId = revoke.closest('form').dataset.login;
  if (!confirm('Stop emailing recommendations to the broker?')) return;
  revoke.disabled = true;
  try {
    await Api.revokeBrokerEmail(loginId);
    await brokerAfterChange('Broker auto-email withdrawn', 'Withdrawn. No more order emails will be sent.');
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
  if (form.id !== 'brokerEmailForm' && form.id !== 'brokerTestForm') return;
  event.preventDefault();
  const button = form.querySelector('button:not([type=button])'),
    message = document.querySelector('#brokerEmailMessage'),
    loginId = form.dataset.login;
  button.disabled = true;
  try {
    if (form.id === 'brokerTestForm') {
      const result = await Api.sendBrokerTestEmail(loginId, form.elements.testEmail.value.trim());
      await brokerAfterChange('Test email queued', 'Test email ' + result.mail_ref + ' to ' + result.to + ': see its status in the list.');
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
    await brokerAfterChange(
      'Broker details saved',
      result.status === 'Active'
        ? 'Saved. Broker auto-email is on.'
        : 'Saved. The client must confirm the details in their portal before order emails are sent.',
    );
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
});
