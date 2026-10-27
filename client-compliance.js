// Client compliance, as in Mahogha's Clients and E-Sign pages: per client a risk profile, a signed
// client agreement, KYC and (optional) broker auto-email.
//   • Client → Compliance: answer the risk questionnaire, sign documents with Aadhaar eSign.
//   • Admin / Sales → Compliance: overview of every client, send a PDF to a client for eSign,
//     download signed copies; Admin records KYC.
//   • RA send screens: a warning next to clients with something missing.
// Rules and scoring live in migration 20261027030000_v2_client_compliance.sql; signing in the
// client-esign Edge Function.

const COMPLIANCE_RETURN_PARAM = 'docsign';
// Question order of v2_private.risk_questionnaire() (stored answers come back in key order).
const RISK_ORDER = ['age', 'horizon', 'objective', 'income', 'savings_share', 'experience', 'derivatives', 'fall', 'loss'];
const DOC_STATUS_TONE ={ Signed: 'green', 'Awaiting signature': 'gold', Signing: 'gold' };
let complianceQuestions = null;
let complianceRetake = false;
let complianceAnswersFor = '';

const complianceRows = () => state.ws?.compliance || [];
const complianceRow = (clientId) => complianceRows().find((r) => r.client_id === clientId);
const latestRiskProfile = (clientId) =>
  (state.ws?.riskProfiles || []).find((r) => r.client_id === clientId);
const documentsFor = (clientId) =>
  (state.ws?.clientDocuments || []).filter((d) => d.client_id === clientId);
const complianceDate = (iso) => (iso ? Api.fmt.stamp(iso) + ' IST' : '');
const tick = (ok, text, sub = '') =>
  `<div class="compliance-check ${ok ? 'done' : 'todo'}"><span>${ok ? '✓' : '○'}</span><div><b>${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`;

// For the RA send screens: what is missing for this client, or ''.
function complianceNote(clientId, segment) {
  const row = complianceRow(clientId);
  if (!row) return '';
  const notes = [];
  if (!row.risk_category) notes.push('no risk profile');
  else if (segment === 'Multi' && !row.derivatives_suitable) notes.push('F&O may not suit risk profile');
  if (!row.agreement_signed_at) notes.push('agreement not signed');
  return notes.length ? ' · ⚠ ' + notes.join(', ') : '';
}

function documentActions(d, client) {
  const buttons = [
    `<button type="button" class="btn secondary" data-doc-download="${esc(d.original_path)}">PDF</button>`,
  ];
  if (d.signed_path)
    buttons.push(
      `<button type="button" class="btn secondary" data-doc-download="${esc(d.signed_path)}">Signed PDF</button>`,
    );
  if (d.status === 'Signing')
    buttons.push(`<button type="button" class="btn secondary" data-doc-verify="${d.id}">Check status</button>`);
  if (!client && ['Awaiting signature', 'Signing'].includes(d.status))
    buttons.push(`<button type="button" class="btn secondary" data-doc-cancel="${d.id}">Withdraw</button>`);
  return `<div class="compliance-actions">${buttons.join('')}</div>`;
}
const documentStatus = (d) =>
  `<span class="status ${DOC_STATUS_TONE[d.status] || 'red'}">${esc(d.status)}</span>${d.signed_at ? `<small>${esc(complianceDate(d.signed_at))}</small>` : ''}`;

function riskSummary(rp) {
  return `<div class="notice"><b>${esc(rp.category)}</b> · score ${rp.score} of 36 · ${esc(complianceDate(rp.submitted_at))}<br>${
    rp.derivatives_suitable
      ? 'Futures and options (Multi) research can suit this profile.'
      : 'Futures and options (Multi) research may not suit this profile.'
  }</div><dl class="risk-answers">${Object.entries(rp.answers || {})
    .sort(([a], [b]) => RISK_ORDER.indexOf(a) - RISK_ORDER.indexOf(b))
    .map(([, a]) => `<dt>${esc(a.question)}</dt><dd>${esc(a.answer)}</dd>`)
    .join('')}</dl>`;
}

// ───────────── client page ─────────────
function clientCompliancePage() {
  const uid = state.user.uid,
    rp = latestRiskProfile(uid),
    docs = documentsFor(uid).filter((d) => d.status !== 'Cancelled'),
    agreement = docs.find((d) => d.kind === 'Client agreement' && d.status === 'Signed'),
    broker = (state.ws?.brokerEmails || [])[0];
  return `<article class="card panel"><div class="panel-head"><div><h3>Your compliance checklist</h3><p>SEBI requires your adviser to know your risk profile and to have your signed agreement before sending research.</p></div></div><div class="compliance-checklist">${tick(Boolean(rp), 'Risk profile', rp ? rp.category + ' · ' + complianceDate(rp.submitted_at) : 'Answer the questionnaire below')}${tick(Boolean(agreement), 'Client agreement', agreement ? 'Signed ' + complianceDate(agreement.signed_at) : docs.some((d) => d.kind === 'Client agreement') ? 'Sign it below' : 'Sampadha will send it to you to sign')}${tick(/^verified/i.test(state.user.kyc), 'KYC', state.user.kyc)}${tick(broker?.status === 'Active', 'Broker auto-email (optional)', broker?.status === 'Active' ? 'On' : 'Off')}</div></article><article class="card panel"><div class="panel-head"><div><h3>Documents to sign</h3><p>Sign with Aadhaar eSign: the OTP goes to your Aadhaar-linked mobile.</p></div><span class="badge">${docs.filter((d) => d.status !== 'Signed').length} to sign</span></div>${
    docs.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Document</th><th>Status</th><th></th></tr></thead><tbody>${docs
          .map(
            (d) =>
              `<tr><td><b>${esc(d.title)}</b><small>${esc(d.doc_ref)} · ${esc(d.kind)} · sent ${esc(complianceDate(d.created_at))}</small></td><td>${documentStatus(d)}</td><td>${documentActions(d, true)}${
                d.status === 'Signed'
                  ? ''
                  : `<form class="compliance-sign" data-doc-sign="${d.id}"><input name="mobile" type="tel" inputmode="numeric" maxlength="14" required placeholder="Aadhaar-linked mobile" value="${esc(String(state.user.mobile || '').replace(/[^\d]/g, '').slice(-10))}"><button class="btn primary">Sign with Aadhaar eSign</button></form>`
              }</td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : '<p class="muted">Nothing to sign right now.</p>'
  }<p id="complianceDocMessage" class="research-message" role="status"></p></article><article class="card panel" id="riskProfileCard"><div class="panel-head"><div><h3>Risk profile</h3><p>Nine questions about your goals, experience and how much risk you can take.</p></div>${rp ? `<span class="status green">${esc(rp.category)}</span>` : '<span class="status gold">To do</span>'}</div>${
    rp && !complianceRetake
      ? riskSummary(rp) + '<div class="actions"><button type="button" class="btn secondary" data-risk-retake>Answer again</button></div>'
      : '<form id="riskForm"><div id="riskQuestions"><p class="muted">Loading the questionnaire…</p></div><label class="consent"><input type="checkbox" name="confirm" required><span><b>I confirm these answers are true and complete *</b><small>Your adviser uses them to judge which research suits you.</small></span></label><div class="actions"><button class="btn primary">Save my risk profile</button></div><p id="riskMessage" class="research-message" role="status"></p></form>'
  }</article>`;
}

async function renderRiskQuestions() {
  const target = document.querySelector('#riskQuestions');
  if (!target) return;
  try {
    complianceQuestions ||= await Api.riskQuestionnaire();
    target.innerHTML = complianceQuestions.questions
      .map(
        (q, i) =>
          `<fieldset class="risk-question"><legend>${i + 1}. ${esc(q.text)} *</legend>${q.options
            .map(
              (o, j) =>
                `<label><input type="radio" name="${esc(q.key)}" value="${j}" required> ${esc(o[0])}</label>`,
            )
            .join('')}</fieldset>`,
      )
      .join('');
  } catch (error) {
    target.textContent = error.message;
  }
}

// ───────────── Admin / Sales page ─────────────
function staffCompliancePage() {
  const rows = complianceRows(),
    clientsList = (state.ws?.directory || []).filter((p) => p.role === 'client' && p.is_active),
    docs = state.ws?.clientDocuments || [],
    login = new Map(clientsList.map((p) => [p.id, p.login_id])),
    admin = state.role === 'admin';
  return `${statCards([
    ['Clients', rows.length, 'In the portal'],
    ['Risk profile done', rows.filter((r) => r.risk_category).length, 'Answered by the client', '✓'],
    ['Agreement signed', rows.filter((r) => r.agreement_signed_at).length, 'Aadhaar eSigned', '✎'],
    ['KYC verified', rows.filter((r) => /^verified/i.test(r.kyc_status || '')).length, 'Recorded by Admin', '✓'],
  ])}<article class="card panel"><div class="panel-head"><div><h3>Send a document for e-sign</h3><p>Upload the client agreement (or any PDF) for one client. They are emailed and sign it with Aadhaar eSign in their portal.</p></div><span class="badge">eSign</span></div><form id="docSendForm"><div class="form-grid three"><label class="field">Client *<select name="client" required><option value="">Select a client</option>${clientsList.map((p) => `<option value="${esc(p.id)}">${esc(p.full_name)} · ${esc(p.login_id)}</option>`).join('')}</select></label><label class="field">Document type *<select name="kind"><option>Client agreement</option><option>Other</option></select></label><label class="field">Title *<input name="title" required maxlength="120" value="Research Analyst client agreement"></label><label class="field">Sign pages<select name="signPages"><option value="All">All pages</option><option value="Last">Last page only</option></select></label><label class="field">PDF (up to 10 MB) *<input name="file" type="file" accept="application/pdf" required></label></div><div class="actions"><button class="btn primary">Send for signature</button></div><p id="docSendMessage" class="research-message" role="status"></p></form></article><article class="card panel"><div class="panel-head"><div><h3>Client compliance</h3><p>Each client's risk profile, signed agreement and KYC, filled in by the client's own actions.</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th>Risk profile</th><th>Agreement</th><th>KYC</th><th>Broker auto-email</th><th></th></tr></thead><tbody>${
    rows
      .map(
        (r) =>
          `<tr><td><b>${esc(r.full_name)}</b><small>${esc(r.login_id)}${r.is_active ? '' : ' · inactive'}</small></td><td>${
            r.risk_category
              ? `<span class="status ${r.derivatives_suitable ? 'green' : 'gold'}">${esc(r.risk_category)}</span><small>${r.risk_score}/36 · ${esc(complianceDate(r.risk_at))}${r.derivatives_suitable ? '' : ' · F&O may not suit'}</small>`
              : '<span class="status red">Not done</span>'
          }</td><td>${
            r.agreement_signed_at
              ? `<span class="status green">Signed</span><small>${esc(complianceDate(r.agreement_signed_at))}</small>`
              : `<span class="status ${r.documents_pending ? 'gold' : 'red'}">${r.documents_pending ? 'Sent, not signed' : 'Not sent'}</span>`
          }</td><td>${
            admin
              ? `<form class="kyc-form" data-kyc="${esc(r.login_id)}"><select name="status">${['Verified', 'Pending', 'Rejected'].map((s) => `<option ${String(r.kyc_status || '').startsWith(s) ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn secondary">Save</button></form><small>${esc(r.kyc_status || '—')}</small>`
              : esc(r.kyc_status || '—')
          }</td><td>${esc(r.broker_email_status || 'Off')}</td><td>${r.risk_category ? `<button type="button" class="btn secondary" data-risk-answers="${esc(r.client_id)}">${complianceAnswersFor === r.client_id ? 'Hide answers' : 'Answers'}</button>` : ''}</td></tr>${
            complianceAnswersFor === r.client_id && latestRiskProfile(r.client_id)
              ? `<tr><td colspan="6">${riskSummary(latestRiskProfile(r.client_id))}</td></tr>`
              : ''
          }`,
      )
      .join('') || '<tr><td colspan="6" class="empty">No clients yet.</td></tr>'
  }</tbody></table></div></article><article class="card panel"><div class="panel-head"><div><h3>Documents sent for e-sign</h3><p>Original and signed copies are kept privately.</p></div><span class="badge">${docs.length}</span></div>${
    docs.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Document</th><th>Client</th><th>Status</th><th></th></tr></thead><tbody>${docs
          .map(
            (d) =>
              `<tr><td><b>${esc(d.title)}</b><small>${esc(d.doc_ref)} · ${esc(d.kind)} · ${esc(d.sign_pages === 'All' ? 'all pages' : 'last page')} · sent ${esc(complianceDate(d.created_at))}</small></td><td>${esc(login.get(d.client_id) || state.ws?.idToLogin.get(d.client_id) || '—')}</td><td>${documentStatus(d)}</td><td>${documentActions(d, false)}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : '<p class="muted">No documents sent yet.</p>'
  }<p id="complianceDocMessage" class="research-message" role="status"></p></article>`;
}

pages.compliance = () => (state.role === 'client' ? clientCompliancePage() : staffCompliancePage());
titles.compliance = 'Compliance';
nav.client.splice(
  nav.client.findIndex((x) => x[0] === 'profile') + 1,
  0,
  ['compliance', '§', 'Compliance'],
);
for (const role of ['admin', 'sales']) {
  const at = nav[role].findIndex((x) => x[0] === 'clients');
  nav[role].splice(at + 1, 0, ['compliance', '§', 'Compliance']);
}
const complianceOriginalShow = show;
show = function (page) {
  complianceOriginalShow(page);
  if (page === 'compliance') renderRiskQuestions();
};

async function complianceRefresh(message) {
  await refreshWorkspace();
  show('compliance');
  const target = document.querySelector('#complianceDocMessage');
  if (target && message) target.textContent = message;
}

async function complianceVerify(documentId) {
  const result = await Api.clientEsignVerify(documentId);
  await complianceRefresh(
    result.status === 'Signed'
      ? 'Signed. The signed copy is saved.'
      : result.message || 'Signing is not finished yet. Check again in a minute.',
  );
}

// Back from the eSign page: confirm the signature with the server.
async function complianceResumeSign() {
  const params = new URLSearchParams(location.search),
    documentId = params.get(COMPLIANCE_RETURN_PARAM);
  if (!documentId) return;
  params.delete(COMPLIANCE_RETURN_PARAM);
  history.replaceState(null, '', location.pathname + (params.size ? '?' + params : ''));
  if (state.role !== 'client') return;
  show('compliance');
  await complianceVerify(documentId).catch((error) => {
    const target = document.querySelector('#complianceDocMessage');
    if (target) target.textContent = error.message;
  });
}
const complianceOriginalEnterPortal = enterPortal;
enterPortal = async function (profile) {
  await complianceOriginalEnterPortal(profile);
  await complianceResumeSign();
};

document.querySelector('#content').addEventListener('click', async (event) => {
  const target = event.target;
  if (target.closest('[data-risk-retake]')) {
    complianceRetake = true;
    show('compliance');
    document.querySelector('#riskProfileCard')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const answers = target.closest('[data-risk-answers]');
  if (answers) {
    complianceAnswersFor =
      complianceAnswersFor === answers.dataset.riskAnswers ? '' : answers.dataset.riskAnswers;
    show('compliance');
    return;
  }
  const button = target.closest('[data-doc-download],[data-doc-verify],[data-doc-cancel]');
  if (!button) return;
  const message = document.querySelector('#complianceDocMessage');
  button.disabled = true;
  try {
    if (button.dataset.docDownload) {
      const blob = await Api.downloadFile(button.dataset.docDownload),
        url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else if (button.dataset.docVerify) {
      message.textContent = 'Checking with the eSign service…';
      await complianceVerify(button.dataset.docVerify);
    } else if (confirm('Withdraw this document? The client can no longer sign it.')) {
      await Api.cancelClientDocument(button.dataset.docCancel);
      await complianceRefresh('Document withdrawn.');
    }
  } catch (error) {
    if (message) message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#content').addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id === 'riskForm') {
    event.preventDefault();
    const button = form.querySelector('button'),
      message = form.querySelector('#riskMessage'),
      answers = {};
    for (const q of complianceQuestions?.questions || []) {
      const picked = form.querySelector(`[name="${q.key}"]:checked`);
      if (picked) answers[q.key] = Number(picked.value);
    }
    button.disabled = true;
    try {
      const result = await Api.submitRiskProfile(answers);
      state.user.risk = result.category;
      complianceRetake = false;
      await complianceRefresh();
      toast('Risk profile saved: ' + result.category);
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
    return;
  }
  if (form.matches('[data-doc-sign]')) {
    event.preventDefault();
    const button = form.querySelector('button'),
      message = document.querySelector('#complianceDocMessage');
    button.disabled = true;
    try {
      message.textContent = 'Opening the eSign page…';
      const returnUrl = new URL(
        location.pathname,
        location.protocol === 'https:' ? location.origin : window.SAMPADHA_CONFIG.liveSiteUrl,
      );
      returnUrl.searchParams.set(COMPLIANCE_RETURN_PARAM, form.dataset.docSign);
      const start = await Api.clientEsignStart(
        form.dataset.docSign,
        form.elements.mobile.value,
        returnUrl.href,
      );
      location.href = start.url;
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
    return;
  }
  if (form.id === 'docSendForm') {
    event.preventDefault();
    const button = form.querySelector('button'),
      message = form.querySelector('#docSendMessage'),
      e = form.elements,
      file = e.file.files[0],
      client = (state.ws?.directory || []).find((p) => p.id === e.client.value);
    button.disabled = true;
    try {
      if (!client) throw new Error('Choose the client.');
      if (!file || file.type !== 'application/pdf') throw new Error('Choose a PDF file.');
      if (file.size > 10 * 1024 * 1024) throw new Error('The PDF must be 10 MB or smaller.');
      message.textContent = 'Uploading…';
      const result = await Api.sendClientDocument(client, file, {
        title: e.title.value.trim(),
        kind: e.kind.value,
        signPages: e.signPages.value,
      });
      await complianceRefresh();
      toast(result.doc_ref + ' sent to ' + client.full_name + ' for signature');
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
    return;
  }
  if (form.matches('[data-kyc]')) {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await Api.setClientKyc(form.dataset.kyc, form.elements.status.value);
      await complianceRefresh();
      toast('KYC updated for ' + form.dataset.kyc);
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  }
});
