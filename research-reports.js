// Research reports: create (legs, attachments, analysis), preview PDF, Aadhaar eSign via Digio,
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
    const words = String(text ?? '-')
        .replaceAll('—', '-')
        .split(/\s+/),
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
    ['__leg', 'Leg', 40],
    ['product', 'Product', 65],
    ['symbol', 'Symbol', 65],
    ['expiry', 'Expiry', 95],
    ['strike', 'Strike', 75],
    ['option', 'Option', 65],
    ['side', 'Buy/Sell', 60],
    ['lots', 'Lots', 50],
    ['lotSize', 'Lot size', 55],
    ['quantity', 'Qty', 60],
    ['price', 'Initiation', 75],
    ['t1', 'T1', 60],
    ['t2', 'T2', 60],
    ['t3', 'T3', 60],
    ['published', 'Published', 115],
    ['delivered', 'Delivered', 115],
    ['signed', 'Sign stamp', 115],
    ['status', 'Status', 75],
    ['closedAt', 'Closed date', 115],
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
      ctx.font = '15px Arial';
      lines.forEach((line, j) => ctx.fillText(line, x + 6, y + 21 + j * 18));
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
  ['t1', 'T1'],
  ['t2', 'T2'],
  ['t3', 'T3'],
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
  researchDigioSdk = null;
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
  if (['price', 't1', 't2', 't3'].includes(key)) {
    if (row[key] === '' || row[key] === null || row[key] === undefined) return '—';
    return (
      '₹' +
      Number(row[key]).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  if (key === 'published') return row.published.replace('T', ' ') + ' IST';
  if (key === 'status' && (row.statusHistory || []).length)
    return (
      row.status +
      ' | ' +
      row.statusHistory
        .map((event, index) => index + 1 + '. ' + event.status + ' @ ' + event.at)
        .join(' | ')
    );
  return row[key] || '—';
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
          (r.recipients.length
            ? r.recipients.length + ' clients · ' + reportEscape(r.sent)
            : r.esignStatus === 'Signed'
              ? 'eSigned · not sent'
              : 'Not signed') +
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
    '<article class="card panel"><div class="research-workflow-header"><h3>Create Multi research report</h3><span class="badge">Multi</span></div><div class="research-steps"><span>1. Legs & research</span><span>2. Preview & Aadhaar eSign</span><span>3. Select product clients & send</span><span>4. Manage positions</span></div><form id="researchCreate"><div class="form-grid"><label class="field">Report title<input name="title" required maxlength="150" placeholder="Enter report title"></label><label class="field">Product<input value="Multi" readonly></label></div><h3>MULTI RECOMMENDATIONS</h3><p class="research-notice">Enter the first leg, then use Add leg to duplicate it and modify only the required fields. T1, T2 and T3 are optional. Published date defaults to today in IST; delivery date, sign stamp, status and closed date appear after report generation.</p><div id="researchEntries">' +
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
      t1Text = get('t1'),
      t2Text = get('t2'),
      t3Text = get('t3'),
      t1 = t1Text ? Number(t1Text) : '',
      t2 = t2Text ? Number(t2Text) : '',
      t3 = t3Text ? Number(t3Text) : '',
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
    if ([t1, t2, t3].some((target) => target !== '' && (!Number.isFinite(target) || target <= 0)))
      fail('T1, T2 and T3 must be positive numbers when entered.');
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
      t1,
      t2,
      t3,
      published,
      delivered: '',
      signed: '',
      status: 'Generated',
      statusHistory: [],
      closedLots: 0,
      closedQty: 0,
      remainingLots: lots,
      remainingQty: lots * lotSize,
      closingPrice: 0,
      lastExit: '',
      closedAt: '',
      exits: [],
    };
  });
}
const researchSignKey = () => 'sampadha.v2.esignIdentifier.' + state.user.uid;
function researchRememberedIdentifier() {
  try {
    return localStorage.getItem(researchSignKey()) || '';
  } catch {
    return '';
  }
}
function researchRememberIdentifier(value) {
  try {
    localStorage.setItem(researchSignKey(), value);
  } catch {
    /* storage unavailable: the field just won't be prefilled next time */
  }
}
function researchSignPanel(r) {
  const signed = r.esignStatus === 'Signed';
  return (
    '<article class="card panel research-section"><h3>Aadhaar eSign</h3>' +
    (signed
      ? '<p class="research-notice">Signed with Aadhaar eSign (Digio) by <strong>' +
        reportEscape(r.signerName) +
        '</strong> on ' +
        reportEscape(r.signed) +
        '. Clients receive this signed PDF.</p>'
      : '<p class="research-notice">Review the PDF above, then sign it with your Aadhaar through Digio. Digio sends an OTP to the mobile number linked to your Aadhaar. Clients can be selected only after the server confirms the signature with Digio.</p><form id="researchSignForm" data-report="' +
        reportEscape(r.id) +
        '" class="research-signing"><label class="research-check"><input type="checkbox" name="consent">I have reviewed this report and will sign it with my Aadhaar eSign.</label><label class="field">Email or mobile number for Digio<input name="identifier" autocomplete="email" maxlength="120" required placeholder="10-digit mobile or email" value="' +
        reportEscape(researchRememberedIdentifier()) +
        '"></label><div class="research-filter-bar"><button class="btn primary">Sign with Aadhaar eSign</button><button type="button" class="btn secondary" data-esign-check="' +
        reportEscape(r.id) +
        '">Check signing status</button></div><p id="researchSignStatus" class="research-message" role="status">' +
        (r.esignStatus === 'Requested'
          ? 'A signing request is open. Finish it in Digio, or start again.'
          : 'Not signed yet.') +
        '</p></form>') +
    '</article><section id="researchClientSection" class="research-section">' +
    (signed
      ? ''
      : '<p class="research-lock">Client selection appears after the Aadhaar eSign is confirmed.</p>') +
    '</section>'
  );
}
// Digio serves a separate SDK build per environment (documentation.digio.in/sdk/web/web).
const DIGIO_SDK_BASE = { sandbox: 'https://ext.digio.in', production: 'https://app.digio.in' };
function researchLoadDigio(environment) {
  if (window.Digio) return Promise.resolve();
  researchDigioSdk ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = (DIGIO_SDK_BASE[environment] || DIGIO_SDK_BASE.sandbox) + '/sdk/v11/digio.js';
    script.onload = resolve;
    script.onerror = () => {
      researchDigioSdk = null;
      script.remove();
      reject(new Error('Could not load the Digio eSign window. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return researchDigioSdk;
}
// Opens Digio's signing window inside the page (an iframe, so popup blockers cannot stop it after
// the async preparation steps); resolves when Digio reports success. The server still checks.
function researchDigioSign(start) {
  return new Promise((resolve, reject) => {
    const digio = new window.Digio({
      environment: start.environment,
      is_iframe: true,
      callback: (response) =>
        response && response.error_code
          ? reject(new Error(response.message || 'Signing was not completed in Digio.'))
          : resolve(response),
      logo: new URL('assets/sampadha-logo.png', location.href).href,
      theme: { primaryColor: '#0d3970', secondaryColor: '#c99325' },
    });
    digio.init();
    if (start.accessToken) digio.submit(start.documentId, start.identifier, start.accessToken);
    else digio.submit(start.documentId, start.identifier);
  });
}
async function researchConfirmSign(reportId) {
  const status = $('#researchSignStatus');
  if (status) status.textContent = 'Confirming the signature with Digio...';
  const result = await Api.esignVerify(reportId);
  await refreshWorkspace();
  if (result.status !== 'Signed') {
    if ($('#researchSignStatus'))
      $('#researchSignStatus').textContent =
        result.message ||
        'Digio has not confirmed the signature yet. Finish signing, then use Check signing status.';
    return;
  }
  researchShow([reportId]);
  $('#researchHistory').innerHTML = researchHistory();
  toast('Report signed with Aadhaar eSign.');
}
async function researchStartSign(r, form) {
  const status = $('#researchSignStatus'),
    buttons = form.querySelectorAll('button');
  if (!form.elements.consent.checked) {
    status.textContent = 'Tick the confirmation to continue.';
    return;
  }
  buttons.forEach((b) => (b.disabled = true));
  try {
    status.textContent = 'Preparing the PDF for signing...';
    await Api.uploadPreviewPdf(r.id, await createResearchPdfBlob(r));
    status.textContent = 'Opening Digio...';
    const start = await Api.esignStart(r.id, form.elements.identifier.value);
    await researchLoadDigio(start.environment);
    researchRememberIdentifier(start.identifier);
    status.textContent = 'Complete the Aadhaar OTP in the Digio window.';
    await researchDigioSign(start);
    await researchConfirmSign(r.id);
  } catch (error) {
    if ($('#researchSignStatus')) $('#researchSignStatus').textContent = error.message;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}
function researchReleasePdfPreview() {
  if (researchPdfPreviewUrl) {
    URL.revokeObjectURL(researchPdfPreviewUrl);
    researchPdfPreviewUrl = '';
  }
}
function researchPdfPanel(r) {
  return (
    '<article class="card panel research-section research-pdf-shell"><div class="research-workflow-header"><div><p class="overline">REPORT PREVIEW</p><h3>View PDF</h3><p>The report PDF appears here above the Aadhaar eSign step.</p></div><button type="button" class="btn secondary" data-research-pdf="' +
    r.id +
    '">Download PDF</button></div><p id="researchPdfStatus" class="research-message" role="status">Generating PDF preview...</p><iframe id="researchPdfViewer" data-report="' +
    r.id +
    '" title="' +
    reportEscape(r.title) +
    ' PDF preview"></iframe></article>'
  );
}
// Signed reports show the PDF Digio returned; unsigned drafts show the locally generated preview.
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
        ? 'Aadhaar eSigned PDF (Digio).'
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
  if (researchOwner(r) && r.esignStatus === 'Signed') researchOpenClients(r);
}
function researchClientSection(r) {
  return (
    '<article class="card panel"><h3>Select clients & send</h3><p class="research-notice">Report signed. Select product types to show their subscribed clients.</p><form id="researchSend" data-report="' +
    r.id +
    '"><div class="research-filter-bar"><button type="button" class="btn secondary" id="researchSelectAll">Select visible clients</button><button type="button" class="btn secondary" id="researchClearAll">Clear checkboxes</button>' +
    MULTI_TYPES.map(
      (name) =>
        '<label class="research-check research-type-check"><input type="checkbox" name="category" value="' +
        name +
        '">' +
        name +
        '</label>',
    ).join('') +
    '</div><p id="researchClientCount" role="status">Choose a product type to show clients.</p><div id="researchClientList" class="research-client-grid"></div><label class="field">Or type matching client IDs / email addresses<textarea class="research-textarea" name="recipients" rows="2" placeholder="Enter IDs or emails for the selected product types"></textarea></label><p id="researchSendMessage" class="research-message" role="status"></p><button class="btn primary">Send to selected clients (demo)</button></form></article>'
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
  if (r.esignStatus !== 'Signed') throw new Error('Complete the Aadhaar eSign before sending.');
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
    '<section class="research-position-filters" aria-label="Position filters"><div><p class="overline">FILTER POSITIONS</p><h4>Clients, products and symbols</h4><small>Select one or more values in each dropdown. Filters work together.</small></div>' +
    researchFilterDropdown('clients', 'Clients', filterOptions.clients) +
    researchFilterDropdown('products', 'Product', filterOptions.products) +
    researchFilterDropdown('symbols', 'Symbol', filterOptions.symbols) +
    '<button type="button" class="btn secondary" id="researchClearPositionFilters">Clear filters</button></section>';
  const history =
    '<h4 class="research-section">POSITION EXIT HISTORY</h4><p class="research-notice">Every partial or full close is retained as a separate timestamped record. The same filters apply to this history.</p><div class="table-wrap"><table class="table research-exit-history"><thead><tr><th>Client IDs</th><th>Exit reference</th><th>Unified code</th><th>Symbol</th><th>Expiry date</th><th>Strike price</th><th>Option type</th><th>Buy/Sell</th><th>Exit #</th><th>Closing price</th><th>No. of lots</th><th>Exit quantity</th><th>Remaining lots</th><th>Remaining quantity</th><th>Status</th><th>Timestamp</th></tr></thead><tbody>' +
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
    '<article class="card panel"><div class="research-workflow-header"><div><h3>Positions</h3><p class="research-notice">Every submitted leg appears here with its client IDs and full details. Exits are entered by number of lots; every partial and full close retains its own timestamp. These are recommendation positions, not broker trades.</p></div><button class="btn secondary" data-go="multiReports">Create report</button></div>' +
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
    ' position(s) match the selected filters.</p><h4>MULTI RECOMMENDATIONS</h4><div class="table-wrap"><table class="table research-order-table"><thead><tr><th>Client IDs</th>' +
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
};
const originalResearchLogout = $('#logout').onclick;
$('#logout').onclick = () => {
  researchReleasePdfPreview();
  researchDraftAttachments = [null, null, null];
  researchAttachmentTab = 0;
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
        product: r.product,
        symbol: r.symbol,
        expiry: r.expiry,
        strike: String(r.strike),
        option: r.option,
        side: r.side,
        lots: String(r.lots),
        lotSize: String(r.lotSize),
        price: String(r.price),
        t1: String(r.t1),
        t2: String(r.t2),
        t3: String(r.t3),
        published: r.published,
      }));
      button.disabled = true;
      message.classList.remove('research-error');
      message.textContent = 'Saving report...';
      created = await Api.createDraft(title, sections, legs);
      for (const file of researchDraftAttachments.filter(Boolean))
        await Api.uploadAttachment(created.id, file.slot, file.file);
      researchDraftAttachments = [null, null, null];
      researchAttachmentTab = 0;
      researchRenderAttachments();
      await refreshWorkspace();
      message.textContent =
        'Report created. Review the PDF below, then sign it with Aadhaar eSign.';
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
      $('#researchClientSection').innerHTML =
        '<article class="card panel"><h3>Report sent</h3><p>' +
        sent +
        ' client deliveries recorded. ' +
        r.rows.length +
        ' recommendation positions are available in Positions.</p><button class="btn primary" data-go="researchOrders">Open Positions</button> <button class="btn secondary" data-research-pdf-view="' +
        reportEscape(r.id) +
        '">View PDF</button></article>';
      $('#researchHistory').innerHTML = researchHistory();
    } catch (error) {
      message.textContent = error.message;
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
