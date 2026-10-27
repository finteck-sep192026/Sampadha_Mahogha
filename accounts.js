// Real accounts (accounts Edge Function):
//   • Set-password screen: the emailed link lands on the portal with a session in the URL; the
//     person chooses a password and goes straight into their workspace.
//   • Admin → Users & access: add staff (Research Analyst, Sales, Admin), send a fresh
//     set-password link, turn a person's access off or on.
//   • Admin → Client approvals: "Create login" on an approved application, with the client's plan,
//     products and Multi tier; the client is emailed their login ID and a set-password link.

const PASSWORD_MIN = 12;
const STAFF_ROLE_OPTIONS = [
  ['ra', 'Research Analyst'],
  ['sales', 'Sales'],
  ['admin', 'Admin'],
];
let accountsCreateFor = '';

// ───────────── set-password screen ─────────────
function showSetPassword(message) {
  const box = document.querySelector('.login-box'),
    form = document.querySelector('#loginForm');
  form.hidden = true;
  box.querySelector('h2').textContent = 'Set your password';
  box.querySelector('h2 + .muted').textContent =
    `Choose a password of at least ${PASSWORD_MIN} characters. You will use it with your login ID or email.`;
  form.insertAdjacentHTML(
    'beforebegin',
    `<form id="setPasswordForm"><label>New password<input name="password" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" required></label><label>Repeat the password<input name="repeat" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" required></label><p class="error" role="alert">${esc(message || '')}</p><button class="btn primary wide">Save password and sign in</button></form>`,
  );
}
function closeSetPassword() {
  document.querySelector('#setPasswordForm')?.remove();
  const box = document.querySelector('.login-box');
  box.querySelector('h2').textContent = 'Sign in';
  box.querySelector('h2 + .muted').textContent = 'Use your client ID, staff ID or email address.';
  document.querySelector('#loginForm').hidden = false;
}
document.addEventListener('DOMContentLoaded', async () => {
  const link = await Api.sessionFromLink();
  if (!link) return;
  if (link.error) {
    document.querySelector('#loginError').textContent =
      'This set-password link has expired or was already used. Ask your Sampadha administrator to send a new one.';
    return;
  }
  showSetPassword();
});
document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'setPasswordForm') return;
  event.preventDefault();
  const form = event.target,
    error = form.querySelector('.error'),
    button = form.querySelector('button'),
    password = form.elements.password.value;
  if (password.length < PASSWORD_MIN) {
    error.textContent = `Use at least ${PASSWORD_MIN} characters.`;
    return;
  }
  if (password !== form.elements.repeat.value) {
    error.textContent = 'The two passwords are different.';
    return;
  }
  button.disabled = true;
  try {
    await Api.setPassword(password);
    const profile = await Api.currentProfile();
    if (!profile) throw new Error('Your password is saved, but this account has no portal access yet.');
    closeSetPassword();
    await enterPortal(profile);
    toast('Password saved');
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
  }
});

// ───────────── Users & access ─────────────
function usersPage() {
  const people = state.ws?.directory || [];
  return `<article class="card panel"><div class="panel-head"><div><h3>Add a staff member</h3><p>They get an email with their login ID and a link to set their own password.</p></div></div><form id="staffInviteForm"><div class="form-grid three"><label class="field">Role *<select name="role">${STAFF_ROLE_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label><label class="field">Full name *<input name="fullName" required maxlength="120" autocomplete="off"></label><label class="field">Email *<input name="email" type="email" required autocomplete="off"></label><label class="field">Mobile<input name="mobile" type="tel" maxlength="16" autocomplete="off"></label></div><div class="actions"><button class="btn primary">Create login and send email</button></div><p id="staffInviteMessage" class="research-message" role="status"></p></form></article><article class="card panel"><div class="panel-head"><div><h3>Users and access</h3><p>Everyone with a portal login. Turning access off stops them signing in; their records stay.</p></div><span class="badge">${people.filter((p) => p.is_active).length} active</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Person</th><th>Role</th><th>Login ID</th><th>Access</th><th></th></tr></thead><tbody>${
    people
      .map(
        (p) =>
          `<tr><td><b>${esc(p.full_name)}</b><small>${esc(p.email)}</small></td><td>${esc(roles[p.role]?.name || p.role)}</td><td class="stamp">${esc(p.login_id)}</td><td><span class="status ${p.is_active ? 'green' : 'red'}">${p.is_active ? 'On' : 'Off'}</span></td><td><div class="compliance-actions">${p.is_active ? `<button type="button" class="btn secondary" data-account-link="${esc(p.login_id)}">Send password link</button>` : ''}${p.id === state.user.uid ? '' : `<button type="button" class="btn secondary" data-account-active="${esc(p.login_id)}" data-active="${p.is_active ? 'false' : 'true'}">${p.is_active ? 'Turn off access' : 'Turn on access'}</button>`}</div></td></tr>`,
      )
      .join('') || '<tr><td colspan="5" class="empty">No users yet.</td></tr>'
  }</tbody></table></div><p id="accountsMessage" class="research-message" role="status"></p></article>`;
}

// ───────────── Client approvals: create the login ─────────────
// Called from role-app.js approvals() for each decided application.
function approvalAccountCell(app) {
  if (app.status !== 'Approved') return '<small>Decision recorded</small>';
  if (app.clientId)
    return `<span class="status green">Login created</span><small>${esc(state.ws?.idToLogin.get(app.clientId) || '')}</small>`;
  if (state.role !== 'admin') return '<small>Waiting for Admin to create the login</small>';
  if (accountsCreateFor !== app.id)
    return `<button type="button" class="btn primary" data-account-create="${esc(app.id)}">Create login</button>`;
  const plans = state.ws?.plans || [];
  return `<form class="account-create" data-app="${esc(app.id)}"><label class="field">Plan<select name="plan" required>${plans.map((p) => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('')}</select></label><fieldset><legend>Products</legend><div class="checks"><label><input type="checkbox" name="products" value="Cash" checked> Cash</label><label><input type="checkbox" name="products" value="Multi"> Multi</label></div></fieldset><label class="field">Multi tier<select name="multiTier"><option value="">Not needed</option>${['Nano', 'Micro', 'Mini', 'Mega', 'Giga'].map((t) => `<option>${t}</option>`).join('')}</select></label><label class="field">Billing<select name="billing"><option>Quarterly</option><option>Annual</option></select></label><div class="compliance-actions"><button class="btn primary">Create and email</button><button type="button" class="btn secondary" data-account-cancel>Cancel</button></div><p class="research-message" role="status"></p></form>`;
}

pages.users = usersPage;
titles.users = 'Users & access';

async function accountsRefresh(page, messageSelector, message) {
  await refreshWorkspace();
  show(page);
  const target = document.querySelector(messageSelector);
  if (target && message) target.textContent = message;
}

document.querySelector('#content').addEventListener('click', async (event) => {
  const create = event.target.closest('[data-account-create]');
  if (create) {
    accountsCreateFor = create.dataset.accountCreate;
    show('approvals');
    return;
  }
  if (event.target.closest('[data-account-cancel]')) {
    accountsCreateFor = '';
    show('approvals');
    return;
  }
  const button = event.target.closest('[data-account-link],[data-account-active]');
  if (!button) return;
  const message = document.querySelector('#accountsMessage');
  button.disabled = true;
  try {
    if (button.dataset.accountLink) {
      const r = await Api.accounts('resend', { loginId: button.dataset.accountLink });
      message.textContent = `A new set-password link was emailed to ${r.email}.`;
      button.disabled = false;
    } else {
      const active = button.dataset.active === 'true';
      if (!active && !confirm(`Turn off portal access for ${button.dataset.accountActive}?`)) {
        button.disabled = false;
        return;
      }
      const r = await Api.accounts('set-active', { loginId: button.dataset.accountActive, active });
      await accountsRefresh('users', '#accountsMessage', `Access ${r.active ? 'turned on' : 'turned off'} for ${r.loginId}.`);
    }
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
});

document.querySelector('#content').addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id === 'staffInviteForm') {
    event.preventDefault();
    const button = form.querySelector('button'),
      message = form.querySelector('#staffInviteMessage'),
      e = form.elements;
    button.disabled = true;
    message.textContent = 'Creating the login…';
    try {
      const r = await Api.accounts('invite', {
        role: e.role.value,
        fullName: e.fullName.value.trim(),
        email: e.email.value.trim(),
        mobile: e.mobile.value.trim(),
      });
      await accountsRefresh('users', '#staffInviteMessage', `Created ${r.loginId}. A set-password link was emailed to ${r.email}.`);
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
    return;
  }
  if (form.matches('.account-create')) {
    event.preventDefault();
    const button = form.querySelector('button'),
      message = form.querySelector('.research-message'),
      app = state.submissions.find((a) => a.id === form.dataset.app),
      e = form.elements;
    button.disabled = true;
    message.textContent = 'Creating the login…';
    try {
      const r = await Api.accounts('invite', {
        role: 'client',
        applicationRef: app.id,
        plan: e.plan.value,
        products: [...form.querySelectorAll('[name=products]:checked')].map((x) => x.value),
        multiTier: e.multiTier.value || null,
        billing: e.billing.value,
      });
      accountsCreateFor = '';
      await accountsRefresh('approvals', '', '');
      toast(`Login ${r.loginId} created and emailed to ${r.email}`);
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
  }
});
