// Overview pages built from the database (the prototype's overview used invented figures):
//   • Admin: clients, reports delivered, signing pipeline and compliance; a monthly chart of
//     delivered reports; compliance meters; the latest audit-trail entries.
//   • Research Analyst: the existing figures plus a monthly chart of their own reports.
//   • Client: their alerts, reports and compliance checklist (no claims about channels that are
//     not switched on).
// Charts come from charts.js; tick() and complianceRows() from client-compliance.js.

const OVERVIEW_MONTHS = 6;
const AUDIT_LABELS = {
  'login.code_verified': 'Passed the sign-in code after the password',
  'login.email_code_sent': 'Asked for an email code to sign in without a password',
  'cash.stock_list_saved': 'Saved the monthly research pack stock list',
  'report.pdf_replaced': 'Replaced a research pack PDF',
  'account.temp_password_set': 'Temporary password set (to be changed by the person)',
  'report.created': 'Report created',
  'report.esign_requested': 'Aadhaar eSign started',
  'report.esigned': 'Report signed with Aadhaar eSign',
  'report.sent': 'Report sent to clients',
  'report.attachment': 'Attachment added to a report',
  'report.parrva_submitted': 'Report sent to CARE PaRRVA',
  'report.parrva_failed': 'CARE PaRRVA submission failed',
  'position.exit': 'Position closed (in part or in full)',
  'application.submitted': 'Client application submitted',
  'application.approved': 'Client application approved',
  'application.rejected': 'Client application returned',
  'risk_profile.submitted': 'Risk profile completed',
  'document.sent_for_signature': 'Document sent for eSign',
  'document.esign_requested': 'Document eSign started',
  'document.esigned': 'Document signed',
  'document.cancelled': 'Document withdrawn',
  'broker_email.consented': 'Broker auto-email consent given',
  'broker_email.details_saved': 'Broker details saved',
  'broker_email.revoked': 'Broker auto-email withdrawn',
  'broker_email.queued': 'Order emailed to broker',
  'broker_email.test_queued': 'Broker test email sent',
  'mail.test_queued': 'Test email sent',
  'master.uploaded': 'Weekly master uploaded',
  'kyc.verified': 'KYC verified',
  'kyc.pending': 'KYC marked pending',
  'kyc.rejected': 'KYC rejected',
};
const AUDIT_ICON_BY_ENTITY = {
  research_report: 'layers',
  client_application: 'userPlus',
  client_profile: 'contacts',
  client_document: 'fileCheck',
  broker_email_consent: 'send',
  email_log: 'mail',
  symbol_master: 'upload',
};

// The last OVERVIEW_MONTHS calendar months in IST, oldest first: [{ key: '2026-10', label: 'Oct' }].
function overviewMonths() {
  const parts = (d) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' })
        .formatToParts(d)
        .map((p) => [p.type, p.value]),
    );
  const now = parts(new Date());
  let year = Number(now.year),
    month = Number(now.month);
  const months = [];
  for (let i = 0; i < OVERVIEW_MONTHS; i++) {
    const date = new Date(Date.UTC(year, month - 1, 15));
    months.unshift({
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }),
      long: date.toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    });
    month -= 1;
    if (!month) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}
const monthKey = (iso) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}`;
};
// Reports per month and segment, counted on the given timestamp field.
function reportsByMonth(reports, field) {
  const months = overviewMonths();
  const count = (segment) =>
    months.map((m) => reports.filter((r) => r[field] && r.segment === segment && monthKey(r[field]) === m.key).length);
  return {
    labels: months.map((m) => m.label),
    range: months[0].long + ' – ' + months[months.length - 1].long,
    series: [
      { name: 'Multi', values: count('Multi') },
      { name: 'Cash', values: count('Cash') },
    ],
    unit: 'reports',
  };
}
const withinDays = (iso, days) => iso && Date.now() - Date.parse(iso) < days * 86400000;

function activityFeed(entries) {
  return `<div class="activity">${
    entries
      .map(
        (a) =>
          `<div class="activity-row"><span class="activity-icon">${icon(AUDIT_ICON_BY_ENTITY[a.entity] || 'history')}</span><div><b>${esc(AUDIT_LABELS[a.action] || a.action.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase()))}</b><small>${esc([a.entity_ref, a.actor_login].filter(Boolean).join(' · ') || 'System')}</small></div><time>${esc(Api.fmt.stamp(a.at))}</time></div>`,
      )
      .join('') || '<p class="empty">Nothing recorded yet.</p>'
  }</div>`;
}

function adminOverview() {
  const ws = state.ws || {},
    reports = ws.reports || [],
    rows = complianceRows().filter((r) => r.is_active),
    clientsTotal = rows.length,
    pendingApps = (ws.applications || []).filter((a) => a.status === 'Pending').length,
    sent30 = reports.filter((r) => withinDays(r.sentAt, 30)),
    unsigned = reports.filter((r) => r.esignStatus !== 'Signed').length,
    signedNotSent = reports.filter((r) => r.esignStatus === 'Signed' && !r.sentAt).length,
    complete = rows.filter(
      (r) => r.risk_category && r.agreement_signed_at && /^verified/i.test(r.kyc_status || ''),
    ).length,
    chart = reportsByMonth(reports, 'sentAt');
  return `${statCards([
    ['Active clients', String(clientsTotal), pendingApps ? `${pendingApps} application${pendingApps > 1 ? 's' : ''} awaiting approval` : 'No applications waiting'],
    ['Reports delivered', String(sent30.length), 'In the last 30 days'],
    ['Awaiting signature', String(unsigned), signedNotSent ? `${signedNotSent} signed, not yet sent` : 'Every signed report has been sent'],
    ['Compliance complete', `${complete} of ${clientsTotal}`, 'Risk profile, agreement and KYC'],
  ])}<section class="overview-grid">${chartCard({
    id: 'chartDelivered',
    title: 'Reports delivered',
    subtitle: 'Signed reports sent to clients each month, ' + chart.range,
  })}<article class="card panel"><div class="panel-head"><div><h3>Client compliance</h3><p>Out of ${clientsTotal} active clients</p></div><button class="btn secondary" data-go="compliance">Open</button></div><div class="meters">${meterRow('Risk profile done', rows.filter((r) => r.risk_category).length, clientsTotal)}${meterRow('Agreement signed', rows.filter((r) => r.agreement_signed_at).length, clientsTotal)}${meterRow('KYC verified', rows.filter((r) => /^verified/i.test(r.kyc_status || '')).length, clientsTotal)}${meterRow('Broker auto-email on', rows.filter((r) => r.broker_email_status === 'Active').length, clientsTotal)}</div></article></section><article class="card panel"><div class="panel-head"><div><h3>Recent activity</h3><p>Latest entries in the audit trail</p></div><button class="btn secondary" data-go="audit">View all</button></div>${activityFeed((ws.audit || []).slice(0, 6))}</article>`;
}

function clientOverview() {
  const uid = state.user.uid,
    unread = clientAlerts.filter((x) => x.unread).length,
    received = (state.ws?.reports || []).filter((r) => r.recipients.includes(uid)).length,
    rp = latestRiskProfile(uid),
    agreement = documentsFor(uid).some((d) => d.kind === 'Client agreement' && d.status === 'Signed'),
    kyc = /^verified/i.test(state.user.kyc || ''),
    done = [rp, agreement, kyc].filter(Boolean).length,
    hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date())),
    greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `<section class="client-welcome card"><div><p class="overline">Your account</p><h3>${greeting}, ${esc(state.user.person.split(' ')[0])}</h3><p>Your research, alerts and account in one place.</p></div>${unread ? `<button class="btn primary" data-go="notifications">View ${unread} new alert${unread > 1 ? 's' : ''}</button>` : ''}</section>${statCards([
    ['Unread alerts', String(unread), 'In the portal and by email'],
    ['Reports received', String(received), 'Signed research sent to you'],
    ['Cash ideas', String(cashRecommendations.length), 'LC, MC, SC and All'],
    ['Multi updates', String(multiRecommendations.length), 'Nano to Giga'],
  ])}<section class="grid-2"><article class="card panel"><div class="panel-head"><div><h3>Your checklist</h3><p>${done === 3 ? 'All done. Thank you.' : `${done} of 3 done`}</p></div><button class="btn secondary" data-go="compliance">Open</button></div><div class="compliance-checklist single">${tick(Boolean(rp), 'Risk profile', rp ? rp.category : 'Answer nine questions')}${tick(agreement, 'Client agreement', agreement ? 'Signed' : 'Sign it with Aadhaar eSign')}${tick(kyc, 'KYC', state.user.kyc)}</div></article><article class="card panel"><div class="panel-head"><div><h3>Latest notifications</h3><p>The three most recent</p></div><button class="btn secondary" data-go="notifications">View all</button></div>${alertRows(clientAlerts.slice(0, 3))}</article></section>`;
}

// The audit trail uses the same plain-language feed as the overview.
pages.audit = () =>
  `<article class="card panel"><div class="panel-head"><div><h3>Audit trail</h3><p>Every change made through the portal, newest first. Entries cannot be edited or deleted.</p></div><span class="badge">Last ${(state.ws?.audit || []).length}</span></div>${activityFeed(state.ws?.audit || [])}</article>`;
pages.dashboard = () => (state.role === 'ra' ? raDashboard() : adminOverview());
pages.clientDashboard = clientOverview;

const overviewOriginalShow = show;
show = function (page) {
  overviewOriginalShow(page);
  if (page !== 'dashboard') return;
  if (state.role === 'admin')
    drawColumnChart('chartDelivered', {
      ...reportsByMonth(state.ws?.reports || [], 'sentAt'),
      empty: 'No reports have been delivered in the last six months. Each month will appear here once a signed report is sent to clients.',
    });
  if (state.role === 'ra')
    drawColumnChart('chartAuthored', {
      ...reportsByMonth(state.ws?.reports || [], 'createdAt'),
      empty: 'You have not created a report in the last six months.',
    });
};
