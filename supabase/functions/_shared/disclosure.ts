// The regulatory footer on every email Sampadha sends from its own mailboxes (never on broker
// orders, which go from the client's own Gmail exactly as written). The same wording is in
// Sampadha-v2/config.js (SAMPADHA_CONFIG.firm) for the portal and report PDFs: change both.
const REGISTRATION =
  'Sampadha is a SEBI-registered Research Analyst (Corporate), registration number INH000031107.';
const RISK_WARNING =
  'Investment in securities market are subject to market risks. Read all the related documents carefully before investing.';
const SEBI_NOTE =
  'Registration granted by SEBI and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors.';
const CONTACT = 'Questions or complaints: reach@sampadha.com';

export const DISCLOSURE_TEXT = `--\n${REGISTRATION}\n${RISK_WARNING}\n${SEBI_NOTE}\n${CONTACT}`;
export const DISCLOSURE_HTML =
  `<p style="margin:18px 0 0;padding-top:12px;border-top:1px solid #dfe5ec;font-size:12px;line-height:1.5;color:#5b6b80">` +
  `${REGISTRATION} ${RISK_WARNING} ${SEBI_NOTE}<br>` +
  `Questions or complaints: <a href="mailto:reach@sampadha.com" style="color:#1556d0">reach@sampadha.com</a></p>`;
