const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const roles = {
  admin: { name: 'Admin', desc: 'Full platform access' },
  ra: { name: 'Research Analyst', desc: 'Strategies and reports' },
  sales: { name: 'Sales', desc: 'Clients, KYC and plans' },
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
    ['strategies', '↗', 'Strategies'],
    ['reports', '▤', 'Single report'],
    ['multiReports', '▦', 'Multiple reports'],
    ['kyc', '✓', 'KYC onboarding'],
    ['plans', '₹', 'Subscriptions'],
    ['products', '◫', 'Subscribed products'],
    ['payments', '₹', 'Payments'],
    ['recommendations', '↗', 'Recommendations'],
    ['audit', '◷', 'Audit trail'],
  ],
  ra: [
    ['dashboard', '⌂', 'Overview'],
    ['workflowMap', '◆', 'Workflow chart'],
    ['strategies', '↗', 'Strategies'],
    ['reports', '▤', 'Single report'],
    ['multiReports', '▦', 'Multiple reports'],
  ],
  sales: [
    ['profile', '♙', 'Profile'],
    ['workflowMap', '◆', 'Workflow chart'],
    ['clients', '◎', 'Clients'],
    ['addClient', '＋', 'Add client'],
    ['emails', '✉', 'Confirmation emails'],
    ['kyc', '✓', 'KYC onboarding'],
    ['plans', '₹', 'Subscription plans'],
  ],
  client: [
    ['clientDashboard', '⌂', 'Dashboard'],
    ['notifications', '🔔', 'Notifications'],
    ['profile', '♙', 'Profile'],
    ['products', '◫', 'Subscribed products'],
    ['payments', '₹', 'Payment details'],
    ['recommendations', '↗', 'All recommendations'],
  ],
};
const clients = []; // [name, id, risk, kyc, plan] — loaded from the database
const recs = [
  {
    product: 'Cash',
    stock: 'TCS',
    action: 'BUY',
    price: '₹3,412',
    target: '₹3,680',
    date: '2026-08-12',
    time: '09:24:18',
    status: 'Active',
  },
  {
    product: 'Multi',
    stock: 'KOTAK',
    action: 'ACCUMULATE',
    price: '₹1,942',
    target: '₹2,120',
    date: '2026-08-18',
    time: '11:06:42',
    status: 'Active',
  },
  {
    product: 'Cash',
    stock: 'INFY',
    action: 'BUY',
    price: '₹1,528',
    target: '₹1,690',
    date: '2026-08-22',
    time: '10:18:07',
    status: 'Active',
  },
  {
    product: 'All',
    stock: 'SBI',
    action: 'HOLD',
    price: '₹812',
    target: '₹865',
    date: '2026-08-27',
    time: '14:32:11',
    status: 'Review',
  },
  {
    product: 'Multi',
    stock: 'ICICI',
    action: 'BUY',
    price: '₹1,264',
    target: '₹1,390',
    date: '2026-09-01',
    time: '09:48:35',
    status: 'Active',
  },
  {
    product: 'Cash',
    stock: 'HERO',
    action: 'BOOK PROFIT',
    price: '₹5,224',
    target: '₹5,100',
    date: '2026-09-03',
    time: '15:11:26',
    status: 'Closed',
  },
  {
    product: 'All',
    stock: 'JIO',
    action: 'WATCH',
    price: '₹1,356',
    target: '₹1,475',
    date: '2026-09-05',
    time: '12:44:50',
    status: 'Review',
  },
  {
    product: 'Cash',
    stock: 'LALITHA',
    action: 'BUY',
    price: '₹684',
    target: '₹760',
    date: '2026-09-08',
    time: '10:02:14',
    status: 'Active',
  },
];
const cashRecommendations = [];
const multiRecommendations = [];
const clientAlerts = [];
let state = {
  role: 'admin',
  user: null,
  page: 'dashboard',
  filtered: recs,
  submissions: [],
  emails: [],
  ws: null,
};
const statCards = (arr) =>
  `<section class="cards">${arr.map((x) => `<article class="card stat"><div class="label"><span>${x[0]}</span><b>${x[3] || '◫'}</b></div><strong>${x[1]}</strong><span class="positive">${x[2]}</span></article>`).join('')}</section>`;
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
const dashboard = () =>
  `${statCards(
    state.role === 'ra'
      ? [
          ['Active strategies', '18', '3 published this month'],
          ['Research reports', '64', '12 this quarter'],
          ['Stocks covered', '42', '8 sectors'],
          ['Subscribers reached', '1,248', '+8.6%'],
        ]
      : [
          ['Total users', '1,486', '+42 this month'],
          ['Active clients', '1,248', '83.9% of users'],
          ['Revenue', '₹1.82 Cr', '+12.4% YTD'],
          ['Pending KYC', '27', '9 require action'],
        ],
  )}<section class="grid-2"><article class="card panel"><div class="panel-head"><div><h3>Platform activity</h3><p>Monthly actions across all workspaces</p></div><span class="badge">Last 8 months</span></div><div class="chart">${[42, 65, 54, 81, 72, 93, 78, 100].map((h) => `<i class="bar" style="height:${h}%"></i>`).join('')}</div></article><article class="card panel"><div class="panel-head"><div><h3>Recent activity</h3><p>Latest recorded events</p></div></div>${activity()}</article></section>`;
const users = () =>
  `<article class="card panel"><div class="panel-head"><div><h3>Users and access</h3><p>Admin can review all roles and account states.</p></div><button class="btn primary action">＋ Add user</button></div><div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Account ID</th><th>Access</th><th>Status</th></tr></thead><tbody>${(
    state.ws?.directory || []
  )
    .map(
      (p) =>
        `<tr><td><b>${esc(p.full_name)}</b><small>${esc(p.email)}</small></td><td>${roles[p.role].name}</td><td class="stamp">${esc(p.login_id)}</td><td>${roles[p.role].desc}</td><td><span class="status ${p.is_active ? 'green' : 'red'}">${p.is_active ? 'Active' : 'Disabled'}</span></td></tr>`,
    )
    .join('')}</tbody></table></div></article>`;
const strategies = () =>
  `<article class="card panel"><div class="panel-head"><div><h3>Research strategies</h3><p>Create, review and publish investment strategies.</p></div><button class="btn primary action">＋ New strategy</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Strategy</th><th>Universe</th><th>Risk</th><th>Analyst</th><th>Updated</th><th>Status</th></tr></thead><tbody>${(
    state.ws?.strategies || []
  )
    .map(
      (x) =>
        `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.universe)}</td><td>${esc(x.risk)}</td><td>${esc(x.analyst_name)}</td><td class="stamp">${Api.fmt.stamp(x.updated_at)}</td><td><span class="status ${x.status === 'Published' ? 'green' : 'gold'}">${esc(x.status)}</span></td></tr>`,
    )
    .join('')}</tbody></table></div></article>`;
const reportForm = (multi) =>
  `<article class="card panel"><div class="panel-head"><div><h3>${multi ? 'Generate multiple reports' : 'Generate single report'}</h3><p>Every generated report receives an immutable date and time stamp.</p></div><span class="badge">IST timestamps</span></div><form id="reportForm"><div class="form-grid"><label class="field">${multi ? 'Select stocks' : 'Stock'}<select id="reportStock" ${multi ? 'multiple size="5"' : ''}>${['TCS', 'KOTAK', 'INFY', 'SBI', 'ICICI', 'HERO', 'JIO', 'LALITHA'].map((x) => `<option>${x}</option>`).join('')}</select></label><label class="field">Product<select><option>Cash</option><option>Multi</option><option>All</option></select></label><label class="field">From date<input type="date" value="2026-09-01"></label><label class="field">To date<input type="date" value="2026-09-09"></label></div><div class="actions"><button type="button" class="btn secondary action">Save draft</button><button class="btn primary">Generate ${multi ? 'batch' : 'report'} →</button></div></form><div id="reportResult"></div></article>`;
const clientTable = () =>
  `<article class="card panel"><div class="panel-head"><div><h3>Client relationships</h3><p>Profiles, KYC state and current subscription.</p></div><button class="btn primary" data-go="addClient">＋ Add client</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th>Risk profile</th><th>KYC</th><th>Plan</th><th>Mobile</th></tr></thead><tbody>${clients.map((x) => `<tr><td><b>${esc(x[0])}</b><small>${esc(x[1])} • ${esc(x[5])}</small></td><td>${esc(x[2])}</td><td><span class="status ${/verified/i.test(x[3]) ? 'green' : /review/i.test(x[3]) ? 'gold' : 'red'}">${esc(x[3])}</span></td><td>${esc(x[4])}</td><td class="stamp">${esc(x[6])}</td></tr>`).join('')}${state.submissions.map((x) => `<tr><td><b>${esc(x.name)}</b><small>${esc(x.id)} • ${esc(x.email)}</small></td><td>${esc(x.risk)}</td><td><span class="status ${x.status === 'Approved' ? 'green' : x.status === 'Rejected' ? 'red' : 'gold'}">${x.status === 'Approved' ? 'KYC approved' : x.status === 'Rejected' ? 'Rejected' : 'Admin approval pending'}</span></td><td>Not assigned</td><td class="stamp">${esc(x.submitted)}</td></tr>`).join('')}</tbody></table></div></article>`;
const addClient = () =>
  `<form id="addClientForm"><section class="form-section card panel"><div class="panel-head"><div><h3>Personal and KYC details</h3><p>Fields marked required must be completed before submission.</p></div><span class="badge">Step 1 of 3</span></div><div class="form-grid three"><label class="field">Full legal name *<input name="name" required placeholder="As per PAN"></label><label class="field">PAN number *<input name="pan" required pattern="[A-Z]{5}[0-9]{4}[A-Z]" maxlength="10" placeholder="ABCDE1234F"></label><label class="field">Date of birth *<input name="dob" type="date" required></label><label class="field">Email address *<input name="email" type="email" required></label><label class="field">Mobile number *<input name="mobile" required placeholder="+91 98765 43210"></label><label class="field">Occupation *<select name="occupation" required><option value="">Select</option><option>Salaried</option><option>Business</option><option>Professional</option><option>Retired</option></select></label><label class="field">Annual income *<select name="income" required><option>₹5–10 lakh</option><option>₹10–25 lakh</option><option>₹25–50 lakh</option><option>Above ₹50 lakh</option></select></label><label class="field">Tax residency *<select name="residency"><option>Resident Indian</option><option>NRI</option></select></label><label class="field">City *<input name="city" required value="Mumbai"></label></div></section><section class="form-section card panel"><div class="panel-head"><div><h3>Trading and demat details</h3><p>Share-market account, segment and experience information.</p></div><span class="badge">Step 2 of 3</span></div><div class="form-grid three"><label class="field">Broker name *<select name="broker" required><option>Zerodha</option><option>ICICI Direct</option><option>Kotak Securities</option><option>HDFC Securities</option><option>Other</option></select></label><label class="field">Depository *<select name="depository"><option>CDSL</option><option>NSDL</option></select></label><label class="field">Demat / BO ID *<input name="demat" required placeholder="16-digit beneficiary ID"></label><label class="field">Trading client ID *<input name="tradingId" required placeholder="Broker client code"></label><label class="field">Primary bank *<input name="bank" required placeholder="Bank name"></label><label class="field">Investment experience *<select name="experience"><option>New investor</option><option>1–3 years</option><option>3–5 years</option><option>More than 5 years</option></select></label></div><fieldset><legend>Required market segments *</legend><div class="checks"><label><input type="checkbox" name="segments" value="Cash" checked> Cash equity</label><label><input type="checkbox" name="segments" value="F&O"> Futures & Options</label><label><input type="checkbox" name="segments" value="Currency"> Currency</label><label><input type="checkbox" name="segments" value="Commodity"> Commodity</label></div></fieldset><fieldset><legend>Interested products</legend><div class="checks"><label><input type="checkbox" name="products" value="Cash" checked> Cash</label><label><input type="checkbox" name="products" value="Multi"> Multi</label><label><input type="checkbox" name="products" value="All"> All products</label></div></fieldset></section><section class="form-section card panel"><div class="panel-head"><div><h3>Suitability and consent</h3><p>Investment capacity, objective and declarations.</p></div><span class="badge">Step 3 of 3</span></div><div class="form-grid three"><label class="field">Risk profile *<select name="risk"><option>Conservative</option><option selected>Moderate</option><option>Growth</option><option>Aggressive</option></select></label><label class="field">Investment horizon *<select name="horizon"><option>Under 1 year</option><option>1–3 years</option><option selected>3–5 years</option><option>More than 5 years</option></select></label><label class="field">Investment objective *<select name="objective"><option>Capital preservation</option><option selected>Long-term wealth</option><option>Income</option><option>Trading</option></select></label><label class="field">Proposed investment amount *<input name="amount" type="number" min="10000" value="500000" required></label><label class="field">Maximum loss tolerance *<select name="loss"><option>Up to 5%</option><option selected>Up to 15%</option><option>Up to 25%</option><option>Above 25%</option></select></label><label class="field">Preferred plan<select name="plan"><option>Essential</option><option>Growth</option><option>Premium</option></select></label></div><label class="consent"><input name="consent" type="checkbox" required><span><b>Client consent confirmed *</b><small>The client has reviewed the risk disclosure and authorized collection of these onboarding details.</small></span></label><div class="notice">Submitting creates a pending record. Only an Admin login can approve or reject the client.</div><div class="actions"><button type="button" class="btn secondary" data-go="clients">Cancel</button><button class="btn primary">Submit for Admin approval →</button></div></section></form>`;
const approvals = () =>
  `<article class="card panel"><div class="panel-head"><div><h3>Client approval queue</h3><p>Only Admin can approve or reject submitted onboarding records.</p></div><span class="badge">${state.submissions.filter((x) => x.status === 'Pending').length} pending</span></div><div class="table-wrap"><table class="table approval-table"><thead><tr><th>Applicant</th><th>Market account</th><th>Segments</th><th>Risk / Amount</th><th>Submitted</th><th>Status</th><th>Admin action</th></tr></thead><tbody>${state.submissions.map((x) => `<tr><td><b>${esc(x.name)}</b><small>${esc(x.pan)} • ${esc(x.mobile)}<br>${esc(x.email)}</small></td><td>${esc(x.broker)}<small>${esc(x.demat)}</small></td><td>${esc(x.segments)}</td><td>${esc(x.risk)}<small>${esc(x.amount)}</small></td><td class="stamp">${esc(x.submitted)}</td><td><span class="status ${x.status === 'Approved' ? 'green' : x.status === 'Rejected' ? 'red' : 'gold'}">${x.status}</span></td><td>${x.status === 'Pending' ? `<div class="approval-actions"><button class="btn primary approve" data-app="${esc(x.id)}">Approve</button><button class="btn secondary reject" data-app="${esc(x.id)}">Reject</button></div>` : '<small>Decision recorded</small>'}</td></tr>`).join('')}</tbody></table></div></article>`;
const kyc = () =>
  `<section class="grid-2" style="margin-top:0"><article class="card panel"><div class="panel-head"><div><h3>KYC onboarding</h3><p>Create a client profile and collect required details.</p></div><span class="status gold">Draft</span></div><form id="kycForm"><div class="form-grid"><label class="field">Full name<input value="Nikhil Verma"></label><label class="field">PAN<input value="ABCDE1234F"></label><label class="field">Mobile<input value="+91 98765 43210"></label><label class="field">Email<input value="nikhil.verma@demo.in"></label><label class="field">Risk profile<select><option>Moderate</option><option>Conservative</option><option>Growth</option></select></label><label class="field">Document status<select><option>Received</option><option>Pending</option></select></label></div><div class="actions"><button class="btn primary">Submit for review →</button></div></form></article><article class="card panel"><h3>Onboarding progress</h3><p class="muted">Identity and contact details</p><div class="progress"><span style="width:75%"></span></div><div class="activity">${[
    ['✓', 'Profile created', 'Completed'],
    ['✓', 'PAN validated', 'Completed'],
    ['◷', 'Address verification', 'In progress'],
    ['○', 'Agreement & consent', 'Pending'],
  ]
    .map(
      (x) =>
        `<div class="activity-row"><span class="activity-icon">${x[0]}</span><div><b>${x[1]}</b><small>${x[2]}</small></div></div>`,
    )
    .join('')}</div></article></section>`;
const plans = () =>
  `<section class="plan-grid">${(state.ws?.plans || [])
    .map(
      (p, i, all) =>
        `<article class="card plan ${i === all.length - 1 ? 'featured' : ''}"><span class="badge">${i === all.length - 1 ? 'MOST COMPLETE' : 'SUBSCRIPTION'}</span><h3>${esc(p.name)}</h3><div class="price">${Api.fmt.rupee(p.price_annual)}<small>/ annum</small></div><p class="muted">${esc(p.summary)}</p><ul><li>Advisor research access</li><li>Recommendation history</li><li>${i ? 'Quarterly' : 'Annual'} portfolio review</li></ul><button class="btn ${i === all.length - 1 ? 'primary' : 'secondary'} wide action">Select plan</button></article>`,
    )
    .join('')}</section>`;
const profile = () =>
  `<section class="profile"><article class="card profile-card"><div class="profile-avatar">${esc(state.user.initials)}</div><h3>${esc(state.user.person)}</h3><p class="muted">${roles[state.role].name} account</p><span class="status green">Verified</span></article><article class="card panel"><div class="panel-head"><div><h3>Profile details</h3><p>Account and contact information.</p></div><button class="btn secondary action">Edit profile</button></div><div class="detail-grid">${[
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
  return `<article class="card panel"><div class="panel-head"><div><h3>Payment details</h3><p>Quarterly and annual subscription transactions.</p></div><span class="badge">FY 2026–27</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Plan</th><th>Period</th><th>Billing</th><th>Amount</th><th>Paid on</th><th>Status</th></tr></thead><tbody>${
    (state.ws?.payments || [])
      .map(
        (p) =>
          `<tr><td>${esc(p.invoice_no)}</td><td>${esc(plan(p.plan_code))}</td><td>${esc(p.period_label)}</td><td>${esc(p.billing)}</td><td>${Api.fmt.rupee(p.amount)}</td><td>${p.paid_on ? Api.fmt.dateOnly(p.paid_on) : p.due_on ? 'Scheduled ' + Api.fmt.dateOnly(p.due_on) : '—'}</td><td><span class="status ${p.status === 'Paid' ? 'green' : p.status === 'Overdue' ? 'red' : 'gold'}">${esc(p.status)}</span></td></tr>`,
      )
      .join('') || '<tr><td colspan="7" class="empty">No payments recorded.</td></tr>'
  }</tbody></table></div></article>`;
};
const cashRecommendationTable = (data) =>
  `<div class="table-wrap recommendation-table"><table class="table"><thead><tr><th>Product</th><th>Stock</th><th>Initiation price</th><th>Initiation quantity</th><th>Published date</th><th>Delivered date</th><th>Status</th><th>Report</th></tr></thead><tbody>${data.length ? data.map((x) => `<tr><td><span class="badge">${x.product}</span></td><td><b>${x.stock}</b><small>${x.id}</small></td><td>${x.price}</td><td>${x.qty}</td><td class="stamp">${x.published} IST</td><td class="stamp">${x.delivered} IST</td><td><span class="status ${x.status === 'Active' ? 'green' : 'red'}">${x.status}</span></td><td><button class="pdf-btn" data-report="${x.id}" data-segment="Cash">▤ View PDF</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">No Cash recommendations match these filters.</td></tr>'}</tbody></table></div>`;
const multiRecommendationTable = (data) =>
  `<div class="table-wrap recommendation-table"><table class="table wide-table"><thead><tr><th>Product</th><th>Symbol</th><th>Expiry date</th><th>Strike price</th><th>Option type</th><th>Buy/Sell</th><th>No. of lots</th><th>Lot size</th><th>Quantity</th><th>Initiation price</th><th>Published date</th><th>Delivered date</th><th>Status</th><th>Report</th></tr></thead><tbody>${data.length ? data.map((x) => `<tr><td><span class="badge">${x.product}</span></td><td><b>${x.symbol}</b><small>${x.id}</small></td><td>${x.expiry}</td><td>${x.strike}</td><td>${x.option}</td><td><span class="status ${x.side === 'BUY' ? 'green' : 'gold'}">${x.side}</span></td><td>${x.lots}</td><td>${x.lotSize}</td><td><b>${x.qty}</b></td><td>${x.price}</td><td class="stamp">${x.published} IST</td><td class="stamp">${x.delivered} IST</td><td><span class="status ${x.status === 'Active' ? 'green' : 'gold'}">${x.status}</span></td><td><button class="pdf-btn" data-report="${x.id}" data-segment="Multi">▤ View PDF</button></td></tr>`).join('') : '<tr><td colspan="14" class="empty">No Multi recommendations match these filters.</td></tr>'}</tbody></table></div>`;
const recommendationPanel = (segment, data) => {
  const cash = segment === 'Cash';
  return `<article class="card panel recommendation-section ${segment.toLowerCase()}-section"><div class="segment-banner"><div><p class="overline">${segment.toUpperCase()} RECOMMENDATIONS</p><h3>${cash ? 'Cash equity recommendation table' : 'Multi derivatives recommendation table'}</h3><p>${cash ? 'LC, MC, SC and All equity products.' : 'Nano, Mini, Micro, Mega and Giga derivatives products.'}</p></div><div class="segment-heading-meta"><span class="badge" id="${cash ? 'cash' : 'multi'}RecommendationCount">${data.length} records</span><span class="segment-mark">${cash ? '₹' : '▦'}</span></div></div>${cash ? `<form id="cashRecommendationFilters" class="separate-table-filters cash-table-filters"><label>Product<select id="crProduct"><option>All</option><option>LC</option><option>MC</option><option>SC</option></select></label><label>Stock<select id="crStock"><option>All</option>${[...new Set(cashRecommendations.map((x) => x.stock))].map((x) => `<option>${x}</option>`).join('')}</select></label><label>Status<select id="crStatus"><option>All</option><option>Active</option><option>Closed</option></select></label><button class="btn primary">Apply Cash filters</button><button id="resetCashRecommendations" type="button" class="btn secondary">Reset</button></form><div id="cashRecommendationTable">${cashRecommendationTable(data)}</div>` : `<form id="multiRecommendationFilters" class="separate-table-filters multi-table-filters"><label>Product<select id="mrProduct"><option>All</option><option>Nano</option><option>Mini</option><option>Micro</option><option>Mega</option><option>Giga</option></select></label><label>Symbol<select id="mrSymbol"><option>All</option><option>NIFTY</option><option>SENSEX</option></select></label><label>Option type<select id="mrOption"><option>All</option><option>CE</option><option>PE</option></select></label><label>Buy / Sell<select id="mrSide"><option>All</option><option>BUY</option><option>SELL</option></select></label><label>Status<select id="mrStatus"><option>All</option><option>Active</option><option>Review</option><option>Closed</option></select></label><button class="btn primary">Apply Multi filters</button><button id="resetMultiRecommendations" type="button" class="btn secondary">Reset</button></form><div id="multiRecommendationTable">${multiRecommendationTable(data)}</div>`}</article>`;
};
const recommendationResults = () =>
  `<div class="recommendation-stack">${recommendationPanel('Cash', cashRecommendations)}${recommendationPanel('Multi', multiRecommendations)}</div>`;
function recommendationPage() {
  return `<article class="card panel recommendation-filter"><div class="panel-head"><div><h3>All recommendations</h3><p>Cash and Multi have independent filters and separate tables.</p></div><span class="badge">${cashRecommendations.length + multiRecommendations.length} total records</span></div><div class="notice">Research communication only—not an order or guaranteed return. Discuss suitability with your advisor.</div></article><section id="recommendationResults">${recommendationResults()}</section><div id="pdfModal" class="pdf-modal hidden"><div class="pdf-sheet"><div class="pdf-head"><div><small>SAMPADHA RESEARCH</small><h3 id="pdfTitle">Recommendation report</h3></div><button id="closePdf" type="button">×</button></div><div id="pdfBody"></div><div class="pdf-foot"><span>Confidential client research • Demo PDF preview</span><button class="btn primary" id="downloadPdf" type="button">Download PDF</button></div></div></div>`;
}
const recTable = (data) =>
  `<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Stock</th><th>View</th><th>Reference price</th><th>Target</th><th>Published timestamp</th><th>Status</th></tr></thead><tbody>${data.length ? data.map((x) => `<tr><td><span class="badge">${x.product}</span></td><td><b>${x.stock}</b></td><td>${x.action}</td><td>${x.price}</td><td>${x.target}</td><td class="stamp">${x.date} • ${x.time} IST</td><td><span class="status ${x.status === 'Active' ? 'green' : x.status === 'Closed' ? 'red' : 'gold'}">${x.status}</span></td></tr>`).join('') : `<tr><td class="empty" colspan="7">No recommendations match these filters.</td></tr>`}</tbody></table></div>`;
const alertRows = (data) =>
  `<div class="notification-list">${data.map((x) => `<article class="notification-row ${x.unread ? 'unread' : ''}"><span class="channel-icon">${x.icon}</span><div><b>${esc(x.title)}</b><small>${esc(x.detail)}</small><small>${esc(x.channel)} • ${esc(x.id)}</small></div><time>${esc(x.time)}</time></article>`).join('') || '<div class="empty">No notifications in this channel.</div>'}</div>`;
const clientDashboard = () => {
  const unread = clientAlerts.filter((x) => x.unread).length;
  return `<section class="client-welcome card"><div><p class="overline">CLIENT OVERVIEW</p><h3>Good morning, ${state.user.person.split(' ')[0]}</h3><p>Your research, alerts and account updates are together here.</p></div><button class="btn primary" data-go="notifications">View ${unread} new alerts →</button></section>${statCards(
    [
      ['Unread alerts', unread, 'Email, WhatsApp and in-app'],
      ['Cash ideas', cashRecommendations.length, 'LC, MC, SC and All'],
      ['Multi updates', multiRecommendations.length, 'Nano to Giga'],
      ['Next review', '30 Sep', 'Quarterly advisor review'],
    ],
  )}<section class="channel-grid">${[
    ['✉', 'Email alerts', 'Enabled'],
    ['◉', 'WhatsApp alerts', 'Enabled'],
    ['🔔', 'Dashboard alerts', 'Enabled'],
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
  `<article class="card panel"><div class="panel-head"><div><h3>Notification centre</h3><p>Email, WhatsApp and dashboard alerts for your account.</p></div><button id="markRead" class="btn secondary">Mark all as read</button></div><section class="channel-grid">${[
    ['✉', 'Email', clientAlerts.filter((x) => x.channel === 'Email').length],
    ['◉', 'WhatsApp', clientAlerts.filter((x) => x.channel === 'WhatsApp').length],
    ['🔔', 'In-app', clientAlerts.filter((x) => x.channel === 'In-app').length],
  ]
    .map(
      (x) =>
        `<article class="card channel-card"><span class="channel-icon">${x[0]}</span><div><b>${x[1]}</b><small>${x[2]} delivered alerts</small></div><span class="status green">ON</span></article>`,
    )
    .join(
      '',
    )}</section><div class="notification-toolbar">${['All', 'Email', 'WhatsApp', 'In-app'].map((x, i) => `<button class="filter-chip ${i === 0 ? 'active' : ''}" data-channel="${x}">${x}</button>`).join('')}</div><div id="notificationResults">${alertRows(clientAlerts)}</div></article>`;
const segmentPage = (type) => {
  const data = recs.filter((x) => x.product === type);
  return `<article class="card panel"><div class="segment-banner"><div><p class="overline">${type.toUpperCase()} RESEARCH</p><h3>${type} segment recommendations</h3><p>${type === 'Cash' ? 'Direct equity calls with entry, target and status.' : 'Model portfolio calls grouped separately from Cash research.'}</p></div><span class="segment-mark">${type === 'Cash' ? '₹' : '▦'}</span></div><div class="notice">Research communication only. Review suitability with your advisor before acting.</div><div class="segment-summary"><div><small>Total records</small><b>${data.length}</b></div><div><small>Active calls</small><b>${data.filter((x) => x.status === 'Active').length}</b></div><div><small>Last updated</small><b>${data.at(-1).date}</b></div></div>${recTable(data)}</article>`;
};
const cashSegment = () => segmentPage('Cash');
const multiSegment = () => segmentPage('Multi');
const segmentResults = (data) => {
  const cash = data.filter((x) => x.product === 'Cash'),
    multi = data.filter((x) => x.product === 'Multi');
  return `${cash.length ? `<article class="card panel"><div class="segment-banner"><div><p class="overline">CASH RESEARCH</p><h3>Cash segment recommendations</h3><p>Direct equity calls with entry price, target and publication timestamp.</p></div><span class="segment-mark">₹</span></div><div class="segment-summary"><div><small>Filtered records</small><b>${cash.length}</b></div><div><small>Active calls</small><b>${cash.filter((x) => x.status === 'Active').length}</b></div><div><small>Display</small><b>Cash</b></div></div>${recTable(cash)}</article>` : ''}${multi.length ? `<article class="card panel"><div class="segment-banner"><div><p class="overline">MULTI RESEARCH</p><h3>Multi segment recommendations</h3><p>Model portfolio calls displayed separately below the Cash table.</p></div><span class="segment-mark">▦</span></div><div class="segment-summary"><div><small>Filtered records</small><b>${multi.length}</b></div><div><small>Active calls</small><b>${multi.filter((x) => x.status === 'Active').length}</b></div><div><small>Display</small><b>Multi</b></div></div>${recTable(multi)}</article>` : ''}${!cash.length && !multi.length ? '<article class="card panel empty">No recommendations match the selected filters.</article>' : ''}`;
};
const segments = () =>
  `<article class="card panel segment-filter-panel"><div class="panel-head"><div><h3>Cash & Multi recommendations</h3><p>Select one segment or view both tables in the same window.</p></div><span id="segmentCount" class="badge">${recs.filter((x) => x.product !== 'All').length} records</span></div><div class="notice">Research communication only. Review suitability with your advisor before acting.</div><form id="segmentFilters" class="filters segment-filters"><label>Segment<select id="sfProduct"><option value="Both">Cash & Multi</option><option value="Cash">Cash only</option><option value="Multi">Multi only</option></select></label><label>Stock<select id="sfStock"><option value="All">All stocks</option>${[...new Set(recs.filter((x) => x.product !== 'All').map((x) => x.stock))].map((x) => `<option>${x}</option>`).join('')}</select></label><label>Status<select id="sfStatus"><option value="All">All statuses</option><option>Active</option><option>Review</option><option>Closed</option></select></label><label>From date<input id="sfFrom" type="date" value="2026-08-01"></label><label>To date<input id="sfTo" type="date" value="2026-09-30"></label><button class="btn primary">Apply filters</button><button id="clearSegmentFilters" type="button" class="btn secondary">Reset</button></form></article><section id="segmentResults" class="segments-stack">${segmentResults(recs.filter((x) => x.product !== 'All'))}</section>`;
const workflowMap = () =>
  `<section class="flow-summary"><div><p class="overline">END-TO-END OPERATING MODEL</p><h3>Sampadha platform workflow</h3><p>Role-based journey from client acquisition to approved research delivery.</p></div><div class="flow-legend"><span><i class="sales-dot"></i>Sales</span><span><i class="admin-dot"></i>Admin</span><span><i class="ra-dot"></i>Research Analyst</span><span><i class="client-dot"></i>Client</span></div></section><section class="workflow-board card"><div class="flow-start"><span>01</span><div><b>Secure role login</b><small>System identifies Admin, RA, Sales or Client access.</small></div></div><div class="flow-split">${[
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
        `<article class="lane ${x[0]}"><div class="lane-title">${x[0] === 'sales' ? 'SALES LANE' : 'RA LANE'}</div><div class="flow-node"><span>${x[1]}</span><div><b>${x[2]}</b><small>${x[3]}</small></div></div>${x[0] === 'sales' ? `<div class="flow-arrow">↓</div><div class="flow-node"><span>03</span><div><b>Submit client application</b><small>Status: Pending Admin Approval</small></div></div><div class="flow-arrow mail-arrow">↓ <em>Automatic email</em></div><div class="flow-node email-node"><span>✉</span><div><b>Application received</b><small>Client receives reference and IST timestamp.</small></div></div>` : `<div class="flow-arrow">↓</div><div class="flow-node"><span>03</span><div><b>Publish research</b><small>Single/batch reports • Cash, Multi and All products</small></div></div>`}</article>`,
    )
    .join(
      '',
    )}</div><div class="flow-arrow central">↓</div><article class="admin-gate"><div class="lane-title">ADMIN CONTROL GATE</div><div class="flow-node admin"><span>04</span><div><b>Review client and research records</b><small>Approve or reject onboarding • manage access • preserve audit trail</small></div></div><div class="decision"><div><b>APPROVED</b><small>Activate profile and selected plan</small></div><span>OR</span><div><b>CHANGES REQUIRED</b><small>Return application for correction</small></div></div></article><div class="flow-arrow mail-arrow central">↓ <em>Decision email</em></div><div class="flow-end-grid"><article class="flow-node client"><span>05</span><div><b>Client confirmation</b><small>Approval or correction-required email with reference and timestamp.</small></div></article><article class="flow-node client"><span>06</span><div><b>View-only client portal</b><small>Profile • subscribed products • payments • filtered recommendations</small></div></article><article class="flow-node audit"><span>07</span><div><b>Ongoing audit and review</b><small>Admin oversight • quarterly/annual payments • report history</small></div></article></div></section>`;
const emails = () => {
  const list =
    state.role === 'client' ? state.emails.filter((x) => x.to === state.user.email) : state.emails;
  return `<article class="card panel"><div class="panel-head"><div><h3>${state.role === 'client' ? 'My notifications' : 'Client confirmation emails'}</h3><p>Automatic messages created after submission and Admin decisions.</p></div><span class="badge">${list.length} messages</span></div><div class="email-layout"><div class="email-list">${list.map((x, i) => `<button class="email-item ${i === 0 ? 'active' : ''}" data-mail="${x.id}"><span class="mail-dot"></span><div><b>${esc(x.subject)}</b><small>To: ${esc(x.to)}</small><small class="stamp">${esc(x.sent)}</small></div><span class="status green">${esc(x.status)}</span></button>`).join('') || '<div class="empty">No confirmation emails available.</div>'}</div><div id="emailPreview" class="email-preview">${list[0] ? emailBody(list[0]) : '<div class="empty">Select an email to preview.</div>'}</div></div></article>`;
};
const emailBody = (x) =>
  `<div class="email-preview-head"><span class="activity-icon">✉</span><div><h3>${esc(x.subject)}</h3><p>From: onboarding@sampadha.demo<br>To: ${esc(x.to)}</p></div><span class="status green">${esc(x.status)}</span></div><div class="email-copy"><p>Hello ${esc(x.name)},</p><p>${esc(x.body)}</p><div class="notice"><b>Application reference</b><br><span class="stamp">${esc(x.application)} • ${esc(x.sent)}</span></div><p>Regards,<br><b>Sampadha Client Services</b></p><small>Simulated message: it is logged in the portal only. No external email was sent.</small></div>`;
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
  segments,
  cashSegment,
  multiSegment,
  users,
  strategies,
  reports: () => reportForm(false),
  multiReports: () => reportForm(true),
  clients: clientTable,
  addClient,
  approvals,
  emails,
  workflowMap,
  kyc,
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
  segments: 'Cash & Multi segments',
  cashSegment: 'Cash segment',
  multiSegment: 'Multi segment',
  users: 'Users & access',
  strategies: 'Strategies',
  reports: 'Single report',
  multiReports: 'Multiple reports',
  clients: 'Clients',
  addClient: 'Add share-market client',
  approvals: 'Client approvals',
  emails: 'Email delivery',
  workflowMap: 'Workflow chart',
  kyc: 'KYC onboarding',
  plans: 'Subscription plans',
  profile: 'Profile',
  products: 'Subscribed products',
  payments: 'Payment details',
  recommendations: 'All recommendations',
  audit: 'Audit trail',
};
function renderNav() {
  const items = nav[state.role];
  $('#nav').innerHTML =
    `<p class="nav-label">${state.role === 'client' ? 'MY ACCOUNT' : 'WORKSPACE'}</p>` +
    items
      .map(
        (x) =>
          `<button class="nav-item ${state.page === x[0] ? 'active' : ''}" data-page="${x[0]}"><span>${x[1]}</span>${x[2]}</button>`,
      )
      .join('');
}
function updateAlertBadge() {
  const count = clientAlerts.filter((x) => x.unread).length;
  $('#alertCount').textContent = count;
  $('#notificationBell').style.display = state.role === 'client' ? 'grid' : 'none';
}
function show(page) {
  state.page = page;
  $('#title').textContent = titles[page];
  $('#crumb').textContent = `${roles[state.role].name} workspace`;
  $('#content').innerHTML = pages[page]().replace('timestampVtbl', 'timestamped');
  renderNav();
  updateAlertBadge();
  bind();
  bindSeparateRecommendationFilters();
  $('.sidebar').classList.remove('open');
}
function bind() {
  const rf = $('#reportForm');
  if (rf)
    rf.onsubmit = (e) => {
      e.preventDefault();
      const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      $('#reportResult').innerHTML =
        `<div class="notice" style="margin-top:18px"><b>Report generated</b><br><span class="stamp">REPORT-${Date.now().toString().slice(-6)} • ${now} IST</span></div>`;
    };
  const k = $('#kycForm');
  if (k)
    k.onsubmit = (e) => {
      e.preventDefault();
      toast('KYC submitted for review');
    };
  const f = $('#filters');
  if (f)
    f.onsubmit = (e) => {
      e.preventDefault();
      const p = $('#fProduct').value,
        s = $('#fStock').value,
        a = $('#fFrom').value,
        b = $('#fTo').value,
        st = $('#fStatus').value;
      state.filtered = recs.filter(
        (x) =>
          (p === 'All' || x.product === p) &&
          (s === 'All' || x.stock === s) &&
          x.date >= a &&
          x.date <= b &&
          (st === 'All' || x.status === st),
      );
      $('#recTable').innerHTML = recTable(state.filtered);
      $('.panel-head .badge').textContent = `${state.filtered.length} records`;
    };
  const recommendationFilters = $('#recommendationFilters');
  if (recommendationFilters) {
    const productOptions = {
      Cash: ['All', 'LC', 'MC', 'SC'],
      Multi: ['All', 'Nano', 'Mini', 'Micro', 'Mega', 'Giga'],
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
    $('#downloadPdf').onclick = () => toast('Demo PDF report downloaded');
  }
  const sf = $('#segmentFilters');
  if (sf) {
    const applySegmentFilters = () => {
      const p = $('#sfProduct').value,
        s = $('#sfStock').value,
        st = $('#sfStatus').value,
        a = $('#sfFrom').value,
        b = $('#sfTo').value;
      const data = recs.filter(
        (x) =>
          x.product !== 'All' &&
          (p === 'Both' || x.product === p) &&
          (s === 'All' || x.stock === s) &&
          (st === 'All' || x.status === st) &&
          x.date >= a &&
          x.date <= b,
      );
      $('#segmentResults').innerHTML = segmentResults(data);
      $('#segmentCount').textContent = `${data.length} records`;
    };
    sf.onsubmit = (e) => {
      e.preventDefault();
      applySegmentFilters();
    };
    $('#sfProduct').onchange = applySegmentFilters;
    $('#clearSegmentFilters').onclick = () => {
      sf.reset();
      applySegmentFilters();
    };
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
  const close = $('#closePdf'),
    download = $('#downloadPdf');
  if (close) close.onclick = () => $('#pdfModal').classList.add('hidden');
  if (download) download.onclick = () => toast('Demo PDF report downloaded');
}
function toast(m) {
  $('#toast').textContent = m;
  $('#toast').classList.add('show');
  setTimeout(() => $('#toast').classList.remove('show'), 2200);
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
    error = $('#loginError');
  submit.disabled = true;
  error.textContent = '';
  try {
    await Api.login($('#email').value, $('#password').value);
    const profile = await Api.currentProfile();
    if (!profile) {
      await Api.logout();
      throw new Error('This account has no portal access. Contact an administrator.');
    }
    $('#password').value = '';
    await enterPortal(profile);
  } catch (err) {
    error.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
};
// Restore an existing session after a refresh, and drop to the login screen if it expires.
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const profile = await Api.currentProfile();
    if (profile) await enterPortal(profile);
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
      `<div class="pdf-logo">SAMPADHA <span>RESEARCH REPORT</span></div><div class="detail-grid">${Object.entries(
        item,
      )
        .filter(([k]) => labels[k])
        .map(
          ([k, v]) =>
            `<div class="detail"><small>${labels[k]}</small><b>${v}${['published', 'delivered'].includes(k) ? ' IST' : ''}</b></div>`,
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
$('#content').addEventListener('submit', async (e) => {
  if (e.target.id !== 'addClientForm') return;
  e.preventDefault();
  const d = new FormData(e.target),
    button = e.target.querySelector('button:not([type=button])'),
    payload = Object.fromEntries(
      [
        'name',
        'pan',
        'dob',
        'email',
        'mobile',
        'occupation',
        'income',
        'residency',
        'city',
        'broker',
        'depository',
        'demat',
        'tradingId',
        'bank',
        'experience',
        'risk',
        'horizon',
        'objective',
        'amount',
        'loss',
        'plan',
      ].map((k) => [k, d.get(k)]),
    );
  payload.segments = d.getAll('segments');
  payload.products = d.getAll('products');
  payload.consent = d.get('consent') === 'on';
  button.disabled = true;
  try {
    await Api.submitApplication(payload);
    await refreshWorkspace();
    toast('Client submitted • confirmation email logged');
    show('emails');
  } catch (err) {
    toast(err.message);
    button.disabled = false;
  }
});
const themes = {
  sapphire: {
    name: 'Sapphire Gold',
    note: 'Signature wealth theme',
    colors: ['#071a35', '#0969e8', '#d7a33b'],
  },
  onyx: {
    name: 'Onyx Copper',
    note: 'Executive dark luxury',
    colors: ['#17120f', '#b56a2e', '#d6a15d'],
  },
  emerald: {
    name: 'Emerald Platinum',
    note: 'Confident institutional',
    colors: ['#062720', '#087f68', '#c8b36a'],
  },
  ivory: {
    name: 'Ivory Navy',
    note: 'Quiet private banking',
    colors: ['#f8f7f3', '#183f75', '#b98a35'],
  },
};
let activeTheme = localStorage.getItem('sampadha-theme') || 'sapphire';
function renderThemes() {
  document.body.dataset.theme = activeTheme === 'sapphire' ? '' : activeTheme;
  $('#themeOptions').innerHTML = Object.entries(themes)
    .map(
      ([key, t]) =>
        `<button class="theme-option ${key === activeTheme ? 'active' : ''}" data-theme="${key}"><span class="theme-swatches">${t.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span><span><b>${t.name}</b><small>${t.note}</small></span><span class="theme-check">${key === activeTheme ? '✓' : ''}</span></button>`,
    )
    .join('');
}
function openThemes(open = true) {
  $('#themeToolbar').classList.toggle('open', open);
}
$('#themeToggle').onclick = () => openThemes();
$('#floatingTheme').onclick = () => openThemes();
$('#themeClose').onclick = () => openThemes(false);
$('#themeOptions').onclick = (e) => {
  const b = e.target.closest('[data-theme]');
  if (!b) return;
  activeTheme = b.dataset.theme;
  localStorage.setItem('sampadha-theme', activeTheme);
  renderThemes();
  toast(`${themes[activeTheme].name} applied`);
};
renderThemes();
