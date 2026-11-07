// Admin's Clients page: one table holding each client's application, approval, login, compliance
// and auto-email, with their onboarding details as tables under each row.

let clientHubOpen = '';
const HUB_COLUMNS = 8 + CLIENT_FACT_HEADS.length;

const hubDash = (value) => esc(value == null || value === '' ? '—' : value);

function hubRiskCell(r) {
  if (!r?.risk_category) return '<span class="status gray">Not done</span>';
  return `<span class="status ${r.derivatives_suitable ? 'green' : 'gold'}">${esc(r.risk_category)}</span><small>${r.risk_score}/36${r.derivatives_suitable ? '' : ' · F&O may not suit'}</small>`;
}
function hubAgreementCell(r) {
  if (!r) return '—';
  return r.agreement_signed_at
    ? `<span class="status green">Signed</span><small>${esc(complianceDate(r.agreement_signed_at))}</small>`
    : `<span class="status ${r.documents_pending ? 'gold' : 'gray'}">${r.documents_pending ? 'Sent, not signed' : 'Not sent'}</span>`;
}
function hubActions(app, key) {
  const open = clientHubOpen === key;
  return `${
    app?.status === 'Pending'
      ? `<div class="approval-actions"><button class="btn primary approve" data-app="${esc(app.id)}">Approve</button><button class="btn secondary reject" data-app="${esc(app.id)}">Reject</button></div>`
      : app
        ? approvalAccountCell(app)
        : ''
  }<button type="button" class="btn secondary" data-client-details="${esc(key)}" aria-expanded="${open}">${open ? 'Hide details' : 'Details'}</button>`;
}
// Field, value, field, value on each row.
function hubFacts(facts) {
  const rows = [];
  for (let i = 0; i < facts.length; i += 2) rows.push(facts.slice(i, i + 2));
  return `<div class="table-wrap"><table class="table"><tbody>${rows
    .map(
      (pair) =>
        `<tr>${pair.map(([label, value]) => `<td><small>${esc(label)}</small></td><td><b>${hubDash(value)}</b></td>`).join('')}</tr>`,
    )
    .join('')}</tbody></table></div>`;
}
const hubBrokerTable = (accounts) =>
  `<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Broker</th><th>Depository</th><th>Demat / BO ID</th><th>Trading client ID</th><th>Bank</th><th>IFSC</th><th>Account</th><th>Horizon</th><th>Objective</th><th>Loss tolerance</th></tr></thead><tbody>${accounts
                .map(
                  (a) =>
                    `<tr><td><b>${hubDash(a.product || a.segment)}</b></td><td>${hubDash(a.broker)}</td><td>${hubDash(a.depository)}</td><td>${hubDash(a.demat)}</td><td>${hubDash(a.tradingId)}</td><td>${hubDash(a.bank)}</td><td>${hubDash(a.ifsc)}</td><td>${a.accountNumber ? 'XXXX' + esc(a.accountNumber.slice(-4)) : '—'}</td><td>${hubDash(a.horizon)}</td><td>${hubDash(a.objective)}</td><td>${hubDash(a.loss)}</td></tr>`,
                )
                .join('')}</tbody></table></div>`;
function hubDetails(app, row, person) {
  const raw = app?.raw || {};
  return `${
    app
      ? `<h4>Onboarding details</h4>${app.pdfPath ? `<div class="actions"><button type="button" class="btn secondary" data-onboarding-file="${esc(app.pdfPath)}">View PDF</button></div>` : ''}${hubFacts([
          ['Application', app.id],
          ['Submitted', app.submitted],
          ['Services', app.services],
          ['Broker auto-email', raw.auto_email?.wanted ? raw.auto_email.broker + ' → ' + raw.auto_email.to : raw.auto_email ? 'Not requested' : ''],
          ['Products', app.products + (app.quoted ? ' (' + app.quoted + ' / year)' : '')],
        ])}<h4>Brokers</h4>${
          app.accounts.length
            ? hubBrokerTable(app.accounts)
            : `<p class="muted">${esc(app.broker)} · ${esc(app.demat)}</p>`
        }`
      : `<h4>Client</h4>${hubFacts([
          ['Email', person?.email],
          ['Mobile', person?.mobile],
        ])}`
  }${
    row?.risk_category
      ? `<div class="actions"><button type="button" class="btn secondary" data-risk-answers="${esc(row.client_id)}">${complianceAnswersFor === row.client_id ? 'Hide risk answers' : 'Risk answers'}</button></div>${complianceAnswersFor === row.client_id && latestRiskProfile(row.client_id) ? riskSummary(latestRiskProfile(row.client_id)) : ''}`
      : ''
  }`;
}
function clientHubTable(kycCell) {
  const compliance = complianceRows(),
    people = state.ws?.directory || [],
    seen = new Set(),
    entries = state.submissions.map((app) => {
      if (app.clientId) seen.add(app.clientId);
      return { app, row: compliance.find((r) => r.client_id === app.clientId) };
    });
  compliance.forEach((row) => {
    if (!seen.has(row.client_id)) entries.push({ row });
  });
  const body = entries
    .map(({ app, row }) => {
      const person = people.find((p) => p.id === (row?.client_id || app?.clientId)),
        login = row?.login_id || person?.login_id || '',
        key = login || app.id,
        plan = clients.find((c) => c[1] === login)?.[4];
      return `<tr><td><b>${esc(app?.name || row.full_name)}</b><small>${esc(login || app.id)}</small></td><td>${pendingCell(key)}</td><td>${hubActions(app, key)}</td>${clientFactCells(app, { pan: person?.pan, email: row?.email || person?.email, mobile: person?.mobile })}<td>${hubRiskCell(row)}</td><td>${hubAgreementCell(row)}</td><td>${row ? kycCell(row) : '—'}</td><td>${hubDash(plan)}</td><td>${login ? brokerAutoEmailCell(login) : '—'}</td></tr>${
        clientHubOpen === key ? `<tr><td colspan="${HUB_COLUMNS}">${hubDetails(app, row, person)}</td></tr>` : ''
      }`;
    })
    .join('');
  return `<article class="card panel"><div class="panel-head"><div><h3>Clients</h3><p>Approvals, compliance and auto-email for every client in one table.</p></div><button id="salesAddClientToggle" class="btn primary" aria-expanded="false">＋ Add client</button></div></article><section id="salesAddClientPanel" hidden>${addClient()}</section><article class="card panel"><div class="table-wrap"><table class="table approval-table"><thead><tr><th>Full legal name</th><th>Pending with</th><th>Actions</th>${clientFactHeads()}<th>Risk profile</th><th>Agreement</th><th>KYC</th><th>Plan</th><th>Auto email</th></tr></thead><tbody>${body || '<tr><td colspan="${HUB_COLUMNS}" class="empty">No clients yet.</td></tr>'}</tbody></table></div></article>`;
}

document.querySelector('#content').addEventListener('click', (event) => {
  const details = event.target.closest('[data-client-details]');
  if (!details) return;
  clientHubOpen = clientHubOpen === details.dataset.clientDetails ? '' : details.dataset.clientDetails;
  show('clients');
});
