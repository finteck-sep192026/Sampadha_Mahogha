// Research reports: create (legs, attachments, analysis), preview PDF, Aadhaar eSign (NSDL),
// deliver to subscribed clients, and manage positions. Data lives in Supabase (schema v2) via Api.
const researchReports = [];
async function createResearchPdfBlob(report) {
  await researchLoadAttachmentData(report);
  const attachmentMedia = await Promise.all(
    (report.attachments || []).map(
      (file) =>
        new Promise((resolve) => {
          if (!file.type.startsWith('image/')) return resolve({ file, image: null });
          const preview = new Image();
          preview.onload = () => resolve({ file, image: preview });
          preview.onerror = () => resolve({ file, image: null });
          preview.src = file.data;
        }),
    ),
  );
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
    const words = [];
    for (const word of String(text ?? '-')
      .replaceAll('—', '-')
      .split(/\s+/)) {
      if (ctx.measureText(word).width <= width) {
        words.push(word);
        continue;
      }
      let chunk = '';
      for (const char of word) {
        const next = chunk + char;
        if (ctx.measureText(next).width > width && chunk) {
          words.push(chunk);
          chunk = char;
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
    ['productName', 'Product name', 80],
    ['adviceName', 'Advice name', 100],
    ['exchangeName', 'Exchange', 80],
    ['strategyName', 'Strategy', 100],
    ['ifIntraday', 'Intraday', 70],
    ['priceType', 'Price type', 75],
    ['buyOrSell', 'Buy/Sell', 65],
    ['instrument', 'Instrument', 80],
    ['ceOrPe', 'CE/PE', 60],
    ['contractName', 'Contract', 100],
    ['contractExpiryDate', 'Expiry date', 95],
    ['entryPriceStart', 'Entry start', 80],
    ['entryPriceEnd', 'Entry end', 80],
    ['lot', 'Lot', 45],
    ['targetPrice', 'Target', 80],
    ['stopLoss', 'Stop loss', 75],
    ['exitPrice', 'Exit price', 75],
    ['optionStrikePrice', 'Strike', 90],
    ['legId', 'Leg ID', 80],
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
      ctx.font = 'bold 13px Arial';
      const lines = wrap(label, width - 10, 'bold 13px Arial').slice(0, 3);
      lines.forEach((line, i) => ctx.fillText(line, x + 5, y + 18 + i * 15));
      x += width;
    }
    y += height;
  };
  const tableRow = (row, index) => {
    const values = pdfColumns.map(([key, , width]) =>
        wrap(researchValue(row, key), width - 10, '13px Arial'),
      ),
      height = Math.max(48, ...values.map((lines) => lines.length * 16 + 14));
    if (y + height > bottom) {
      finish();
      begin();
      write(report.title, { font: 'bold 24px Arial', gap: 30 });
      write('MULTI RECOMMENDATIONS - continued', {
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
      ctx.font = '13px Arial';
      lines.forEach((line, j) => ctx.fillText(line, x + 5, y + 19 + j * 16));
      x += width;
    });
    y += height;
  };
  const researchSectionHeader = () => {
    const height = 46,
      sectionWidth = 260,
      detailsWidth = 1334;
    ctx.fillStyle = '#0d3970';
    ctx.fillRect(left, y, sectionWidth + detailsWidth, height);
    ctx.strokeStyle = '#d6e2f0';
    ctx.strokeRect(left, y, sectionWidth, height);
    ctx.strokeRect(left + sectionWidth, y, detailsWidth, height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px Arial';
    ctx.fillText('Research section', left + 12, y + 29);
    ctx.fillText('Details', left + sectionWidth + 12, y + 29);
    y += height;
  };
  const drawResearchSections = () => {
    const sectionWidth = 260,
      detailsWidth = 1334;
    if (y + 46 > bottom) {
      finish();
      begin();
    }
    write('RESEARCH ANALYSIS', { font: 'bold 22px Arial', color: '#0d3970', gap: 32 });
    researchSectionHeader();
    RESEARCH_SECTIONS.forEach((name, index) => {
      const lines = wrap(report.sections[name], detailsWidth - 24, '17px Arial'),
        height = Math.max(52, lines.length * 22 + 20);
      if (y + height > bottom) {
        finish();
        begin();
        write('RESEARCH ANALYSIS - continued', {
          font: 'bold 22px Arial',
          color: '#0d3970',
          gap: 32,
        });
        researchSectionHeader();
      }
      ctx.fillStyle = index % 2 ? '#f6f9fc' : '#fff';
      ctx.fillRect(left, y, sectionWidth + detailsWidth, height);
      ctx.strokeStyle = '#c7d5e5';
      ctx.strokeRect(left, y, sectionWidth, height);
      ctx.strokeRect(left + sectionWidth, y, detailsWidth, height);
      ctx.fillStyle = '#0d3970';
      ctx.font = 'bold 17px Arial';
      ctx.fillText(name, left + 12, y + 30);
      ctx.fillStyle = '#14243b';
      ctx.font = '17px Arial';
      lines.forEach((line, lineIndex) =>
        ctx.fillText(line, left + sectionWidth + 12, y + 28 + lineIndex * 22),
      );
      y += height;
    });
    y += 4;
  };
  begin();
  write(report.title, { font: 'bold 30px Arial', gap: 40 });
  write(report.ref + ' · ' + report.created, { font: '18px Arial', color: '#5b6d82', gap: 32 });
  write('MULTI RECOMMENDATIONS', { font: 'bold 20px Arial', color: '#a06b12', gap: 34 });
  tableHeader();
  report.rows.forEach(tableRow);
  y += 28;
  if (attachmentMedia.length) {
    const gap = 20,
      cardHeight = 270,
      blockHeight = 32 + cardHeight;
    if (y + blockHeight > bottom) {
      finish();
      begin();
    }
    write('ATTACHMENTS', { font: 'bold 22px Arial', color: '#0d3970', gap: 32 });
    const count = attachmentMedia.length,
      cellWidth = Math.min(500, (1594 - gap * (count - 1)) / count),
      totalWidth = cellWidth * count + gap * (count - 1),
      startX = left + (1594 - totalWidth) / 2,
      top = y;
    attachmentMedia.forEach(({ file, image }, index) => {
      const x = startX + index * (cellWidth + gap),
        slot = Number.isInteger(file.slot) ? file.slot + 1 : index + 1,
        nameLine = wrap(file.name, cellWidth - 24, '14px Arial')[0];
      ctx.fillStyle = '#f7f9fc';
      ctx.fillRect(x, top, cellWidth, cardHeight);
      ctx.strokeStyle = '#c7d5e5';
      ctx.strokeRect(x, top, cellWidth, cardHeight);
      ctx.fillStyle = '#0d3970';
      ctx.font = 'bold 16px Arial';
      ctx.fillText('Upload ' + slot, x + 12, top + 22);
      ctx.fillStyle = '#5b6d82';
      ctx.font = '14px Arial';
      ctx.fillText(nameLine, x + 12, top + 42);
      if (image) {
        const maxWidth = cellWidth - 30,
          maxHeight = 210,
          scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight),
          width = Math.max(1, Math.round(image.naturalWidth * scale)),
          height = Math.max(1, Math.round(image.naturalHeight * scale)),
          imageX = x + (cellWidth - width) / 2,
          imageY = top + 50 + (maxHeight - height) / 2;
        ctx.fillStyle = '#fff';
        ctx.fillRect(imageX - 4, imageY - 4, width + 8, height + 8);
        ctx.drawImage(image, imageX, imageY, width, height);
      } else {
        ctx.fillStyle = '#082f5c';
        ctx.fillRect(x + cellWidth / 2 - 55, top + 82, 110, 110);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('PDF', x + cellWidth / 2, top + 148);
        ctx.textAlign = 'left';
      }
    });
    y = top + cardHeight + 18;
  }
  drawResearchSections();
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
  return new Blob(chunks, { type: 'application/pdf' });
}
async function downloadResearchPdf(report) {
  const blob = await researchPdfBlob(report),
    url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = report.ref + (report.esignStatus === 'Signed' ? '-signed' : '-preview') + '.pdf';
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
// CARE PaRRVA instrument codes per exchange; options carry CE/PE and a strike, futures do not.
const RESEARCH_INSTRUMENTS = {
  NSE: ['FUTSTK', 'FUTIDX', 'OPTSTK', 'OPTIDX'],
  BSE: ['STF', 'IDF', 'STO', 'IDO'],
};
const RESEARCH_OPTION_INSTRUMENTS = ['OPTSTK', 'OPTIDX', 'STO', 'IDO'];
const RESEARCH_IMPORT_COLUMNS = [
  ['productName', 'ProductName'],
  ['adviceName', 'AdviceName'],
  ['exchangeName', 'ExchangeName'],
  ['strategyName', 'StrategyName'],
  ['ifIntraday', 'IfIntraday'],
  ['priceType', 'PriceType'],
  ['buyOrSell', 'BuyOrSell'],
  ['instrument', 'Instrument'],
  ['ceOrPe', 'CEorPE'],
  ['contractName', 'ContractName'],
  ['contractExpiryDate', 'ContractExpiryDate'],
  ['entryPriceStart', 'EntryPriceStart'],
  ['entryPriceEnd', 'EntryPriceEnd'],
  ['lot', 'Lot'],
  ['targetPrice', 'TargetPrice'],
  ['stopLoss', 'StopLoss'],
  ['exitPrice', 'ExitPrice'],
  ['optionStrikePrice', 'OptionStrikePrice'],
  ['legId', 'LegId'],
];
const RESEARCH_COLUMNS = [
  ...RESEARCH_IMPORT_COLUMNS,
  ['published', 'Published date'],
  ['delivered', 'Delivered date'],
  ['signed', 'Sign stamp'],
  ['status', 'Status'],
  ['closedAt', 'Closed date'],
];
let researchClients = [],
  researchOrderFilter = 'Open',
  researchPositionFilters = { clients: [], products: [], symbols: [] },
  researchDraftAttachments = [null, null, null],
  researchAttachmentTab = 0,
  researchPdfPreviewUrl = '',
  researchCsvRows = [],
  researchCsvFileName = '';
const researchAttachmentUrls = new Map(); // storage path -> object URL
// Called by role-app.js whenever the workspace is (re)loaded from the database.
function researchApplyWorkspace(ws) {
  researchReports.splice(0, researchReports.length, ...(ws ? ws.reports : []));
  researchClients = ws ? ws.researchClients : [];
  if (!ws) {
    researchAttachmentUrls.forEach((url) => URL.revokeObjectURL(url));
    researchAttachmentUrls.clear();
  }
}
if (typeof state !== 'undefined' && state.ws) researchApplyWorkspace(state.ws);
const researchStyle = document.createElement('link');
researchStyle.rel = 'stylesheet';
researchStyle.href = 'research-workflow.css';
document.head.appendChild(researchStyle);
const researchAttachmentStyle = document.createElement('link');
researchAttachmentStyle.rel = 'stylesheet';
researchAttachmentStyle.href = 'research-attachments.css';
document.head.appendChild(researchAttachmentStyle);
const researchPositionStyle = document.createElement('link');
researchPositionStyle.rel = 'stylesheet';
researchPositionStyle.href = 'research-positions.css';
document.head.appendChild(researchPositionStyle);
const researchPdfStyle = document.createElement('link');
researchPdfStyle.rel = 'stylesheet';
researchPdfStyle.href = 'research-pdf.css';
document.head.appendChild(researchPdfStyle);

function researchValue(row, key) {
  if (
    [
      'entryPriceStart',
      'entryPriceEnd',
      'targetPrice',
      'stopLoss',
      'exitPrice',
      'optionStrikePrice',
      'price',
      't1',
      't2',
      't3',
    ].includes(key)
  ) {
    if (row[key] === '' || row[key] === null || row[key] === undefined) return '—';
    return (
      '₹' +
      Number(row[key]).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  if (key === 'published') return String(row.published || '').replace('T', ' ') + ' IST';
  if (key === 'status' && (row.statusHistory || []).length)
    return (
      row.status +
      ' | ' +
      row.statusHistory
        .map((event, index) => index + 1 + '. ' + event.status + ' @ ' + event.at)
        .join(' | ')
    );
  return row[key] === 0 ? 0 : row[key] || '—';
}
function researchDefaultPublished() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute;
}
function researchCsvLine(line) {
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
function researchCsvRowsFromText(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2)
    throw new Error('CSV must include the 19-column header row and at least one recommendation.');
  if (lines.length > 51) throw new Error('CSV can contain a maximum of 50 recommendation rows.');
  const normalize = (value) =>
      String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ''),
    headers = researchCsvLine(lines[0]).map(normalize),
    indexes = {};
  for (const [key, label] of RESEARCH_IMPORT_COLUMNS)
    indexes[key] = headers.indexOf(normalize(label));
  const missing = RESEARCH_IMPORT_COLUMNS.filter(([key]) => indexes[key] < 0).map(
    ([, label]) => label,
  );
  if (missing.length) throw new Error('Missing CSV columns: ' + missing.join(', ') + '.');
  const rows = lines.slice(1).map((line, rowIndex) => {
    const values = researchCsvLine(line),
      get = (key) => String(values[indexes[key]] ?? '').trim(),
      fail = (message) => {
        throw new Error('CSV row ' + (rowIndex + 2) + ': ' + message);
      },
      productName = get('productName'),
      adviceName = get('adviceName'),
      exchangeName = get('exchangeName').toUpperCase(),
      strategyName = get('strategyName'),
      intradayText = get('ifIntraday').toUpperCase(),
      ifIntraday = ['YES', 'Y', 'TRUE'].includes(intradayText)
        ? 'YES'
        : ['NO', 'N', 'FALSE'].includes(intradayText)
          ? 'NO'
          : '',
      priceType = get('priceType').toUpperCase(),
      buyOrSell = get('buyOrSell').toUpperCase(),
      instrument = get('instrument').toUpperCase(),
      ceText = get('ceOrPe').toUpperCase(),
      contractName = get('contractName').toUpperCase(),
      contractExpiryDate = get('contractExpiryDate'),
      entryPriceStart = Number(get('entryPriceStart')),
      entryPriceEnd = Number(get('entryPriceEnd')),
      lot = Number(get('lot')),
      targetPrice = Number(get('targetPrice')),
      stopLoss = Number(get('stopLoss')),
      exitText = get('exitPrice'),
      exitPrice = exitText ? Number(exitText) : '',
      strikeText = get('optionStrikePrice'),
      legId = get('legId'),
      isOption = RESEARCH_OPTION_INSTRUMENTS.includes(instrument);
    // CARE PaRRVA Strategy API rules (RA API document 0.0.3, section 6).
    if (
      [productName, adviceName, strategyName, priceType, buyOrSell, contractName, legId].some(
        (value) => !value,
      )
    )
      fail(
        'ProductName, AdviceName, StrategyName, PriceType, BuyOrSell, ContractName and LegId are required.',
      );
    if (!['NSE', 'BSE'].includes(exchangeName)) fail('ExchangeName must be NSE or BSE.');
    if (!ifIntraday) fail('IfIntraday must be YES or NO.');
    if (!['PR', 'CMP', 'FP'].includes(priceType)) fail('PriceType must be PR, CMP or FP.');
    if (!['BUY', 'SELL'].includes(buyOrSell)) fail('BuyOrSell must be BUY or SELL.');
    if (!RESEARCH_INSTRUMENTS[exchangeName]?.includes(instrument))
      fail(
        'Instrument must be ' +
          (RESEARCH_INSTRUMENTS[exchangeName] || RESEARCH_INSTRUMENTS.NSE).join(', ') +
          ' for ' +
          (exchangeName || 'NSE') +
          '.',
      );
    let ceOrPe = null,
      optionStrikePrice = null;
    if (isOption) {
      if (!['CE', 'PE'].includes(ceText)) fail('CEorPE must be CE or PE for options.');
      ceOrPe = ceText;
      optionStrikePrice = Number(strikeText);
      if (!strikeText || !Number.isFinite(optionStrikePrice) || optionStrikePrice <= 0)
        fail('OptionStrikePrice must be a positive number for options.');
    } else if (!['', 'NULL'].includes(ceText) || !['', 'NULL'].includes(strikeText.toUpperCase()))
      fail('Leave CEorPE and OptionStrikePrice empty for futures.');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(contractExpiryDate) ||
      !Number.isFinite(Date.parse(contractExpiryDate))
    )
      fail('ContractExpiryDate must be a date in YYYY-MM-DD format.');
    if (contractExpiryDate < researchDefaultPublished().slice(0, 10))
      fail('ContractExpiryDate is in the past.');
    if (!Number.isSafeInteger(lot) || lot < 1) fail('Lot must be a positive whole number.');
    if (
      !Number.isFinite(entryPriceStart) ||
      entryPriceStart <= 0 ||
      !Number.isFinite(entryPriceEnd) ||
      entryPriceEnd <= 0
    )
      fail('EntryPriceStart and EntryPriceEnd must be positive numbers.');
    if (buyOrSell === 'BUY' && entryPriceStart > entryPriceEnd)
      fail('for BUY, EntryPriceStart is the lower price (start must not exceed end).');
    if (buyOrSell === 'SELL' && entryPriceStart < entryPriceEnd)
      fail('for SELL, EntryPriceStart is the higher price (start must not be below end).');
    if (
      !Number.isFinite(targetPrice) ||
      targetPrice <= 0 ||
      !Number.isFinite(stopLoss) ||
      stopLoss <= 0
    )
      fail('TargetPrice and StopLoss must be positive numbers.');
    if (exitPrice !== '' && (!Number.isFinite(exitPrice) || exitPrice <= 0))
      fail('ExitPrice must be blank or a positive number.');
    if (!/^\d{1,9}$/.test(legId) || Number(legId) < 1)
      fail('LegId must be a positive whole number.');
    const published = researchDefaultPublished();
    return {
      productName,
      adviceName,
      exchangeName,
      strategyName,
      ifIntraday,
      priceType,
      buyOrSell,
      instrument,
      ceOrPe,
      contractName,
      contractExpiryDate,
      entryPriceStart,
      entryPriceEnd,
      lot,
      targetPrice,
      stopLoss,
      exitPrice,
      optionStrikePrice,
      legId,
      product: productName,
      symbol: contractName,
      expiry: contractExpiryDate,
      strike: optionStrikePrice,
      option: ceOrPe,
      side: buyOrSell,
      lots: lot,
      lotSize: 1,
      quantity: lot,
      price: entryPriceStart,
      t1: targetPrice,
      t2: '',
      t3: '',
      published,
    };
  });
  // Rows sharing an AdviceName are one PaRRVA strategy: same strategy fields, unique LegIds.
  const strategies = new Map();
  rows.forEach((row, index) => {
    const first = strategies.get(row.adviceName);
    if (!first) return strategies.set(row.adviceName, { row, legs: new Set([row.legId]) });
    const line = 'CSV row ' + (index + 2) + ': ';
    if (
      ['productName', 'exchangeName', 'strategyName', 'ifIntraday'].some(
        (key) => first.row[key] !== row[key],
      )
    )
      throw new Error(
        line +
          'rows with AdviceName ' +
          row.adviceName +
          ' must have the same ProductName, ExchangeName, StrategyName and IfIntraday.',
      );
    if (first.legs.has(row.legId))
      throw new Error(
        line +
          'LegId ' +
          row.legId +
          ' is used more than once in AdviceName ' +
          row.adviceName +
          '.',
      );
    first.legs.add(row.legId);
  });
  return rows;
}
function researchCsvTable(rows) {
  return (
    '<div class="table-wrap"><table class="table research-csv-table"><thead><tr><th>Row</th>' +
    RESEARCH_IMPORT_COLUMNS.map(([, label]) => '<th>' + label + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows
      .map(
        (row, index) =>
          '<tr><td>' +
          (index + 1) +
          '</td>' +
          RESEARCH_IMPORT_COLUMNS.map(
            ([key]) => '<td>' + reportEscape(researchValue(row, key)) + '</td>',
          ).join('') +
          '</tr>',
      )
      .join('') +
    '</tbody></table></div>'
  );
}
function researchRenderCsvPreview() {
  const target = $('#researchCsvPreview'),
    message = $('#researchCsvMessage'),
    button = $('#researchCreateButton');
  if (!target) return;
  if (button) button.disabled = !researchCsvRows.length;
  if (message)
    message.textContent = researchCsvRows.length
      ? researchCsvRows.length + ' recommendation row(s) imported from ' + researchCsvFileName + '.'
      : 'Upload the 19-column CSV to generate recommendation rows.';
  target.innerHTML = researchCsvRows.length
    ? '<div class="research-csv-summary"><div><strong>' +
      reportEscape(researchCsvFileName) +
      '</strong><small>' +
      researchCsvRows.length +
      ' advice leg(s) ready for PDF</small></div><button type="button" class="btn secondary" id="researchClearCsv">Remove CSV</button></div>' +
      researchCsvTable(researchCsvRows)
    : '<div class="research-csv-empty"><strong>No advice-leg CSV uploaded</strong><span>Download the template, fill ProductName through LegId, and upload it here.</span></div>';
}
async function researchImportCsv(file) {
  const message = $('#researchCsvMessage');
  try {
    if (!file) throw new Error('Choose a CSV file.');
    if (file.size > 5 * 1024 * 1024) throw new Error('CSV file must be 5 MB or smaller.');
    if (!(
      file.name.toLowerCase().endsWith('.csv') ||
      file.type === 'text/csv' ||
      file.type === 'application/vnd.ms-excel'
    ))
      throw new Error('Upload a .csv file.');
    researchCsvRows = researchCsvRowsFromText(await file.text());
    researchCsvFileName = file.name;
    researchRenderCsvPreview();
  } catch (error) {
    researchCsvRows = [];
    researchCsvFileName = '';
    researchRenderCsvPreview();
    if (message) message.textContent = error.message;
  }
}
function researchOrdinal(day) {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) return day + 'th';
  return day + ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
}
function researchCodeDate(value) {
  const parts = String(value || '')
    .split('-')
    .map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part)))
    return String(value || '');
  const [year, month, day] = parts,
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return researchOrdinal(day) + ' ' + (months[month - 1] || '') + ' ' + year;
}
function researchUnifiedCode(row) {
  return [row.symbol, researchCodeDate(row.expiry), row.strike, row.option, row.side].join(' - ');
}
function researchOwner(r) {
  return reportAllowed() && (state.role === 'admin' || r.authorId === state.user.uid);
}
function researchCanView(r) {
  return researchOwner(r) || (state.role === 'client' && r.recipients.includes(state.user.uid));
}
const researchClientRows = () =>
  researchClients.map((c) => ({
    uid: c.id,
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
function researchAttachmentCards(files, removable = false) {
  return files
    .map(
      (file, index) =>
        '<article class="research-attachment-card"><span class="research-attachment-slot">Upload ' +
        (Number.isInteger(file.slot) ? file.slot + 1 : index + 1) +
        '</span>' +
        (file.type.startsWith('image/')
          ? '<img src="' + file.data + '" alt="' + reportEscape(file.name) + ' preview">'
          : '<span class="research-file-icon" aria-hidden="true">PDF</span>') +
        '<div><strong>' +
        reportEscape(file.name) +
        '</strong><small>' +
        reportEscape(file.type) +
        ' · ' +
        Math.max(1, Math.round(file.size / 1024)) +
        ' KB</small></div>' +
        (removable
          ? '<button type="button" class="btn secondary" data-remove-attachment="' +
            file.id +
            '">Remove</button>'
          : '<a class="btn secondary" href="' +
            file.data +
            '" download="' +
            reportEscape(file.name) +
            '">Open</a>') +
        '</article>',
    )
    .join('');
}
function researchRenderAttachments() {
  const list = $('#researchAttachmentList'),
    message = $('#researchAttachmentMessage');
  if (!list) return;
  const file = researchDraftAttachments[researchAttachmentTab],
    ready = researchDraftAttachments.filter(Boolean).length;
  document.querySelectorAll('[data-attachment-tab]').forEach((button, index) => {
    const selected = index === researchAttachmentTab;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', selected);
    button.querySelector('.research-upload-state').textContent = researchDraftAttachments[index]
      ? 'Ready'
      : 'Empty';
  });
  list.innerHTML = file
    ? researchAttachmentCards([file], true)
    : '<div class="research-attachment-empty"><strong>Upload ' +
      (researchAttachmentTab + 1) +
      ' is empty</strong><span>Choose, drag and drop, or paste an image into this tab.</span></div>';
  if (message) message.textContent = ready + ' of 3 upload tabs ready.';
}
function researchReadFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: 'FILE-' + crypto.randomUUID(),
        name: file.name || 'pasted-image.png',
        type: file.type || 'application/octet-stream',
        size: file.size,
        data: reader.result,
        file,
      });
    reader.onerror = () => reject(new Error('Could not read ' + file.name + '.'));
    reader.readAsDataURL(file);
  });
}
async function researchAddAttachments(files) {
  const message = $('#researchAttachmentMessage'),
    file = [...files].find(Boolean);
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error(file.name + ' is larger than 5 MB.');
    if (!(file.type.startsWith('image/') || file.type === 'application/pdf'))
      throw new Error(file.name + ' must be an image or PDF.');
    const uploaded = await researchReadFile(file);
    uploaded.slot = researchAttachmentTab;
    researchDraftAttachments[researchAttachmentTab] = uploaded;
    researchRenderAttachments();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}
async function researchLoadAttachmentData(report) {
  await Promise.all(
    (report.attachments || [])
      .filter((file) => !file.data && file.path)
      .map(async (file) => {
        if (!researchAttachmentUrls.has(file.path))
          researchAttachmentUrls.set(
            file.path,
            URL.createObjectURL(await Api.downloadFile(file.path)),
          );
        file.data = researchAttachmentUrls.get(file.path);
      }),
  );
}
function researchSectionsTable(r) {
  return (
    '<div class="table-wrap"><table class="table research-analysis-table"><thead><tr><th>Research section</th><th>Details</th></tr></thead><tbody>' +
    RESEARCH_SECTIONS.map(
      (name) =>
        '<tr><th scope="row">' + name + '</th><td>' + reportEscape(r.sections[name]) + '</td></tr>',
    ).join('') +
    '</tbody></table></div>'
  );
}
function researchHistory() {
  const list = researchReports.filter(
    (r) => researchCanView(r) && (state.role === 'client' || r.segment !== 'Cash'),
  );
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
          (r.segment === 'Cash'
            ? 'Cash ' + reportEscape(r.cashProduct) + ' · ' + r.cashRows.length + ' stocks'
            : r.rows.length + ' recommendations') +
          ' · ' +
          reportEscape(r.ref) +
          '</small></td><td>' +
          reportEscape(r.created) +
          '</td><td>' +
          (r.recipients.length
            ? r.recipients.length + ' clients · ' + reportEscape(r.sent)
            : r.esignStatus === 'Signed'
              ? 'eSigned · not sent'
              : 'Not signed') +
          (state.role !== 'client' && r.segment !== 'Cash'
            ? '<small>CARE PaRRVA: ' +
              reportEscape(
                r.parrvaStatus === 'Submitted' ? 'submitted ' + r.parrvaSubmitted : r.parrvaStatus,
              ) +
              '</small>'
            : '') +
          '</td><td><button type="button" class="btn secondary" data-research-pdf-view="' +
          r.id +
          '">View PDF</button> <button type="button" class="btn secondary" data-research-pdf="' +
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
    ['t1', 'T1', 'number', 'First target price'],
    ['t2', 'T2', 'number', 'Second target price'],
    ['t3', 'T3', 'number', 'Third target price'],
    ['published', 'Published date', 'datetime-local', 'Defaults to today (IST)'],
  ];
  return (
    '<section class="research-entry"><div class="research-entry-head"><h4>Leg <span class="research-row-number"></span></h4><button type="button" class="btn secondary" data-remove-research-row>Remove</button></div><div class="research-entry-grid">' +
    fields
      .map(
        ([key, label, type, placeholder]) =>
          '<label class="field">' +
          label +
          (['t1', 't2', 't3'].includes(key) ? ' <small>(optional)</small>' : '') +
          '<input name="' +
          key +
          '" type="' +
          type +
          '" placeholder="' +
          placeholder +
          '" ' +
          (key === 'quantity' ? 'readonly' : ['t1', 't2', 't3'].includes(key) ? '' : 'required') +
          (key === 'published' ? ' value="' + researchDefaultPublished() + '"' : '') +
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
    '<article class="card panel"><div class="research-workflow-header"><h3>Create Multi research report</h3><span class="badge">Multi</span></div><div class="research-steps"><span>1. Legs & research</span><span>2. Preview & choose recipients</span><span>3. Sign with Aadhaar & send</span><span>4. Manage positions</span></div><form id="researchCreate"><div class="form-grid"><label class="field">Report title<input name="title" required maxlength="150" placeholder="Enter report title"></label><label class="field">Product<input value="Multi" readonly></label></div><h3>Multi recommendations</h3><p class="research-notice">Enter the first leg, then use Add leg to duplicate it and modify only the required fields. T1, T2 and T3 are optional. Published date defaults to today in IST; delivery date, sign stamp, status and closed date appear after report generation.</p><div id="researchEntries">' +
    researchEntry() +
    '</div><button type="button" class="btn secondary" id="researchAddRow">+ Add leg</button><section class="research-attachments"><div class="research-attachments-heading"><div><h4>Attachments</h4><p>Three upload tabs are available. Uploaded images are shown inside the downloaded report PDF.</p></div><strong>3 slots</strong></div><div class="research-upload-tabs" role="tablist" aria-label="Attachment uploads">' +
    [1, 2, 3]
      .map(
        (number, index) =>
          '<button type="button" role="tab" data-attachment-tab="' +
          index +
          '" aria-selected="' +
          (index === 0) +
          '" class="' +
          (index === 0 ? 'is-active' : '') +
          '"><span>Upload ' +
          number +
          '</span><small class="research-upload-state">Empty</small></button>',
      )
      .join('') +
    '</div><div class="research-upload-panel" role="tabpanel"><div id="researchDropzone" class="research-dropzone" tabindex="0"><input id="researchFileInput" type="file" accept="image/*,.pdf,application/pdf" hidden><button type="button" class="btn secondary" id="researchChooseFiles">Choose file</button><p>Drag and drop an image or PDF here, or paste an image with Ctrl+V.</p><small>One file per tab, maximum 5 MB.</small></div><p id="researchAttachmentMessage" class="research-message" role="status"></p><div id="researchAttachmentList" class="research-attachment-list"></div></div></section><div class="form-grid research-section">' +
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
function researchAttachmentsMarkup() {
  return (
    '<section class="research-attachments"><div class="research-attachments-heading"><div><h4>Attachments</h4><p>Everything after the CSV import stays the same. Add up to three images or PDFs; uploaded images appear in the generated report PDF.</p></div><strong>3 slots</strong></div><div class="research-upload-tabs" role="tablist" aria-label="Attachment uploads">' +
    [1, 2, 3]
      .map(
        (number, index) =>
          '<button type="button" role="tab" data-attachment-tab="' +
          index +
          '" aria-selected="' +
          (index === 0) +
          '" class="' +
          (index === 0 ? 'is-active' : '') +
          '"><span>Upload ' +
          number +
          '</span><small class="research-upload-state">Empty</small></button>',
      )
      .join('') +
    '</div><div class="research-upload-panel" role="tabpanel"><div id="researchDropzone" class="research-dropzone" tabindex="0"><input id="researchFileInput" type="file" accept="image/*,.pdf,application/pdf" hidden><button type="button" class="btn secondary" id="researchChooseFiles">Choose file</button><p>Drag and drop an image or PDF here, or paste an image with Ctrl+V.</p><small>One file per tab, maximum 5 MB.</small></div><p id="researchAttachmentMessage" class="research-message" role="status"></p><div id="researchAttachmentList" class="research-attachment-list"></div></div></section>'
  );
}
researchPage = function () {
  return (
    '<article class="card panel"><div class="research-workflow-header"><div><p class="overline">Research workspace</p><h3>Create Multi Segment report</h3></div><span class="badge">Multi</span></div><div class="research-steps"><span>1. Upload CSV & research</span><span>2. Preview & choose recipients</span><span>3. Sign with Aadhaar & send</span><span>4. Manage positions</span></div><form id="researchCreate"><div class="form-grid"><label class="field">Report title<input name="title" required maxlength="150" placeholder="Enter report title"></label><label class="field">Product<input value="Multi" readonly></label></div><section class="research-csv-import"><div class="research-csv-heading"><div><p class="overline">Multi recommendations</p><h3>Upload advice-leg CSV</h3><p>Upload the exact 19-column format from ProductName through LegId. Each CSV row becomes one recommendation in the preview, PDF and Positions. Published date is stamped automatically at import time.</p></div><a class="btn secondary" href="multi-recommendations-template.csv" download>Download 19-column template</a></div><label class="research-csv-upload" for="researchCsvInput"><span class="research-csv-icon">CSV</span><strong>Choose advice-leg CSV</strong><small>CSV only · 19 required headers · maximum 5 MB · up to 50 rows</small><input id="researchCsvInput" type="file" accept=".csv,text/csv"></label><p id="researchCsvMessage" class="research-message" role="status">Upload the 19-column CSV to generate recommendation rows.</p>' +
    (typeof multiQuickInputMarkup === 'function' ? multiQuickInputMarkup() : '') +
    '<div id="researchCsvPreview"></div></section>' +
    researchAttachmentsMarkup() +
    '<div class="form-grid research-section">' +
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
    '</div><p id="researchCreateMessage" class="research-message research-error" role="alert"></p><button id="researchCreateButton" class="btn primary" disabled>Create & preview PDF</button></form></article><section id="researchPreview"></section><section id="researchHistory">' +
    researchHistory() +
    '</section>'
  );
};
function researchReadRows(form) {
  if (!researchCsvRows.length) throw new Error('Upload a valid Multi recommendations CSV file.');
  return researchCsvRows.map((row) => ({
    id: 'POS-' + crypto.randomUUID(),
    ...row,
    delivered: '',
    signed: '',
    status: 'Generated',
    statusHistory: [],
    closedLots: 0,
    closedQty: 0,
    remainingLots: row.lots,
    remainingQty: row.quantity,
    closingPrice: 0,
    lastExit: '',
    closedAt: '',
    exits: [],
  }));
}
const researchSignKey = () => 'sampadha.v2.esignMobile.' + state.user.uid;
function researchRememberedMobile() {
  try {
    return localStorage.getItem(researchSignKey()) || '';
  } catch {
    return '';
  }
}
function researchRememberMobile(value) {
  try {
    localStorage.setItem(researchSignKey(), value);
  } catch {
    /* storage unavailable: the field just won't be prefilled next time */
  }
}
// Unsigned: choose CARE PaRRVA and clients first, then one button signs and, once the signature is
// confirmed, sends. Signed: the signature, then the send form for anything not sent yet.
function researchSignPanel(r) {
  const signed = r.esignStatus === 'Signed',
    clients = '<section id="researchClientSection" class="research-section"></section>',
    sign =
      '<article class="card panel research-section"><h3>Aadhaar eSign</h3>' +
      (signed
        ? '<p class="research-notice">Signed with Aadhaar eSign by <strong>' +
          reportEscape(r.signerName) +
          '</strong> on ' +
          reportEscape(r.signed) +
          '. Clients receive this signed PDF.</p>'
        : '<p class="research-notice">Sign the PDF above with your Aadhaar. You will be taken to the secure NSDL eSign page; the OTP goes to the mobile number linked to your Aadhaar. As soon as the signature is confirmed, the report is sent to what you chose above. If the eSign page ends on the signed PDF instead of bringing you back, return to this report and click Check signing status: sending continues from there.</p><form id="researchSignForm" data-report="' +
          reportEscape(r.id) +
          '" class="research-signing"><label class="research-check"><input type="checkbox" name="consent">I have reviewed this report and will sign it with my Aadhaar eSign.</label><label class="field">Your mobile number<input name="mobile" type="tel" inputmode="numeric" autocomplete="tel" maxlength="14" required placeholder="10-digit mobile" value="' +
          reportEscape(researchRememberedMobile()) +
          '"></label><div class="research-filter-bar"><button class="btn primary" id="researchSignButton">Sign with Aadhaar & send</button><button type="button" class="btn secondary" data-esign-check="' +
          reportEscape(r.id) +
          '">Check signing status</button></div><p id="researchSignStatus" class="research-message" role="status">' +
          (r.esignStatus === 'Requested'
            ? 'A signing request is open. Finish it on the eSign page, or start again.'
            : 'Not signed yet.') +
          '</p></form>') +
      '</article>';
  return signed ? sign + clients : clients + sign;
}
// The sign button says what it will do: sign only, or sign and send.
function researchSignLabel() {
  const button = $('#researchSignButton'),
    form = $('#researchSend');
  if (!button || !form) return;
  const plan = researchSendChoices(form).plan;
  button.textContent = sendPlanHasWork(plan) ? 'Sign with Aadhaar & send' : 'Sign with Aadhaar eSign';
}
async function researchConfirmSign(reportId) {
  const status = $('#researchSignStatus');
  if (status) status.textContent = 'Confirming the signature...';
  const result = await Api.esignVerify(reportId);
  await refreshWorkspace();
  if (result.status !== 'Signed') {
    if ($('#researchSignStatus'))
      $('#researchSignStatus').textContent =
        result.message ||
        'The signature is not confirmed yet. Finish signing, then use Check signing status.';
    return;
  }
  researchShow([reportId]);
  $('#researchHistory').innerHTML = researchHistory();
  toast('Report signed with Aadhaar eSign.', 'seal');
  // One-click Sign & Send: send what was chosen before signing, now that the signature is confirmed.
  const plan = sendPlanTake(reportId),
    r = researchReports.find((x) => x.id === reportId);
  if (!plan || !r) return;
  if ($('#researchSendMessage')) $('#researchSendMessage').textContent = 'Signed. Sending now...';
  await researchDispatch(r, plan).catch((error) => {
    researchOpenClients(researchReports.find((x) => x.id === reportId) || r);
    $('#researchSendMessage').textContent =
      error.message + ' Check the choices below and press Send to try again.';
  });
}
// One-click Sign & Send: what the analyst chose to send is kept (in this browser, for a day)
// while they sign on the eSign page, and is sent once the signature is confirmed. Read once, so
// a reload never sends twice. Shared with cash-segment.js.
const SEND_PLAN_KEY = 'sampadha-send-plan:';
const SEND_PLAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const sendPlanHasWork = (plan) => Boolean(plan && (plan.toParrva || plan.ids.length));
function sendPlanSave(reportId, plan) {
  try {
    if (sendPlanHasWork(plan))
      localStorage.setItem(SEND_PLAN_KEY + reportId, JSON.stringify({ ...plan, at: Date.now() }));
    else localStorage.removeItem(SEND_PLAN_KEY + reportId);
  } catch {
    /* storage unavailable: the analyst sends with the Send button after signing */
  }
}
function sendPlanTake(reportId) {
  try {
    const plan = JSON.parse(localStorage.getItem(SEND_PLAN_KEY + reportId) || 'null');
    localStorage.removeItem(SEND_PLAN_KEY + reportId);
    return sendPlanHasWork(plan) && Date.now() - plan.at < SEND_PLAN_MAX_AGE_MS ? plan : null;
  } catch {
    return null;
  }
}
// Signing happens on the gateway's hosted page; it sends the signer back to this address.
const ESIGN_RETURN_PARAM = 'esign_report';
async function researchStartSign(r, form) {
  const status = $('#researchSignStatus'),
    buttons = form.querySelectorAll('button');
  const choices = $('#researchSend') ? researchSendChoices($('#researchSend')) : { plan: null };
  if (choices.error) {
    status.textContent = choices.error;
    return;
  }
  if (!form.elements.consent.checked) {
    status.textContent = 'Tick the confirmation to continue.';
    return;
  }
  buttons.forEach((b) => (b.disabled = true));
  try {
    sendPlanSave(r.id, choices.plan);
    status.textContent = 'Preparing the PDF for signing...';
    await Api.uploadPreviewPdf(r.id, await createResearchPdfBlob(r));
    status.textContent = 'Opening the eSign page...';
    const returnUrl = new URL(
      location.pathname,
      location.protocol === 'https:' ? location.origin : window.SAMPADHA_CONFIG.liveSiteUrl,
    );
    returnUrl.searchParams.set(ESIGN_RETURN_PARAM, r.id);
    const start = await Api.esignStart(r.id, form.elements.mobile.value, returnUrl.href);
    researchRememberMobile(form.elements.mobile.value.trim());
    location.href = start.url;
  } catch (error) {
    if ($('#researchSignStatus')) $('#researchSignStatus').textContent = error.message;
    buttons.forEach((b) => (b.disabled = false));
  }
}
// Back from the eSign page: reopen the report and confirm the signature with the server.
async function researchResumeSign() {
  const params = new URLSearchParams(location.search),
    reportId = params.get(ESIGN_RETURN_PARAM);
  if (!reportId) return;
  params.delete(ESIGN_RETURN_PARAM);
  history.replaceState(null, '', location.pathname + (params.size ? '?' + params : ''));
  const r = researchReports.find(
    (x) => x.id === reportId && researchOwner(x) && x.segment !== 'Cash',
  );
  if (!r) return;
  show('multiReports');
  researchShow([r.id]);
  $('#researchPreview').scrollIntoView({ block: 'start' });
  if (r.esignStatus !== 'Signed')
    await researchConfirmSign(r.id).catch((error) => {
      if ($('#researchSignStatus')) $('#researchSignStatus').textContent = error.message;
    });
}
function researchReleasePdfPreview() {
  if (researchPdfPreviewUrl) {
    URL.revokeObjectURL(researchPdfPreviewUrl);
    researchPdfPreviewUrl = '';
  }
}
function researchPdfPanel(r) {
  return (
    '<article class="card panel research-section research-pdf-shell"><div class="research-workflow-header"><div><p class="overline">Report preview</p><h3>View PDF</h3><p>The report PDF appears here above the Aadhaar eSign step.</p></div><button type="button" class="btn secondary" data-research-pdf="' +
    r.id +
    '">Download PDF</button></div><p id="researchPdfStatus" class="research-message" role="status">Generating PDF preview...</p><iframe id="researchPdfViewer" data-report="' +
    r.id +
    '" title="' +
    reportEscape(r.title) +
    ' PDF preview"></iframe></article>'
  );
}
// Signed reports show the PDF returned by the eSign service; unsigned drafts show the local preview.
const researchPdfBlob = (r) =>
  r.esignStatus === 'Signed' ? Api.downloadFile(r.signedPdfPath) : createResearchPdfBlob(r);
async function researchRefreshPdfFrame(r) {
  const viewer = $('#researchPdfViewer'),
    status = $('#researchPdfStatus');
  if (!viewer || viewer.dataset.report !== r.id) return;
  if (status) status.textContent = 'Generating PDF preview...';
  const blob = await researchPdfBlob(r);
  if (!$('#researchPdfViewer') || $('#researchPdfViewer').dataset.report !== r.id) return;
  researchReleasePdfPreview();
  researchPdfPreviewUrl = URL.createObjectURL(blob);
  $('#researchPdfViewer').src = researchPdfPreviewUrl + '#toolbar=1&navpanes=0';
  if ($('#researchPdfStatus'))
    $('#researchPdfStatus').textContent =
      r.esignStatus === 'Signed'
        ? 'Aadhaar eSigned PDF.'
        : 'Unsigned preview. This is the PDF you will sign.';
}
function researchShow(ids) {
  const r = researchReports.find((r) => ids.includes(r.id) && researchCanView(r));
  if (!r) return;
  researchReleasePdfPreview();
  $('#researchPreview').innerHTML =
    researchPdfPanel(r) + (researchOwner(r) ? researchSignPanel(r) : '');
  researchRefreshPdfFrame(r).catch((error) => {
    if ($('#researchPdfStatus'))
      $('#researchPdfStatus').textContent = 'PDF preview could not be generated: ' + error.message;
  });
  if (researchOwner(r)) researchOpenClients(r);
}
function researchParrvaChoice(r) {
  if (r.parrvaStatus === 'Submitted')
    return (
      '<p class="research-parrva research-parrva-done"><strong>CARE PaRRVA:</strong> submitted on ' +
      reportEscape(r.parrvaSubmitted) +
      '.</p>'
    );
  const strategies = new Set(r.rows.map((row) => row.adviceName)).size;
  return (
    '<div class="research-parrva"><label class="research-check"><input type="checkbox" name="parrva" checked>Send to CARE PaRRVA (Strategy API, ' +
    strategies +
    (strategies === 1 ? ' strategy, ' : ' strategies, ') +
    r.rows.length +
    ' legs)</label>' +
    (r.parrvaStatus === 'Failed'
      ? '<p class="research-message research-error">Last attempt failed: ' +
        reportEscape(r.parrvaMessage) +
        '</p>'
      : '') +
    '</div>'
  );
}
function researchClientSection(r) {
  const signed = r.esignStatus === 'Signed';
  return (
    '<article class="card panel"><h3>' +
    (signed ? 'Send to CARE PaRRVA & clients' : 'Where should this report go?') +
    '</h3><p class="research-notice">' +
    (signed
      ? 'Report signed. Choose CARE PaRRVA, clients, or both.'
      : 'Choose now; it is sent automatically as soon as your Aadhaar signature is confirmed.') +
    ' When both are chosen, CARE PaRRVA is sent first and clients receive the report only if it is accepted.</p><form id="researchSend" data-report="' +
    r.id +
    '">' +
    researchParrvaChoice(r) +
    '<p class="research-notice">Clients: select product types to show their subscribed clients.</p><div class="research-filter-bar"><button type="button" class="btn secondary" id="researchSelectAll">Select visible clients</button><button type="button" class="btn secondary" id="researchClearAll">Clear checkboxes</button>' +
    MULTI_TYPES.map(
      (name) =>
        '<label class="research-check research-type-check"><input type="checkbox" name="category" value="' +
        name +
        '">' +
        name +
        '</label>',
    ).join('') +
    '</div><p class="research-notice">Clients marked ⇄ broker auto-email have consented: their broker also receives these legs as an order email.</p><p id="researchClientCount" role="status">Choose a product type to show clients.</p><div id="researchClientList" class="research-client-grid"></div><label class="field">Or type matching client IDs / email addresses<textarea class="research-textarea" name="recipients" rows="2" placeholder="Enter IDs or emails for the selected product types"></textarea></label><p id="researchSendMessage" class="research-message" role="status"></p>' +
    (signed ? '<button class="btn primary">Send</button>' : '') +
    '</form></article>'
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
        c.id +
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
        (typeof brokerAutoEmailActive === 'function' && brokerAutoEmailActive(c.uid)
          ? ' · ⇄ broker auto-email'
          : '') +
        (typeof complianceNote === 'function' ? reportEscape(complianceNote(c.uid, 'Multi')) : '') +
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
    researchSignLabel();
  });
  form.addEventListener('input', researchSignLabel);
  $('#researchSelectAll').onclick = () => {
    form.querySelectorAll('[name=client]').forEach((x) => (x.checked = true));
    researchSignLabel();
  };
  $('#researchClearAll').onclick = () => {
    form.querySelectorAll('[name=client]').forEach((x) => (x.checked = false));
    form.elements.recipients.value = '';
    $('#researchSendMessage').textContent = '';
    researchSignLabel();
  };
  researchFilterClients();
  researchSignLabel();
}
async function researchSendReport(r, selected, types) {
  if (r.esignStatus !== 'Signed') throw new Error('Complete the Aadhaar eSign before sending.');
  const result = await Api.sendReport(r.id, selected, types);
  await refreshWorkspace();
  return result.delivered;
}
// What the send form asks for: { plan: { toParrva, ids, types } } or { error }.
function researchSendChoices(form) {
  const d = new FormData(form),
    toParrva = !!form.elements.parrva?.checked,
    types = d.getAll('category'),
    eligible = new Set(researchEligible(types).map((c) => c.id)),
    selected = researchRecipients(d.get('recipients'), d.getAll('client'));
  if (selected.ids.length || selected.invalid.length) {
    if (!types.length) return { error: 'Choose Nano, Micro, Mini, Mega or Giga to show clients.' };
    if (selected.invalid.length)
      return { error: 'Unknown client IDs/emails: ' + selected.invalid.join(', ') };
    if (selected.ids.some((id) => !eligible.has(id)))
      return { error: 'Choose only clients subscribed to the selected product types.' };
  }
  return { plan: { toParrva, ids: selected.ids, types } };
}
// Sends a signed report as planned: CARE PaRRVA first, clients only once PaRRVA has accepted it.
// On failure the error message also says what had already gone out.
async function researchDispatch(r, plan) {
  const say = (text) => $('#researchSendMessage') && ($('#researchSendMessage').textContent = text),
    results = [];
  try {
    if (plan.toParrva) {
      say('Sending to CARE PaRRVA...');
      const parrva = await Api.parrvaSubmit(r.id);
      results.push(
        'CARE PaRRVA accepted ' +
          parrva.strategies +
          ' strategy record(s) with ' +
          parrva.legs +
          ' legs.',
      );
    }
    if (plan.ids.length) {
      say('Delivering to clients...');
      results.push(
        (await researchSendReport(r, plan.ids, plan.types)) + ' client deliveries recorded.',
      );
    } else await refreshWorkspace();
  } catch (error) {
    await refreshWorkspace().catch(() => {});
    $('#researchHistory').innerHTML = researchHistory();
    throw new Error((results.length ? results.join(' ') + ' ' : '') + error.message);
  }
  $('#researchClientSection').innerHTML =
    '<article class="card panel"><h3>Report sent</h3><p>' +
    results.join(' ') +
    (plan.ids.length
      ? ' ' + r.rows.length + ' recommendation positions are available in Positions.'
      : '') +
    '</p>' +
    (plan.ids.length
      ? '<button class="btn primary" data-go="researchOrders">Open Positions</button> '
      : '') +
    '<button class="btn secondary" data-research-pdf-view="' +
    reportEscape(r.id) +
    '">View report</button></article>';
  $('#researchHistory').innerHTML = researchHistory();
  toast(results.join(' '), 'seal');
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
function researchOrderClientIds(order) {
  const logins = new Map(researchClients.map((c) => [c.id, c.login_id]));
  return (researchReports.find((report) => report.id === order.reportId)?.recipients || []).map(
    (id) => logins.get(id) || state.ws?.idToLogin.get(id) || id.slice(0, 8),
  );
}
function researchPositionMatches(order) {
  const clients = researchOrderClientIds(order),
    filters = researchPositionFilters;
  return (
    (!filters.clients.length || clients.some((id) => filters.clients.includes(id))) &&
    (!filters.products.length || filters.products.includes(order.row.product)) &&
    (!filters.symbols.length || filters.symbols.includes(order.row.symbol))
  );
}
function researchFilterDropdown(key, label, options) {
  const selected = researchPositionFilters[key],
    summary = selected.length ? selected.length + ' selected' : 'All';
  return (
    '<details class="research-filter-dropdown" data-filter-details="' +
    key +
    '"><summary><span>' +
    label +
    '</span><strong>' +
    summary +
    '</strong></summary><div class="research-filter-options">' +
    options
      .map(
        (option) =>
          '<label><input type="checkbox" data-position-filter="' +
          key +
          '" value="' +
          reportEscape(option) +
          '" ' +
          (selected.includes(option) ? 'checked' : '') +
          '><span>' +
          reportEscape(option) +
          '</span></label>',
      )
      .join('') +
    (options.length ? '' : '<p>No options available</p>') +
    '</div></details>'
  );
}
async function researchCloseOrder(id, lots, price) {
  if (!reportAllowed()) throw new Error('Research workspace access required.');
  const order = researchVisibleOrders().find((o) => o.row.id === id);
  if (!order || order.row.status === 'Closed')
    throw new Error('This order is already closed or unavailable.');
  const closeLots = Number(lots),
    exitPrice = Number(price);
  if (!Number.isSafeInteger(closeLots) || closeLots < 1)
    throw new Error('No. of lots must be a positive whole number.');
  if (closeLots > order.row.remainingLots)
    throw new Error(
      'No. of lots cannot exceed the remaining ' + order.row.remainingLots + ' lot(s).',
    );
  if (!Number.isFinite(exitPrice) || exitPrice <= 0)
    throw new Error('Enter a valid closing price.');
  await Api.closeLeg(id, closeLots, exitPrice);
  await refreshWorkspace();
  return researchVisibleOrders().find((o) => o.row.id === id).row;
}
function researchOrdersPage() {
  if (!reportAllowed())
    return '<article class="card panel">Research workspace access required.</article>';
  const all = researchVisibleOrders(),
    views = ['Open', 'Partially Closed', 'Closed'];
  const unique = (values) =>
    [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
  const filterOptions = {
    clients: unique(all.flatMap(researchOrderClientIds)),
    products: unique(all.map((order) => order.row.product)),
    symbols: unique(all.map((order) => order.row.symbol)),
  };
  const filteredAll = all.filter(researchPositionMatches),
    rows = filteredAll.filter((order) => order.row.status === researchOrderFilter);
  const money = (value) =>
    value
      ? '₹' +
        Number(value).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : '—';
  const exits = filteredAll
    .flatMap((order) => (order.row.exits || []).map((exit) => ({ order, row: order.row, exit })))
    .sort((a, b) => b.exit.recordedAt - a.exit.recordedAt);
  const filters =
    '<section class="research-position-filters" aria-label="Position filters"><div><p class="overline">Filter positions</p><h4>Clients, products and symbols</h4><small>Select one or more values in each dropdown. Filters work together.</small></div>' +
    researchFilterDropdown('clients', 'Clients', filterOptions.clients) +
    researchFilterDropdown('products', 'Product', filterOptions.products) +
    researchFilterDropdown('symbols', 'Symbol', filterOptions.symbols) +
    '<button type="button" class="btn secondary" id="researchClearPositionFilters">Clear filters</button></section>';
  const history =
    '<h4 class="research-section">Position exit history</h4><p class="research-notice">Every partial or full close is retained as a separate timestamped record. The same filters apply to this history.</p><div class="table-wrap"><table class="table research-exit-history"><thead><tr><th>Client IDs</th><th>Exit reference</th><th>Unified code</th><th>Symbol</th><th>Expiry date</th><th>Strike price</th><th>Option type</th><th>Buy/Sell</th><th>Exit #</th><th>Closing price</th><th>No. of lots</th><th>Exit quantity</th><th>Remaining lots</th><th>Remaining quantity</th><th>Status</th><th>Timestamp</th></tr></thead><tbody>' +
    exits
      .map(
        (item) =>
          '<tr><td>' +
          reportEscape(researchOrderClientIds(item.order).join(', ') || '—') +
          '</td><td>' +
          reportEscape(item.exit.id) +
          '</td><td><code>' +
          reportEscape(researchUnifiedCode(item.row)) +
          '</code></td><td>' +
          reportEscape(item.row.symbol) +
          '</td><td>' +
          reportEscape(researchCodeDate(item.row.expiry)) +
          '</td><td>' +
          reportEscape(item.row.strike) +
          '</td><td>' +
          reportEscape(item.row.option) +
          '</td><td>' +
          reportEscape(item.row.side) +
          '</td><td>' +
          item.exit.sequence +
          '</td><td>' +
          money(item.exit.price) +
          '</td><td>' +
          item.exit.lots +
          '</td><td>' +
          item.exit.quantity +
          '</td><td><strong>' +
          item.exit.remainingLotsAfter +
          '</strong></td><td><strong>' +
          item.exit.remainingAfter +
          '</strong></td><td>' +
          reportEscape(item.exit.statusAfter) +
          '</td><td>' +
          reportEscape(item.exit.at) +
          '</td></tr>',
      )
      .join('') +
    (!exits.length
      ? '<tr><td colspan="16" class="empty">No exits match the selected filters.</td></tr>'
      : '') +
    '</tbody></table></div>';
  const positionRows = rows
    .map((o) => {
      const remainingLots = Number(
        o.row.remainingLots ?? (o.row.remainingQty ?? o.row.quantity) / o.row.lotSize,
      );
      const action =
        o.row.status === 'Closed'
          ? '<span class="badge">Fully closed</span>'
          : '<form class="research-exit-form" data-close-order-form="' +
            o.row.id +
            '"><label>Closing price<input name="closingPrice" type="number" min="0.01" step="0.01" required placeholder="Price"></label><label>No. of lots<input name="closingLots" type="number" min="1" max="' +
            remainingLots +
            '" step="1" required placeholder="Max ' +
            remainingLots +
            '"></label><button class="btn secondary">Record exit</button><small class="research-exit-error" role="alert"></small></form>';
      return (
        '<tr><td>' +
        reportEscape(researchOrderClientIds(o).join(', ') || '—') +
        '</td>' +
        RESEARCH_COLUMNS.map(
          ([key]) => '<td>' + reportEscape(researchValue(o.row, key)) + '</td>',
        ).join('') +
        '<td>' +
        money(o.row.closingPrice) +
        '</td><td>' +
        reportEscape(o.row.closedLots || 0) +
        '</td><td><strong>' +
        reportEscape(remainingLots) +
        '</strong></td><td>' +
        reportEscape(o.row.remainingQty ?? o.row.quantity) +
        '</td><td>' +
        reportEscape(o.row.lastExit || '—') +
        '</td><td>' +
        action +
        '</td></tr>'
      );
    })
    .join('');
  return (
    '<article class="card panel"><div class="research-workflow-header"><div><h3>Positions</h3><p class="research-notice">Every imported CSV recommendation appears here with its client IDs and full details. Exits are entered by number of lots; every partial and full close retains its own timestamp. These are recommendation positions, not broker trades.</p></div><button class="btn secondary" data-go="multiReports">Create report</button></div>' +
    filters +
    '<div class="research-orders-tabs">' +
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
          filteredAll.filter((o) => o.row.status === view).length +
          ')</button>',
      )
      .join('') +
    '</div><p class="research-filter-result"><strong>' +
    rows.length +
    '</strong> ' +
    researchOrderFilter.toLowerCase() +
    ' position(s) match the selected filters.</p><h4>Multi recommendations</h4><div class="table-wrap"><table class="table research-order-table"><thead><tr><th>Client IDs</th>' +
    RESEARCH_COLUMNS.map(([, label]) => '<th>' + label + '</th>').join('') +
    '<th>Closing price</th><th>Closed lots</th><th>Remaining lots</th><th>Remaining quantity</th><th>Last exit</th><th>Action</th></tr></thead><tbody>' +
    positionRows +
    (!rows.length
      ? '<tr><td colspan="' +
        (RESEARCH_COLUMNS.length + 7) +
        '" class="empty">No ' +
        researchOrderFilter.toLowerCase() +
        ' positions match the selected filters.</td></tr>'
      : '') +
    '</tbody></table></div>' +
    history +
    '</article>'
  );
}
delete pages.reports;
pages.multiReports = researchPage;
pages.receivedReports = () =>
  '<section id="researchPreview"></section><section id="researchHistory">' +
  researchHistory() +
  '</section>';
pages.researchOrders = researchOrdersPage;
titles.researchOrders = 'Positions';
titles.receivedReports = 'Reports received';
delete titles.reports;
for (const role of ['ra', 'admin']) nav[role].push(['researchOrders', '▦', 'Positions']);
nav.client.push(['receivedReports', '▤', 'Reports received']);
const originalResearchShowPage = show;
show = function (page) {
  researchReleasePdfPreview();
  originalResearchShowPage(page);
  researchNumberRows();
  researchRenderAttachments();
  researchRenderCsvPreview();
};
const originalResearchEnterPortal = enterPortal;
enterPortal = async function (profile) {
  await originalResearchEnterPortal(profile);
  await researchResumeSign();
};
const originalResearchLogout = $('#logout').onclick;
$('#logout').onclick = () => {
  researchReleasePdfPreview();
  researchDraftAttachments = [null, null, null];
  researchAttachmentTab = 0;
  researchCsvRows = [];
  researchCsvFileName = '';
  researchPositionFilters = { clients: [], products: [], symbols: [] };
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
      const lots = form.elements.closingLots.value,
        row = await researchCloseOrder(
          form.dataset.closeOrderForm,
          lots,
          form.elements.closingPrice.value,
        );
      show('researchOrders');
      toast(
        row.remainingQty
          ? lots +
              ' lot(s) closed · ' +
              row.remainingLots +
              ' lot(s) / ' +
              row.remainingQty +
              ' quantity remaining. Exit history retained.'
          : 'All lots closed. Position moved to Closed and exit history retained.',
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
    let created = null;
    try {
      const title = String(d.get('title') || '').trim(),
        sections = Object.fromEntries(
          RESEARCH_SECTIONS.map((name) => [name, String(d.get(name) || '').trim()]),
        );
      if (!title || Object.values(sections).some((x) => !x))
        throw new Error('Enter a title and all four research sections.');
      const legs = researchReadRows(form).map((r) => ({
        ...Object.fromEntries(
          RESEARCH_IMPORT_COLUMNS.map(([key]) => [key, r[key] == null ? '' : String(r[key])]),
        ),
        // Contracts per lot: from the weekly master for Quick input, 1 for CSV uploads.
        lotSize: String(r.lotSize || 1),
      }));
      button.disabled = true;
      message.classList.remove('research-error');
      message.textContent = 'Saving report...';
      created = await Api.createDraft(title, sections, legs);
      for (const file of researchDraftAttachments.filter(Boolean))
        await Api.uploadAttachment(created.id, file.slot, file.file);
      researchDraftAttachments = [null, null, null];
      researchAttachmentTab = 0;
      researchCsvRows = [];
      researchCsvFileName = '';
      researchRenderAttachments();
      await refreshWorkspace();
      message.textContent =
        'Report created from the imported CSV. Review the PDF below, then sign it with Aadhaar eSign.';
      researchShow([created.id]);
      $('#researchHistory').innerHTML = researchHistory();
      $('#researchPreview').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      message.classList.add('research-error');
      message.textContent = created
        ? 'Report ' + created.report_ref + ' was saved, but an attachment failed: ' + error.message
        : error.message;
      if (created) {
        await refreshWorkspace().catch(() => {});
        $('#researchHistory').innerHTML = researchHistory();
      }
    } finally {
      button.disabled = false;
    }
  }
  if (e.target.id === 'researchSignForm') {
    e.preventDefault();
    const r = researchReports.find((r) => r.id === e.target.dataset.report);
    if (r && researchOwner(r)) await researchStartSign(r, e.target);
  }
  if (e.target.id === 'researchSend') {
    e.preventDefault();
    const form = e.target,
      r = researchReports.find((r) => r.id === form.dataset.report),
      message = $('#researchSendMessage'),
      button = form.querySelector('button:not([type=button])');
    if (!r || !researchOwner(r) || r.esignStatus !== 'Signed') return;
    const { plan, error } = researchSendChoices(form);
    if (error) {
      message.textContent = error;
      return;
    }
    if (!sendPlanHasWork(plan)) {
      message.textContent = 'Choose CARE PaRRVA, at least one client, or both.';
      return;
    }
    button.disabled = true;
    try {
      await researchDispatch(r, plan);
    } catch (failure) {
      message.textContent = failure.message;
      button.disabled = false;
    }
  }
});
$('#content').addEventListener('click', (e) => {
  const clearPositionFilters = e.target.closest('#researchClearPositionFilters');
  if (clearPositionFilters && reportAllowed()) {
    researchPositionFilters = { clients: [], products: [], symbols: [] };
    show('researchOrders');
    return;
  }
  const clearCsv = e.target.closest('#researchClearCsv');
  if (clearCsv && reportAllowed()) {
    researchCsvRows = [];
    researchCsvFileName = '';
    const input = $('#researchCsvInput');
    if (input) input.value = '';
    researchRenderCsvPreview();
    return;
  }
  const attachmentTab = e.target.closest('[data-attachment-tab]');
  if (attachmentTab && reportAllowed()) {
    researchAttachmentTab = Number(attachmentTab.dataset.attachmentTab);
    researchRenderAttachments();
    return;
  }
  const choose = e.target.closest('#researchChooseFiles');
  if (choose && reportAllowed()) {
    $('#researchFileInput')?.click();
    return;
  }
  const attachmentRemove = e.target.closest('[data-remove-attachment]');
  if (attachmentRemove && reportAllowed()) {
    const index = researchDraftAttachments.findIndex(
      (file) => file?.id === attachmentRemove.dataset.removeAttachment,
    );
    if (index >= 0) researchDraftAttachments[index] = null;
    researchRenderAttachments();
    return;
  }
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
  const view = e.target.closest('[data-research-pdf-view],[data-research-view]');
  if (view) {
    researchShow([view.dataset.researchPdfView || view.dataset.researchView]);
    return;
  }
  const filter = e.target.closest('[data-order-filter]');
  if (filter && reportAllowed()) {
    researchOrderFilter = filter.dataset.orderFilter;
    show('researchOrders');
    return;
  }
  const check = e.target.closest('[data-esign-check]');
  if (check && reportAllowed()) {
    check.disabled = true;
    researchConfirmSign(check.dataset.esignCheck)
      .catch((error) => {
        if ($('#researchSignStatus')) $('#researchSignStatus').textContent = error.message;
      })
      .finally(() => (check.disabled = false));
    return;
  }
  const download = e.target.closest('[data-research-pdf]');
  if (download) {
    const r = researchReports.find(
      (x) => x.id === download.dataset.researchPdf && researchCanView(x),
    );
    if (r)
      downloadResearchPdf(r).catch((error) => toast('PDF could not be created: ' + error.message));
  }
});
$('#content').addEventListener('change', (e) => {
  if (e.target.id === 'researchCsvInput' && reportAllowed()) {
    researchImportCsv(e.target.files[0]);
    e.target.value = '';
    return;
  }
  if (e.target.matches('[data-position-filter]') && reportAllowed()) {
    const key = e.target.dataset.positionFilter;
    researchPositionFilters[key] = [
      ...document.querySelectorAll('[data-position-filter="' + key + '"]:checked'),
    ].map((input) => input.value);
    show('researchOrders');
    const dropdown = document.querySelector('[data-filter-details="' + key + '"]');
    if (dropdown) dropdown.open = true;
    return;
  }
  if (e.target.id === 'researchFileInput' && reportAllowed()) {
    researchAddAttachments(e.target.files);
    e.target.value = '';
  }
});
$('#content').addEventListener('dragover', (e) => {
  const zone = e.target.closest('#researchDropzone');
  if (zone) {
    e.preventDefault();
    zone.classList.add('is-dragging');
  }
});
$('#content').addEventListener('dragleave', (e) => {
  const zone = e.target.closest('#researchDropzone');
  if (zone) zone.classList.remove('is-dragging');
});
$('#content').addEventListener('drop', (e) => {
  const zone = e.target.closest('#researchDropzone');
  if (!zone || !reportAllowed()) return;
  e.preventDefault();
  zone.classList.remove('is-dragging');
  researchAddAttachments(e.dataTransfer.files);
});
$('#content').addEventListener('paste', (e) => {
  if (!$('#researchCreate') || !reportAllowed()) return;
  const images = [...(e.clipboardData?.files || [])].filter((file) =>
    file.type.startsWith('image/'),
  );
  if (images.length) {
    e.preventDefault();
    researchAddAttachments(images);
  }
});
