const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const roles = {
  admin: { name: 'Admin', desc: 'Full platform access' },
  ra: { name: 'Research Analyst', desc: 'Cash and Multi reports' },
  sales: { name: 'Sales', desc: 'Clients and communication' },
  client: { name: 'Client', desc: 'View-only investor access' },
};
const nav = {
  admin: [
    ['dashboard', '⌂', 'Overview'],
    ['workflowMap', '◆', 'Workflow chart'],
    ['users', '♙', 'Users & access'],
    ['clients', '◎', 'Clients'],
    ['addClient', '＋', 'Add client'],
    ['approvals', '✓', 'Client approvals'],
    ['emails', '✉', 'Email delivery'],
    ['multiReports', '▦', 'Multi Segment'],
    ['plans', '₹', 'Subscriptions'],
    ['products', '◫', 'Subscribed products'],
    ['payments', '₹', 'Payments'],
    ['recommendations', '↗', 'Recommendations'],
    ['audit', '◷', 'Audit trail'],
  ],
  ra: [
    ['dashboard', '⌂', 'Overview'],
    ['cashSegment', '₹', 'Cash Segment'],
    ['multiReports', '▦', 'Multi Segment'],
  ],
  sales: [
    ['profile', '♙', 'Profile'],
    ['clients', '◎', 'Clients'],
    ['emails', '✉', 'Client Communication'],
  ],
  client: [
    ['clientDashboard', '⌂', 'Dashboard'],
    ['notifications', '🔔', 'Notifications'],
    ['profile', '♙', 'Profile'],
  ],
};
// A client's Notifications and Profile each open as tabs. Every tab stays its own page.
const CLIENT_TABS = [
  {
    title: 'Notifications, recommendations & reports',
    tabs: [
      ['notifications', 'Notifications'],
      ['recommendations', 'All recommendations'],
      ['receivedReports', 'Reports'],
    ],
  },
  {
    title: 'Profile, products & payments',
    tabs: [
      ['profile', 'Profile'],
      ['products', 'Subscribed products'],
      ['payments', 'Payment details'],
    ],
  },
];
const clientTabGroup = (page) =>
  state.role === 'client' ? CLIENT_TABS.find((g) => g.tabs.some((t) => t[0] === page)) : null;
const clientTabBar = (group, page) =>
  `<div class="notification-toolbar">${group.tabs.map((t) => `<button class="filter-chip ${t[0] === page ? 'active' : ''}" data-go="${t[0]}">${t[1]}</button>`).join('')}</div>`;
const clients = []; // [name, id, risk, kyc, plan] — loaded from the database
const cashRecommendations = [];
const multiRecommendations = [];
const clientAlerts = [];
let state = {
  role: 'admin',
  user: null,
  page: 'dashboard',
  submissions: [],
  emails: [],
  ws: null,
};
const statCards = (arr) =>
  `<section class="cards">${arr.map((x) => `<article class="card stat"><div class="label"><span>${x[0]}</span><b>${x[3] || '◫'}</b></div><strong${/^[\d₹.,%\s–—-]*$|^\d+ of \d+$/.test(String(x[1])) ? '' : ' class="stat-text"'}>${x[1]}</strong><span class="positive">${x[2]}</span></article>`).join('')}</section>`;
const activity = () =>
  `<div class="activity">${[
    ['✓', 'KYC approved', 'Priya Sharma', '12 min'],
    ['↗', 'Strategy published', 'Momentum Select', '38 min'],
    ['₹', 'Annual plan renewed', 'Vikram Reddy', '2 hr'],
    ['▤', 'Report generated', 'INFY • Cash', 'Yesterday'],
  ]
    .map(
      (x) =>
        `<div class="activity-row"><span class="activity-icon">${x[0]}</span><div><b>${x[1]}</b><small>${x[2]}</small></div><time>${x[3]}</time></div>`,
    )
    .join('')}</div>`;
const raStats = () => {
  const reports = state.ws?.reports || [],
    cashCount = reports.filter((r) => r.segment === 'Cash').length;
  return [
    ['Cash reports', String(cashCount), 'Monthly, quarterly and half-yearly'],
    ['Multi reports', String(reports.length - cashCount), 'Created from the advice basket'],
    [
      'Signed PDF reports',
      String(reports.filter((r) => r.esignStatus === 'Signed').length),
      'Aadhaar eSigned and ready to send',
    ],
    [
      'Client deliveries',
      String(reports.reduce((total, r) => total + r.recipients.length, 0)),
      'Reports delivered to clients',
    ],
  ];
};
const raDashboard = () =>
  `${statCards(raStats())}${typeof chartCard === 'function' ? chartCard({ id: 'chartAuthored', title: 'Your reports', subtitle: 'Reports you created each month, by segment' }) : ''}<article class="card panel ra-workspace-card"><div class="panel-head"><div><h3>RA report workspace</h3><p>Only Research Analyst report work and activity are shown here.</p></div><span class="badge">Reports only</span></div><div class="cash-overview-actions"><button class="btn primary" data-go="cashSegment">Open Cash Segment</button><button class="btn secondary" data-go="multiReports">Open Multi Segment</button><button class="btn secondary" data-go="researchOrders">Open Positions</button></div><div class="grid-2"><div class="notice"><b>Cash Segment</b><br>Choose LC, MC or SC and the monthly, quarterly or half-yearly frequency, upload the report PDF, sign it with Aadhaar eSign and select clients.</div><div class="notice"><b>Multi Segment</b><br>Create multi-leg recommendations, attach supporting files, preview the PDF and manage positions.</div></div></article><article class="card panel ra-activity-card"><div class="panel-head"><div><h3>Recent RA activity</h3><p>Tabs viewed and report actions completed in this browser session.</p></div><span class="badge">This session</span></div>${typeof renderRaActivity === 'function' ? renderRaActivity() : '<p class="muted">Activity will appear after the RA opens a report area.</p>'}</article>`;
const dashboard = () =>
  state.role === 'ra'
    ? raDashboard()
    : `${statCards([
        ['Total users', '1,486', '+42 this month'],
        ['Active clients', '1,248', '83.9% of users'],
        ['Revenue', '₹1.82 Cr', '+12.4% YTD'],
        ['Pending KYC', '27', '9 require action'],
      ])}<section class="grid-2"><article class="card panel"><div class="panel-head"><div><h3>Platform activity</h3><p>Monthly actions across all workspaces</p></div><span class="badge">Last 8 months</span></div><div class="chart">${[42, 65, 54, 81, 72, 93, 78, 100].map((h) => `<i class="bar" style="height:${h}%"></i>`).join('')}</div></article><article class="card panel"><div class="panel-head"><div><h3>Recent activity</h3><p>Latest recorded events</p></div></div>${activity()}</article></section>`;
const users = () =>
  `<article class="card panel"><div class="panel-head"><div><h3>Users and access</h3><p>Admin can review all roles and account states.</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Account ID</th><th>Access</th><th>Status</th></tr></thead><tbody>${(
    state.ws?.directory || []
  )
    .map(
      (p) =>
        `<tr><td><b>${esc(p.full_name)}</b><small>${esc(p.email)}</small></td><td>${roles[p.role].name}</td><td class="stamp">${esc(p.login_id)}</td><td>${roles[p.role].desc}</td><td><span class="status ${p.is_active ? 'green' : 'red'}">${p.is_active ? 'Active' : 'Disabled'}</span></td></tr>`,
    )
    .join('')}</tbody></table></div></article>`;
// Who the client's onboarding is waiting for, by login ID or, before a login exists, application.
const pendingCell = (key) => {
  const row = (state.ws?.clientPending || []).find((p) => p.login_id === key || p.app_ref === key);
  if (!row) return '—';
  return `<span class="status ${row.pending === 'Complete' ? 'green' : /^Rejected/.test(row.pending) ? 'red' : 'gold'}">${esc(row.pending)}</span>`;
};
const clientTable = (showAdd = true) =>
  `<article class="card panel"><div class="panel-head"><div><h3>Client relationships</h3><p>Profiles, KYC state and current subscription.</p></div>${showAdd ? '<button class="btn primary" data-go="addClient">＋ Add client</button>' : ''}</div><div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th>Risk profile</th><th>KYC</th><th>Plan</th><th>Mobile</th><th>Auto email</th><th>Pending with</th></tr></thead><tbody>${clients.map((x) => `<tr><td><b>${esc(x[0])}</b><small>${esc(x[1])} • ${esc(x[5])}</small></td><td>${esc(x[2])}</td><td><span class="status ${/verified/i.test(x[3]) ? 'green' : /review/i.test(x[3]) ? 'gold' : 'red'}">${esc(x[3])}</span></td><td>${esc(x[4])}</td><td class="stamp">${esc(x[6])}</td><td>${brokerAutoEmailCell(x[1])}</td><td>${pendingCell(x[1])}</td></tr>`).join('')}${state.submissions.filter((x) => !x.clientId).map((x) => `<tr><td><b>${esc(x.name)}</b><small>${esc(x.id)} • ${esc(x.email)}</small></td><td>${esc(x.risk)}</td><td><span class="status ${x.status === 'Approved' ? 'green' : x.status === 'Rejected' ? 'red' : 'gold'}">${x.status === 'Approved' ? 'KYC approved' : x.status === 'Rejected' ? 'Rejected' : 'Admin approval pending'}</span></td><td>Not assigned</td><td class="stamp">${esc(x.mobile || '—')}</td><td>—</td><td>${pendingCell(x.id)}</td></tr>`).join('')}</tbody></table></div></article>`;
const MARKET_SEGMENTS = ['Cash', 'MTF', 'Equity derivatives', 'Commodity derivatives'];
const CLIENT_CASH_PRODUCTS = ['LC', 'MC', 'SC', 'FC'];
const CLIENT_MULTI_PRODUCTS = ['Bronze', 'Silver', 'Palladium', 'Platinum', 'Gold', 'Rhodium'];
const CLIENT_PRODUCTS = [...CLIENT_CASH_PRODUCTS, ...CLIENT_MULTI_PRODUCTS];
const CLIENT_SERVICES = [
  'Prop Trading',
  'Single Stock Management',
  'Custom Research Report',
  'Custom Research Recommendation',
];
const brokerDeskNames = () => (state.ws?.brokerDesks || []).map((d) => d.name);
const productCheck = (product) => {
  const price = (state.ws?.productPrices || []).find((p) => p.product === product)?.price_annual;
  return `<label><input type="checkbox" name="products" value="${product}" data-price="${price ?? ''}"> ${product}${price == null ? '' : ` <small>${Api.fmt.rupee(price)} / year</small>`}</label>`;
};
// One block per ticked product, because a client can use a different broker for each.
const brokerBlock = (product, i) =>
  `<fieldset data-broker-block="${esc(product)}" hidden disabled><legend>${esc(product)} broker</legend><div class="form-grid three"><label class="field">Broker name *<select name="broker_${i}" required>${[...brokerDeskNames(), 'Others'].map((n) => `<option>${esc(n)}</option>`).join('')}</select></label><label class="field" data-other-broker hidden>Other broker name *<input name="brokerOther_${i}" maxlength="80" placeholder="Broker name"></label><label class="field">Depository *<select name="depository_${i}"><option>CDSL</option><option>NSDL</option></select></label><label class="field">Demat / BO ID *<input name="demat_${i}" required placeholder="16-digit beneficiary ID"></label><label class="field">Trading client ID *<input name="tradingId_${i}" required placeholder="Broker client code"></label><label class="field">Primary bank *<input name="bank_${i}" required placeholder="Bank name"></label><label class="field">Bank IFSC code *<input name="ifsc_${i}" required maxlength="11" pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}" title="11 characters, e.g. HDFC0001234" placeholder="e.g. HDFC0001234"></label><label class="field">Bank account number *<input name="accountNumber_${i}" required inputmode="numeric" maxlength="18" pattern="[0-9]{9,18}" title="9 to 18 digits" placeholder="9 to 18 digits"></label><label class="field">Holding horizon *<select name="horizon_${i}"><option>Under 1 year</option><option>1–3 years</option><option>3–5 years</option><option>More than 5 years</option></select></label><label class="field">Investment objective *<select name="objective_${i}"><option>Monthly cash flows</option><option>Quarterly cash flows</option><option>Quarterly cash flows + Capital appreciation</option><option>Capital appreciation</option></select></label><label class="field">Maximum loss tolerance *<select name="loss_${i}"><option>Up to 20%</option><option>Up to 35%</option><option>Up to 50%</option><option>Up to 70%</option></select></label></div></fieldset>`;
function syncAddClient() {
  const form = $('#addClientForm');
  if (!form) return;
  const ticked = [...form.querySelectorAll('[name=products]:checked')].map((x) => x.value);
  form.querySelectorAll('[data-broker-block]').forEach((block) => {
    const on = ticked.includes(block.dataset.brokerBlock),
      other = block.querySelector('[data-other-broker]'),
      input = other.querySelector('input'),
      isOther = block.querySelector('select').value === 'Others';
    block.hidden = !on;
    block.disabled = !on;
    other.hidden = !isOther;
    input.required = isOther;
  });
  const prices = [...form.querySelectorAll('[name=products]:checked')].map((x) => x.dataset.price),
    total = prices.reduce((sum, p) => sum + Number(p || 0), 0),
    missing = prices.filter((p) => p === '').length;
  $('#productTotal').textContent = prices.length
    ? `Total for the ticked products: ${Api.fmt.rupee(total)} / year${missing ? ` (${missing} without a price yet)` : ''}`
    : '';
}
const experienceOptions = () =>
  '<option>New / No experience</option><option>Under 1 year</option><option>1–3 years</option><option>3–5 years</option><option>More than 5 years</option>';
const addClient = () =>
  `<form id="addClientForm"><section class="form-section card panel"><div class="panel-head"><div><h3>Personal and KYC details</h3><p>Fields marked required must be completed before submission.</p></div><span class="badge">Step 1 of 3</span></div><div class="form-grid three"><label class="field">Full legal name *<input name="name" required placeholder="As per PAN"></label><label class="field">PAN number *<input name="pan" required pattern="[A-Z]{5}[0-9]{4}[A-Z]" maxlength="10" placeholder="ABCDE1234F"></label><label class="field">Date of birth *<input name="dob" type="date" required></label><label class="field">Email address *<input name="email" type="email" required></label><label class="field">Mobile number *<input name="mobile" required placeholder="+91 98765 43210"></label><label class="field">Occupation *<select name="occupation" required><option value="">Select</option><option>Salaried</option><option>Business</option><option>Professional</option><option>Retired</option></select></label><label class="field">Annual income *<select name="income" required><option>₹5–10 lakh</option><option>₹10–25 lakh</option><option>₹25–50 lakh</option><option>Above ₹50 lakh</option></select></label><label class="field">Net worth *<select name="netWorth" required><option>Below ₹10 lakh</option><option>₹10–25 lakh</option><option>₹25–75 lakh</option><option>₹75 lakh–₹2.5 crore</option><option>₹2.5–5 crore</option><option>Above ₹5 crore</option></select></label><label class="field">Tax residency *<select name="residency"><option>Resident Indian – Non business</option><option>Resident Indian – Business</option><option>Non-individual (LLP, Private Limited etc.)</option><option>Non-resident individual</option></select></label><label class="field">City *<input name="city" required value="Mumbai"></label><label class="field">Mutual fund investment experience<select name="mfExperience">${experienceOptions()}</select></label><label class="field">Stocks investment experience<select name="stockExperience">${experienceOptions()}</select></label><label class="field">F &amp; O trading experience<select name="foExperience">${experienceOptions()}</select></label><label class="field">Proposed investment amount *<input name="amount" type="number" min="10000" value="500000" required></label></div><fieldset><legend>Required market segments *</legend><div class="checks">${MARKET_SEGMENTS.map((x) => `<label><input type="checkbox" name="segments" value="${x}"${x === 'Cash' ? ' checked' : ''}> ${x}</label>`).join('')}</div></fieldset></section><section class="form-section card panel"><div class="panel-head"><div><h3>Products and services</h3><p>Choose the services and products, then enter the broker and suitability details for each product.</p></div><span class="badge">Step 2 of 3</span></div><fieldset><legend>Services</legend><div class="checks">${CLIENT_SERVICES.map((x) => `<label><input type="checkbox" name="services" value="${x}"> ${x}</label>`).join('')}</div></fieldset><fieldset><legend>Interested products *</legend><h4>Cash segment</h4><div class="checks">${CLIENT_CASH_PRODUCTS.map(productCheck).join('')}</div><h4>Multi segment</h4><div class="checks">${CLIENT_MULTI_PRODUCTS.map(productCheck).join('')}</div><p id="productTotal" class="research-notice"></p></fieldset>${CLIENT_PRODUCTS.map(brokerBlock).join('')}</section><section class="form-section card panel"><div class="panel-head"><div><h3>Client confirmation</h3><p>Send the details to the client, then submit for Admin approval.</p></div><span class="badge">Step 3 of 3</span></div><label class="consent"><input name="consent" type="checkbox" required><span><b>Send above details to client mail *</b><small>Admin gets this for approval. The client gets the details as a PDF by email, then accepts them in their login once Admin creates it.</small></span></label><div class="notice">Submitting creates a pending record. Only an Admin login can approve or reject the client.</div><div class="actions"><button type="reset" class="btn secondary">Clear form</button><button class="btn primary">Submit for Admin approval →</button></div></section></form>`;
const salesClientsPage = () =>
  `<article class="card panel"><div class="panel-head"><div><p class="overline">Client relationships</p><h3>Clients</h3><p>View existing clients or add a new share-market client for Admin approval.</p></div><button id="salesAddClientToggle" class="btn primary" aria-expanded="false">＋ Add client</button></div></article><section id="salesAddClientPanel" hidden>${addClient()}</section>${clientTable(false)}`;
const approvals = () =>
  `<article class="card panel"><div class="panel-head"><div><h3>Client approval queue</h3><p>Only Admin can approve or reject submitted onboarding records.</p></div><span class="badge">${state.submissions.filter((x) => x.status === 'Pending').length} pending</span></div><div class="table-wrap"><table class="table approval-table"><thead><tr><th>Applicant</th><th>Market account</th><th>Segments</th><th>Risk / Amount</th><th>Submitted</th><th>Status</th><th>Admin action</th></tr></thead><tbody>${state.submissions.map((x) => `<tr><td><b>${esc(x.name)}</b><small>${esc(x.pan)} • ${esc(x.mobile)}<br>${esc(x.email)}</small>${x.pdfPath ? `<button type="button" class="btn secondary" data-onboarding-file="${esc(x.pdfPath)}">View PDF</button>` : ''}</td><td>${x.accounts.length ? x.accounts.map((a) => `${esc(a.product)}: ${esc(a.broker)}<small>${esc(a.demat)} • ${esc(a.tradingId)}</small><small>${esc(a.bank)} • ${esc(a.ifsc)} • XXXX${esc((a.accountNumber || '').slice(-4))}</small><small>${esc(a.horizon)} • ${esc(a.objective)} • ${esc(a.loss)}</small>`).join('') : `${esc(x.broker)}<small>${esc(x.demat)}</small>`}</td><td>${esc(x.segments)}<small>${esc(x.services)}</small><small>${esc(x.products)}${x.quoted ? ' • ' + esc(x.quoted) + ' / year' : ''}</small></td><td>${esc(x.risk)}<small>${esc(x.amount)}</small><small>Net worth ${esc(x.netWorth)}</small><small>MF ${esc(x.mfExperience)} • Stocks ${esc(x.stockExperience)} • F&amp;O ${esc(x.foExperience)}</small></td><td class="stamp">${esc(x.submitted)}</td><td><span class="status ${x.status === 'Approved' ? 'green' : x.status === 'Rejected' ? 'red' : 'gold'}">${x.status}</span></td><td>${x.status === 'Pending' ? `<div class="approval-actions"><button class="btn primary approve" data-app="${esc(x.id)}">Approve</button><button class="btn secondary reject" data-app="${esc(x.id)}">Reject</button></div>` : typeof approvalAccountCell === 'function' ? approvalAccountCell(x) : '<small>Decision recorded</small>'}</td></tr>`).join('')}</tbody></table></div></article>`;
const plans = () =>
  `<section class="plan-grid">${(state.ws?.plans || [])
    .map(
      (p, i, all) =>
        `<article class="card plan ${i === all.length - 1 ? 'featured' : ''}"><span class="badge">${i === all.length - 1 ? 'Most complete' : 'Subscription'}</span><h3>${esc(p.name)}</h3><div class="price">${Api.fmt.rupee(p.price_annual)}<small>/ annum</small></div><p class="muted">${esc(p.summary)}</p><ul><li>Advisor research access</li><li>Recommendation history</li><li>${i ? 'Quarterly' : 'Annual'} portfolio review</li></ul></article>`,
    )
    .join('')}</section>${state.role === 'admin' ? productPricesCard() : ''}`;
const productPricesCard = () =>
  `<article class="card panel"><div class="panel-head"><div><h3>Product prices</h3><p>Annual price for each product, shown beside it on the Add client form. Leave blank until a price is set.</p></div></div><form id="productPricesForm"><div class="form-grid three">${(state.ws?.productPrices || []).map((p) => `<label class="field">${esc(p.product)}<small>${esc(p.segment)}</small><input name="${esc(p.product)}" type="number" min="0" step="1" value="${p.price_annual ?? ''}" placeholder="₹ per year"></label>`).join('')}</div><div class="actions"><button class="btn primary">Save prices</button></div></form></article>`;
const profile = () =>
  `<section class="profile"><article class="card profile-card"><div class="profile-avatar">${esc(state.user.initials)}</div><h3>${esc(state.user.person)}</h3><p class="muted">${roles[state.role].name} account</p><span class="status green">Verified</span></article><article class="card panel"><div class="panel-head"><div><h3>Profile details</h3><p>Account and contact information.</p></div></div><div class="detail-grid">${[
    ['Email', esc(state.user.email)],
    ['Mobile', esc(state.user.mobile)],
    ['Account ID', esc(state.user.id)],
    ['PAN', esc(state.user.pan)],
    ['Risk profile', esc(state.user.risk)],
    ['KYC status', esc(state.user.kyc)],
  ]
    .map((x) => `<div class="detail"><small>${x[0]}</small><b>${x[1]}</b></div>`)
    .join('')}</div></article></section>`;
const PRODUCT_INFO = {
  Cash: ['Direct equity ideas', 'As published'],
  Multi: ['Derivatives research', 'As published'],
  All: ['Complete research access', 'Ongoing'],
};
const products = () => {
  const sub = state.ws?.subscriptions?.find((x) => x.client_id === state.user.uid) || {},
    plan = state.ws?.plans?.find((p) => p.code === sub.plan_code),
    items = sub.products || [];
  return `${statCards([
    ['Active products', items.length, items.join(', ') || 'No active subscription'],
    [
      'Current plan',
      esc(plan?.name || '—'),
      sub.ends_on ? 'Valid until ' + Api.fmt.dateOnly(sub.ends_on) : 'No end date',
    ],
    ['Research tier', esc(sub.multi_tier || '—'), 'Multi derivatives access'],
    ['Risk profile', esc(state.user.risk), 'KYC: ' + esc(state.user.kyc)],
  ])}<article class="card panel" style="margin-top:17px"><div class="panel-head"><div><h3>Subscribed products</h3><p>Your currently active research access.</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Coverage</th><th>Frequency</th><th>Started</th><th>Status</th></tr></thead><tbody>${
    items
      .map(
        (name) =>
          `<tr><td><b>${esc(name)}</b></td><td>${esc((PRODUCT_INFO[name] || ['—', '—'])[0])}</td><td>${esc((PRODUCT_INFO[name] || ['—', '—'])[1])}</td><td>${Api.fmt.dateOnly(sub.starts_on)}</td><td><span class="status ${sub.status === 'Active' ? 'green' : 'gold'}">${esc(sub.status)}</span></td></tr>`,
      )
      .join('') || '<tr><td colspan="5" class="empty">No subscribed products.</td></tr>'
  }</tbody></table></div></article>`;
};
const payments = () => {
  const plan = (code) => state.ws?.plans?.find((p) => p.code === code)?.name || code;
  return `<article class="card panel"><div class="panel-head"><div><h3>Payment details</h3><p>Quarterly and annual subscription transactions.</p></div><span class="badge">FY 2026–27</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Plan</th><th>Period</th><th>Billing</th><th class="num">Amount</th><th>Paid on</th><th>Status</th></tr></thead><tbody>${
    (state.ws?.payments || [])
      .map(
        (p) =>
          `<tr><td>${esc(p.invoice_no)}</td><td>${esc(plan(p.plan_code))}</td><td>${esc(p.period_label)}</td><td>${esc(p.billing)}</td><td class="num">${Api.fmt.rupee(p.amount)}</td><td>${p.paid_on ? Api.fmt.dateOnly(p.paid_on) : p.due_on ? 'Scheduled ' + Api.fmt.dateOnly(p.due_on) : '—'}</td><td><span class="status ${p.status === 'Paid' ? 'green' : p.status === 'Overdue' ? 'red' : 'gold'}">${esc(p.status)}</span></td></tr>`,
      )
      .join('') || '<tr><td colspan="7" class="empty">No payments recorded.</td></tr>'
  }</tbody></table></div></article>`;
};
const cashRecommendationTable = (data) =>
  `<div class="table-wrap recommendation-table"><table class="table"><thead><tr><th>Product</th><th>Stock</th><th class="num">Initiation price</th><th class="num">Initiation quantity</th><th>Published date</th><th>Delivered date</th><th>Status</th><th>Report</th></tr></thead><tbody>${data.length ? data.map((x) => `<tr><td><span class="badge">${esc(x.product)}</span></td><td><b>${esc(x.stock)}</b><small>${esc(x.id)}</small></td><td class="num">${esc(x.price)}</td><td class="num">${esc(x.qty)}</td><td class="stamp">${esc(x.published)} IST</td><td class="stamp">${esc(x.delivered)} IST</td><td><span class="status ${x.status === 'Active' ? 'green' : 'gray'}">${esc(x.status)}</span></td><td><button class="pdf-btn" data-report="${esc(x.id)}" data-segment="Cash">Details</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">No Cash recommendations match these filters.</td></tr>'}</tbody></table></div>`;
const multiRecommendationTable = (data) =>
  `<div class="table-wrap recommendation-table"><table class="table wide-table"><thead><tr><th>Product</th><th>Symbol</th><th>Expiry date</th><th class="num">Strike price</th><th>Option type</th><th>Buy/Sell</th><th class="num">No. of lots</th><th class="num">Lot size</th><th class="num">Quantity</th><th class="num">Initiation price</th><th>Published date</th><th>Delivered date</th><th>Status</th><th>Report</th></tr></thead><tbody>${data.length ? data.map((x) => `<tr><td><span class="badge">${esc(x.product)}</span></td><td><b>${esc(x.symbol)}</b><small>${esc(x.id)}</small></td><td>${esc(x.expiry)}</td><td class="num">${esc(x.strike)}</td><td>${esc(x.option)}</td><td><span class="status ${x.side === 'BUY' ? 'green' : 'gold'}">${esc(x.side)}</span></td><td class="num">${esc(x.lots)}</td><td class="num">${esc(x.lotSize)}</td><td class="num"><b>${esc(x.qty)}</b></td><td class="num">${esc(x.price)}</td><td class="stamp">${esc(x.published)} IST</td><td class="stamp">${esc(x.delivered)} IST</td><td><span class="status ${x.status === 'Active' ? 'green' : 'gray'}">${esc(x.status)}</span></td><td><button class="pdf-btn" data-report="${esc(x.id)}" data-segment="Multi">Details</button></td></tr>`).join('') : '<tr><td colspan="14" class="empty">No Multi recommendations match these filters.</td></tr>'}</tbody></table></div>`;
const recommendationPanel = (segment, data) => {
  const cash = segment === 'Cash';
  return `<article class="card panel recommendation-section ${segment.toLowerCase()}-section"><div class="segment-banner"><div><p class="overline">${segment} recommendations</p><h3>${cash ? 'Cash equity recommendation table' : 'Multi derivatives recommendation table'}</h3><p>${cash ? 'LC, MC, SC and All equity products.' : 'Bronze, Silver, Palladium, Platinum, Gold and Rhodium derivatives products.'}</p></div><div class="segment-heading-meta"><span class="badge" id="${cash ? 'cash' : 'multi'}RecommendationCount">${data.length} records</span><span class="segment-mark">${icon(cash ? 'rupee' : 'layers')}</span></div></div>${cash ? `<form id="cashRecommendationFilters" class="separate-table-filters cash-table-filters"><label>Product<select id="crProduct"><option>All</option><option>LC</option><option>MC</option><option>SC</option></select></label><label>Stock<select id="crStock"><option>All</option>${[...new Set(cashRecommendations.map((x) => x.stock))].map((x) => `<option>${x}</option>`).join('')}</select></label><label>Status<select id="crStatus"><option>All</option><option>Active</option><option>Closed</option></select></label><button class="btn secondary">Apply Cash filters</button><button id="resetCashRecommendations" type="button" class="btn secondary">Reset</button></form><div id="cashRecommendationTable">${cashRecommendationTable(data)}</div>` : `<form id="multiRecommendationFilters" class="separate-table-filters multi-table-filters"><label>Product<select id="mrProduct"><option>All</option>${['Bronze', 'Silver', 'Palladium', 'Platinum', 'Gold', 'Rhodium'].map((x) => `<option>${x}</option>`).join('')}</select></label><label>Symbol<select id="mrSymbol"><option>All</option>${[...new Set(multiRecommendations.map((x) => x.symbol))].map((x) => `<option>${esc(x)}</option>`).join('')}</select></label><label>Option type<select id="mrOption"><option>All</option><option>CE</option><option>PE</option></select></label><label>Buy / Sell<select id="mrSide"><option>All</option><option>BUY</option><option>SELL</option></select></label><label>Status<select id="mrStatus"><option>All</option><option>Active</option><option>Review</option><option>Closed</option></select></label><button class="btn secondary">Apply Multi filters</button><button id="resetMultiRecommendations" type="button" class="btn secondary">Reset</button></form><div id="multiRecommendationTable">${multiRecommendationTable(data)}</div>`}</article>`;
};
const recommendationResults = () =>
  `<div class="recommendation-stack">${recommendationPanel('Cash', cashRecommendations)}${recommendationPanel('Multi', multiRecommendations)}</div>`;
function recommendationPage() {
  return `<article class="card panel recommendation-filter"><div class="panel-head"><div><h3>All recommendations</h3><p>Cash and Multi have independent filters and separate tables.</p></div><span class="badge">${cashRecommendations.length + multiRecommendations.length} total records</span></div><div class="notice">Research communication only—not an order or guaranteed return. Discuss suitability with your advisor.</div></article><section id="recommendationResults">${recommendationResults()}</section><div id="pdfModal" class="pdf-modal hidden"><div class="pdf-sheet"><div class="pdf-head"><div><small>Sampadha Research</small><h3 id="pdfTitle">Recommendation report</h3></div><button id="closePdf" type="button">×</button></div><div id="pdfBody"></div><div class="pdf-foot"><span>Recommendation summary. The signed report is under Reports received.</span></div></div></div>`;
}
const alertRows = (data) =>
  `<div class="notification-list">${data.map((x) => `<article class="notification-row ${x.unread ? 'unread' : ''}"><span class="channel-icon">${icon(CHANNEL_ICONS[x.channel] || 'bell')}</span><div><b>${esc(x.title)}</b><small>${esc(x.detail)}</small><small>${esc(x.channel)} • ${esc(x.id)}</small></div><time>${esc(x.time)}</time></article>`).join('') || '<div class="empty">No notifications in this channel.</div>'}</div>`;
const clientDashboard = () => {
  const unread = clientAlerts.filter((x) => x.unread).length;
  return `<section class="client-welcome card"><div><p class="overline">Client overview</p><h3>Good morning, ${state.user.person.split(' ')[0]}</h3><p>Your research, alerts and account updates are together here.</p></div><button class="btn primary" data-go="notifications">View ${unread} new alerts →</button></section>${statCards(
    [
      ['Unread alerts', unread, 'Email, WhatsApp and in-app'],
      ['Cash ideas', cashRecommendations.length, 'LC, MC, SC and All'],
      ['Multi updates', multiRecommendations.length, 'Bronze to Rhodium'],
      ['Next review', '30 Sep', 'Quarterly advisor review'],
    ],
  )}<section class="channel-grid">${[
    [icon('mail'), 'Email alerts', 'Enabled'],
    [icon('message'), 'WhatsApp alerts', 'Enabled'],
    [icon('bell'), 'Dashboard alerts', 'Enabled'],
  ]
    .map(
      (x) =>
        `<article class="card channel-card"><span class="channel-icon">${x[0]}</span><div><b>${x[1]}</b><small>Instant recommendation updates</small></div><span class="status green">${x[2]}</span></article>`,
    )
    .join(
      '',
    )}</section><section class="grid-2"><article class="card panel"><div class="panel-head"><div><h3>Latest notifications</h3><p>Most recent communication across all channels.</p></div><button class="btn secondary" data-go="notifications">View all</button></div>${alertRows(clientAlerts.slice(0, 3))}</article><article class="card panel"><div class="panel-head"><div><h3>All recommendations</h3><p>Choose Cash or Multi and view its dedicated table.</p></div></div><div class="activity"><button class="activity-row" data-go="recommendations"><span class="activity-icon">↗</span><div><b>Open recommendations</b><small>Cash equity and Multi derivatives reports</small></div><time>Open →</time></button></div></article></section>`;
};
const notifications = () =>
  `<article class="card panel"><div class="panel-head"><div><h3>Notification centre</h3><p>Every alert sent to you, by channel.</p></div><button id="markRead" class="btn secondary">Mark all as read</button></div><section class="channel-grid">${[
    [icon('mail'), 'Email', clientAlerts.filter((x) => x.channel === 'Email').length],
    [icon('message'), 'WhatsApp', clientAlerts.filter((x) => x.channel === 'WhatsApp').length],
    [icon('bell'), 'In-app', clientAlerts.filter((x) => x.channel === 'In-app').length],
  ]
    .map(
      (x) =>
        `<article class="card channel-card"><span class="channel-icon">${x[0]}</span><div><b>${x[1]}</b><small>${x[2]} alert${x[2] === 1 ? '' : 's'}</small></div></article>`,
    )
    .join(
      '',
    )}</section><div class="notification-toolbar">${['All', 'Email', 'WhatsApp', 'In-app'].map((x, i) => `<button class="filter-chip ${i === 0 ? 'active' : ''}" data-channel="${x}">${x}</button>`).join('')}</div><div id="notificationResults">${alertRows(clientAlerts)}</div></article>`;
const workflowMap = () =>
  `<section class="flow-summary"><div><p class="overline">End-to-end operating model</p><h3>Sampadha platform workflow</h3><p>Role-based journey from client acquisition to approved research delivery.</p></div><div class="flow-legend"><span><i class="sales-dot"></i>Sales</span><span><i class="admin-dot"></i>Admin</span><span><i class="ra-dot"></i>Research Analyst</span><span><i class="client-dot"></i>Client</span></div></section><section class="workflow-board card"><div class="flow-start"><span>01</span><div><b>Secure role login</b><small>System identifies Admin, RA, Sales or Client access.</small></div></div><div class="flow-split">${[
    [
      'sales',
      '02',
      'Sales acquisition',
      'Create profile • collect KYC • Demat, broker and suitability details',
    ],
    [
      'ra',
      '02',
      'Research creation',
      'Build strategies • cover stocks • generate timestampVtbl reports',
    ],
  ]
    .map(
      (x) =>
        `<article class="lane ${x[0]}"><div class="lane-title">${x[0] === 'sales' ? 'Sales lane' : 'Research lane'}</div><div class="flow-node"><span>${x[1]}</span><div><b>${x[2]}</b><small>${x[3]}</small></div></div>${x[0] === 'sales' ? `<div class="flow-arrow">↓</div><div class="flow-node"><span>03</span><div><b>Submit client application</b><small>Status: Pending Admin Approval</small></div></div><div class="flow-arrow mail-arrow">↓ <em>Automatic email</em></div><div class="flow-node email-node"><span>✉</span><div><b>Application received</b><small>Client receives reference and IST timestamp.</small></div></div>` : `<div class="flow-arrow">↓</div><div class="flow-node"><span>03</span><div><b>Publish research</b><small>Single/batch reports • Cash, Multi and All products</small></div></div>`}</article>`,
    )
    .join(
      '',
    )}</div><div class="flow-arrow central">↓</div><article class="admin-gate"><div class="lane-title">Admin control gate</div><div class="flow-node admin"><span>04</span><div><b>Review client and research records</b><small>Approve or reject onboarding • manage access • preserve audit trail</small></div></div><div class="decision"><div><b>Approved</b><small>Activate profile and selected plan</small></div><span>OR</span><div><b>Changes required</b><small>Return application for correction</small></div></div></article><div class="flow-arrow mail-arrow central">↓ <em>Decision email</em></div><div class="flow-end-grid"><article class="flow-node client"><span>05</span><div><b>Client confirmation</b><small>Approval or correction-required email with reference and timestamp.</small></div></article><article class="flow-node client"><span>06</span><div><b>View-only client portal</b><small>Profile • subscribed products • payments • filtered recommendations</small></div></article><article class="flow-node audit"><span>07</span><div><b>Ongoing audit and review</b><small>Admin oversight • quarterly/annual payments • report history</small></div></article></div></section>`;
// What Client Communication filters on. A client's code, PAN and mobile come from their profile,
// or from the application while they have no login yet.
const commDetails = (x) => {
  const person = (state.ws?.directory || []).find((p) => p.email === x.to),
    application = state.submissions.find((a) => a.email === x.to),
    meta = (state.ws?.mailMeta || []).find((m) => m.mail_ref === x.id),
    code = person?.login_id || (x.application === '—' ? '' : x.application),
    pan = person?.pan || application?.pan || '',
    mobile = person?.mobile || application?.mobile || '';
  return {
    code,
    pan,
    mobile,
    sender: meta?.sender || 'System',
    product: meta?.segment || '',
    search: [code, x.name, pan, mobile, x.to].join(' ').toLowerCase(),
  };
};
const commFilters = () =>
  `<form id="commFilters" class="separate-table-filters"><label>Sent / added by<select id="commSender"><option value="">All senders</option><option>Admin</option><option>RA</option><option>Sales</option></select></label><label>Product<select id="commProduct"><option value="">Cash &amp; Multi</option><option>Cash</option><option>Multi</option></select></label><label>Search client<input id="commSearch" type="search" list="commClients" placeholder="Choose or type a client"><datalist id="commClients">${(state.ws?.directory || []).filter((p) => p.role === 'client').map((p) => `<option value="${esc(p.login_id)}">${esc(p.full_name)}</option>`).join('')}</datalist></label></form>`;
function applyCommFilters() {
  const sender = $('#commSender').value,
    product = $('#commProduct').value,
    text = $('#commSearch').value.trim().toLowerCase();
  let shown = 0;
  $$('.email-item').forEach((item) => {
    const match =
      (!sender || item.dataset.sender === sender) &&
      (!product || item.dataset.product === product) &&
      (!text || item.dataset.search.includes(text));
    item.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  $('#commCount').textContent = `${shown} messages`;
}
const emails = () => {
  const list =
      state.role === 'client' ? state.emails.filter((x) => x.to === state.user.email) : state.emails,
    sales = state.role === 'sales';
  return `<article class="card panel"><div class="panel-head"><div><h3>${state.role === 'client' ? 'My notifications' : sales ? 'Client Communication' : 'Email delivery'}</h3><p>${sales ? 'Filter Cash or Multi communication and search by client code, name, PAN card or mobile number.' : 'Every email the portal sends: client confirmations, report notices and broker order emails.'}</p></div><span id="commCount" class="badge">${list.length} messages</span></div>${sales ? commFilters() : ''}<div class="email-layout"><div class="email-list">${list.map((x, i) => { const c = sales ? commDetails(x) : null; return `<button class="email-item ${i === 0 ? 'active' : ''}" data-mail="${x.id}"${c ? ` data-sender="${esc(c.sender)}" data-product="${esc(c.product)}" data-search="${esc(c.search)}"` : ''}><span class="mail-dot"></span><div><b>${esc(x.subject)}</b>${c ? `<small>${esc(c.sender)}${c.product ? ' • ' + esc(c.product) : ''}</small><small>To: ${esc(x.name || x.to)}${c.code ? ' • ' + esc(c.code) : ''}</small><small>${esc(c.pan || 'PAN unavailable')} • ${esc(c.mobile || 'Mobile unavailable')}</small>` : `<small>To: ${esc(x.to)}</small>`}<small class="stamp">${esc(x.sent)}</small></div><span class="status ${MAIL_TONE[x.status] || 'red'}">${esc(mailStatusLabel(x))}</span></button>`; }).join('') || '<div class="empty">No confirmation emails available.</div>'}</div><div id="emailPreview" class="email-preview">${list[0] ? emailBody(list[0]) : '<div class="empty">Select an email to preview.</div>'}</div></div></article>`;
};
const MAIL_TONE = { Sent: 'green', Queued: 'gold', Sending: 'gold', Simulated: 'gold' };
// A broker order is 'Sent' once Gmail accepts it; that does not prove the broker received it.
const mailStatusLabel = (x) =>
  x.status === 'Sent' && x.sendVia === 'client_gmail' ? 'Accepted by Gmail' : x.status;
const emailBody = (x) =>
  `<div class="email-preview-head"><span class="activity-icon">✉</span><div><h3>${esc(x.subject)}</h3><p>To: ${esc(x.to)}${x.cc.length ? `<br>CC: ${esc(x.cc.join('; '))}` : ''}</p></div><span class="status ${MAIL_TONE[x.status] || 'red'}">${esc(mailStatusLabel(x))}</span></div><div class="email-copy">${/^Broker/.test(x.type) ? `<pre class="broker-mail-body">${esc(x.body)}</pre>` : `<p>Hello${x.name ? ' ' + esc(x.name) : ''},</p><p>${esc(x.body)}</p><p>Regards,<br><b>Sampadha Client Services</b></p>`}<div class="notice"><b>${esc(x.type)}</b><br><span class="stamp">${x.application && x.application !== '—' ? esc(x.application) + ' • ' : ''}${esc(x.id)} • queued ${esc(x.sent)}${x.delivered ? ' • sent ' + esc(x.delivered) : ''}</span></div><small>${x.status === 'Sent' ? (x.sendVia === 'client_gmail' ? 'Accepted by Gmail. This does not prove the broker received it.' : 'Delivered to the mail server.') : x.status === 'Simulated' ? 'Logged in the portal only: email sending was not set up when this message was created.' : esc(x.note || 'Waiting to be sent.')}</small></div>`;
const AUDIT_ICON = { client: '✓', research: '▤' };
const audit = () =>
  `<article class="card panel"><div class="panel-head"><div><h3>Audit trail</h3><p>Append-only record of changes made through the portal.</p></div><span class="badge">IST</span></div><div class="activity">${
    (state.ws?.audit || [])
      .map(
        (a) =>
          `<div class="activity-row"><span class="activity-icon">${AUDIT_ICON[a.entity.split('_')[0]] || '•'}</span><div><b>${esc(a.action)}</b><small>${esc(a.entity_ref || '')} • ${esc(a.actor_login || 'system')}</small></div><time>${Api.fmt.stamp(a.at)} IST</time></div>`,
      )
      .join('') || '<div class="empty">No audit events yet.</div>'
  }</div></article>`;
const pages = {
  dashboard,
  clientDashboard,
  notifications,
  users,
  clients: () => (state.role === 'sales' ? salesClientsPage() : clientTable()),
  addClient,
  approvals,
  emails,
  workflowMap,
  plans,
  profile,
  products,
  payments,
  recommendations: recommendationPage,
  audit,
};
const titles = {
  dashboard: 'Overview',
  clientDashboard: 'Client dashboard',
  notifications: 'Notifications & alerts',
  cashSegment: 'Cash Segment',
  users: 'Users & access',
  multiReports: 'Multi Segment',
  clients: 'Clients',
  addClient: 'Add share-market client',
  approvals: 'Client approvals',
  emails: 'Email delivery',
  workflowMap: 'Workflow chart',
  plans: 'Subscription plans',
  profile: 'Profile',
  products: 'Subscribed products',
  payments: 'Payment details',
  recommendations: 'All recommendations',
  audit: 'Audit trail',
};
// Admin has the longest menu, so it is grouped; the other roles get one short list.
const NAV_GROUPS = ['Research', 'Clients', 'Communication', 'Billing', 'Administration'];
const NAV_GROUP_OF = {
  multiReports: 'Research',
  cashSegment: 'Research',
  recommendations: 'Research',
  researchOrders: 'Research',
  raUploads: 'Research',
  clients: 'Clients',
  compliance: 'Clients',
  addClient: 'Clients',
  approvals: 'Clients',
  emails: 'Communication',
  brokerEmail: 'Communication',
  plans: 'Billing',
  products: 'Billing',
  payments: 'Billing',
  users: 'Administration',
  workflowMap: 'Administration',
  audit: 'Administration',
};
function renderNav() {
  const current = clientTabGroup(state.page)?.tabs[0][0] || state.page;
  const item = (x) =>
    `<button class="nav-item ${current === x[0] ? 'active' : ''}" data-page="${x[0]}"${current === x[0] ? ' aria-current="page"' : ''}>${typeof icon === 'function' && NAV_ICONS[x[0]] ? icon(NAV_ICONS[x[0]]) : `<span>${x[1]}</span>`}${x[2]}</button>`;
  const items = nav[state.role];
  if (state.role !== 'admin') {
    $('#nav').innerHTML =
      `<p class="nav-label">${state.role === 'client' ? 'My account' : 'Workspace'}</p>` +
      items.map(item).join('');
    return;
  }
  const ungrouped = items.filter((x) => !NAV_GROUP_OF[x[0]]);
  $('#nav').innerHTML =
    ungrouped.map(item).join('') +
    NAV_GROUPS.map((group) => {
      const inGroup = items.filter((x) => NAV_GROUP_OF[x[0]] === group);
      return inGroup.length
        ? `<p class="nav-label">${group}</p>` + inGroup.map(item).join('')
        : '';
    }).join('');
}
function updateAlertBadge() {
  const count = clientAlerts.filter((x) => x.unread).length;
  $('#alertCount').textContent = count;
  $('#notificationBell').style.display = state.role === 'client' ? 'grid' : 'none';
}
function show(page) {
  state.page = page;
  const tabGroup = clientTabGroup(page);
  $('#title').textContent =
    tabGroup?.title ||
    (page === 'emails' && state.role === 'sales' ? 'Client Communication' : titles[page]);
  $('#crumb').textContent = `${roles[state.role].name} workspace`;
  $('#content').innerHTML =
    (tabGroup ? clientTabBar(tabGroup, page) : '') +
    pages[page]().replace('timestampVtbl', 'timestamped');
  renderNav();
  updateAlertBadge();
  bind();
  bindSeparateRecommendationFilters();
  syncAddClient();
  $('.sidebar').classList.remove('open');
}
function bind() {
  const recommendationFilters = $('#recommendationFilters');
  if (recommendationFilters) {
    const productOptions = {
      Cash: ['All', 'LC', 'MC', 'SC'],
      Multi: ['All', 'Bronze', 'Silver', 'Palladium', 'Platinum', 'Gold', 'Rhodium'],
    };
    const applyRecommendations = () => {
      const segment = $('#rSegment').value,
        product = $('#rProduct').value,
        status = $('#rStatus').value,
        source = segment === 'Cash' ? cashRecommendations : multiRecommendations,
        data = source.filter(
          (x) =>
            (product === 'All' || x.product === product) &&
            (status === 'All' || x.status === status),
        );
      $('#recommendationResults').innerHTML = recommendationResults(segment, product, status);
      $('#recommendationCount').textContent = `${data.length} records`;
    };
    $('#rSegment').onchange = () => {
      const segment = $('#rSegment').value;
      $('#rProduct').innerHTML = productOptions[segment]
        .map((x) => `<option>${x}</option>`)
        .join('');
      applyRecommendations();
    };
    recommendationFilters.onsubmit = (e) => {
      e.preventDefault();
      applyRecommendations();
    };
    $('#resetRecommendationFilters').onclick = () => {
      recommendationFilters.reset();
      $('#rProduct').innerHTML = productOptions.Cash.map((x) => `<option>${x}</option>`).join('');
      applyRecommendations();
    };
    $('#closePdf').onclick = () => $('#pdfModal').classList.add('hidden');
  }
  $$('[data-channel]').forEach(
    (x) =>
      (x.onclick = () => {
        $$('[data-channel]').forEach((y) => y.classList.remove('active'));
        x.classList.add('active');
        const channel = x.dataset.channel;
        $('#notificationResults').innerHTML = alertRows(
          channel === 'All' ? clientAlerts : clientAlerts.filter((a) => a.channel === channel),
        );
      }),
  );
  const mark = $('#markRead');
  if (mark)
    mark.onclick = async () => {
      try {
        await Api.markNotificationsRead();
        clientAlerts.forEach((x) => (x.unread = false));
        updateAlertBadge();
        $('#notificationResults').innerHTML = alertRows(clientAlerts);
        toast('All notifications marked as read');
      } catch (err) {
        toast(err.message);
      }
    };
  $$('.action').forEach(
    (x) =>
      (x.onclick = (e) => {
        e.preventDefault();
        toast('Demo action completed');
      }),
  );
}
function bindSeparateRecommendationFilters() {
  const cashForm = $('#cashRecommendationFilters'),
    multiForm = $('#multiRecommendationFilters');
  if (cashForm) {
    const applyCash = () => {
      const product = $('#crProduct').value,
        stock = $('#crStock').value,
        status = $('#crStatus').value,
        data = cashRecommendations.filter(
          (x) =>
            (product === 'All' || x.product === product) &&
            (stock === 'All' || x.stock === stock) &&
            (status === 'All' || x.status === status),
        );
      $('#cashRecommendationTable').innerHTML = cashRecommendationTable(data);
      $('#cashRecommendationCount').textContent = `${data.length} records`;
    };
    cashForm.onsubmit = (e) => {
      e.preventDefault();
      applyCash();
    };
    $('#resetCashRecommendations').onclick = () => {
      cashForm.reset();
      applyCash();
    };
  }
  if (multiForm) {
    const applyMulti = () => {
      const product = $('#mrProduct').value,
        symbol = $('#mrSymbol').value,
        option = $('#mrOption').value,
        side = $('#mrSide').value,
        status = $('#mrStatus').value,
        data = multiRecommendations.filter(
          (x) =>
            (product === 'All' || x.product === product) &&
            (symbol === 'All' || x.symbol === symbol) &&
            (option === 'All' || x.option === option) &&
            (side === 'All' || x.side === side) &&
            (status === 'All' || x.status === status),
        );
      $('#multiRecommendationTable').innerHTML = multiRecommendationTable(data);
      $('#multiRecommendationCount').textContent = `${data.length} records`;
    };
    multiForm.onsubmit = (e) => {
      e.preventDefault();
      applyMulti();
    };
    $('#resetMultiRecommendations').onclick = () => {
      multiForm.reset();
      applyMulti();
    };
  }
  const close = $('#closePdf');
  if (close) close.onclick = () => $('#pdfModal').classList.add('hidden');
}
// kind 'seal': something was just signed or put on record; the toast carries the gold seal,
// which stamps in, and stays a little longer.
let toastTimer;
function toast(m, kind = '') {
  const box = $('#toast');
  box.textContent = m;
  box.classList.remove('seal');
  if (kind === 'seal') {
    void box.offsetWidth; // restart the stamp if a seal toast is already showing
    box.classList.add('seal');
  }
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), kind === 'seal' ? 3400 : 2400);
}
function applyWorkspace(ws) {
  state.ws = ws;
  const fill = (target, rows) => target.splice(0, target.length, ...rows);
  fill(cashRecommendations, ws ? ws.cash : []);
  fill(multiRecommendations, ws ? ws.multi : []);
  fill(clientAlerts, ws ? ws.alerts : []);
  fill(clients, ws ? ws.clientRows : []);
  state.submissions = ws ? ws.applications : [];
  state.emails = ws ? ws.mails : [];
  if (typeof researchApplyWorkspace === 'function') researchApplyWorkspace(ws);
}
async function refreshWorkspace() {
  applyWorkspace(await Api.loadWorkspace({ role: state.role }));
}
async function enterPortal(profile) {
  state.role = profile.role;
  state.user = {
    uid: profile.id,
    person: profile.full_name,
    initials: profile.initials,
    email: profile.email,
    mobile: profile.mobile || '—',
    id: profile.login_id,
    pan: profile.pan || '—',
    risk: profile.risk_profile || 'Not applicable',
    kyc: profile.kyc_status || '—',
  };
  await refreshWorkspace();
  state.page = nav[state.role][0][0];
  $('#login').classList.add('hidden');
  $('#portal').classList.remove('hidden');
  $('#roleBadge').innerHTML =
    `<b>${esc(state.user.person)}</b><small>${roles[state.role].name} • ${roles[state.role].desc}</small>`;
  $('#avatar').textContent = state.user.initials;
  show(state.page);
}
function leavePortal(message = '') {
  state.user = null;
  applyWorkspace(null);
  $('#portal').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#loginError').textContent = message;
}
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const submit = e.target.querySelector('button'),
    error = $('#loginError'),
    label = submit.textContent;
  submit.disabled = true;
  error.textContent = '';
  try {
    if (e.target.dataset.mode === 'email') {
      // Sending can take a few seconds (the function may be starting up, then the email goes out).
      submit.textContent = 'Sending…';
      return await requestEmailCode($('#email').value.trim());
    }
    await Api.login($('#email').value, $('#password').value);
    $('#password').value = '';
    await continueSignIn();
  } catch (err) {
    error.textContent = err.message;
  } finally {
    submit.disabled = false;
    submit.textContent = label;
  }
};

// ───────────── sign-in code (second step) ─────────────
// After the password the database refuses the session until the 6-digit code emailed to the
// person is entered. Sessions opened from an emailed link (set-password) already count, and so do
// sessions from an email code alone (below).
async function continueSignIn() {
  const status = await Api.loginCodeStatus();
  if (!status?.verified) {
    showLoginCode('step', `Sending a code${status?.sentTo ? ' to ' + status.sentTo : ''}…`);
    return sendLoginCode();
  }
  closeLoginCode();
  const profile = await Api.currentProfile();
  if (!profile) {
    await Api.logout();
    throw new Error('This account has no portal access. Contact an administrator.');
  }
  await enterPortal(profile);
}
async function sendLoginCode() {
  const message = $('#loginCodeMessage');
  try {
    const sent = await Api.loginCode('send');
    message.textContent = `We emailed a 6-digit code to ${sent.sentTo}. It expires in 10 minutes.`;
  } catch (err) {
    message.textContent = err.message;
  }
}
// flow 'step': the second step after the password; flow 'email': signing in with an email code alone.
function showLoginCode(flow, message) {
  const box = $('.login-box'),
    email = flow === 'email';
  $('#loginForm').hidden = true;
  box.querySelector('h2').textContent = email ? 'Check your email' : 'Enter your sign-in code';
  box.querySelector('h2 + .muted').textContent = !email
    ? 'For your security, sign-in has a second step: a code sent to your email.'
    : passwordReset
      ? 'Enter the code we emailed you, then choose a new password.'
      : 'Enter the one-time code we emailed you. No password is needed.';
  if (!$('#loginCodeForm'))
    $('#loginForm').insertAdjacentHTML(
      'beforebegin',
      `<form id="loginCodeForm"><p id="loginCodeMessage" class="login-code-message" role="status"></p><label>Code from the email<input name="code" class="login-code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required></label><p class="error" role="alert"></p><button class="btn primary wide">Verify and continue</button><div class="login-code-links"><button type="button" class="btn ghost" data-login-code-resend>Send a new code</button><button type="button" class="btn ghost" data-login-code-cancel>Use a different account</button></div></form>`,
    );
  const form = $('#loginCodeForm');
  form.dataset.flow = flow;
  $('#loginCodeMessage').textContent = message;
  form.querySelector('.error').textContent = '';
  form.elements.code.value = '';
  form.elements.code.focus();
}
function closeLoginCode() {
  if (!$('#loginCodeForm')) return;
  $('#loginCodeForm').remove();
  const box = $('.login-box');
  box.querySelector('h2').textContent = 'Sign in';
  box.querySelector('h2 + .muted').textContent = 'Use your client ID, staff ID or email address.';
  $('#loginForm').hidden = false;
}

// ───────────── sign in with an email code (no password) ─────────────
// The login-code function emails a one-time code to the account's own address; the code itself
// signs the person in, so there is no second step.
// Forgot password is the same code, followed straight away by the set-password screen
// (accounts.js), so it needs no emailed link (Auth's links expire after 5 minutes here).
let emailCodeFor = '',
  passwordReset = false;
function setSignInMode(mode, reset = false) {
  const form = $('#loginForm'),
    box = $('.login-box'),
    email = mode === 'email',
    password = $('#password'),
    toggle = form.querySelector('[data-sign-in-mode]');
  passwordReset = email && reset;
  form.dataset.mode = mode;
  password.closest('label').hidden = email;
  password.required = !email;
  form.querySelector('button.primary').textContent = email ? 'Email me a code' : 'Sign in';
  toggle.dataset.signInMode = email ? 'password' : 'email';
  toggle.textContent = passwordReset
    ? 'Back to sign in'
    : email
      ? 'Sign in with my password instead'
      : 'Sign in with an email code instead';
  box.querySelector('h2').textContent = passwordReset ? 'Reset your password' : 'Sign in';
  box.querySelector('h2 + .muted').textContent = passwordReset
    ? "Enter your client ID, staff ID or email. We'll email you a code, then you choose a new password."
    : 'Use your client ID, staff ID or email address.';
  box.querySelector('.demo-hint').hidden = passwordReset;
  $('#loginError').textContent = '';
  $('#email').focus();
}
async function requestEmailCode(identifier) {
  await Api.loginCode('request', { identifier });
  emailCodeFor = identifier;
  showLoginCode(
    'email',
    `If ${identifier} has portal access, a ${passwordReset ? 'code to reset its password' : 'sign-in code'} is on its way to that account's email. It works once and expires in 5 minutes.`,
  );
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'loginCodeForm') return;
  e.preventDefault();
  const form = e.target,
    error = form.querySelector('.error'),
    button = form.querySelector('button:not([type=button])');
  button.disabled = true;
  error.textContent = '';
  try {
    if (form.dataset.flow === 'email') await Api.loginWithEmailCode(emailCodeFor, form.elements.code.value);
    else await Api.loginCode('verify', { code: form.elements.code.value });
    if (form.dataset.flow === 'email' && passwordReset) {
      // Signed in by the code: now the new password (saving it opens the portal).
      closeLoginCode();
      setSignInMode('password');
      return showSetPassword();
    }
    await continueSignIn();
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
  }
});
document.addEventListener('click', async (e) => {
  const mode = e.target.closest('[data-sign-in-mode]');
  if (mode) return setSignInMode(mode.dataset.signInMode);
  if (e.target.closest('[data-forgot-password]')) return setSignInMode('email', true);
  if (e.target.closest('[data-login-code-resend]')) {
    const message = $('#loginCodeMessage');
    message.textContent = 'Sending a new code…';
    if ($('#loginCodeForm').dataset.flow !== 'email') return sendLoginCode();
    try {
      await Api.loginCode('request', { identifier: emailCodeFor });
      message.textContent = `A new code is on its way (at most one every 30 seconds). Use the latest email; earlier codes stop working.`;
    } catch (err) {
      message.textContent = err.message;
    }
  } else if (e.target.closest('[data-login-code-cancel]')) {
    await Api.logout();
    closeLoginCode();
    if (passwordReset) setSignInMode('password');
  }
});

// Restore an existing session after a refresh, and drop to the login screen if it expires.
document.addEventListener('DOMContentLoaded', async () => {
  // A set-password link carries its own session; accounts.js handles it.
  if (/access_token=|error=/.test(location.hash)) return;
  try {
    const { data } = await Api.sb.auth.getSession();
    if (data.session) await continueSignIn();
  } catch {
    /* stay on the login screen */
  }
});
Api.sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && state.user)
    leavePortal('Your session ended. Please sign in again.');
});
$('#nav').onclick = (e) => {
  const b = e.target.closest('[data-page]');
  if (b) show(b.dataset.page);
};
$('#logout').onclick = async () => {
  try {
    await Api.logout();
  } catch {
    /* local sign-out below still applies */
  }
  leavePortal();
};
$('#menu').onclick = () => $('.sidebar').classList.toggle('open');
$('#notificationBell').onclick = () =>
  state.role === 'client'
    ? show('notifications')
    : toast('Client notifications are visible in the client workspace');
$('#content').addEventListener('click', (e) => {
  const toggle = e.target.closest('#salesAddClientToggle');
  if (toggle) {
    const panel = $('#salesAddClientPanel');
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    toggle.textContent = panel.hidden ? '＋ Add client' : '− Hide client form';
    if (!panel.hidden) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const go = e.target.closest('[data-go]');
  if (go) {
    e.preventDefault();
    return show(go.dataset.go);
  }
  const mail = e.target.closest('[data-mail]');
  if (mail) {
    const item = state.emails.find((x) => x.id === mail.dataset.mail);
    if (item) $('#emailPreview').innerHTML = emailBody(item);
    $$('.email-item').forEach((x) => x.classList.toggle('active', x === mail));
    return;
  }
  const pdf = e.target.closest('[data-report]');
  if (pdf) {
    const source = pdf.dataset.segment === 'Cash' ? cashRecommendations : multiRecommendations,
      item = source.find((x) => x.id === pdf.dataset.report);
    if (!item) return;
    const labels = {
      id: 'Report reference',
      product: 'Product',
      stock: 'Stock',
      symbol: 'Symbol',
      price: 'Initiation price',
      qty: 'Quantity',
      expiry: 'Expiry date',
      strike: 'Strike price',
      option: 'Option type',
      side: 'Recommendation',
      lots: 'Number of lots',
      lotSize: 'Lot size',
      published: 'Published date',
      delivered: 'Delivered date',
      status: 'Status',
    };
    $('#pdfTitle').textContent = `${pdf.dataset.segment} report • ${item.id}`;
    $('#pdfBody').innerHTML =
      `<div class="detail-grid">${Object.entries(
        item,
      )
        .filter(([k]) => labels[k])
        .map(
          ([k, v]) =>
            `<div class="detail"><small>${labels[k]}</small><b>${esc(v)}${['published', 'delivered'].includes(k) ? ' IST' : ''}</b></div>`,
        )
        .join(
          '',
        )}</div><div class="notice pdf-disclaimer">This recommendation is research communication for the subscribed client. It is not a guarantee of return or an automatic trade instruction.</div>`;
    $('#pdfModal').classList.remove('hidden');
    return;
  }
  const action = e.target.closest('.approve,.reject');
  if (!action) return;
  if (state.role !== 'admin') return toast('Admin access required');
  const approved = action.classList.contains('approve');
  action.disabled = true;
  Api.decideApplication(action.dataset.app, approved)
    .then(async () => {
      await refreshWorkspace();
      toast(`Client ${approved ? 'approved' : 'rejected'} • confirmation email logged`);
      show('approvals');
    })
    .catch((err) => {
      toast(err.message);
      action.disabled = false;
    });
});
for (const type of ['input', 'change'])
  $('#content').addEventListener(type, (e) => {
    if (e.target.closest('#commFilters')) applyCommFilters();
    if (e.target.closest('#addClientForm')) syncAddClient();
  });
$('#content').addEventListener('reset', () => setTimeout(syncAddClient));
$('#content').addEventListener('submit', async (e) => {
  if (e.target.id === 'commFilters') return e.preventDefault();
  if (e.target.id === 'productPricesForm') {
    e.preventDefault();
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      await Api.saveProductPrices(
        Object.fromEntries([...e.target.elements].filter((x) => x.name).map((x) => [x.name, x.value])),
      );
      await refreshWorkspace();
      show('plans');
      toast('Prices saved');
    } catch (err) {
      toast(err.message);
      button.disabled = false;
    }
    return;
  }
  if (e.target.id !== 'addClientForm') return;
  e.preventDefault();
  const d = new FormData(e.target),
    button = e.target.querySelector('button:not([type=button]):not([type=reset])'),
    payload = Object.fromEntries(
      [
        'name',
        'pan',
        'dob',
        'email',
        'mobile',
        'occupation',
        'income',
        'netWorth',
        'residency',
        'city',
        'mfExperience',
        'stockExperience',
        'foExperience',
        'amount',
      ].map((k) => [k, d.get(k)]),
    );
  payload.segments = d.getAll('segments');
  payload.services = d.getAll('services');
  payload.products = d.getAll('products');
  payload.accounts = CLIENT_PRODUCTS.flatMap((product, i) =>
    payload.products.includes(product)
      ? [
          {
            product,
            broker: d.get('broker_' + i) === 'Others' ? d.get('brokerOther_' + i).trim() : d.get('broker_' + i),
            depository: d.get('depository_' + i),
            demat: d.get('demat_' + i).trim(),
            tradingId: d.get('tradingId_' + i).trim(),
            bank: d.get('bank_' + i).trim(),
            ifsc: d.get('ifsc_' + i).trim().toUpperCase(),
            accountNumber: d.get('accountNumber_' + i).trim(),
            horizon: d.get('horizon_' + i),
            objective: d.get('objective_' + i),
            loss: d.get('loss_' + i),
          },
        ]
      : [],
  );
  if (!payload.segments.length) return toast('Tick at least one market segment.');
  if (!payload.products.length) return toast('Tick at least one product.');
  payload.consent = d.get('consent') === 'on';
  button.disabled = true;
  try {
    payload.pdfPath = await Api.uploadOnboardingPdf(await onboardingPdfBlob(payload));
    await Api.submitApplication(payload);
    await refreshWorkspace();
    toast('Client submitted • confirmation email logged');
    show('emails');
  } catch (err) {
    toast(err.message);
    button.disabled = false;
  }
});
