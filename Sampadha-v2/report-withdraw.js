// Withdraw a report, and mark a corrected report as replacing a withdrawn one.
//
// A signed, filed or delivered report is never edited. The analyst withdraws it with a reason
// (clients who received it are told at once), creates the corrected report as usual, and marks
// the new one as replacing the old. A draft that never left the desk is discarded the same way.
// The rules live in the database (migration 20261127040000); these are its buttons.
const withdrawReports = () => state.ws?.reports || [];
const withdrawLeftDesk = (r) =>
  r.recipients.length > 0 || ['Submitted', 'Failed'].includes(r.parrvaStatus);

// Under a report's title in a list: withdrawn, and what replaces or is replaced.
function reportWithdrawNote(r) {
  const all = withdrawReports(),
    old = r.supersedes && all.find((x) => x.id === r.supersedes),
    next = all.find((x) => x.supersedes === r.id && !x.voided && (state.role !== 'client' || x.sentAt));
  return (
    (r.voided
      ? `<small class="report-withdrawn"><span class="status red">${withdrawLeftDesk(r) || state.role === 'client' ? 'Withdrawn' : 'Discarded'}</span> ${esc(r.voidedAt)} · ${esc(r.voidReason)}</small>`
      : '') +
    (next ? `<small class="report-withdrawn">Replaced by ${esc(next.ref)}</small>` : '') +
    (old ? `<small class="report-withdrawn">Replaces ${esc(old.ref)}</small>` : '')
  );
}

function reportWithdrawButton(r) {
  if (r.voided || typeof researchOwner !== 'function' || !researchOwner(r)) return '';
  return ` <button type="button" class="btn secondary" data-report-withdraw="${esc(r.id)}">${withdrawLeftDesk(r) ? 'Withdraw' : 'Discard draft'}</button>`;
}

// On a report not yet sent: choose the withdrawn report it corrects.
function reportSupersedesField(r) {
  if (r.voided || r.recipients.length) return '';
  const choices = withdrawReports().filter(
    (x) =>
      x.voided &&
      x.segment === r.segment &&
      researchOwner(x) &&
      withdrawLeftDesk(x) &&
      // one replacement per withdrawn report
      !withdrawReports().some((y) => y.supersedes === x.id && y.id !== r.id && !y.voided),
  );
  if (!choices.length) return '';
  return `<label class="field report-supersedes">This report corrects a withdrawn report<select data-report-supersedes="${esc(r.id)}"><option value="">No, it is a new report</option>${choices.map((x) => `<option value="${esc(x.id)}"${x.id === r.supersedes ? ' selected' : ''}>${esc(x.ref)} · ${esc(x.title)}</option>`).join('')}</select><small>Clients who received the withdrawn report are told that this one replaces it.</small></label><p class="research-message" role="status" data-report-supersedes-message></p>`;
}

function withdrawDialog(r) {
  const left = withdrawLeftDesk(r),
    clients = r.recipients.length,
    points = [];
  if (clients)
    points.push(
      `${clients === 1 ? '1 client' : clients + ' clients'} who received it will be emailed now, with your reason, and told not to act on it.`,
    );
  if (r.parrvaStatus === 'Submitted')
    points.push(
      'It was accepted by CARE PaRRVA. Withdrawing here does not change that filing: correct it with NSE separately.',
    );
  if (clients && r.segment === 'Multi')
    points.push(
      'Broker order emails already sent cannot be recalled. Any still waiting to go are stopped.',
    );
  if (r.rows?.some((l) => l.closedLots < l.lots) && left && r.segment === 'Multi')
    points.push('Its open legs leave Positions, and no exit can be recorded on them afterwards.');
  points.push(
    left
      ? 'The report stays on record as withdrawn. To correct it, create a new report and mark it as replacing this one.'
      : 'This draft was never sent or filed, so nobody is told. It stays on record as discarded.',
  );
  const dialog = document.createElement('dialog');
  dialog.className = 'send-summary';
  dialog.setAttribute('aria-labelledby', 'withdrawTitle');
  dialog.innerHTML = `<form><h3 id="withdrawTitle">${left ? 'Withdraw' : 'Discard'} ${esc(r.ref)}?</h3><dl class="send-summary-rows"><div><dt>Report</dt><dd>${esc(r.title)}</dd></div><div><dt>Status</dt><dd>${esc([clients ? 'Sent to ' + clients + (clients === 1 ? ' client' : ' clients') : 'Not sent', r.esignStatus === 'Signed' ? 'signed' : 'not signed', 'PaRRVA ' + (r.parrvaStatus === 'Submitted' ? 'accepted' : r.parrvaStatus.toLowerCase())].join(' · '))}</dd></div></dl><ul class="send-summary-warnings">${points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul><label class="field">Reason *<textarea name="reason" rows="3" required minlength="10" maxlength="300" placeholder="${left ? 'Clients will read this. For example: the strike price was entered wrongly.' : 'Why this draft is being discarded'}"></textarea></label><p class="send-summary-final">This cannot be undone.</p><p class="research-message" role="status"></p><div class="actions"><button type="button" class="btn secondary" data-withdraw-cancel autofocus>Go back</button><button class="btn danger">${left ? 'Withdraw report' : 'Discard draft'}</button></div></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form'),
    message = dialog.querySelector('.research-message');
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('[data-withdraw-cancel]').onclick = () => dialog.close();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('.btn.danger');
    button.disabled = true;
    message.textContent = 'Working…';
    try {
      const done = await Api.voidReport(r.id, form.elements.reason.value.trim());
      dialog.close();
      await refreshWorkspace();
      show(state.page);
      toast(
        `${done.report_ref} ${left ? 'withdrawn' : 'discarded'}.` +
          (done.clients_told ? ` ${done.clients_told} client(s) told.` : '') +
          (done.broker_orders_already_sent
            ? ` ${done.broker_orders_already_sent} broker order(s) had already gone out.`
            : ''),
      );
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
  });
  dialog.showModal();
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-report-withdraw]');
  if (!button) return;
  const r = withdrawReports().find((x) => x.id === button.dataset.reportWithdraw);
  if (r) withdrawDialog(r);
});

document.addEventListener('change', async (event) => {
  const select = event.target.closest('[data-report-supersedes]');
  if (!select) return;
  const message = document.querySelector('[data-report-supersedes-message]');
  select.disabled = true;
  try {
    const done = await Api.setReportSupersedes(select.dataset.reportSupersedes, select.value);
    await refreshWorkspace();
    if (message)
      message.textContent = done.replaces
        ? `Marked as replacing ${done.replaces}. Clients are told when you send it.`
        : 'Marked as a new report.';
  } catch (error) {
    if (message) message.textContent = error.message;
  }
  select.disabled = false;
});

if (typeof AUDIT_LABELS === 'object')
  Object.assign(AUDIT_LABELS, {
    'report.withdrawn': 'Report withdrawn',
    'report.discarded': 'Draft discarded',
    'report.supersedes_set': 'Report marked as replacing a withdrawn one',
  });
