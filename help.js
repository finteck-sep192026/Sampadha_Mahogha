// Help & grievances page and the regulatory footer, for every role. The firm's details come from
// config.js (SAMPADHA_CONFIG.firm) so they are written once; an empty value is not shown.
const FIRM = window.SAMPADHA_CONFIG.firm || {};
const firmDisclosure = () =>
  [FIRM.name && FIRM.registration ? `${FIRM.name} is a ${FIRM.registration}.` : '', FIRM.riskWarning, FIRM.sebiNote]
    .filter(Boolean)
    .join(' ');

// The same sentence wherever the page asks for it: the portal footer and the sign-in page.
document.querySelectorAll('[data-firm-disclosure]').forEach((el) => {
  el.textContent = firmDisclosure();
});

const helpRow = (label, value) => (value ? `<div class="detail"><small>${esc(label)}</small><b>${value}</b></div>` : '');
const helpLink = (url, label) =>
  url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
const helpMail = (subject) =>
  `<a href="mailto:${esc(FIRM.contactEmail)}?subject=${encodeURIComponent(subject)}">${esc(FIRM.contactEmail)}</a>`;

function helpPage() {
  const client = state.role === 'client';
  return `<article class="card panel"><div class="panel-head"><div><h3>Contact Sampadha</h3><p>${
    client
      ? 'For a question about a report, your details, your subscription or this portal.'
      : 'For a question about the portal or a client record.'
  }</p></div></div><div class="detail-grid">${
    helpRow('Email', FIRM.contactEmail ? helpMail('Portal help' + (state.user?.id ? ' · ' + state.user.id : '')) : '') +
    helpRow('Phone', FIRM.phone ? esc(FIRM.phone) : '') +
    helpRow('Your login ID', state.user?.id ? esc(state.user.id) : '')
  }</div>${
    client
      ? '<p class="help-note">If any of your details are wrong, email us with your login ID and the correction. Do not send your full PAN or bank account number by email; the last four characters are enough for us to find it.</p>'
      : ''
  }</article>
<article class="card panel"><div class="panel-head"><div><h3>Complaints and grievances</h3><p>How to raise a complaint, and where to take it if we do not resolve it.</p></div></div><ol class="help-steps"><li><b>Write to Sampadha first.</b> ${
    FIRM.contactEmail ? `Email ${helpMail('Complaint' + (state.user?.id ? ' · ' + state.user.id : ''))}` : 'Contact Sampadha'
  }${FIRM.grievanceOfficer ? `, marked for ${esc(FIRM.grievanceOfficer)}` : ''}, with your login ID and what went wrong.</li><li><b>If it is not resolved,</b> you can lodge the complaint with SEBI on ${helpLink(FIRM.scoresUrl, 'SCORES')}.</li><li><b>If you are still not satisfied,</b> you can use the ${helpLink(FIRM.odrUrl, 'Online Dispute Resolution portal')}.</li></ol></article>
<article class="card panel"><div class="panel-head"><div><h3>About the research you receive</h3><p>${esc(FIRM.name || 'Sampadha')} is a ${esc(FIRM.registration || 'SEBI-registered Research Analyst')}.</p></div></div><ul class="help-list"><li>${esc(FIRM.riskWarning || '')}</li><li>${esc(FIRM.sebiNote || '')}</li><li>Reports are research communication. They are not orders, and Sampadha does not place trades or hold client funds or securities.</li><li>Read every report with your own risk profile in mind.</li></ul><p class="help-note"><a href="privacy.html">Privacy Policy</a></p></article>`;
}

pages.help = helpPage;
titles.help = 'Help & grievances';
if (typeof NAV_ICONS === 'object') NAV_ICONS.help = 'message';
NAV_GROUP_OF.help = 'Administration';
Object.values(nav).forEach((items) => items.push(['help', '?', 'Help']));

// The footer sits outside #content, so its Help link needs its own handler.
document.querySelector('.portal-disclosure-link')?.addEventListener('click', () => show('help'));
