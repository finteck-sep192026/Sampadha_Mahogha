// Client onboarding: the PDF of what Sales entered, and the client's acceptance of it. The PDF is
// made in the browser when Sales submits, stored privately and attached to the client's email. The
// client accepts it on the Broker auto-email page, so one link covers both consents. Rules are in
// supabase/migrations/20261107080000_v2_onboarding_workflow.sql.

async function onboardingPdfBlob(p) {
  // A4 portrait at 150 dpi, one canvas per page, turned into JPEG pages.
  const W = 1240,
    H = 1754,
    left = 90,
    right = W - 90,
    sans = 'Arial, Helvetica, sans-serif',
    ink = '#13233a',
    muted = '#5b6b80',
    navy = '#0b1f3a',
    gold = '#b8862b',
    hairline = '#d9e1ea',
    pages = [];
  let ctx,
    y = 0;
  const page = () => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = navy;
    ctx.fillRect(0, 0, W, 130);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 40px ${sans}`;
    ctx.fillText('Sampadha', left, 80);
    ctx.font = `400 24px ${sans}`;
    ctx.textAlign = 'right';
    ctx.fillText('Client onboarding details', right, 78);
    ctx.textAlign = 'left';
    pages.push(canvas);
    y = 190;
  };
  const room = (height) => {
    if (y + height > H - 110) page();
  };
  const heading = (label) => {
    room(120);
    y += 22;
    ctx.fillStyle = gold;
    ctx.fillRect(left, y - 24, 6, 30);
    ctx.fillStyle = navy;
    ctx.font = `700 30px ${sans}`;
    ctx.fillText(label, left + 20, y);
    y += 40;
  };
  const line = (label, value) => {
    const text = String(value || '-'),
      width = right - left - 390,
      words = text.split(' '),
      lines = [];
    ctx.font = `600 25px ${sans}`;
    let current = '';
    for (const word of words) {
      const next = current ? current + ' ' + word : word;
      if (ctx.measureText(next).width > width && current) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    lines.push(current);
    room(46 * lines.length);
    ctx.fillStyle = muted;
    ctx.font = `400 25px ${sans}`;
    ctx.fillText(label, left, y);
    ctx.fillStyle = ink;
    ctx.font = `600 25px ${sans}`;
    lines.forEach((value_, i) => ctx.fillText(value_, left + 390, y + i * 38));
    y += 46 + (lines.length - 1) * 38;
    ctx.fillStyle = hairline;
    ctx.fillRect(left, y - 30, right - left, 1);
  };
  page();
  ctx.fillStyle = muted;
  ctx.font = `400 24px ${sans}`;
  ctx.fillText(
    'Prepared ' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST',
    left,
    y,
  );
  y += 40;
  heading('Personal and KYC details');
  [
    ['Full legal name', p.name],
    ['PAN', p.pan],
    ['Date of birth', p.dob],
    ['Email', p.email],
    ['Mobile', p.mobile],
    ['Occupation', p.occupation],
    ['Annual income', p.income],
    ['Net worth', p.netWorth],
    ['Tax residency', p.residency],
    ['City', p.city],
    ['Mutual fund experience', p.mfExperience],
    ['Stocks experience', p.stockExperience],
    ['F&O experience', p.foExperience],
    ['Proposed investment amount', p.amount],
    ['Market segments', p.segments.join(', ')],
  ].forEach(([label, value]) => line(label, value));
  heading('Products and services');
  line('Services', p.services.join(', '));
  line('Products', p.products.join(', '));
  p.accounts.forEach((a) => {
    heading(a.product + ' broker');
    [
      ['Broker', a.broker],
      ['Depository', a.depository],
      ['Demat / BO ID', a.demat],
      ['Trading client ID', a.tradingId],
      ['Primary bank', a.bank],
      ['Bank IFSC code', a.ifsc],
      ['Bank account number', a.accountNumber],
      ['Holding horizon', a.horizon],
      ['Investment objective', a.objective],
      ['Maximum loss tolerance', a.loss],
    ].forEach(([label, value]) => line(label, value));
  });
  const images = pages.map((canvas, index) => {
    ctx = canvas.getContext('2d');
    ctx.fillStyle = muted;
    ctx.font = `400 20px ${sans}`;
    ctx.fillText('Confidential: prepared for the client named above', left, H - 50);
    ctx.textAlign = 'right';
    ctx.fillText(`Page ${index + 1} of ${pages.length}`, right, H - 50);
    ctx.textAlign = 'left';
    return Uint8Array.from(atob(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]), (c) => c.charCodeAt(0));
  });
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
    '<< /Type /Pages /Count ' + images.length + ' /Kids [' + images.map((_, i) => 3 + i * 3 + ' 0 R').join(' ') + '] >>',
  );
  images.forEach((bytes, i) => {
    const id = 3 + i * 3;
    object(
      id,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Img ' +
        (id + 1) + ' 0 R >> >> /Contents ' + (id + 2) + ' 0 R >>',
    );
    offsets[id + 1] = size;
    push(
      id + 1 + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + W + ' /Height ' + H +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + bytes.length + ' >>\nstream\n',
    );
    push(bytes);
    push('\nendstream\nendobj\n');
    const commands = 'q 595.28 0 0 841.89 0 0 cm /Img Do Q';
    object(id + 2, '<< /Length ' + commands.length + ' >>\nstream\n' + commands + '\nendstream');
  });
  const xref = size;
  push('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
  offsets.slice(1).forEach((offset) => push(String(offset).padStart(10, '0') + ' 00000 n \n'));
  push('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
  return new Blob(chunks, { type: 'application/pdf' });
}

const onboardingPending = () => {
  const own = state.ws?.onboarding;
  return Boolean(own?.pdf_path && !own.details_accepted_at);
};
// The top of the client's Broker auto-email page.
function onboardingClientCard() {
  const own = state.ws?.onboarding;
  if (!own?.pdf_path) return '';
  return `<article class="card panel"><div class="panel-head"><div><h3>Your onboarding details</h3><p>Check the details your Sampadha contact entered for you.</p></div><span class="status ${own.details_accepted_at ? 'green' : 'gold'}">${own.details_accepted_at ? 'Accepted' : 'Waiting for you'}</span></div><div class="actions"><button type="button" class="btn secondary" data-onboarding-file="${esc(own.pdf_path)}">View PDF</button></div>${
    own.details_accepted_at
      ? `<p class="muted">Accepted on ${esc(Api.fmt.stamp(own.details_accepted_at))} IST.</p>`
      : '<form id="onboardingAcceptForm"><label class="consent"><input name="accept" type="checkbox" required><span><b>I accept these details *</b><small>The details in this PDF are correct. If anything is wrong, ask your Sampadha contact to change it before accepting.</small></span></label><div class="actions"><button class="btn primary">Accept details</button></div></form>'
  }</article>`;
}

document.querySelector('#content').addEventListener('click', async (event) => {
  const file = event.target.closest('[data-onboarding-file]');
  if (!file) return;
  const opened = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await Api.downloadFile(file.dataset.onboardingFile));
    if (opened) opened.location = url;
    else location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    opened?.close();
    toast(error.message);
  }
});
document.querySelector('#content').addEventListener('submit', async (event) => {
  if (event.target.id !== 'onboardingAcceptForm') return;
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    await Api.acceptOnboardingDetails();
    await refreshWorkspace();
    show('brokerEmail');
    toast('Details accepted');
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  }
});

// A client with anything waiting lands on the one page that holds both consents.
const onboardingOriginalEnterPortal = enterPortal;
enterPortal = async function (profile) {
  await onboardingOriginalEnterPortal(profile);
  if (
    state.role === 'client' &&
    (onboardingPending() || brokerRowFor(state.user.uid)?.status === 'Pending')
  )
    show('brokerEmail');
};
