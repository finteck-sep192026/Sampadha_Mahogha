// Cash Segment → Monthly research pack. The packs are made on the analyst's PC by the Sampadha
// Research Pack Generator (github.com/content-cpu/sampadha-research-pack-generator), whose
// Trendlyne data only loads from a home connection. The portal holds both ends of that:
//   1. Stock list in: a CSV or Excel file with LC, MC and SC columns of NSE symbols (columns may be
//      different lengths), saved per month and downloaded as YYYY-MM.csv for the generator's
//      stock_lists/ folder.
//   2. Packs out: the generator's PDFs (LargeCap_ / Midcap_ / Smallcap_Research_Pack_YYYYMMDD.pdf),
//      one Cash report each (cash_kind 'pack'), then Aadhaar eSign and sending as for any Cash
//      report. Packs hold no recommendations, so they never go to CARE PaRRVA.
// Database: migration 20261029000000_v2_cash_research_pack.sql.

const PACK_PDF_LIMIT = 10 * 1024 * 1024; // what the esign function accepts
const PACK_SYMBOL = /^[A-Z0-9][A-Z0-9&._-]{0,19}$/;
const PACK_FILE_PRODUCT = [
  [/^large\s*cap/i, 'LC'],
  [/^mid\s*cap/i, 'MC'],
  [/^small\s*cap/i, 'SC'],
];
let cashPackMonth = researchDefaultPublished().slice(0, 7),
  cashPackLists = null, // saved stock lists, newest month first; null until loaded
  cashPackDraft = null, // { fileName, LC, MC, SC } read from a file but not saved yet
  cashPackLoading = null;

const cashPackMonthName = (month) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).toLocaleString(
    'en-IN',
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  );
const cashPackSaved = () => (cashPackLists || []).find((list) => list.month === cashPackMonth) || null;
const cashPackColumns = (list) => ({ LC: list.lc, MC: list.mc, SC: list.sc });
// The newest pack for a product in the chosen month.
const cashPackReport = (product) =>
  cashReports()
    .filter((r) => r.cashKind === 'pack' && r.packMonth === cashPackMonth && r.product === product)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;

// ───────────── stock list in ─────────────
async function cashPackReadList(file) {
  const extension = (file.name.split('.').pop() || '').toLowerCase();
  if (!['csv', 'xls', 'xlsx'].includes(extension))
    throw new Error('Choose a CSV, XLS or XLSX stock list.');
  if (file.size > 2 * 1024 * 1024) throw new Error('The stock list must be 2 MB or smaller.');
  let matrix;
  if (extension === 'csv')
    matrix = (await file.text())
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map(cashParseCsvLine);
  else {
    if (typeof quickLoadXlsx !== 'function') throw new Error('The spreadsheet reader is not available.');
    await quickLoadXlsx();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' }),
      sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error('The file has no worksheet.');
    matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  }
  if (matrix.length < 2) throw new Error('The stock list has no stocks under its header row.');
  const headers = matrix[0].map((h) => String(h).trim().toUpperCase()),
    missing = ['LC', 'MC', 'SC'].filter((key) => !headers.includes(key));
  if (missing.length)
    throw new Error(
      'The stock list needs columns named LC, MC and SC (missing: ' + missing.join(', ') + ').',
    );
  const lists = { fileName: file.name },
    bad = [];
  for (const key of ['LC', 'MC', 'SC']) {
    const column = headers.indexOf(key),
      seen = new Set();
    for (const row of matrix.slice(1)) {
      const symbol = String(row[column] ?? '')
        .replace(/\s+/g, '')
        .toUpperCase();
      if (!symbol || seen.has(symbol)) continue;
      if (!PACK_SYMBOL.test(symbol)) bad.push(key + ': ' + symbol);
      seen.add(symbol);
    }
    if (seen.size > 150) throw new Error(key + ' has more than 150 stocks.');
    lists[key] = [...seen];
  }
  if (bad.length)
    throw new Error(
      'These are not NSE symbols (letters, digits, & . _ -): ' + bad.slice(0, 5).join(', ') + '.',
    );
  if (!lists.LC.length && !lists.MC.length && !lists.SC.length)
    throw new Error('The stock list has no stocks.');
  return lists;
}
// The generator's own format: header LC,MC,SC and one row per position, blanks where a column ends.
function cashPackDownloadList(list) {
  const columns = cashPackColumns(list),
    rows = Math.max(columns.LC.length, columns.MC.length, columns.SC.length),
    text = ['LC,MC,SC']
      .concat(
        Array.from({ length: rows }, (_, i) =>
          ['LC', 'MC', 'SC'].map((key) => columns[key][i] || '').join(','),
        ),
      )
      .join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text + '\r\n'], { type: 'text/csv' }));
  link.download = list.month + '.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ───────────── packs out ─────────────
async function cashPackSha256(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function cashPackUpload(product, file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error(file.name + ' is not a PDF.');
  if (file.size > PACK_PDF_LIMIT)
    throw new Error(file.name + ' is larger than 10 MB, the most Aadhaar eSign accepts.');
  if (new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !== '%PDF-')
    throw new Error(file.name + ' is not a readable PDF.');
  const sha = await cashPackSha256(file),
    current = cashPackReport(product);
  let id;
  if (current && current.esignStatus !== 'Signed') {
    // Not signed yet: the new file replaces the old one in the same report.
    await Api.replaceCashPackPdf(current.id, file.name, sha);
    id = current.id;
  } else id = (await Api.createCashPackDraft(product, cashPackMonth, file.name, sha)).id;
  await Api.uploadPreviewPdf(id, file);
  cashTrackRa('Cash Segment', 'Uploaded research pack', product + ' ' + cashPackMonth);
  return id;
}
const cashPackProductOf = (fileName) =>
  PACK_FILE_PRODUCT.find(([pattern]) => pattern.test(fileName))?.[1] || '';

// ───────────── card ─────────────
function cashPackStatus(report) {
  if (!report) return '<span class="muted">No pack yet</span>';
  return (
    '<strong>' +
    cashEscape(report.ref) +
    '</strong><small>' +
    cashEscape(cashStatusLabel(report)) +
    ' · ' +
    cashEscape(report.fileName) +
    '</small>'
  );
}
function cashPackListPart() {
  const saved = cashPackSaved(),
    month = cashPackMonthName(cashPackMonth),
    picker = (label) =>
      '<label class="btn secondary cash-pack-file">' +
      label +
      '<input type="file" accept=".csv,.xls,.xlsx" data-cash-pack-list hidden></label>';
  if (cashPackDraft) {
    const counts = ['LC', 'MC', 'SC'].map((key) => key + ' ' + cashPackDraft[key].length).join(' · ');
    return (
      '<div class="cash-pack-step"><h4>1. Stock list for ' +
      cashEscape(month) +
      '</h4><p>' +
      cashEscape(cashPackDraft.fileName) +
      ' · ' +
      counts +
      (saved ? ' · replaces the saved list (' + cashEscape(saved.file_name) + ')' : '') +
      '</p>' +
      ['LC', 'MC', 'SC']
        .map(
          (key) =>
            '<p class="cash-pack-chips"><b>' +
            key +
            '</b>' +
            (cashPackDraft[key].map((s) => '<span>' + cashEscape(s) + '</span>').join('') ||
              '<span class="muted">none</span>') +
            '</p>',
        )
        .join('') +
      '<div class="cash-form-actions"><button type="button" class="btn primary" data-cash-pack-save>Save stock list</button><button type="button" class="btn secondary" data-cash-pack-cancel>Cancel</button></div></div>'
    );
  }
  if (!saved)
    return (
      '<div class="cash-pack-step"><h4>1. Stock list for ' +
      cashEscape(month) +
      '</h4><p>Choose the CSV or Excel file with columns <b>LC</b>, <b>MC</b> and <b>SC</b> (NSE symbols; the columns can be different lengths).</p><div class="cash-form-actions">' +
      picker('Choose stock list') +
      '</div></div>'
    );
  return (
    '<div class="cash-pack-step"><h4>1. Stock list for ' +
    cashEscape(month) +
    '</h4><p>' +
    cashEscape(saved.file_name) +
    ' · LC ' +
    saved.lc.length +
    ' · MC ' +
    saved.mc.length +
    ' · SC ' +
    saved.sc.length +
    ' · saved ' +
    cashEscape(Api.fmt.stamp(saved.uploaded_at)) +
    '</p><div class="cash-form-actions"><button type="button" class="btn secondary" data-cash-pack-download>Download ' +
    cashEscape(saved.month) +
    '.csv for the generator</button>' +
    picker('Replace stock list') +
    '</div><p class="research-notice">Put the file in the generator\'s <code>stock_lists</code> folder (or set <code>STOCK_LIST_PATH</code> to it) and run the generator on your PC. It saves each pack as Word and PDF.</p></div>'
  );
}
function cashPackUploadPart() {
  const saved = cashPackSaved();
  if (!saved || cashPackDraft) return '';
  const columns = cashPackColumns(saved);
  return (
    '<div class="cash-pack-step"><h4>2. Upload the packs</h4><p>Upload the generator\'s PDFs (up to 10 MB each). Each pack is then signed with Aadhaar eSign and sent to clients, like a Cash report.</p><div class="table-wrap"><table class="table cash-pack-table"><thead><tr><th>Product</th><th>Stocks</th><th>Pack</th><th></th></tr></thead><tbody>' +
    Object.entries(CASH_PRODUCTS)
      .map(([product, name]) => {
        const report = cashPackReport(product),
          label = !report ? 'Upload PDF' : report.esignStatus === 'Signed' ? 'Upload new PDF' : 'Replace PDF';
        return (
          '<tr><th scope="row"><strong>' +
          product +
          '</strong><small>' +
          name +
          '</small></th><td>' +
          columns[product].length +
          '</td><td>' +
          cashPackStatus(report) +
          '</td><td class="cash-report-actions">' +
          (report
            ? '<button type="button" class="btn secondary" data-cash-view="' + report.id + '">Open</button>'
            : '') +
          (columns[product].length
            ? '<label class="btn secondary cash-pack-file">' +
              label +
              '<input type="file" accept=".pdf,application/pdf" data-cash-pack-upload="' +
              product +
              '" hidden></label>'
            : '<span class="muted">No ' + product + ' stocks this month</span>') +
          '</td></tr>'
        );
      })
      .join('') +
    '</tbody></table></div><div class="cash-form-actions"><label class="btn primary cash-pack-file">Upload all three PDFs<input type="file" accept=".pdf,application/pdf" multiple data-cash-pack-upload="auto" hidden></label></div><p class="research-notice">With "Upload all three", each file goes to its product by name: LargeCap_…, Midcap_… and Smallcap_….</p></div>'
  );
}
function cashPackBody() {
  if (cashPackLists === null) return '<p class="muted">Loading the stock lists…</p>';
  return cashPackListPart() + cashPackUploadPart();
}
function cashPackCard() {
  if (cashPackLists === null) cashPackLoad();
  return (
    '<article class="card panel cash-pack-card" id="cashPackCard"><div class="panel-head"><div><p class="overline">Monthly research pack</p><h3>LC, MC and SC research packs</h3><p>Made on your PC by the Sampadha Research Pack Generator: save the month\'s stock list here, run the generator with it, then upload the PDFs it makes.</p></div><label class="field cash-pack-month">Month<input type="month" id="cashPackMonth" value="' +
    cashEscape(cashPackMonth) +
    '"></label></div><div id="cashPackBody">' +
    cashPackBody() +
    '</div><p id="cashPackMessage" class="research-message" role="status"></p></article>'
  );
}
function cashPackRefresh(message) {
  const body = document.querySelector('#cashPackBody');
  if (body) body.innerHTML = cashPackBody();
  if (message !== undefined && document.querySelector('#cashPackMessage'))
    document.querySelector('#cashPackMessage').textContent = message;
}
function cashPackLoad() {
  cashPackLoading ??= Api.listCashStockLists()
    .then((lists) => {
      cashPackLists = lists || [];
      cashPackRefresh();
    })
    .catch((error) => {
      cashPackLists = [];
      cashPackRefresh('The stock lists could not be loaded: ' + error.message);
    })
    .finally(() => {
      cashPackLoading = null;
    });
  return cashPackLoading;
}

// ───────────── events ─────────────
document.querySelector('#content').addEventListener('change', async (event) => {
  const say = (text) => cashPackRefresh(text);
  if (event.target.id === 'cashPackMonth') {
    if (/^\d{4}-\d{2}$/.test(event.target.value)) cashPackMonth = event.target.value;
    cashPackDraft = null;
    return say('');
  }
  if (event.target.matches('[data-cash-pack-list]')) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      cashPackDraft = await cashPackReadList(file);
      say('Check the stocks below, then save the list for ' + cashPackMonthName(cashPackMonth) + '.');
    } catch (error) {
      cashPackDraft = null;
      say(error.message);
    }
    return;
  }
  const upload = event.target.closest('[data-cash-pack-upload]');
  if (!upload) return;
  const files = [...upload.files],
    target = upload.dataset.cashPackUpload;
  upload.value = '';
  if (!files.length) return;
  try {
    const plan =
      target === 'auto'
        ? files.map((file) => {
            const product = cashPackProductOf(file.name);
            if (!product)
              throw new Error(
                'Cannot tell which product ' +
                  file.name +
                  ' is for. Its name should start with LargeCap, Midcap or Smallcap, or use that row\'s own button.',
              );
            return [product, file];
          })
        : [[target, files[0]]];
    if (new Set(plan.map(([product]) => product)).size !== plan.length)
      throw new Error('Choose one PDF per product.');
    let last = '';
    for (const [product, file] of plan) {
      say('Uploading ' + file.name + ' (' + product + ')…');
      last = await cashPackUpload(product, file);
    }
    await refreshWorkspace();
    if (plan.length === 1) cashShowReport(last);
    else cashShowCurrent();
    toast(plan.length + ' research pack(s) uploaded. Sign each one with Aadhaar eSign to send it.');
  } catch (error) {
    await refreshWorkspace().catch(() => {});
    cashShowCurrent();
    cashPackRefresh(error.message);
  }
});
document.querySelector('#content').addEventListener('click', async (event) => {
  if (event.target.closest('[data-cash-pack-cancel]')) {
    cashPackDraft = null;
    return cashPackRefresh('');
  }
  if (event.target.closest('[data-cash-pack-download]')) {
    const saved = cashPackSaved();
    if (saved) cashPackDownloadList(saved);
    return;
  }
  const save = event.target.closest('[data-cash-pack-save]');
  if (!save || !cashPackDraft) return;
  save.disabled = true;
  try {
    await Api.saveCashStockList(cashPackMonth, cashPackDraft.fileName, cashPackDraft);
    cashTrackRa('Cash Segment', 'Saved research pack stock list', cashPackMonth);
    cashPackDraft = null;
    cashPackLists = null;
    await cashPackLoad();
    cashPackRefresh(
      'Stock list saved for ' + cashPackMonthName(cashPackMonth) + '. Download it for the generator.',
    );
  } catch (error) {
    save.disabled = false;
    cashPackRefresh(error.message);
  }
});
