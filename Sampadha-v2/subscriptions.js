// Client subscriptions: when each one ends, renewing it with the payment received, cancelling it
// and correcting an end date (Admin); the end-date warning a client sees; and the payments list.
// The database decides who may receive research (migration 20261127020000); this is its screen.
const subsToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST
const subsDays = (endsOn) => Math.round((Date.parse(endsOn) - Date.parse(subsToday())) / 86400e3);
// A subscription past its end date reads Expired even in the hour before the database marks it.
const subsStatus = (s) =>
  s.status === 'Active' && s.ends_on && s.ends_on < subsToday() ? 'Expired' : s.status;
const subsAddPeriod = (from, billing) => {
  const d = new Date(from + 'T00:00:00Z');
  if (billing === 'Annual') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 3);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const subsNextDay = (date) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
// Where a renewal starts: the day after the current end if still running, otherwise today.
const subsRenewFrom = (s) =>
  subsStatus(s) === 'Active' && s.ends_on ? subsNextDay(s.ends_on) : subsToday();
const subsFyStart = () => {
  const [y, m] = subsToday().split('-').map(Number);
  return `${m < 4 ? y - 1 : y}-04-01`;
};
const SUBS_MODES = ['UPI', 'Bank transfer', 'Cheque', 'Card', 'Cash', 'Other'];
let subsOpen = null; // { login, form: 'renew' | 'end' | 'cancel' }

const subsBadge = (s) => {
  const status = subsStatus(s);
  if (status !== 'Active')
    return `<span class="status ${status === 'Cancelled' ? 'gray' : 'red'}">${esc(status)}</span>${s.ends_on && status === 'Expired' ? `<small>Ended ${Api.fmt.dateOnly(s.ends_on)}</small>` : ''}`;
  if (!s.ends_on) return '<span class="status green">Active</span><small>No end date</small>';
  const days = subsDays(s.ends_on);
  return `<span class="status ${days <= 15 ? 'gold' : 'green'}">Active</span><small>${days === 0 ? 'Ends today' : days === 1 ? '1 day left' : days + ' days left'}</small>`;
};

function subsForm(s, person) {
  const login = person.login_id;
  const head = (title, text) =>
    `<div class="panel-head"><div><h3>${title}</h3><p>${text}</p></div></div>`;
  const foot = (label, danger) =>
    `<div class="actions"><button class="btn ${danger ? 'danger' : 'primary'}">${label}</button><button type="button" class="btn secondary" data-subs-close>Close</button></div><p class="research-message" role="status"></p>`;
  if (subsOpen.form === 'renew') {
    const plan = (state.ws?.plans || []).find((p) => p.code === s.plan_code),
      from = subsRenewFrom(s),
      price = (billing) =>
        plan ? Math.round(Number(plan.price_annual) / (billing === 'Annual' ? 1 : 4)) : '';
    return `<form class="subs-form" data-subs-form="renew" data-login="${esc(login)}" data-from="${from}" data-annual="${plan ? Number(plan.price_annual) : ''}">${head(
      `Renew ${esc(person.full_name)} (${esc(login)})`,
      'Record the payment received. The subscription is extended by one billing period and the client is told by email.',
    )}<div class="form-grid three"><label class="field">Billing period *<select name="billing">${['Quarterly', 'Annual'].map((b) => `<option${b === s.billing ? ' selected' : ''}>${b}</option>`).join('')}</select></label><label class="field">Amount received, including GST (₹) *<input name="amount" type="number" min="0" step="0.01" required value="${price(s.billing)}"><small>Enter 0 for a complimentary period: no invoice is made.</small></label><label class="field">GST rate (%) *<input name="gstRate" type="number" min="0" max="28" step="0.01" required value="18"></label><label class="field">Received on *<input name="paidOn" type="date" required max="${subsToday()}" value="${subsToday()}"></label><label class="field">Received by *<select name="mode">${SUBS_MODES.map((m) => `<option>${m}</option>`).join('')}</select></label><label class="field">Payment reference<input name="reference" maxlength="80" placeholder="UTR, cheque number"></label></div><div class="notice subs-summary" data-subs-summary></div>${foot('Renew subscription')}</form>`;
  }
  if (subsOpen.form === 'end')
    return `<form class="subs-form" data-subs-form="end" data-login="${esc(login)}">${head(
      `Change the end date for ${esc(person.full_name)} (${esc(login)})`,
      'Use this only to correct a date entered wrongly. To extend a paid subscription, renew it. The client is not emailed.',
    )}<div class="form-grid"><label class="field">Ends on *<input name="endsOn" type="date" required min="${esc(s.starts_on)}" value="${esc(s.ends_on || '')}"></label><label class="field">Reason *<input name="reason" required minlength="5" maxlength="300" placeholder="Why the date is changing"></label></div>${foot('Save end date')}</form>`;
  return `<form class="subs-form" data-subs-form="cancel" data-login="${esc(login)}">${head(
    `Cancel the subscription of ${esc(person.full_name)} (${esc(login)})`,
    'New research reports stop reaching this client at once, and they are told by email. Reports already received stay available to them. A cancelled subscription can be renewed later.',
  )}<div class="form-grid"><label class="field">Reason *<input name="reason" required minlength="5" maxlength="300" placeholder="Recorded in the audit trail"></label></div>${foot('Cancel subscription', true)}</form>`;
}

function clientSubsPage() {
  const subs = state.ws?.subscriptions || [],
    people = new Map((state.ws?.directory || []).map((p) => [p.id, p])),
    plans = new Map((state.ws?.plans || []).map((p) => [p.code, p.name])),
    rows = subs
      .map((s) => ({ s, person: people.get(s.client_id) }))
      .filter((r) => r.person)
      .sort((a, b) => (a.s.ends_on || '9999').localeCompare(b.s.ends_on || '9999')),
    live = rows.filter((r) => subsStatus(r.s) === 'Active'),
    soon = live.filter((r) => r.s.ends_on && subsDays(r.s.ends_on) <= 30),
    fy = subsFyStart(),
    collected = (state.ws?.payments || [])
      .filter((p) => p.status === 'Paid' && p.paid_on >= fy)
      .reduce((sum, p) => sum + Number(p.amount), 0);
  const open = subsOpen && rows.find((r) => r.person.login_id === subsOpen.login);
  return `${statCards([
    ['Live subscriptions', live.length, 'Receiving research'],
    ['Ending within 30 days', soon.length, soon.length ? 'Renew before they lapse' : 'None due'],
    ['Ended or cancelled', rows.length - live.length, 'Not receiving research'],
    ['Collected this financial year', Api.fmt.rupee(collected), 'Since ' + Api.fmt.dateOnly(fy)],
  ])}${open ? `<article class="card panel" style="margin-top:17px">${subsForm(open.s, open.person)}</article>` : ''}<article class="card panel" style="margin-top:17px"><div class="panel-head"><div><h3>Client subscriptions</h3><p>Soonest to end first. A client receives research only while the subscription is active and its end date has not passed.</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th>Plan</th><th>Billing</th><th>Started</th><th>Ends</th><th>Status</th><th>Actions</th></tr></thead><tbody>${
    rows
      .map(({ s, person }) => {
        const login = esc(person.login_id),
          status = subsStatus(s);
        return `<tr><td><b>${esc(person.full_name)}</b><small>${login}</small></td><td>${esc(plans.get(s.plan_code) || s.plan_code)}<small>${esc((s.products || []).join(', '))}${s.multi_tier ? ' • ' + esc(s.multi_tier) : ''}</small></td><td>${esc(s.billing)}</td><td>${Api.fmt.dateOnly(s.starts_on)}</td><td>${s.ends_on ? Api.fmt.dateOnly(s.ends_on) : '—'}</td><td>${subsBadge(s)}${s.cancel_reason ? `<small>${esc(s.cancel_reason)}</small>` : ''}</td><td><div class="compliance-actions"><button type="button" class="btn primary" data-subs-open="renew" data-login="${login}">Renew</button>${status === 'Cancelled' ? '' : `<button type="button" class="btn secondary" data-subs-open="end" data-login="${login}">Change end date</button><button type="button" class="btn secondary" data-subs-open="cancel" data-login="${login}">Cancel</button>`}</div></td></tr>`;
      })
      .join('') || '<tr><td colspan="7" class="empty">No client subscriptions yet. One is created with each client login.</td></tr>'
  }</tbody></table></div><p id="subsMessage" class="research-message" role="status"></p></article>`;
}

// What the renewal will do, in words, before the button is pressed.
function subsSummary(form) {
  const e = form.elements,
    to = subsAddPeriod(form.dataset.from, e.billing.value),
    amount = Number(e.amount.value),
    rate = Number(e.gstRate.value),
    taxable = Math.round((amount / (1 + rate / 100)) * 100) / 100;
  form.querySelector('[data-subs-summary]').textContent =
    `New period: ${Api.fmt.dateOnly(form.dataset.from)} to ${Api.fmt.dateOnly(to)}. ` +
    (amount > 0
      ? `Invoice for ${Api.fmt.rupee(amount, 2)}: ${Api.fmt.rupee(taxable, 2)} plus GST ${Api.fmt.rupee(amount - taxable, 2)} at ${rate}%.`
      : 'No payment and no invoice will be recorded.');
  form.querySelector('.btn.primary').textContent = 'Renew until ' + Api.fmt.dateOnly(to);
}

// ───────────── payments, for Admin (all clients) and for a client (their own) ─────────────
function paymentsPage() {
  const admin = state.role === 'admin',
    people = state.ws?.idToLogin,
    rows = [...(state.ws?.payments || [])].sort((a, b) =>
      String(b.paid_on || b.due_on || '').localeCompare(String(a.paid_on || a.due_on || '')),
    );
  return `<article class="card panel"><div class="panel-head"><div><h3>Payment details</h3><p>${admin ? 'Every payment recorded when a subscription was renewed, newest first.' : 'Payments recorded for your subscription, newest first.'}</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th>${admin ? '<th>Client</th>' : ''}<th>Period</th><th class="num">Before GST</th><th class="num">GST</th><th class="num">Amount</th><th>Received</th><th>Status</th></tr></thead><tbody>${
    rows
      .map(
        (p) =>
          `<tr><td>${esc(p.invoice_no)}</td>${admin ? `<td>${esc(people?.get(p.client_id) || '—')}</td>` : ''}<td>${esc(p.period_label)}<small>${esc(p.billing)}</small></td><td class="num">${p.taxable == null ? '—' : Api.fmt.rupee(p.taxable, 2)}</td><td class="num">${p.gst == null ? '—' : Api.fmt.rupee(p.gst, 2)}<small>${p.gst_rate == null ? '' : Number(p.gst_rate) + '%'}</small></td><td class="num"><b>${Api.fmt.rupee(p.amount, 2)}</b></td><td>${p.paid_on ? Api.fmt.dateOnly(p.paid_on) : p.due_on ? 'Due ' + Api.fmt.dateOnly(p.due_on) : '—'}<small>${esc([p.mode, p.reference].filter(Boolean).join(' • '))}</small></td><td><span class="status ${p.status === 'Paid' ? 'green' : p.status === 'Overdue' ? 'red' : 'gold'}">${esc(p.status)}</span></td></tr>`,
      )
      .join('') || `<tr><td colspan="${admin ? 8 : 7}" class="empty">No payments recorded.</td></tr>`
  }</tbody></table></div></article>`;
}

// ───────────── what a client sees when the end is near or past ─────────────
function subsClientNotice() {
  if (state.role !== 'client') return '';
  const s = (state.ws?.subscriptions || []).find((x) => x.client_id === state.user.uid);
  if (!s) return '';
  const status = subsStatus(s),
    contact = window.SAMPADHA_CONFIG.firm?.contactEmail,
    how = contact ? ` To renew, write to ${esc(contact)}.` : ' To renew, contact Sampadha.';
  if (status === 'Cancelled')
    return `<div class="notice subs-notice ended">Your subscription is cancelled, so new research reports will not reach you. Reports you already received stay available.${how}</div>`;
  if (status === 'Expired')
    return `<div class="notice subs-notice ended">Your subscription ended on ${Api.fmt.dateOnly(s.ends_on)}, so new research reports will not reach you. Reports you already received stay available.${how}</div>`;
  if (!s.ends_on || subsDays(s.ends_on) > 15) return '';
  const days = subsDays(s.ends_on);
  return `<div class="notice subs-notice">Your subscription ends on ${Api.fmt.dateOnly(s.ends_on)} (${days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days'}).${how}</div>`;
}

pages.clientSubs = clientSubsPage;
titles.clientSubs = 'Client subscriptions';
NAV_GROUP_OF.clientSubs = 'Billing';
if (typeof NAV_ICONS === 'object') NAV_ICONS.clientSubs = 'package';
// Admin has no subscription of their own, so "Subscribed products" becomes the clients' list.
nav.admin.splice(
  nav.admin.findIndex((x) => x[0] === 'products'),
  1,
  ['clientSubs', '◫', 'Client subscriptions'],
);
pages.payments = paymentsPage;
for (const page of ['clientDashboard', 'products']) {
  const original = pages[page];
  pages[page] = () => subsClientNotice() + original();
}

async function subsDone(message) {
  subsOpen = null;
  await refreshWorkspace();
  show('clientSubs');
  const target = document.querySelector('#subsMessage');
  if (target) target.textContent = message;
}

document.querySelector('#content').addEventListener('click', (event) => {
  const open = event.target.closest('[data-subs-open]');
  if (open) {
    subsOpen = { login: open.dataset.login, form: open.dataset.subsOpen };
    show('clientSubs');
    const form = document.querySelector('.subs-form');
    if (form?.dataset.subsForm === 'renew') subsSummary(form);
    form?.scrollIntoView({ block: 'nearest' });
    form?.querySelector('input,select')?.focus();
    return;
  }
  if (event.target.closest('[data-subs-close]')) {
    subsOpen = null;
    show('clientSubs');
  }
});

document.querySelector('#content').addEventListener('input', (event) => {
  const form = event.target.closest('[data-subs-form="renew"]');
  if (!form) return;
  // Changing the period sets the usual price for it; the amount stays editable.
  if (event.target.name === 'billing' && form.dataset.annual)
    form.elements.amount.value = Math.round(
      Number(form.dataset.annual) / (event.target.value === 'Annual' ? 1 : 4),
    );
  subsSummary(form);
});

document.querySelector('#content').addEventListener('submit', async (event) => {
  const form = event.target.closest('.subs-form');
  if (!form) return;
  event.preventDefault();
  const e = form.elements,
    login = form.dataset.login,
    button = form.querySelector('.actions .btn'),
    message = form.querySelector('.research-message');
  button.disabled = true;
  message.textContent = 'Saving…';
  try {
    if (form.dataset.subsForm === 'renew') {
      const r = await Api.renewSubscription(login, {
        billing: e.billing.value,
        amount: Number(e.amount.value),
        gstRate: Number(e.gstRate.value),
        paidOn: e.paidOn.value,
        mode: e.mode.value,
        reference: e.reference.value.trim(),
      });
      await subsDone(
        `${login} renewed until ${Api.fmt.dateOnly(r.ends_on)}.${r.invoice_no ? ' Invoice ' + r.invoice_no + ' recorded.' : ''} The client has been emailed.`,
      );
    } else if (form.dataset.subsForm === 'end') {
      const r = await Api.setSubscriptionEnd(login, e.endsOn.value, e.reason.value.trim());
      await subsDone(`${login} now ends on ${Api.fmt.dateOnly(r.ends_on)}.`);
    } else {
      await Api.cancelSubscription(login, e.reason.value.trim());
      await subsDone(`${login} is cancelled. The client has been emailed.`);
    }
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
});
