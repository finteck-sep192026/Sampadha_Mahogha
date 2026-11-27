// The last look before a report leaves: what is going, to whom, what else it sets off, and what
// cannot be undone. A send reaches clients' mailboxes and, for clients with broker auto-email,
// their brokers, so it is confirmed here in words and not with a bare OK box.
//
//   await sendSummary({ title, rows: [[label, html]], clients: [{ name, id, note, warn }],
//                       warnings: [text], confirm: 'Send to 3 clients' })  → true to go ahead
function sendSummary({ title, rows = [], clients = [], warnings = [], confirm: label = 'Send' }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'send-summary';
  dialog.setAttribute('aria-labelledby', 'sendSummaryTitle');
  dialog.innerHTML = `<form method="dialog"><h3 id="sendSummaryTitle">${esc(title)}</h3><dl class="send-summary-rows">${rows
    .filter((r) => r && r[1])
    .map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${value}</dd></div>`)
    .join('')}</dl>${
    clients.length
      ? `<p class="send-summary-label">${clients.length === 1 ? '1 client' : clients.length + ' clients'} will receive it</p><ul class="send-summary-clients">${clients.map((c) => `<li><b>${esc(c.name)}</b> <span>${esc(c.id)}</span>${c.note ? `<small>${esc(c.note)}</small>` : ''}${c.warn ? `<small class="warn">${esc(c.warn)}</small>` : ''}</li>`).join('')}</ul>`
      : ''
  }${warnings.length ? `<ul class="send-summary-warnings">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}<p class="send-summary-final">A sent report cannot be recalled.</p><div class="actions"><button value="cancel" class="btn secondary" autofocus>Go back</button><button value="send" class="btn primary">${esc(label)}</button></div></form>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(dialog.returnValue === 'send');
    });
    dialog.showModal();
  });
}

// Suitability and paperwork gaps for one client, without the leading separator complianceNote adds.
const sendSummaryGaps = (clientUid, segment) =>
  typeof complianceNote === 'function'
    ? complianceNote(clientUid, segment).replace(/^[\s·⚠]+/, '')
    : '';
