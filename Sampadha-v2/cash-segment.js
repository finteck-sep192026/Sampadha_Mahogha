// Cash Segment: LC/MC/SC reports built from a 12-column CSV, organised by Monthly, Quarterly and
// Half-Yearly frequency. Reports, rows, signing and delivery live in Supabase (schema v2) and share
// the Aadhaar eSign, PDF storage and "Reports received" flow with Multi reports.
let cashStrategyFormOpen = false,
  cashSelectedId = null,
  cashPdfUrl = '',
  cashInternalRender = false;
// Activity is kept for this browser session only (shown on the RA Overview).
const cashRaActivity = [];
const CASH_PRODUCTS = { LC: 'Large Cap', MC: 'Mid Cap', SC: 'Small Cap' };
const CASH_FREQUENCIES = ['Monthly', 'Quarterly', 'Half-Yearly'];
const CASH_RETURN_PARAM = 'esign_cash';
const cashEscape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const cashNow = () =>
  new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
  }) + ' IST';
const cashCsvColumns = [
  ['productName', 'ProductName'],
  ['portfolioName', 'PortfolioName'],
  ['portfolioType', 'PortfolioType'],
  ['stopPortfolio', 'StopPortfolio'],
  ['isin', 'ISIN'],
  ['weightage', 'Weightage'],
  ['exchangeName', 'ExchangeName'],
  ['ifMutualFund', 'IfMutualFund'],
  ['stock', 'Stock'],
  ['action', 'Action'],
  ['price', 'Initiation Price'],
  ['quantity', 'Quantity'],
];
function cashParseCsvLine(line) {
  const cells = [];
  let current = '',
    quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}
function cashParseCsv(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2)
    throw new Error('CSV must include the 12-column header row and at least one recommendation.');
  if (lines.length > 101) throw new Error('CSV can contain a maximum of 100 recommendation rows.');
  const normalize = (value) =>
      String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ''),
    headers = cashParseCsvLine(lines[0]).map(normalize),
    indexes = {};
  for (const [key, label] of cashCsvColumns) indexes[key] = headers.indexOf(normalize(label));
  const missing = cashCsvColumns.filter(([key]) => indexes[key] < 0).map(([, label]) => label);
  if (missing.length) throw new Error('Missing CSV columns: ' + missing.join(', ') + '.');
  return lines.slice(1).map((line, index) => {
    const values = cashParseCsvLine(line),
      get = (key) => String(values[indexes[key]] ?? '').trim(),
      fail = (message) => {
        throw new Error('CSV row ' + (index + 2) + ': ' + message);
      },
      productName = get('productName'),
      portfolioName = get('portfolioName'),
      portfolioType = get('portfolioType'),
      stopPortfolio = get('stopPortfolio').toUpperCase(),
      isin = get('isin').toUpperCase(),
      weightage = Number(get('weightage')),
      exchangeName = get('exchangeName').toUpperCase(),
      ifMutualFund = get('ifMutualFund').toUpperCase(),
      stock = get('stock').toUpperCase(),
      action = get('action').toUpperCase(),
      price = Number(get('price')),
      quantity = Number(get('quantity'));
    if (
      [
        productName,
        portfolioName,
        portfolioType,
        stopPortfolio,
        isin,
        exchangeName,
        ifMutualFund,
        stock,
        action,
      ].some((value) => !value)
    )
      fail('all text fields are required.');
    if (!['YES', 'NO'].includes(stopPortfolio)) fail('StopPortfolio must be YES or NO.');
    if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin))
      fail('ISIN must contain 12 characters, starting with a two-letter country code.');
    if (!Number.isFinite(weightage) || weightage <= 0 || weightage > 1)
      fail('Weightage must be greater than 0 and not more than 1.');
    if (!['YES', 'NO'].includes(ifMutualFund)) fail('IfMutualFund must be YES or NO.');
    if (!['BUY', 'SELL', 'HOLD'].includes(action)) fail('Action must be BUY, SELL or HOLD.');
    if (!Number.isFinite(price) || price <= 0) fail('Initiation Price must be a positive number.');
    if (!Number.isSafeInteger(quantity) || quantity < 1)
      fail('Quantity must be a positive whole number.');
    return {
      id: index + 1,
      productName,
      portfolioName,
      portfolioType,
      stopPortfolio,
      isin,
      weightage,
      exchangeName,
      ifMutualFund,
      stock,
      action,
      price,
      quantity,
    };
  });
}

// Multi-page landscape PDF with every imported row (from the prototype).
async function cashCreatePdfBlob(report) {
  const canvas = document.createElement('canvas');
  canvas.width = 1754;
  canvas.height = 1240;
  const ctx = canvas.getContext('2d'),
    left = 70,
    right = 1684,
    bottom = 1125,
    pages = [];
  let y = 0,
    pageNumber = 0;
  const widths = [120, 120, 120, 110, 150, 100, 120, 120, 140, 90, 170, 100];
  const columns = cashCsvColumns.map((column, index) => [...column, widths[index]]);
  const fallback = {
    productName: report.product,
    portfolioName: report.product + ' Portfolio',
    portfolioType: 'Equity',
    stopPortfolio: 'NO',
    isin: '-',
    weightage: '-',
    exchangeName: 'NSE',
    ifMutualFund: 'NO',
  };
  const value = (row, key) => {
    const raw = row[key] ?? fallback[key] ?? '-';
    if (key === 'price' && raw !== '-')
      return '₹' + Number(raw).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return String(raw);
  };
  const wrap = (text, width, font) => {
    ctx.font = font;
    const words = [];
    for (const word of String(text ?? '-')
      .replaceAll('—', '-')
      .split(/\s+/)) {
      if (ctx.measureText(word).width <= width) {
        words.push(word);
        continue;
      }
      let chunk = '';
      for (const character of word) {
        const next = chunk + character;
        if (ctx.measureText(next).width > width && chunk) {
          words.push(chunk);
          chunk = character;
        } else chunk = next;
      }
      if (chunk) words.push(chunk);
    }
    const lines = [];
    let current = '';
    for (const word of words) {
      const next = current ? current + ' ' + word : word;
      if (ctx.measureText(next).width > width && current) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    if (current) lines.push(current);
    return lines.length ? lines : ['-'];
  };
  const begin = () => {
    pageNumber++;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 1754, 1240);
    ctx.fillStyle = '#071a35';
    ctx.fillRect(0, 0, 1754, 115);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px Arial';
    ctx.fillText('SAMPADHA CASH SEGMENT', left, 70);
    y = 155;
  };
  const finish = () => {
    ctx.fillStyle = '#6b7c91';
    ctx.font = '16px Arial';
    ctx.fillText('Cash Segment research report | Page ' + pageNumber, left, 1190);
    pages.push(
      Uint8Array.from(atob(canvas.toDataURL('image/jpeg', 0.94).split(',')[1]), (character) =>
        character.charCodeAt(0),
      ),
    );
  };
  const write = (text, font = 'bold 28px Arial', color = '#132a46', gap = 36) => {
    ctx.fillStyle = color;
    ctx.font = font;
    for (const line of wrap(text, right - left, font)) {
      ctx.fillText(line, left, y);
      y += gap;
    }
  };
  const tableHeader = () => {
    const height = 58;
    let x = left;
    ctx.fillStyle = '#0d3970';
    ctx.fillRect(
      left,
      y,
      columns.reduce((total, column) => total + column[2], 0),
      height,
    );
    for (const [, label, width] of columns) {
      ctx.strokeStyle = '#d5e2ef';
      ctx.strokeRect(x, y, width, height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px Arial';
      wrap(label, width - 12, 'bold 13px Arial')
        .slice(0, 3)
        .forEach((line, index) => ctx.fillText(line, x + 6, y + 18 + index * 15));
      x += width;
    }
    y += height;
  };
  const newContinuationPage = () => {
    finish();
    begin();
    write(report.title, 'bold 24px Arial', '#132a46', 30);
    write('CASH RECOMMENDATIONS - continued', 'bold 18px Arial', '#9a6716', 28);
    tableHeader();
  };
  begin();
  write(report.title, 'bold 34px Arial', '#132a46', 42);
  write(report.ref + ' | ' + report.created, '18px Arial', '#60748b', 34);
  const info = [
      ['Product', report.product],
      ['Report type', report.frequency || 'New report'],
      ['CSV file', report.fileName],
      ['Recommendations', String(report.rows.length)],
    ],
    infoWidth = 385,
    infoTop = y;
  info.forEach((item, index) => {
    const x = left + index * (infoWidth + 18);
    ctx.fillStyle = '#f4f8fc';
    ctx.fillRect(x, infoTop, infoWidth, 74);
    ctx.strokeStyle = '#c8d7e7';
    ctx.strokeRect(x, infoTop, infoWidth, 74);
    ctx.fillStyle = '#60748b';
    ctx.font = '14px Arial';
    ctx.fillText(item[0].toUpperCase(), x + 14, infoTop + 24);
    ctx.fillStyle = '#0d3970';
    ctx.font = 'bold 19px Arial';
    ctx.fillText(wrap(item[1], infoWidth - 28, 'bold 19px Arial')[0], x + 14, infoTop + 53);
  });
  y = infoTop + 110;
  write('CASH RECOMMENDATIONS', 'bold 22px Arial', '#9a6716', 30);
  tableHeader();
  report.rows.forEach((row, rowIndex) => {
    const cellLines = columns.map(([key, , width]) =>
        wrap(value(row, key), width - 12, '13px Arial'),
      ),
      height = Math.max(46, ...cellLines.map((lines) => lines.length * 16 + 14));
    if (y + height > bottom) newContinuationPage();
    let x = left;
    cellLines.forEach((lines, columnIndex) => {
      const width = columns[columnIndex][2];
      ctx.fillStyle = rowIndex % 2 ? '#f6f9fc' : '#fff';
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = '#c8d7e7';
      ctx.strokeRect(x, y, width, height);
      ctx.fillStyle = '#14243b';
      ctx.font = '13px Arial';
      lines.forEach((line, lineIndex) => ctx.fillText(line, x + 6, y + 19 + lineIndex * 16));
      x += width;
    });
    y += height;
  });
  const tableWidth = columns.reduce((total, column) => total + column[2], 0);
  if (y + 120 > bottom) {
    finish();
    begin();
    write('REPORT NOTES', 'bold 22px Arial', '#0d3970', 32);
  } else y += 28;
  ctx.fillStyle = '#f6f9fc';
  ctx.fillRect(left, y, tableWidth, 90);
  ctx.strokeStyle = '#d7a33b';
  ctx.strokeRect(left, y, tableWidth, 90);
  ctx.fillStyle = '#0d3970';
  ctx.font = 'bold 18px Arial';
  ctx.fillText('Research communication', left + 18, y + 30);
  ctx.fillStyle = '#445b74';
  ctx.font = '16px Arial';
  ctx.fillText(
    'This report communicates research recommendations. It does not place trades or guarantee returns.',
    left + 18,
    y + 60,
  );
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
      pages.length +
      ' /Kids [' +
      pages.map((_, index) => 3 + index * 3 + ' 0 R').join(' ') +
      '] >>',
  );
  pages.forEach((image, index) => {
    const id = 3 + index * 3;
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
        image.length +
        ' >>\nstream\n',
    );
    push(image);
    push('\nendstream\nendobj\n');
    const commands = 'q 841.89 0 0 595.28 0 0 cm /Img Do Q';
    object(id + 2, '<< /Length ' + commands.length + ' >>\nstream\n' + commands + '\nendstream');
  });
  const xref = size;
  push('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
  offsets.slice(1).forEach((offset) => push(String(offset).padStart(10, '0') + ' 00000 n \n'));
  push('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
  return new Blob(chunks, { type: 'application/pdf' });
}

// ───────────── data (from the workspace loaded by role-app.js) ─────────────
const cashReports = () =>
  (state.ws?.reports || [])
    .filter((r) => r.segment === 'Cash' && researchOwner(r))
    .map((r) => ({
      ...r,
      product: r.cashProduct,
      rows: r.cashRows,
    }));
const cashFindReport = (id) => cashReports().find((r) => r.id === id) || null;
const cashClients = () => state.ws?.cashClients || [];
const cashStatusLabel = (report) =>
  report.recipients.length
    ? 'Sent to ' + report.recipients.length + ' client(s)'
    : report.esignStatus === 'Signed'
      ? 'Signed · not sent'
      : report.esignStatus === 'Requested'
        ? 'Signing in progress'
        : 'Not signed';

// ───────────── library: Strategy × Monthly / Quarterly / Half-Yearly ─────────────
function cashReportCell(frequency, product) {
  const reports = cashReports()
    .filter((report) => report.frequency === frequency && report.product === product)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 2);
  if (!reports.length) return '<p class="muted">No reports yet.</p>';
  return (
    '<div class="cash-report-list">' +
    reports
      .map(
        (report) =>
          '<article><div><strong>' +
          cashEscape(report.title) +
          '</strong><small>' +
          cashEscape(report.ref) +
          ' · ' +
          cashEscape(report.created) +
          '</small><small>' +
          cashEscape(cashStatusLabel(report)) +
          '</small></div><div class="cash-report-actions"><button type="button" class="btn secondary" data-cash-view="' +
          report.id +
          '">View PDF</button><button type="button" class="btn secondary" data-cash-download="' +
          report.id +
          '">Download</button></div></article>',
      )
      .join('') +
    '</div>'
  );
}
function cashReportGroups() {
  return (
    '<section class="card cash-report-table-card"><div class="table-wrap"><table class="table cash-report-matrix"><thead><tr><th>Strategy</th><th>Monthly</th><th>Quarterly</th><th>Half-Yearly</th></tr></thead><tbody>' +
    Object.entries(CASH_PRODUCTS)
      .map(
        ([product, name]) =>
          '<tr><th scope="row"><strong>' +
          product +
          '</strong><small>' +
          name +
          '</small></th>' +
          CASH_FREQUENCIES.map(
            (frequency) => '<td>' + cashReportCell(frequency, product) + '</td>',
          ).join('') +
          '</tr>',
      )
      .join('') +
    '</tbody></table></div></section>'
  );
}
function cashCreateForm() {
  if (!cashStrategyFormOpen) return '';
  return (
    '<article class="card panel cash-create-card"><div class="panel-head"><div><p class="overline">New Cash report</p><h3>Upload Cash Segment CSV</h3><p>Select the market-cap product and reporting period, then upload the exact 12-column Cash Segment file.</p></div><button type="button" class="btn secondary" id="cashCancelCreate">Close</button></div><form id="cashCreateForm"><div class="form-grid three"><label class="field">Product<select name="product" required><option value="">Select product</option><option>LC</option><option>MC</option><option>SC</option></select></label><label class="field">Report frequency<select name="frequency" required><option value="">Select report frequency</option><option>Monthly</option><option>Quarterly</option><option>Half-Yearly</option></select></label><label class="field">Upload CSV file<input name="csv" type="file" accept=".csv,text/csv" required><small>12 required headers: ProductName through Quantity. Maximum 100 rows.</small></label></div><p class="cash-csv-schema"><strong>Accepted columns:</strong> ' +
    cashCsvColumns.map(([, label]) => label).join(', ') +
    '</p><div class="cash-form-actions"><button class="btn primary">Create and preview PDF</button><a class="btn secondary" href="cash-strategy-template.csv" download>Download 12-column template</a></div><p id="cashCreateMessage" class="research-message research-error" role="alert"></p></form></article>'
  );
}

// ───────────── preview, Aadhaar eSign, client selection ─────────────
function cashPdfPanel(report) {
  return (
    '<article class="card panel cash-pdf-shell"><div class="panel-head"><div><p class="overline">' +
    cashEscape(report.ref) +
    ' · ' +
    cashEscape(cashStatusLabel(report)) +
    '</p><h3>View PDF</h3><p>' +
    cashEscape(report.title) +
    ' · ' +
    cashEscape(report.product) +
    ' · ' +
    report.rows.length +
    ' recommendations</p></div><button type="button" class="btn secondary" data-cash-download="' +
    report.id +
    '">Download PDF</button></div><p id="cashPdfStatus" class="research-message" role="status">Generating PDF preview...</p><iframe id="cashPdfViewer" data-report="' +
    report.id +
    '" title="' +
    cashEscape(report.title) +
    ' PDF preview"></iframe></article>'
  );
}
function cashSignPanel(report) {
  if (report.esignStatus === 'Signed')
    return (
      '<article class="card panel cash-otp-card"><h3>Aadhaar eSign</h3><p class="research-notice">Signed with Aadhaar eSign by <strong>' +
      cashEscape(report.signerName) +
      '</strong> on ' +
      cashEscape(report.signed) +
      '. Clients receive this signed PDF.</p></article><section id="cashClientSection" class="cash-client-section">' +
      cashClientSelection(report) +
      '</section>'
    );
  return (
    '<article class="card panel cash-otp-card"><h3>Aadhaar eSign</h3><p class="research-notice">Review the PDF above, then sign it with your Aadhaar. You will be taken to the secure NSDL eSign page; the OTP goes to the mobile number linked to your Aadhaar. You are normally brought back here when signing is done; if the eSign page ends on the signed PDF instead, come back to this report and click Check signing status.</p><form id="cashSignForm" data-report="' +
    report.id +
    '"><label class="research-check"><input type="checkbox" name="consent">I have reviewed this Cash Segment report and will sign it with my Aadhaar eSign.</label><label class="field">Your mobile number<input name="mobile" type="tel" inputmode="numeric" autocomplete="tel" maxlength="14" required placeholder="10-digit mobile" value="' +
    cashEscape(researchRememberedMobile()) +
    '"></label><div class="cash-otp-actions"><button class="btn primary">Sign with Aadhaar eSign</button><button type="button" class="btn secondary" data-cash-esign-check="' +
    report.id +
    '">Check signing status</button></div><p id="cashSignStatus" class="research-message" role="status">' +
    (report.esignStatus === 'Requested'
      ? 'A signing request is open. Finish it on the eSign page, or start again.'
      : 'Not signed yet.') +
    '</p></form></article><section id="cashClientSection" class="cash-client-section"><p class="research-lock">Client selection appears after the Aadhaar eSign is confirmed.</p></section>'
  );
}
function cashClientSelection(report) {
  const received = new Set(report.recipients),
    clients = cashClients();
  return (
    '<article class="card panel"><h3>Select clients & send</h3><p>' +
    (report.recipients.length
      ? 'Delivered to ' +
        report.recipients.length +
        ' client(s) on ' +
        cashEscape(report.sent) +
        '. You can also send it to more clients.'
      : 'Report signed. Select one or more clients whose plan includes Cash.') +
    '</p><form id="cashSendForm" data-report="' +
    report.id +
    '"><div class="cash-client-grid">' +
    clients
      .map(
        (client) =>
          '<label><input type="checkbox" name="client" value="' +
          cashEscape(client.login_id) +
          '"' +
          (received.has(client.id) ? ' checked disabled' : '') +
          '><span><b>' +
          cashEscape(client.login_id) +
          '</b><small>' +
          cashEscape(client.full_name) +
          (received.has(client.id) ? ' · received' : '') +
          (typeof brokerAutoEmailActive === 'function' && brokerAutoEmailActive(client.id)
            ? ' · ⇄ broker auto-email'
            : '') +
          (typeof complianceNote === 'function'
            ? cashEscape(complianceNote(client.id, 'Cash'))
            : '') +
          '</small></span></label>',
      )
      .join('') +
    (clients.length ? '' : '<p class="muted">No clients with a Cash plan.</p>') +
    '</div><p id="cashSendStatus" class="research-message" role="status"></p><button class="btn primary">Send to Selected Clients</button></form></article>'
  );
}
function cashStrategyPage() {
  if (!['ra', 'admin'].includes(state.role)) return segmentPage('Cash');
  const report = cashSelectedId ? cashFindReport(cashSelectedId) : null;
  return (
    '<section class="cash-hero card"><div><h3>Cash reports</h3><p>Create LC, MC or SC reports from a CSV and file them by monthly, quarterly or half-yearly frequency.</p></div><button type="button" class="btn primary" id="cashNewStrategy">New report</button></section><div class="research-steps cash-steps"><span>1. Product, frequency and CSV</span><span>2. Create and preview the PDF</span><span>3. Aadhaar eSign</span><span>4. Choose clients and send</span></div>' +
    cashCreateForm() +
    '<section class="cash-library-heading"><div><h3>Report library</h3></div><p>The latest two reports for each strategy and period.</p></section>' +
    cashReportGroups() +
    '<section id="cashPreviewRegion" class="cash-preview-region">' +
    (report ? cashPdfPanel(report) + cashSignPanel(report) : '') +
    '</section>'
  );
}

// ───────────── PDF: locally generated preview, or the stored eSigned copy ─────────────
const cashPdfBlob = (report) =>
  report.esignStatus === 'Signed'
    ? Api.downloadFile(report.signedPdfPath)
    : cashCreatePdfBlob(report);
function cashReleasePdf() {
  if (cashPdfUrl) {
    URL.revokeObjectURL(cashPdfUrl);
    cashPdfUrl = '';
  }
}
async function cashRefreshPdf(report) {
  const viewer = document.querySelector('#cashPdfViewer'),
    status = document.querySelector('#cashPdfStatus');
  if (!viewer || viewer.dataset.report !== report.id) return;
  if (status) status.textContent = 'Generating PDF preview...';
  const blob = await cashPdfBlob(report);
  const current = document.querySelector('#cashPdfViewer');
  if (!current || current.dataset.report !== report.id) return;
  cashReleasePdf();
  cashPdfUrl = URL.createObjectURL(blob);
  current.src = cashPdfUrl + '#toolbar=1&navpanes=0';
  if (document.querySelector('#cashPdfStatus'))
    document.querySelector('#cashPdfStatus').textContent =
      report.esignStatus === 'Signed'
        ? 'Aadhaar eSigned PDF.'
        : 'Unsigned preview. This is the PDF you will sign.';
}
async function cashDownload(report) {
  const blob = await cashPdfBlob(report),
    url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = report.ref + (report.esignStatus === 'Signed' ? '-signed' : '-preview') + '.pdf';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ───────────── RA activity (this browser session) ─────────────
function cashTrackRa(area, action, detail) {
  if (state.role !== 'ra') return;
  const latest = cashRaActivity[0];
  if (latest && latest.area === area && latest.action === action && latest.detail === detail)
    return;
  cashRaActivity.unshift({ time: cashNow(), area, action, detail });
  cashRaActivity.splice(12);
}
function renderRaActivity() {
  if (!cashRaActivity.length)
    return '<p class="muted">Activity appears here as you open report areas and work on reports.</p>';
  return (
    '<div class="table-wrap"><table class="table ra-activity-table"><thead><tr><th>Time</th><th>RA Area</th><th>Activity</th><th>Details</th></tr></thead><tbody>' +
    cashRaActivity
      .slice(0, 8)
      .map(
        (item) =>
          '<tr><td class="stamp">' +
          cashEscape(item.time) +
          '</td><td><b>' +
          cashEscape(item.area) +
          '</b></td><td><span class="status green">' +
          cashEscape(item.action) +
          '</span></td><td>' +
          cashEscape(item.detail) +
          '</td></tr>',
      )
      .join('') +
    '</tbody></table></div>'
  );
}

// ───────────── signing (shared esign Edge Function) ─────────────
async function cashConfirmSign(reportId) {
  const status = document.querySelector('#cashSignStatus');
  if (status) status.textContent = 'Confirming the signature...';
  const result = await Api.esignVerify(reportId);
  await refreshWorkspace();
  if (result.status !== 'Signed') {
    cashShowReport(reportId);
    if (document.querySelector('#cashSignStatus'))
      document.querySelector('#cashSignStatus').textContent =
        result.message ||
        'The signature is not confirmed yet. Finish signing, then use Check signing status.';
    return;
  }
  cashShowReport(reportId);
  const report = cashFindReport(reportId);
  if (report) cashTrackRa('Cash Segment', 'Signed with Aadhaar eSign', report.title);
  toast('Cash report signed with Aadhaar eSign.');
}
async function cashStartSign(report, form) {
  const status = document.querySelector('#cashSignStatus'),
    buttons = form.querySelectorAll('button');
  if (!form.elements.consent.checked) {
    status.textContent = 'Tick the confirmation to continue.';
    return;
  }
  buttons.forEach((b) => (b.disabled = true));
  try {
    status.textContent = 'Preparing the PDF for signing...';
    await Api.uploadPreviewPdf(report.id, await cashCreatePdfBlob(report));
    status.textContent = 'Opening the eSign page...';
    const returnUrl = new URL(
      location.pathname,
      location.protocol === 'https:' ? location.origin : window.SAMPADHA_CONFIG.liveSiteUrl,
    );
    returnUrl.searchParams.set(CASH_RETURN_PARAM, report.id);
    const start = await Api.esignStart(report.id, form.elements.mobile.value, returnUrl.href);
    researchRememberMobile(form.elements.mobile.value.trim());
    cashTrackRa('Cash Segment', 'Started Aadhaar eSign', report.title);
    location.href = start.url;
  } catch (error) {
    if (document.querySelector('#cashSignStatus'))
      document.querySelector('#cashSignStatus').textContent = error.message;
    buttons.forEach((b) => (b.disabled = false));
  }
}
// Back from the eSign page: reopen the Cash report and confirm the signature with the server.
async function cashResumeSign() {
  const params = new URLSearchParams(location.search),
    reportId = params.get(CASH_RETURN_PARAM);
  if (!reportId) return;
  params.delete(CASH_RETURN_PARAM);
  history.replaceState(null, '', location.pathname + (params.size ? '?' + params : ''));
  const report = cashFindReport(reportId);
  if (!report) return;
  cashShowReport(reportId);
  if (report.esignStatus !== 'Signed')
    await cashConfirmSign(reportId).catch((error) => {
      if (document.querySelector('#cashSignStatus'))
        document.querySelector('#cashSignStatus').textContent = error.message;
    });
}

// ───────────── navigation ─────────────
function cashShowCurrent() {
  cashInternalRender = true;
  show('cashSegment');
  cashInternalRender = false;
}
function cashShowReport(reportId) {
  cashStrategyFormOpen = false;
  cashSelectedId = reportId;
  cashShowCurrent();
  setTimeout(
    () =>
      document
        .querySelector('#cashPreviewRegion')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    0,
  );
}
pages.cashSegment = cashStrategyPage;
titles.cashSegment = 'Cash Segment';
const cashOriginalShow = show;
show = function (page) {
  if (state.role === 'ra' && !cashInternalRender)
    cashTrackRa(titles[page] || page, 'Viewed tab', 'Opened ' + (titles[page] || page));
  if (page !== 'cashSegment') cashReleasePdf();
  cashOriginalShow(page);
  if (!cashInternalRender) window.scrollTo(0, 0);
  if (page === 'cashSegment' && cashSelectedId) {
    const report = cashFindReport(cashSelectedId);
    if (report)
      cashRefreshPdf(report).catch((error) => {
        const status = document.querySelector('#cashPdfStatus');
        if (status) status.textContent = 'PDF preview could not be generated: ' + error.message;
      });
  }
};
const cashOriginalEnterPortal = enterPortal;
enterPortal = async function (profile) {
  await cashOriginalEnterPortal(profile);
  await cashResumeSign();
};
const cashOriginalLogout = document.querySelector('#logout').onclick;
document.querySelector('#logout').onclick = () => {
  cashReleasePdf();
  cashStrategyFormOpen = false;
  cashSelectedId = null;
  cashRaActivity.splice(0);
  cashOriginalLogout();
};

// ───────────── events ─────────────
document.querySelector('#content').addEventListener('click', (event) => {
  const newStrategy = event.target.closest('#cashNewStrategy');
  if (newStrategy) {
    cashStrategyFormOpen = true;
    cashSelectedId = null;
    cashShowCurrent();
    cashTrackRa('Cash Segment', 'Opened New Report', 'Started a new Cash Segment report');
    return;
  }
  const cancel = event.target.closest('#cashCancelCreate');
  if (cancel) {
    cashStrategyFormOpen = false;
    cashShowCurrent();
    return;
  }
  const view = event.target.closest('[data-cash-view]');
  if (view) {
    const report = cashFindReport(view.dataset.cashView);
    cashShowReport(view.dataset.cashView);
    if (report) cashTrackRa('Cash Segment', 'Viewed PDF', report.title);
    return;
  }
  const download = event.target.closest('[data-cash-download]');
  if (download) {
    const report = cashFindReport(download.dataset.cashDownload);
    if (report) {
      cashTrackRa('Cash Segment', 'Downloaded PDF', report.title);
      cashDownload(report).catch((error) => toast('PDF could not be created: ' + error.message));
    }
    return;
  }
  const check = event.target.closest('[data-cash-esign-check]');
  if (check) {
    check.disabled = true;
    cashConfirmSign(check.dataset.cashEsignCheck)
      .catch((error) => {
        if (document.querySelector('#cashSignStatus'))
          document.querySelector('#cashSignStatus').textContent = error.message;
      })
      .finally(() => (check.disabled = false));
  }
});
document.querySelector('#content').addEventListener('submit', async (event) => {
  if (event.target.id === 'cashCreateForm') {
    event.preventDefault();
    const form = event.target,
      message = document.querySelector('#cashCreateMessage'),
      button = form.querySelector('button:not([type=button])'),
      file = form.elements.csv.files[0];
    message.textContent = '';
    try {
      if (!file) throw new Error('Choose a CSV file.');
      if (file.size > 5 * 1024 * 1024) throw new Error('CSV file must be 5 MB or smaller.');
      if (!(file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv'))
        throw new Error('Upload a .csv file.');
      const rows = cashParseCsv(await file.text()),
        product = form.elements.product.value,
        frequency = form.elements.frequency.value;
      if (!product) throw new Error('Select LC, MC or SC.');
      if (!frequency) throw new Error('Select Monthly, Quarterly or Half-Yearly.');
      button.disabled = true;
      message.textContent = 'Saving report...';
      const created = await Api.createCashDraft(
        product,
        frequency,
        file.name,
        rows.map((row) =>
          Object.fromEntries(cashCsvColumns.map(([key]) => [key, String(row[key])])),
        ),
      );
      await refreshWorkspace();
      cashTrackRa(
        'Cash Segment',
        'Created report',
        product + ' ' + frequency + ' report from ' + file.name,
      );
      cashShowReport(created.id);
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
    return;
  }
  if (event.target.id === 'cashSignForm') {
    event.preventDefault();
    const report = cashFindReport(event.target.dataset.report);
    if (report) await cashStartSign(report, event.target);
    return;
  }
  if (event.target.id === 'cashSendForm') {
    event.preventDefault();
    const form = event.target,
      report = cashFindReport(form.dataset.report),
      status = document.querySelector('#cashSendStatus'),
      button = form.querySelector('button'),
      selected = [...form.querySelectorAll('[name=client]:checked:not(:disabled)')].map(
        (input) => input.value,
      );
    if (!report) return;
    if (!selected.length) {
      status.textContent = 'Select at least one client.';
      return;
    }
    button.disabled = true;
    try {
      const result = await Api.sendCashReport(report.id, selected);
      await refreshWorkspace();
      cashTrackRa(
        'Cash Segment',
        'Sent report',
        report.title + ' to ' + result.delivered + ' client(s)',
      );
      cashShowReport(report.id);
      toast('Cash report sent to ' + result.delivered + ' client(s).');
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  }
});
