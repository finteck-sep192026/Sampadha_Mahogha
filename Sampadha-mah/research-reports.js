// Session-only research creation and delivery demo.
const researchReports = [];
function downloadResearchPdf(report) {
  const canvas = document.createElement('canvas');
  canvas.width = 1754;
  canvas.height = 1240;
  const ctx = canvas.getContext('2d'),
    images = [];
  let y = 0,
    page = 0;
  const left = 60,
    right = 1694,
    bottom = 1140;
  const begin = () => {
    page++;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 1754, 1240);
    ctx.fillStyle = '#071a35';
    ctx.fillRect(0, 0, 1754, 105);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px Arial';
    ctx.fillText('SAMPADHA RESEARCH', left, 66);
    ctx.fillStyle = '#14243b';
    y = 145;
  };
  const finish = () => {
    ctx.font = '18px Arial';
    ctx.fillStyle = '#6b7c91';
    ctx.fillText('Multi research report | Page ' + page, left, 1190);
    images.push(
      Uint8Array.from(atob(canvas.toDataURL('image/jpeg', 0.94).split(',')[1]), (c) =>
        c.charCodeAt(0),
      ),
    );
  };
  const wrap = (text, width, font) => {
    ctx.font = font;
    const words = String(text ?? '—').split(/\s+/),
      lines = [];
    let current = '';
    for (const word of words) {
      const next = current ? current + ' ' + word : word;
      if (ctx.measureText(next).width > width && current) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    if (current) lines.push(current);
    return lines.length ? lines : ['—'];
  };
  const write = (text, options = {}) => {
    const font = options.font || '22px Arial',
      color = options.color || '#14243b',
      gap = options.gap || 32,
      width = options.width || 1594;
    for (const paragraph of String(text).split(/\r?\n/)) {
      for (const value of wrap(paragraph, width, font)) {
        if (y > bottom) {
          finish();
          begin();
        }
        ctx.fillStyle = color;
        ctx.font = font;
        ctx.fillText(value, left, y);
        y += gap;
      }
    }
  };
  const pdfColumns = [
    ['__leg', 'Leg', 52],
    ['product', 'Product', 105],
    ['symbol', 'Symbol', 100],
    ['expiry', 'Expiry date', 140],
    ['strike', 'Strike price', 120],
    ['option', 'Option type', 105],
    ['side', 'Buy/Sell', 95],
    ['lots', 'No. lots', 85],
    ['lotSize', 'Lot size', 85],
    ['quantity', 'Quantity', 90],
    ['price', 'Initiation price', 130],
    ['published', 'Published date', 170],
    ['delivered', 'Delivered date', 170],
    ['status', 'Status', 145],
  ];
  const tableHeader = () => {
    const height = 58;
    ctx.fillStyle = '#0d3970';
    ctx.fillRect(
      left,
      y,
      pdfColumns.reduce((sum, c) => sum + c[2], 0),
      height,
    );
    let x = left;
    for (const [, label, width] of pdfColumns) {
      ctx.strokeStyle = '#d6e2f0';
      ctx.strokeRect(x, y, width, height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px Arial';
      const lines = wrap(label, width - 12, 'bold 15px Arial').slice(0, 2);
      lines.forEach((line, i) => ctx.fillText(line, x + 6, y + 22 + i * 18));
      x += width;
    }
    y += height;
  };
  const tableRow = (row, index) => {
    const values = pdfColumns.map(([key, , width]) =>
        wrap(key === '__leg' ? index + 1 : researchValue(row, key), width - 12, '15px Arial'),
      ),
      height = Math.max(48, ...values.map((lines) => lines.length * 18 + 16));
    if (y + height > bottom) {
      finish();
      begin();
      write(report.title, { font: 'bold 24px Arial', gap: 30 });
      write('MULTI RECOMMENDATIONS — continued', {
        font: 'bold 18px Arial',
        color: '#a06b12',
        gap: 28,
      });
      tableHeader();
    }
    let x = left;
    values.forEach((lines, i) => {
      const width = pdfColumns[i][2];
      ctx.fillStyle = index % 2 ? '#f6f9fc' : '#fff';
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = '#c7d5e5';
      ctx.strokeRect(x, y, width, height);
      ctx.fillStyle = '#14243b';
      ctx.font = '15px Arial';
      lines.forEach((line, j) => ctx.fillText(line, x + 6, y + 21 + j * 18));
      x += width;
    });
    y += height;
  };
  begin();
  write(report.title, { font: 'bold 30px Arial', gap: 40 });
  write(report.ref + ' · ' + report.created, { font: '18px Arial', color: '#5b6d82', gap: 32 });
  write('MULTI RECOMMENDATIONS', { font: 'bold 20px Arial', color: '#a06b12', gap: 34 });
  tableHeader();
  report.rows.forEach(tableRow);
  y += 28;
  for (const name of RESEARCH_SECTIONS) {
    if (y > bottom - 100) {
      finish();
      begin();
    }
    write(name, { font: 'bold 22px Arial', color: '#0d3970', gap: 32 });
    write(report.sections[name], { font: '19px Arial', gap: 27 });
    y += 12;
  }
  if (report.status === 'Sent') {
    if (y > bottom - 100) {
      finish();
      begin();
    }
    write('AUTHORISED WITH A ONE-TIME CODE', {
      font: 'bold 19px Arial',
      color: '#a06b12',
      gap: 28,
    });
    write(
      'Authenticator-app code verified by the server · ' + report.sent + ' · not an Aadhaar eSign',
      {
        font: '17px Arial',
        color: '#5b6d82',
        gap: 26,
      },
    );
  }
  finish();
  const encoder = new TextEncoder(),
    chunks = [],
    offsets = [0];
  let size = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    size += bytes.length;
  };
  const object = (id, content) => {
    offsets[id] = size;
    push(id + ' 0 obj\n' + content + '\nendobj\n');
  };
  push('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(
    2,
    '<< /Type /Pages /Count ' +
      images.length +
      ' /Kids [' +
      images.map((_, i) => 3 + i * 3 + ' 0 R').join(' ') +
      '] >>',
  );
  images.forEach((bytes, i) => {
    const id = 3 + i * 3;
    object(
      id,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /XObject << /Img ' +
        (id + 1) +
        ' 0 R >> >> /Contents ' +
        (id + 2) +
        ' 0 R >>',
    );
    offsets[id + 1] = size;
    push(
      id +
        1 +
        ' 0 obj\n<< /Type /XObject /Subtype /Image /Width 1754 /Height 1240 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
        bytes.length +
        ' >>\nstream\n',
    );
    push(bytes);
    push('\nendstream\nendobj\n');
    const commands = 'q 841.89 0 0 595.28 0 0 cm /Img Do Q';
    object(id + 2, '<< /Length ' + commands.length + ' >>\nstream\n' + commands + '\nendstream');
  });
  const xref = size;
  push('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
  offsets.slice(1).forEach((offset) => push(String(offset).padStart(10, '0') + ' 00000 n \n'));
  push('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/pdf' })),
    link = document.createElement('a');
  link.href = url;
  link.download = report.ref + '.pdf';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const reportEscape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const reportTime = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
const reportAllowed = () => ['ra', 'admin'].includes(state.role);
const MULTI_TYPES = ['Nano', 'Micro', 'Mini', 'Mega', 'Giga'];
const RESEARCH_SECTIONS = ['Technical', 'Derivatives', 'Quantitative', 'Risks'];
const RESEARCH_COLUMNS = [
  ['product', 'Product'],
  ['symbol', 'Symbol'],
  ['expiry', 'Expiry date'],
  ['strike', 'Strike price'],
  ['option', 'Option type'],
  ['side', 'Buy/Sell'],
  ['lots', 'No. of lots'],
  ['lotSize', 'Lot size'],
  ['quantity', 'Quantity'],
  ['price', 'Initiation price'],
  ['published', 'Published date'],
  ['delivered', 'Delivered date'],
  ['status', 'Status'],
];
let researchClients = [],
  researchOrderFilter = 'Open',
  researchSign = null,
  researchSignTimer = null;
// Called by role-app.js whenever the workspace is (re)loaded from the database.
function researchApplyWorkspace(ws) {
  researchReports.splice(0, researchReports.length, ...(ws ? ws.reports : []));
  researchClients = ws ? ws.researchClients : [];
}
if (typeof state !== 'undefined' && state.ws) researchApplyWorkspace(state.ws);
const researchStyle = document.createElement('link');
researchStyle.rel = 'stylesheet';
researchStyle.href = 'research-workflow.css';
document.head.appendChild(researchStyle);

function researchValue(row, key) {
  if (key === 'price')
    return (
      '₹' +
      Number(row.price).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  if (key === 'published') return row.published.replace('T', ' ') + ' IST';
  return row[key] || '—';
}
function researchOwner(r) {
  return reportAllowed() && (state.role === 'admin' || r.authorId === state.user.uid);
}
function researchCanView(r) {
  return researchOwner(r) || (state.role === 'client' && r.recipients.includes(state.user.uid));
}
const researchClientRows = () =>
  researchClients.map((c) => ({
    id: c.login_id,
    person: c.full_name,
    email: c.email,
    tier: c.multi_tier,
  }));
function researchEligible(types) {
  return researchClientRows().filter((c) => types.includes(c.tier));
}
function researchRecipients(text, checked) {
  const tokens = String(text || '')
      .split(/[\s,;]+/)
      .filter(Boolean),
    ids = new Set(checked),
    invalid = [];
  for (const token of tokens) {
    const client = researchClientRows().find(
      (x) =>
        x.id.toLowerCase() === token.toLowerCase() || x.email.toLowerCase() === token.toLowerCase(),
    );
    if (client) ids.add(client.id);
    else invalid.push(token);
  }
  return { ids: [...ids], invalid };
}
function researchTable(rows) {
  return (
    '<div class="table-wrap"><table class="table research-order-table"><thead><tr>' +
    RESEARCH_COLUMNS.map(([, label]) => '<th>' + label + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows
      .map(
        (row) =>
          '<tr>' +
          RESEARCH_COLUMNS.map(
            ([key]) => '<td>' + reportEscape(researchValue(row, key)) + '</td>',
          ).join('') +
          '</tr>',
      )
      .join('') +
    '</tbody></table></div>'
  );
}
function researchDocument(r) {
  return (
    '<article class="card panel research-section"><p class="overline">SAMPADHA RESEARCH</p><h3>' +
    reportEscape(r.title) +
    '</h3><p>' +
    reportEscape(r.ref) +
    ' · ' +
    reportEscape(r.created) +
    '</p><h4>MULTI RECOMMENDATIONS</h4>' +
    researchTable(r.rows) +
    RESEARCH_SECTIONS.map(
      (name) =>
        '<section class="research-section"><h4>' +
        name +
        '</h4><pre>' +
        reportEscape(r.sections[name]) +
        '</pre></section>',
    ).join('') +
    (r.status === 'Sent'
      ? '<p class="research-notice">Authorised with a one-time code · ' +
        reportEscape(r.sent) +
        '<br>Not a legally valid Aadhaar eSign.</p>'
      : '') +
    '</article>'
  );
}
function researchHistory() {
  const list = researchReports.filter(researchCanView);
  return (
    '<article class="card panel research-section"><h3>' +
    (state.role === 'client' ? 'Reports received' : 'Created reports') +
    '</h3><div class="table-wrap"><table class="table"><thead><tr><th>Report</th><th>Created</th><th>Delivery</th><th>Actions</th></tr></thead><tbody>' +
    list
      .map(
        (r) =>
          '<tr><td>' +
          reportEscape(r.title) +
          '<small>' +
          r.rows.length +
          ' recommendations · ' +
          reportEscape(r.ref) +
          '</small></td><td>' +
          reportEscape(r.created) +
          '</td><td>' +
          (state.role === 'client'
            ? 'Delivered · ' + reportEscape(r.sent)
            : r.recipients.length
              ? r.recipients.length + ' clients · ' + reportEscape(r.sent)
              : 'Not sent') +
          '</td><td><button type="button" class="btn secondary" data-research-view="' +
          r.id +
          '">View</button> <button type="button" class="btn secondary" data-research-pdf="' +
          r.id +
          '">Download PDF</button></td></tr>',
      )
      .join('') +
    (!list.length ? '<tr><td colspan="4">No reports yet.</td></tr>' : '') +
    '</tbody></table></div></article>'
  );
}
function researchEntry() {
  const fields = [
    ['product', 'Product', 'text', 'Nano / Micro / Mini / Mega / Giga'],
    ['symbol', 'Symbol', 'text', 'NIFTY / SENSEX'],
    ['expiry', 'Expiry date', 'date', 'YYYY-MM-DD'],
    ['strike', 'Strike price', 'number', 'e.g. 25000'],
    ['option', 'Option type', 'text', 'CE / PE'],
    ['side', 'Buy/Sell', 'text', 'BUY / SELL'],
    ['lots', 'No. of lots', 'number', 'e.g. 2'],
    ['lotSize', 'Lot size', 'number', 'Enter lot size'],
    ['quantity', 'Quantity', 'text', 'Auto: lots × lot size'],
    ['price', 'Initiation price', 'number', 'e.g. 150.50'],
    ['published', 'Published date', 'datetime-local', 'Date and time (IST)'],
    ['delivered', 'Delivered date', 'text', 'Filled after demo delivery'],
    ['status', 'Status', 'text', 'Open'],
  ];
  return (
    '<section class="research-entry"><div class="research-entry-head"><h4>Leg <span class="research-row-number"></span></h4><button type="button" class="btn secondary" data-remove-research-row>Remove</button></div><div class="research-entry-grid">' +
    fields
      .map(
        ([key, label, type, placeholder]) =>
          '<label class="field">' +
          label +
          '<input name="' +
          key +
          '" type="' +
          type +
          '" placeholder="' +
          placeholder +
          '" ' +
          (['quantity', 'delivered', 'status'].includes(key) ? 'readonly' : 'required') +
          (key === 'status' ? ' value="Open"' : '') +
          (type === 'number'
            ? ' min="' +
              (['lots', 'lotSize'].includes(key) ? '1' : '0.01') +
              '" step="' +
              (['lots', 'lotSize'].includes(key) ? '1' : '0.01') +
              '"'
            : '') +
          (['product', 'symbol', 'option', 'side'].includes(key) ? ' maxlength="30"' : '') +
          '></label>',
      )
      .join('') +
    '</div></section>'
  );
}
function researchNumberRows() {
  const rows = [...document.querySelectorAll('#researchEntries .research-entry')];
  rows.forEach((row, i) => {
    row.querySelector('.research-row-number').textContent = i + 1;
    row.querySelector('[data-remove-research-row]').disabled = rows.length === 1;
  });
}
function researchPage() {
  return (
    '<article class="card panel"><div class="research-workflow-header"><h3>Create Multi research report</h3><span class="badge">Multi</span></div><div class="research-steps"><span>1. Legs & research</span><span>2. Preview & authenticator code</span><span>3. Select product clients & send</span><span>4. Manage orders</span></div><form id="researchCreate"><div class="form-grid"><label class="field">Report title<input name="title" required maxlength="150" placeholder="Enter report title"></label><label class="field">Product<input value="Multi" readonly></label></div><h3>MULTI RECOMMENDATIONS</h3><p class="research-notice">Enter the first leg, then use Add leg to duplicate it and modify only the required fields. Published date uses IST; quantity is calculated automatically.</p><div id="researchEntries">' +
    researchEntry() +
    '</div><button type="button" class="btn secondary" id="researchAddRow">+ Add leg</button><div class="form-grid research-section">' +
    RESEARCH_SECTIONS.map(
      (name) =>
        '<label class="field">' +
        name +
        '<textarea class="research-textarea" name="' +
        name +
        '" required rows="5" maxlength="5000" placeholder="Enter ' +
        name.toLowerCase() +
        ' research..."></textarea></label>',
    ).join('') +
    '</div><p id="researchCreateMessage" class="research-message research-error" role="alert"></p><button class="btn primary">Create & preview</button></form></article><section id="researchPreview"></section><section id="researchHistory">' +
    researchHistory() +
    '</section>'
  );
}
function researchReadRows(form) {
  const entries = [...form.querySelectorAll('.research-entry')];
  if (!entries.length) throw new Error('Add at least one recommendation.');
  return entries.map((entry, i) => {
    const get = (key) => entry.querySelector('[name="' + key + '"]').value.trim(),
      product = MULTI_TYPES.find((p) => p.toLowerCase() === get('product').toLowerCase());
    const symbol = get('symbol').toUpperCase(),
      option = get('option').toUpperCase(),
      side = get('side').toUpperCase(),
      lots = Number(get('lots')),
      lotSize = Number(get('lotSize')),
      strike = Number(get('strike')),
      price = Number(get('price')),
      expiry = get('expiry'),
      published = get('published');
    const fail = (message) => {
      throw new Error('Leg ' + (i + 1) + ': ' + message);
    };
    if (!product) fail('enter Nano, Micro, Mini, Mega or Giga.');
    if (!['NIFTY', 'SENSEX'].includes(symbol)) fail('enter NIFTY or SENSEX.');
    if (!['CE', 'PE'].includes(option) || !['BUY', 'SELL'].includes(side))
      fail('use CE/PE and BUY/SELL.');
    if (
      !Number.isSafeInteger(lots) ||
      lots < 1 ||
      !Number.isSafeInteger(lotSize) ||
      lotSize < 1 ||
      !Number.isSafeInteger(lots * lotSize)
    )
      fail('lots and lot size must be positive whole numbers.');
    if (!Number.isFinite(strike) || strike <= 0 || !Number.isFinite(price) || price <= 0)
      fail('strike and initiation price must be positive numbers.');
    if (
      !expiry ||
      !published ||
      !Number.isFinite(Date.parse(expiry)) ||
      !Number.isFinite(Date.parse(published)) ||
      expiry < published.slice(0, 10)
    )
      fail('expiry must be on or after the published date.');
    return {
      id: 'POS-' + crypto.randomUUID(),
      product,
      symbol,
      expiry,
      strike,
      option,
      side,
      lots,
      lotSize,
      quantity: lots * lotSize,
      price,
      published,
      delivered: '',
      status: 'Open',
      closedQty: 0,
      remainingQty: lots * lotSize,
      closingPrice: 0,
      lastExit: '',
      closedAt: '',
      exits: [],
    };
  });
}
function invalidateResearchOtp() {
  researchSign = null;
  clearTimeout(researchSignTimer);
  researchSignTimer = null;
  const target = $('#researchClientSection');
  if (target)
    target.innerHTML =
      '<p class="research-lock">Client selection appears after you verify an authenticator code.</p>';
  const status = $('#researchOtpStatus');
  if (status)
    status.textContent = 'Enter the 6-digit code from your authenticator app to continue.';
}
function researchCodeForm(reportId, factorId, label) {
  return (
    '<form id="researchOtpForm" data-report="' +
    reportAttr(reportId) +
    '" data-factor="' +
    reportAttr(factorId) +
    '" class="research-signing"><label class="research-check"><input type="checkbox" name="consent">I have reviewed this report and authorise sending it.</label><label class="field">Authenticator code<input name="otp" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="6-digit code"></label><button class="btn primary">' +
    label +
    '</button><p id="researchOtpStatus" class="research-message" role="status">Enter the 6-digit code from your authenticator app to continue.</p></form>'
  );
}
const reportAttr = (v) => reportEscape(v);
function researchSignPanel(r) {
  return (
    '<article class="card panel research-section"><h3>Sign with your authenticator app</h3><p class="research-notice">Sending needs a fresh code from your authenticator app. The server checks it, each code authorises one send, and it is valid for 5 minutes. This is not an Aadhaar eSign.</p><div id="researchSignBody" data-report="' +
    reportAttr(r.id) +
    '"><p>Checking authenticator status…</p></div></article><section id="researchClientSection" class="research-section"><p class="research-lock">Client selection appears after you verify an authenticator code.</p></section>'
  );
}
async function researchRenderSign(r) {
  try {
    const factor = await Api.mfa.factor(),
      body = $('#researchSignBody');
    if (!body || body.dataset.report !== r.id) return;
    body.innerHTML = factor
      ? researchCodeForm(r.id, factor.id, 'Verify & continue to clients')
      : '<p>Link an authenticator app once (Google Authenticator, Microsoft Authenticator, Authy…). Then every report you send is signed with a code from it.</p><button type="button" class="btn secondary" id="researchEnroll">Set up authenticator app</button><div id="researchEnrollArea"></div>';
  } catch (error) {
    const body = $('#researchSignBody');
    if (body) body.textContent = error.message;
  }
}
async function researchStartEnroll(button) {
  const area = $('#researchEnrollArea'),
    reportId = $('#researchSignBody').dataset.report;
  button.disabled = true;
  try {
    const factor = await Api.mfa.enroll();
    area.innerHTML =
      '<div class="research-qr"><img id="researchQr" alt="Authenticator QR code" width="180" height="180"><p>Scan this with your app, or type the key: <code id="researchSecret"></code></p></div>' +
      researchCodeForm(reportId, factor.factorId, 'Confirm app & continue to clients');
    $('#researchQr').src = factor.qr;
    $('#researchSecret').textContent = factor.secret;
    button.remove();
  } catch (error) {
    area.textContent = error.message;
    button.disabled = false;
  }
}
function researchShow(ids) {
  invalidateResearchOtp();
  const r = researchReports.find((r) => ids.includes(r.id) && researchCanView(r));
  if (!r) return;
  $('#researchPreview').innerHTML =
    researchDocument(r) + (researchOwner(r) ? researchSignPanel(r) : '');
  if (researchOwner(r)) researchRenderSign(r);
}
function researchClientSection(r) {
  return (
    '<article class="card panel"><h3>Select clients & send</h3><p class="research-notice">Code verified. Select product types to show their subscribed clients. These are sample subscriptions.</p><form id="researchSend" data-report="' +
    reportAttr(r.id) +
    '"><div class="research-filter-bar"><button type="button" class="btn secondary" id="researchSelectAll">Select visible clients</button><button type="button" class="btn secondary" id="researchClearAll">Clear checkboxes</button>' +
    MULTI_TYPES.map(
      (name) =>
        '<label class="research-check research-type-check"><input type="checkbox" name="category" value="' +
        name +
        '">' +
        name +
        '</label>',
    ).join('') +
    '</div><p id="researchClientCount" role="status">Choose a product type to show clients.</p><div id="researchClientList" class="research-client-grid"></div><label class="field">Or type matching client IDs / email addresses<textarea class="research-textarea" name="recipients" rows="2" placeholder="Enter IDs or emails for the selected product types"></textarea></label><p id="researchSendMessage" class="research-message" role="status"></p><button class="btn primary">Send to selected clients</button></form></article>'
  );
}
function researchFilterClients() {
  const form = $('#researchSend');
  if (!form) return;
  const types = [...form.querySelectorAll('[name=category]:checked')].map((x) => x.value),
    selected = new Set([...form.querySelectorAll('[name=client]:checked')].map((x) => x.value)),
    visible = researchEligible(types);
  $('#researchClientList').innerHTML = visible
    .map(
      (c) =>
        '<label class="research-check research-client"><input type="checkbox" name="client" value="' +
        reportAttr(c.id) +
        '" ' +
        (selected.has(c.id) ? 'checked' : '') +
        '><span>' +
        reportEscape(c.person) +
        '<small>' +
        c.id +
        ' · ' +
        reportEscape(c.email) +
        '</small><small>Subscribed: ' +
        reportEscape(c.tier) +
        '</small></span></label>',
    )
    .join('');
  $('#researchClientCount').textContent = types.length
    ? visible.length + ' matching clients · ' + types.join(', ')
    : 'Choose a product type to show clients.';
}
function researchOpenClients(r) {
  $('#researchClientSection').innerHTML = researchClientSection(r);
  const form = $('#researchSend');
  form.addEventListener('change', (e) => {
    if (e.target.name === 'category') researchFilterClients();
  });
  $('#researchSelectAll').onclick = () =>
    form.querySelectorAll('[name=client]').forEach((x) => (x.checked = true));
  $('#researchClearAll').onclick = () => {
    form.querySelectorAll('[name=client]').forEach((x) => (x.checked = false));
    form.elements.recipients.value = '';
    $('#researchSendMessage').textContent = '';
  };
  researchFilterClients();
}
async function researchSendReport(r, selected, types) {
  if (!researchSign || researchSign.reportId !== r.id || Date.now() >= researchSign.expires)
    throw new Error('Verify a fresh authenticator code before sending.');
  const result = await Api.sendReport(r.id, selected, types);
  await refreshWorkspace();
  return result.delivered;
}
function researchVisibleOrders() {
  return researchReports
    .filter(researchOwner)
    .flatMap((r) =>
      r.rows
        .filter((row) => row.delivered)
        .map((row) => ({ reportId: r.id, authorId: r.authorId, row })),
    );
}
async function researchCloseOrder(id, quantity, price) {
  if (!reportAllowed()) throw new Error('Research workspace access required.');
  const order = researchVisibleOrders().find((o) => o.row.id === id);
  if (!order || order.row.status === 'Closed')
    throw new Error('This order is already closed or unavailable.');
  const qty = Number(quantity),
    exitPrice = Number(price);
  if (!Number.isSafeInteger(qty) || qty < 1)
    throw new Error('Closing quantity must be a positive whole number.');
  if (!Number.isFinite(exitPrice) || exitPrice <= 0)
    throw new Error('Enter a valid closing price.');
  await Api.closeLeg(id, qty, exitPrice);
  await refreshWorkspace();
  return researchVisibleOrders().find((o) => o.row.id === id).row;
}
function researchOrdersPage() {
  if (!reportAllowed())
    return '<article class="card panel">Research workspace access required.</article>';
  const all = researchVisibleOrders(),
    views = ['Open', 'Partially Closed', 'Closed'],
    rows = all.filter((o) => o.row.status === researchOrderFilter);
  const money = (value) =>
    value
      ? '₹' +
        Number(value).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : '—';
  return (
    '<article class="card panel"><div class="research-workflow-header"><div><h3>Orders</h3><p class="research-notice">Every submitted leg appears here with its full details. Record one or more exits; remaining quantity is calculated automatically. This demo does not place trades.</p></div><button class="btn secondary" data-go="reports">Create report</button></div><div class="research-orders-tabs">' +
    views
      .map(
        (view) =>
          '<button class="btn secondary" data-order-filter="' +
          view +
          '" aria-pressed="' +
          (researchOrderFilter === view) +
          '">' +
          view +
          ' (' +
          all.filter((o) => o.row.status === view).length +
          ')</button>',
      )
      .join('') +
    '</div><h4>MULTI RECOMMENDATIONS</h4><div class="table-wrap"><table class="table research-order-table"><thead><tr>' +
    RESEARCH_COLUMNS.map(([, label]) => '<th>' + label + '</th>').join('') +
    '<th>Closing price</th><th>Closed quantity</th><th>Remaining quantity</th><th>Last exit</th><th>Action</th></tr></thead><tbody>' +
    rows
      .map(
        (o) =>
          '<tr>' +
          RESEARCH_COLUMNS.map(
            ([key]) => '<td>' + reportEscape(researchValue(o.row, key)) + '</td>',
          ).join('') +
          '<td>' +
          money(o.row.closingPrice) +
          '</td><td>' +
          reportEscape(o.row.closedQty || 0) +
          '</td><td><strong>' +
          reportEscape(o.row.remainingQty ?? o.row.quantity) +
          '</strong></td><td>' +
          reportEscape(o.row.lastExit || '—') +
          '</td><td>' +
          (o.row.status === 'Closed'
            ? '<span class="badge">Fully closed</span>'
            : '<form class="research-exit-form" data-close-order-form="' +
              reportAttr(o.row.id) +
              '"><label>Closing price<input name="closingPrice" type="number" min="0.01" step="0.01" required placeholder="Price"></label><label>Closing quantity<input name="closingQty" type="number" min="1" max="' +
              (o.row.remainingQty ?? o.row.quantity) +
              '" step="1" required placeholder="Max ' +
              (o.row.remainingQty ?? o.row.quantity) +
              '"></label><button class="btn secondary">Record exit</button><small class="research-exit-error" role="alert"></small></form>') +
          '</td></tr>',
      )
      .join('') +
    (!rows.length
      ? '<tr><td colspan="18" class="empty">No ' +
        researchOrderFilter.toLowerCase() +
        ' orders.</td></tr>'
      : '') +
    '</tbody></table></div></article>'
  );
}
pages.reports = researchPage;
pages.multiReports = researchPage;
pages.receivedReports = () =>
  '<section id="researchPreview"></section><section id="researchHistory">' +
  researchHistory() +
  '</section>';
pages.researchOrders = researchOrdersPage;
titles.researchOrders = 'Orders';
titles.receivedReports = 'Reports received';
for (const role of ['ra', 'admin']) nav[role].push(['researchOrders', '▦', 'Orders']);
nav.client.push(['receivedReports', '▤', 'Reports received']);
const originalResearchShowPage = show;
show = function (page) {
  invalidateResearchOtp();
  originalResearchShowPage(page);
  researchNumberRows();
};
const originalResearchLogout = $('#logout').onclick;
$('#logout').onclick = () => {
  invalidateResearchOtp();
  originalResearchLogout();
};
$('#content').addEventListener('input', (e) => {
  if (!e.target.closest('#researchEntries') || !['lots', 'lotSize'].includes(e.target.name)) return;
  const row = e.target.closest('.research-entry'),
    lots = Number(row.querySelector('[name=lots]').value),
    size = Number(row.querySelector('[name=lotSize]').value);
  row.querySelector('[name=quantity]').value =
    Number.isSafeInteger(lots) &&
    lots > 0 &&
    Number.isSafeInteger(size) &&
    size > 0 &&
    Number.isSafeInteger(lots * size)
      ? lots * size
      : '';
});
$('#content').addEventListener('submit', async (e) => {
  if (e.target.matches('[data-close-order-form]')) {
    e.preventDefault();
    const form = e.target,
      message = form.querySelector('.research-exit-error'),
      button = form.querySelector('button');
    button.disabled = true;
    try {
      const row = await researchCloseOrder(
          form.dataset.closeOrderForm,
          form.elements.closingQty.value,
          form.elements.closingPrice.value,
        ),
        remaining = row.remainingQty;
      show('researchOrders');
      toast(
        remaining
          ? row.closedQty +
              ' closed · ' +
              remaining +
              ' remaining. Order moved to Partially Closed.'
          : 'Full quantity closed. Order moved to Closed.',
      );
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
    return;
  }
  if (e.target.id === 'researchCreate') {
    e.preventDefault();
    if (!reportAllowed()) return;
    const form = e.target,
      d = new FormData(form),
      message = $('#researchCreateMessage'),
      button = form.querySelector('button:not([type=button])');
    try {
      const title = String(d.get('title') || '').trim(),
        sections = Object.fromEntries(
          RESEARCH_SECTIONS.map((name) => [name, String(d.get(name) || '').trim()]),
        );
      if (!title || Object.values(sections).some((x) => !x))
        throw new Error('Enter a title and all four research sections.');
      const rows = researchReadRows(form),
        legs = rows.map((r) => ({
          product: r.product,
          symbol: r.symbol,
          expiry: r.expiry,
          strike: String(r.strike),
          option: r.option,
          side: r.side,
          lots: String(r.lots),
          lotSize: String(r.lotSize),
          price: String(r.price),
          published: r.published,
        }));
      button.disabled = true;
      const created = await Api.createDraft(title, sections, legs);
      await refreshWorkspace();
      message.classList.remove('research-error');
      message.textContent = 'Report created. Review it below, then verify your authenticator code.';
      researchShow([created.id]);
      $('#researchHistory').innerHTML = researchHistory();
      $('#researchPreview').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      message.classList.add('research-error');
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }
  if (e.target.id === 'researchOtpForm') {
    e.preventDefault();
    const form = e.target,
      r = researchReports.find((r) => r.id === form.dataset.report),
      status = $('#researchOtpStatus'),
      button = form.querySelector('button'),
      code = form.elements.otp.value.trim();
    if (!r || !researchOwner(r)) return;
    if (!form.elements.consent.checked) {
      status.textContent = 'Tick the confirmation to continue.';
      return;
    }
    if (!/^[0-9]{6,8}$/.test(code)) {
      status.textContent = 'Enter the 6-digit code from your authenticator app.';
      return;
    }
    button.disabled = true;
    try {
      await Api.mfa.verify(form.dataset.factor, code);
      clearTimeout(researchSignTimer);
      researchSign = { reportId: r.id, expires: Date.now() + 300000 };
      researchSignTimer = setTimeout(() => {
        invalidateResearchOtp();
        const st = $('#researchOtpStatus');
        if (st) st.textContent = 'Code expired. Enter a new code from your app.';
      }, 300000);
      status.textContent = 'Code verified. Select product types and clients below.';
      researchOpenClients(r);
      $('#researchClientSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      status.textContent = error.message;
      form.elements.otp.value = '';
    } finally {
      button.disabled = false;
    }
  }
  if (e.target.id === 'researchSend') {
    e.preventDefault();
    const form = e.target,
      r = researchReports.find((r) => r.id === form.dataset.report),
      message = $('#researchSendMessage'),
      button = form.querySelector('button:not([type=button])');
    if (!r || !researchOwner(r) || !researchSign || researchSign.reportId !== r.id) {
      invalidateResearchOtp();
      return;
    }
    const d = new FormData(form),
      types = d.getAll('category'),
      eligible = new Set(researchEligible(types).map((c) => c.id)),
      selected = researchRecipients(d.get('recipients'), d.getAll('client'));
    if (!types.length) {
      message.textContent = 'Choose Nano, Micro, Mini, Mega or Giga to show clients.';
      return;
    }
    if (selected.invalid.length) {
      message.textContent = 'Unknown client IDs/emails: ' + selected.invalid.join(', ');
      return;
    }
    if (!selected.ids.length) {
      message.textContent = 'Select a client or type a matching client ID/email.';
      return;
    }
    if (selected.ids.some((id) => !eligible.has(id))) {
      message.textContent = 'Choose only clients subscribed to the selected product types.';
      return;
    }
    button.disabled = true;
    try {
      const sent = await researchSendReport(r, selected.ids, types);
      invalidateResearchOtp();
      $('#researchClientSection').innerHTML =
        '<article class="card panel"><h3>Report sent</h3><p>' +
        sent +
        ' client deliveries recorded. ' +
        r.rows.length +
        ' recommendation positions are available in Orders.</p><button class="btn primary" data-go="researchOrders">Open Orders</button> <button class="btn secondary" data-research-view="' +
        reportAttr(r.id) +
        '">View report</button></article>';
      $('#researchHistory').innerHTML = researchHistory();
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
      if (/one-time code|authenticator code/i.test(error.message)) invalidateResearchOtp();
    }
  }
});
$('#content').addEventListener('click', (e) => {
  const enroll = e.target.closest('#researchEnroll');
  if (enroll) researchStartEnroll(enroll);
});
$('#content').addEventListener('click', (e) => {
  const add = e.target.closest('#researchAddRow');
  if (add && reportAllowed()) {
    const entries = $('#researchEntries'),
      source = entries.querySelector('.research-entry:last-child');
    entries.insertAdjacentHTML('beforeend', researchEntry());
    const target = entries.querySelector('.research-entry:last-child');
    if (source && target) {
      for (const input of source.querySelectorAll('[name]')) {
        const copy = target.querySelector('[name="' + input.name + '"]');
        if (copy) copy.value = input.value;
      }
    }
    researchNumberRows();
    target.querySelector('input:not([readonly])')?.focus();
    return;
  }
  const remove = e.target.closest('[data-remove-research-row]');
  if (remove && reportAllowed()) {
    if (document.querySelectorAll('#researchEntries .research-entry').length > 1)
      remove.closest('.research-entry').remove();
    researchNumberRows();
    return;
  }
  const view = e.target.closest('[data-research-view]');
  if (view) {
    researchShow([view.dataset.researchView]);
    return;
  }
  const filter = e.target.closest('[data-order-filter]');
  if (filter && reportAllowed()) {
    researchOrderFilter = filter.dataset.orderFilter;
    show('researchOrders');
    return;
  }
  const download = e.target.closest('[data-research-pdf]');
  if (download) {
    const r = researchReports.find(
      (x) => x.id === download.dataset.researchPdf && researchCanView(x),
    );
    if (r) downloadResearchPdf(r);
  }
});
