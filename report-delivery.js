// A sent report, for its author or Admin: which clients it reached, and replacing its PDF.
// Replacing keeps the old PDF, notifies the clients and sends no broker order. Rules are in
// supabase/migrations/20261107030000_v2_client_brokers_and_replace.sql.

function reportDeliveryCard(r) {
  if (!r.recipients.length || !['ra', 'admin'].includes(state.role)) return '';
  return (
    '<article class="card panel research-section" data-delivery="' +
    r.id +
    '"><div class="panel-head"><div><h3>Client delivery</h3><p>Which clients this report reached. Read receipts are not tracked.</p></div><span class="badge">' +
    r.recipients.length +
    (r.recipients.length === 1 ? ' client' : ' clients') +
    '</span></div><div data-delivery-table><p class="muted">Loading…</p></div><h4>Replace report PDF</h4><p class="research-notice">Clients get the new PDF and a notice, and the old PDF is kept. The recommendations stay as they are, no new broker order goes out and a CARE PaRRVA filing does not change. The report must be eSigned again.</p><form data-report-replace="' +
    r.id +
    '"><div class="form-grid"><label class="field">New PDF *<input name="pdf" type="file" accept="application/pdf,.pdf" required></label><label class="field">Reason *<input name="reason" required minlength="5" maxlength="300" placeholder="What changed"></label></div><div class="actions"><button class="btn secondary">Replace PDF</button></div><p class="research-message" role="status"></p></form></article>'
  );
}

const deliveryOrderCell = (row) => {
  if (!row.order_status) return '—';
  const label =
      row.order_status === 'Sent' && row.order_via === 'client_gmail'
        ? 'Accepted by Gmail'
        : row.order_status,
    tone = row.order_status === 'Sent' ? 'green' : /Failed|Expired/.test(row.order_status) ? 'red' : 'gold';
  return (
    '<span class="status ' + tone + '">' + esc(label) + '</span><small>' + esc(row.order_to) + '</small>' +
    (row.order_note && tone === 'red' ? '<small>' + esc(row.order_note) + '</small>' : '')
  );
};
async function renderReportDelivery(card) {
  const target = card.querySelector('[data-delivery-table]');
  try {
    const rows = await Api.reportDeliveryStatus(card.dataset.delivery);
    target.innerHTML =
      '<div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th>In portal</th><th>Email notice</th><th>Broker order</th></tr></thead><tbody>' +
      rows
        .map(
          (row) =>
            '<tr><td><b>' + esc(row.full_name) + '</b><small>' + esc(row.login_id) +
            '</small></td><td class="stamp">' + esc(Api.fmt.stamp(row.delivered_at)) + ' IST</td><td>' +
            (row.notice_status
              ? '<span class="status ' + (row.notice_status === 'Sent' ? 'green' : 'gold') + '">' +
                esc(row.notice_status) + '</span><small>' + esc(Api.fmt.stamp(row.notice_at)) + ' IST</small>'
              : '—') +
            '</td><td>' + deliveryOrderCell(row) + '</td></tr>',
        )
        .join('') +
      '</tbody></table></div>';
  } catch (error) {
    target.textContent = error.message;
  }
}

// Report panels are drawn at several moments, so load a table whenever one appears.
new MutationObserver(() => {
  document.querySelectorAll('[data-delivery]:not([data-loaded])').forEach((card) => {
    card.dataset.loaded = '1';
    renderReportDelivery(card);
  });
}).observe(document.querySelector('#content'), { childList: true, subtree: true });

document.querySelector('#content').addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.matches('[data-report-replace]')) return;
  event.preventDefault();
  const button = form.querySelector('button'),
    message = form.querySelector('.research-message'),
    file = form.elements.pdf.files[0];
  if (!file?.name.toLowerCase().endsWith('.pdf')) {
    message.textContent = 'Choose a PDF file.';
    return;
  }
  if (!confirm('Replace this report for every client who received it?')) return;
  button.disabled = true;
  message.textContent = 'Replacing…';
  try {
    const result = await Api.replaceReportPdf(
      form.dataset.reportReplace,
      file,
      form.elements.reason.value,
    );
    await refreshWorkspace();
    show(state.page);
    toast('Report replaced for ' + result.clients + (result.clients === 1 ? ' client' : ' clients'));
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
});
