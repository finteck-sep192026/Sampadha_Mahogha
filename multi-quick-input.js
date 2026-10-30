// Multi Segment Quick input: one compact line per option leg plus the weekly contract master,
// turned into the 19 CARE PaRRVA columns and fed into the same preview → eSign → send flow as the
// CSV format (the basket is the only way in; there is no CSV upload). Based on the Careparva
// generator (27 Oct 2026), with PaRRVA's rules applied:
//   - AdviceName gets a unique suffix (a repeated AdviceName is a modification at PaRRVA)
//   - entry, target and stop-loss are part of the line and must be > 0, intraday or not
//     (Strategy API section 6 makes all of them mandatory); PriceType is always CMP
//   - expiry is sent as YYYY-MM-DD, ContractName is the underlying, BSE codes are IDO/STO
// The weekly master is uploaded on the Uploads page and stored privately on the server.
//
//   CB Nifty 03Nov 24000C+3 @120-125 T180 SL95
//   prefix · symbol · expiry · strike C/P · +buy/−sell lots · @entry[-entry] · T target · SL stop-loss
const QUICK_PREFIXES = {
  CB: 'CALL BUY',
  PB: 'PUT BUY',
  BC: 'BULL CALL',
  BP: 'BULL PUT',
  RP: 'RATIO PUT',
  RC: 'RATIO CALL',
};
const QUICK_INDEX_SYMBOLS = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX', 'BSX']);
// Exchange contract-master instrument codes → PaRRVA option codes.
const QUICK_OPTION_CODES = {
  NSE: { OPTIDX: 'OPTIDX', OPTSTK: 'OPTSTK' },
  BSE: { IO: 'IDO', IDO: 'IDO', SO: 'STO', STO: 'STO' },
};
const QUICK_MASTER_TYPES = {
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
// Weekly options exist only on these underlyings; every other contract expires once a month.
const QUICK_WEEKLY_SYMBOLS = new Set(['NIFTY', 'SENSEX', 'BSX']);
const QUICK_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const QUICK_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
let quickMaster = null, // { id, fileName, uploadedAt, master: { SYMBOL: [profile, …] } }
  quickXlsx = null,
  quickMastersList = null;

const quickNormalize = (value) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

// SheetJS is large, so it loads only when a spreadsheet is actually read.
function quickLoadXlsx() {
  if (window.XLSX) return Promise.resolve();
  quickXlsx ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/xlsx.full.min.js';
    script.onload = resolve;
    script.onerror = () => {
      quickXlsx = null;
      script.remove();
      reject(new Error('The spreadsheet reader could not load. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return quickXlsx;
}

// ───────────── weekly master ─────────────
function quickMasterDate(value) {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[/-](\d{1,2}|[A-Za-z]{3})[/-](\d{2}|\d{4})$/);
  if (!match) return '';
  let day = Number(match[1]),
    month = /^\d+$/.test(match[2])
      ? Number(match[2])
      : QUICK_MONTHS.indexOf(match[2].toUpperCase()) + 1,
    year = Number(match[3]);
  if (year < 100) year += 2000;
  if (month > 12 && day <= 12) [day, month] = [month, day];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}
async function quickReadSheet(file) {
  const extension = (file.name.split('.').pop() || '').toLowerCase();
  if (!QUICK_MASTER_TYPES[extension])
    throw new Error('The weekly master must be a CSV, XLS or XLSX file.');
  if (file.size > 10 * 1024 * 1024) throw new Error('The weekly master must be 10 MB or smaller.');
  await quickLoadXlsx();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true }),
    sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('The file has no worksheet.');
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (matrix.length < 2) throw new Error('The weekly master has no data rows.');
  const headers = matrix[0].map((value) => String(value).trim());
  return {
    extension,
    headers,
    rows: matrix
      .slice(1)
      .filter((values) => values.some((value) => String(value).trim()))
      .map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))),
  };
}
// Accepts the standardized 10-column master (MainExch, SubExch, FinInstrmTp, TckrSymb, XpryDt,
// NewBrdLotQty, MOFSLExchCode, BajajExch, BajajInst, Symbol) or a legacy Symbol + MLot sheet.
async function quickParseMaster(file) {
  const sheet = await quickReadSheet(file),
    column = Object.fromEntries(sheet.headers.map((h) => [quickNormalize(h), h])),
    standard = ['MAINEXCH', 'FININSTRMTP', 'TCKRSYMB', 'XPRYDT', 'NEWBRDLOTQTY', 'SYMBOL'].every(
      (key) => column[key],
    ),
    symbolColumn = column.SYMBOL || column.TCKRSYMB,
    lotColumn = standard ? column.NEWBRDLOTQTY : column.MLOT;
  if (!symbolColumn || !lotColumn)
    throw new Error(
      'The weekly master needs the standard columns (MainExch, FinInstrmTp, TckrSymb, XpryDt, NewBrdLotQty, Symbol) or legacy Symbol and MLot columns.',
    );
  const master = {};
  let contracts = 0;
  sheet.rows.forEach((row, index) => {
    const symbol = quickNormalize(row[symbolColumn]);
    if (!symbol) return;
    const lot = Number(String(row[lotColumn]).replace(/,/g, ''));
    if (!Number.isSafeInteger(lot) || lot < 1)
      throw new Error('Row ' + (index + 2) + ': invalid lot size for ' + symbol + '.');
    const ticker = standard ? quickNormalize(row[column.TCKRSYMB]) : symbol,
      exchange = standard
        ? quickNormalize(row[column.MAINEXCH])
        : symbol === 'BSX' || symbol === 'SENSEX'
          ? 'BSE'
          : 'NSE',
      profile = {
        lot,
        exchange,
        instrument: standard ? quickNormalize(row[column.FININSTRMTP]) : '',
        ticker,
        expiry: standard ? quickMasterDate(row[column.XPRYDT]) : '',
        row: index + 2,
      };
    if (standard && !profile.expiry)
      throw new Error('Row ' + (index + 2) + ': invalid XpryDt for ' + symbol + '.');
    if (!['NSE', 'BSE'].includes(exchange))
      throw new Error('Row ' + (index + 2) + ': MainExch must be NSE or BSE.');
    // Reachable by the broker symbol (e.g. BSX) and by the exchange ticker (e.g. SENSEX).
    for (const key of new Set([symbol, ticker])) (master[key] ||= []).push(profile);
    contracts++;
  });
  if (!contracts) throw new Error('No contracts were found in the weekly master.');
  return {
    master,
    contracts,
    symbols: new Set(Object.values(master).flat().map((p) => p.ticker)).size,
    format: standard ? 'standard-v2' : 'legacy',
    extension: sheet.extension,
  };
}
async function quickLatestMaster() {
  const [latest] = await Api.listSymbolMasters(1);
  if (!latest)
    throw new Error('No weekly master has been uploaded yet. Upload it on the Uploads page.');
  if (quickMaster?.id !== latest.id) {
    const blob = await Api.downloadFile(latest.storage_path),
      parsed = await quickParseMaster(new File([blob], latest.storage_path.split('/').pop()));
    quickMaster = {
      id: latest.id,
      fileName: latest.file_name,
      uploadedAt: latest.uploaded_at,
      master: parsed.master,
    };
  }
  return quickMaster;
}

// ───────────── compact basket → 19 PaRRVA columns ─────────────
function quickExpiry(day, monthText, line) {
  const month = QUICK_MONTHS.indexOf(monthText.toUpperCase());
  if (month < 0) throw new Error(line + 'expiry month ' + monthText + ' is not valid.');
  const today = researchDefaultPublished().slice(0, 10);
  let year = Number(today.slice(0, 4));
  // A month already behind us (e.g. 06Jan typed in December) is next year's contract.
  if (month < Number(today.slice(5, 7)) - 1) year++;
  const date = new Date(Date.UTC(year, month, Number(day)));
  if (date.getUTCMonth() !== month)
    throw new Error(line + 'expiry ' + day + monthText + ' is not a real date.');
  const iso = date.toISOString().slice(0, 10);
  if (iso < today) throw new Error(line + 'expiry ' + day + monthText + ' is in the past.');
  return iso;
}
function quickContract(master, symbol, expiry, line) {
  const profiles = master[symbol];
  if (!profiles)
    throw new Error(
      line + symbol + ' is not in the weekly master. Upload the latest master on the Uploads page.',
    );
  const dated = profiles.filter((p) => p.expiry);
  if (!dated.length) return profiles[0];
  // The master lists the monthly contracts, so a weekly expiry (e.g. 03Nov) takes its lot size,
  // exchange and instrument from the same month's contract; the typed date is still the expiry sent.
  const exact = dated.find((p) => p.expiry === expiry);
  if (exact) return exact;
  const month = expiry.slice(0, 7),
    monthName = quickDayLabel(month + '-01').replace(/^1 /, ''),
    sameMonth = dated.filter((p) => p.expiry.slice(0, 7) === month).sort((a, b) => (a.expiry < b.expiry ? 1 : -1));
  if (!sameMonth.length) {
    const months = [...new Set(dated.map((p) => p.expiry.slice(0, 7)))]
      .sort()
      .map((m) => quickDayLabel(m + '-01').replace(/^1 /, ''))
      .slice(0, 4);
    throw new Error(
      line + 'the weekly master has no ' + symbol + ' contract for ' + monthName +
        '. Months in the master: ' + months.join(', ') + '.',
    );
  }
  const monthly = sameMonth[0],
    typed = quickDayLabel(expiry);
  // The typed date must be a day the contract can actually expire on.
  if (!QUICK_WEEKLY_SYMBOLS.has(symbol) && !QUICK_WEEKLY_SYMBOLS.has(monthly.ticker))
    throw new Error(
      line + symbol + ' options expire monthly only; the ' + monthName + ' contract expires on ' +
        quickDayLabel(monthly.expiry) + ', not ' + typed + '.',
    );
  if (expiry > monthly.expiry)
    throw new Error(
      line + 'the last ' + symbol + ' expiry in ' + monthName + ' is ' + quickDayLabel(monthly.expiry) +
        ', so no contract expires on ' + typed + '.',
    );
  const weekday = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay(),
    counts = {};
  for (const p of dated) counts[weekday(p.expiry)] = (counts[weekday(p.expiry)] || 0) + 1;
  // Usual expiry weekday from the master; a holiday moves an expiry one day earlier.
  const usual = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a] || b - a)[0]),
    before = (usual + 6) % 7,
    day = weekday(expiry);
  if (day === 0 || day === 6 || (day !== usual && day !== before))
    throw new Error(
      line + symbol + ' weekly options expire on ' + QUICK_WEEKDAYS[usual] + 's (' +
        QUICK_WEEKDAYS[before] + ' when that is a holiday); ' + typed + ' is a ' +
        QUICK_WEEKDAYS[day] + '.',
    );
  return monthly;
}
const quickDayLabel = (iso) =>
  Number(iso.slice(8, 10)) + ' ' + QUICK_MONTHS[Number(iso.slice(5, 7)) - 1].charAt(0) +
  QUICK_MONTHS[Number(iso.slice(5, 7)) - 1].slice(1).toLowerCase() + ' ' + iso.slice(0, 4);
function quickInstrument(profile, symbol) {
  const codes = QUICK_OPTION_CODES[profile.exchange] || {},
    mapped = codes[profile.instrument];
  if (mapped) return mapped;
  const index = QUICK_INDEX_SYMBOLS.has(symbol) || QUICK_INDEX_SYMBOLS.has(profile.ticker);
  return profile.exchange === 'BSE' ? (index ? 'IDO' : 'STO') : index ? 'OPTIDX' : 'OPTSTK';
}
const QUICK_EXAMPLE = 'CB Nifty 03Nov 24000C+3 @120-125 T180 SL95';
// prefix · symbol · expiry · strike C/P(E) · +/- lots · then the prices, read separately below.
const QUICK_LEG =
  /^(CB|PB|BC|BP|RP|RC) ?([A-Z0-9._&-]+?) (\d{1,2}) ?([A-Z]{3}) (\d+(?:\.\d+)?) ?([CP])E? ?([+-]) ?(\d+)(.*)$/;
// One leg per entry, however it was typed: several legs on one line, or prices on the next line.
function quickBasketLines(text) {
  const legs = [];
  String(text)
    .toUpperCase()
    .replace(/[−–—]/g, '-')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/₹/g, '')
    .replace(/\b(?:TGT|TARGET)\b/g, 'T')
    .replace(/\bSTOP ?-? ?LOSS\b/g, 'SL')
    .replace(/[:=,;|\\]/g, ' ')
    // A new leg can start on the same line, straight after the previous leg's stop-loss.
    .replace(/(\bSL\s*\d+(?:\.\d+)?)\s+(?=(?:CB|PB|BC|BP|RP|RC)\s*[A-Z])/g, '$1\n')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .forEach((line) => {
      if (legs.length && /^(?:@|T ?\d|SL ?\d)/.test(line)) legs[legs.length - 1] += ' ' + line;
      else legs.push(line);
    });
  return legs;
}
// Prices (user's rules, 30 Oct 2026): target and stop-loss are never required (blank or 0 = none);
// an Intraday YES leg needs its @ entry price. Any price that is typed must be a clean number.
function quickParseLeg(text, line, intraday = 'NO') {
  const match = text.match(QUICK_LEG);
  if (!match) throw new Error(line + 'use the format ' + QUICK_EXAMPLE);
  const [, code, symbol, day, month, strike, cp, direction, lots, rest] = match,
    // Each price ends at a space or the line's end, so a typo such as T18O is reported, not read as 18.
    entry = rest.match(/@ ?(\d+(?:\.\d+)?)(?: ?- ?(\d+(?:\.\d+)?))?(?= |$)/),
    target = rest.match(/(?:^| )T ?(\d+(?:\.\d+)?)(?= |$)/),
    stop = rest.match(/(?:^| )SL ?(\d+(?:\.\d+)?)(?= |$)/),
    missing =
      intraday === 'YES'
        ? [!entry && '@ entry price'].filter(Boolean)
        : [];
  if (missing.length)
    throw new Error(line + 'an intraday leg needs ' + missing.join(' and ') + ', e.g. ' + QUICK_EXAMPLE);
  let leftover = rest;
  for (const part of [entry, target, stop]) if (part) leftover = leftover.replace(part[0], ' ');
  if (/\d/.test(leftover))
    throw new Error(line + 'could not read "' + leftover.trim() + '". Use the format ' + QUICK_EXAMPLE);
  return [code, symbol, day, month, strike, cp, direction, lots, entry?.[1], entry?.[2], target?.[1], stop?.[1]];
}
// Intraday legs without an entry price: [{ index, text, side, entry, target, stop }].
// Lines that are not in the basket format at all are left to quickParseLeg's message.
function quickMissingPrices(lines, intraday) {
  if (intraday !== 'YES') return [];
  return lines
    .map((text, index) => {
      const match = text.match(QUICK_LEG);
      if (!match) return null;
      const rest = match[9],
        entry = rest.match(/@ ?(\d+(?:\.\d+)?)(?: ?- ?(\d+(?:\.\d+)?))?(?= |$)/),
        target = rest.match(/(?:^| )T ?(\d+(?:\.\d+)?)(?= |$)/),
        stop = rest.match(/(?:^| )SL ?(\d+(?:\.\d+)?)(?= |$)/);
      if (entry) return null;
      return {
        index,
        text,
        side: match[7] === '+' ? 'BUY' : 'SELL',
        entry: entry ? entry[1] + (entry[2] ? '-' + entry[2] : '') : '',
        target: target ? target[1] : '',
        stop: stop ? stop[1] : '',
      };
    })
    .filter(Boolean);
}
// A small table under the basket that asks for the missing prices, leg by leg. Its fields have
// no name, so they never become part of the report form.
function quickRenderMissing(panel, missing) {
  const box = panel.querySelector('#quickPrices'),
    input = (leg, key, value, hint) =>
      '<input data-price="' + key + '" data-leg="' + leg.index + '" value="' + reportEscape(value) +
      '" inputmode="decimal" autocomplete="off" placeholder="' + hint + '"' + (value ? ' readonly' : '') + '>';
  box.hidden = false;
  box.innerHTML =
    '<p class="research-notice"><b>Add the entry price.</b> An intraday leg needs its entry price (one price, or a range like 120-125). Target and stop-loss stay optional.</p>' +
    '<div class="table-wrap"><table class="table quick-prices-table"><thead><tr><th>Leg</th><th>Basket line</th><th>Entry</th></tr></thead><tbody>' +
    missing
      .map(
        (leg) =>
          '<tr><td>' + (leg.index + 1) + '</td><td><code>' + reportEscape(leg.text) + '</code><small>' + leg.side +
          '</small></td><td>' + input(leg, 'entry', leg.entry, 'e.g. 120 or 120-125') + '</td></tr>',
      )
      .join('') +
    '</tbody></table></div><p class="error" id="quickPricesError" role="alert"></p><div class="quick-basket-actions"><button type="button" class="btn primary" data-quick-apply-prices>Add entry and generate legs</button><button type="button" class="btn secondary" data-quick-cancel-prices>Cancel</button></div>';
  box.querySelector('input:not([readonly])')?.focus();
}
async function quickGenerate(panel) {
  const field = (name) => panel.querySelector('[data-quick=' + name + ']').value,
    lines = quickBasketLines(field('basket'));
  if (!lines.length) throw new Error('Enter at least one basket line.');
  if (lines.length > 50) throw new Error('A report can have at most 50 legs.');
  const { master, fileName } = await quickLatestMaster(),
    // Unique suffix so every basket is a new advice at CARE PaRRVA, not a modification.
    stamp = researchDefaultPublished().replace(/-/g, '').slice(2).replace('T', '-').replace(':', ''),
    groups = new Map(),
    legs = lines.map((text, index) => {
      const line = 'Leg ' + (index + 1) + ': ',
        [code, rawSymbol, day, month, strike, cp, direction, lots, from, to, target, stop] =
          quickParseLeg(text, line, field('intraday')),
        symbol = quickNormalize(rawSymbol),
        expiry = quickExpiry(day, month, line),
        profile = quickContract(master, symbol, expiry, line),
        side = direction === '+' ? 'BUY' : 'SELL',
        priced = from != null,
        low = priced ? Math.min(Number(from), Number(to ?? from)) : '',
        high = priced ? Math.max(Number(from), Number(to ?? from)) : '',
        prefix = QUICK_PREFIXES[code.toUpperCase()],
        adviceName = prefix + ' ' + profile.ticker + ' ' + stamp,
        legId = (groups.get(adviceName) || 0) + 1;
      groups.set(adviceName, legId);
      return {
        productName: field('product'),
        adviceName,
        exchangeName: profile.exchange,
        strategyName: prefix,
        ifIntraday: field('intraday'),
        priceType: 'CMP',
        buyOrSell: side,
        instrument: quickInstrument(profile, symbol),
        ceOrPe: cp.toUpperCase() === 'C' ? 'CE' : 'PE',
        contractName: profile.ticker,
        contractExpiryDate: expiry,
        // PaRRVA: start is the lower price for BUY and the higher price for SELL.
        entryPriceStart: side === 'BUY' ? low : high,
        entryPriceEnd: side === 'BUY' ? high : low,
        lot: Number(lots),
        // Target and stop-loss: blank or 0 both mean none.
        targetPrice: target == null || Number(target) === 0 ? '' : Number(target),
        stopLoss: stop == null || Number(stop) === 0 ? '' : Number(stop),
        exitPrice: '',
        optionStrikePrice: Number(strike),
        legId,
        lotSize: profile.lot,
      };
    });
  // Run the generated rows through the same PaRRVA validation as an uploaded CSV.
  const csv = [
      RESEARCH_IMPORT_COLUMNS.map(([, label]) => label).join(','),
      ...legs.map((leg) => RESEARCH_IMPORT_COLUMNS.map(([key]) => leg[key]).join(',')),
    ].join('\n'),
    rows = researchCsvRowsFromText(csv);
  rows.forEach((row, index) => {
    row.lotSize = legs[index].lotSize;
    row.quantity = row.lot * row.lotSize;
  });
  return { rows, fileName };
}
// Sits inside the #researchCreate form, so it is a plain panel (no nested form) and its fields
// have no name: they never become part of the report submission.
function multiQuickInputMarkup() {
  const select = (name, label, options, selected) =>
    '<label class="field">' +
    label +
    '<select data-quick="' +
    name +
    '">' +
    options
      .map((o) => '<option' + (o === selected ? ' selected' : '') + '>' + o + '</option>')
      .join('') +
    '</select></label>';
  return (
    '<div id="quickBasket" class="quick-basket"><div><p class="overline">Multi recommendations</p><h4>Type the advice basket</h4><p class="research-notice">One option leg per line: prefix, symbol, expiry, strike with C/P, + buy or − sell with lots, then the prices. Intraday NO: prices are optional (e.g. CB Nifty 03Nov 24000C+3). Intraday YES: the @ entry price (or range) is needed. T target and SL stop-loss are always optional (blank or 0). Several legs on one line, or the prices on the next line, are read too. Lot sizes, exchange and instrument come from the expiry month\'s contract in the latest weekly master on the Uploads page.</p></div><div class="form-grid quick-basket-settings">' +
    select('product', 'Product', MULTI_TYPES, MULTI_TYPES[0]) +
    select('intraday', 'Intraday', ['NO', 'YES'], 'NO') +
    '<label class="field">Price type<input value="CMP" readonly></label>' +
    '</div><label class="field">Basket<textarea class="research-textarea" data-quick="basket" rows="5" spellcheck="false" placeholder="Intraday NO:  CB Nifty 03Nov 24000C+3&#10;Intraday YES: CB Nifty 03Nov 24000C+3 @120-125"></textarea></label><small class="research-notice">CB = CALL BUY, PB = PUT BUY, BC = BULL CALL, BP = BULL PUT, RP = RATIO PUT, RC = RATIO CALL. Lines with the same prefix and symbol form one strategy; each basket gets its own AdviceName so CARE PaRRVA records it as a new advice.</small><div class="quick-basket-actions"><button type="button" class="btn secondary" data-quick-generate>Generate legs</button><span id="quickBasketMaster" class="research-notice"></span></div><div id="quickPrices" class="quick-prices" hidden></div></div>'
  );
}

// ───────────── Uploads page (Research Analyst, Admin) ─────────────
function quickUploadsPage() {
  if (!reportAllowed())
    return '<article class="card panel">Research workspace access required.</article>';
  return (
    '<article class="card panel"><div class="panel-head"><div><p class="overline">Multi Segment</p><h3>Weekly contract master</h3><p>Upload the weekly Multisegment master (CSV, XLS or XLSX, up to 10 MB). Quick input uses the latest upload for lot sizes, exchange and instrument codes. Standard columns: MainExch, SubExch, FinInstrmTp, TckrSymb, XpryDt, NewBrdLotQty, MOFSLExchCode, BajajExch, BajajInst, Symbol.</p></div></div><form id="quickMasterForm"><label class="field">Weekly master file<input name="master" type="file" accept=".csv,.xls,.xlsx" required></label><button class="btn primary">Upload master</button><p id="quickMasterMessage" class="research-message" role="status"></p></form></article><article class="card panel research-section"><h3>Uploaded masters</h3><div id="quickMasterList"><p class="muted">Loading…</p></div></article>'
  );
}
async function quickRenderMasterList() {
  const target = document.querySelector('#quickMasterList');
  if (!target) return;
  try {
    quickMastersList = await Api.listSymbolMasters(10);
    target.innerHTML = quickMastersList.length
      ? '<div class="table-wrap"><table class="table"><thead><tr><th>File</th><th>Uploaded</th><th>Symbols</th><th>Contracts</th><th>Format</th></tr></thead><tbody>' +
        quickMastersList
          .map(
            (m, index) =>
              '<tr><td>' +
              reportEscape(m.file_name) +
              (index === 0 ? ' <span class="badge">In use</span>' : '') +
              '</td><td>' +
              reportEscape(Api.fmt.stamp(m.uploaded_at)) +
              '</td><td>' +
              m.symbols +
              '</td><td>' +
              m.contracts +
              '</td><td>' +
              reportEscape(m.format) +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table></div>'
      : '<p class="muted">No weekly master uploaded yet.</p>';
  } catch (error) {
    target.textContent = error.message;
  }
}

pages.raUploads = quickUploadsPage;
titles.raUploads = 'Uploads';
for (const role of ['ra', 'admin']) nav[role].push(['raUploads', '⇪', 'Uploads']);
const quickOriginalShow = show;
show = function (page) {
  quickOriginalShow(page);
  if (page === 'raUploads') quickRenderMasterList();
  if (page === 'multiReports' && document.querySelector('#quickBasketMaster'))
    Api.listSymbolMasters(1)
      .then(([latest]) => {
        const note = document.querySelector('#quickBasketMaster');
        if (note)
          note.textContent = latest
            ? 'Weekly master: ' + latest.file_name + ' (' + Api.fmt.stamp(latest.uploaded_at) + ')'
            : 'No weekly master yet: upload it on the Uploads page.';
      })
      .catch(() => {});
};

document.querySelector('#content').addEventListener('submit', async (event) => {
  if (event.target.id === 'quickMasterForm') {
    event.preventDefault();
    const form = event.target,
      message = document.querySelector('#quickMasterMessage'),
      button = form.querySelector('button'),
      file = form.elements.master.files[0];
    button.disabled = true;
    try {
      if (!file) throw new Error('Choose the weekly master file.');
      message.textContent = 'Reading ' + file.name + '…';
      const parsed = await quickParseMaster(file);
      message.textContent = 'Uploading…';
      await Api.uploadSymbolMaster(file, parsed, QUICK_MASTER_TYPES[parsed.extension]);
      quickMaster = null;
      message.textContent =
        parsed.symbols + ' symbols and ' + parsed.contracts + ' contracts loaded from ' + file.name + '.';
      form.reset();
      await quickRenderMasterList();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }
});
document.querySelector('#content').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-quick-generate]');
  if (!button) return;
  const message = document.querySelector('#researchCsvMessage'),
    panel = button.closest('#quickBasket'),
    prices = panel.querySelector('#quickPrices');
  const missing = quickMissingPrices(
    quickBasketLines(panel.querySelector('[data-quick=basket]').value),
    panel.querySelector('[data-quick=intraday]').value,
  );
  if (missing.length) {
    researchCsvRows = [];
    researchCsvFileName = '';
    researchRenderCsvPreview();
    quickRenderMissing(panel, missing);
    if (message)
      message.textContent =
        missing.length + (missing.length === 1 ? ' leg needs' : ' legs need') + ' an entry price: fill it in below.';
    return;
  }
  prices.hidden = true;
  prices.innerHTML = '';
  button.disabled = true;
  try {
    const { rows, fileName } = await quickGenerate(panel);
    researchCsvRows = rows;
    researchCsvFileName = 'Advice basket (master: ' + fileName + ')';
    researchRenderCsvPreview();
    document
      .querySelector('#researchCsvPreview')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    researchCsvRows = [];
    researchCsvFileName = '';
    researchRenderCsvPreview();
    if (message) message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

// The missing-prices table: the prices are written into the basket text (one leg per line), then
// the legs are generated from it as usual, with all the same checks.
document.querySelector('#content').addEventListener('click', (event) => {
  const panel = event.target.closest('#quickBasket');
  if (!panel) return;
  if (event.target.closest('[data-quick-cancel-prices]')) {
    const box = panel.querySelector('#quickPrices');
    box.hidden = true;
    box.innerHTML = '';
    const message = document.querySelector('#researchCsvMessage');
    if (message) message.textContent = '';
    return;
  }
  if (!event.target.closest('[data-quick-apply-prices]')) return;
  const basket = panel.querySelector('[data-quick=basket]'),
    lines = quickBasketLines(basket.value),
    error = panel.querySelector('#quickPricesError'),
    value = (leg, key) => panel.querySelector('[data-leg="' + leg + '"][data-price="' + key + '"]')?.value.trim() ?? '';
  for (const leg of quickMissingPrices(lines, panel.querySelector('[data-quick=intraday]').value)) {
    const entry = value(leg.index, 'entry');
    if (!/^\d+(\.\d+)?( ?- ?\d+(\.\d+)?)?$/.test(entry)) {
      error.textContent = 'Leg ' + (leg.index + 1) + ': enter the entry price as a number, or a range like 120-125.';
      panel.querySelector('[data-leg="' + leg.index + '"]:not([readonly])')?.focus();
      return;
    }
    lines[leg.index] =
      leg.text + ' @' + entry.replace(/ /g, '');
  }
  basket.value = lines.join('\n');
  panel.querySelector('[data-quick-generate]').click();
});
document.querySelector('#content').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || !event.target.closest('#quickPrices input')) return;
  event.preventDefault();
  event.target.closest('#quickBasket').querySelector('[data-quick-apply-prices]')?.click();
});
