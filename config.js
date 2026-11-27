// Public browser configuration. The publishable key is safe to ship: access is enforced by
// Row Level Security and server-side functions in Postgres, not by hiding this key.
// NEVER put the secret / service_role key in this folder.
window.SAMPADHA_CONFIG = {
  supabaseUrl: 'https://nxtyswlxnmekpvlfuucg.supabase.co',
  supabaseKey: 'sb_publishable_mJg6cVoioce1RDgBrncqEQ_s5Xn6V6A',
  // The eSign service only returns signers to HTTPS addresses; local copies use the live site.
  liveSiteUrl: 'https://racrm.fintecindia.com',
  // The firm's regulatory details, shown in the portal footer, the Help page and report PDFs.
  // The same wording is in supabase/functions/_shared/disclosure.ts for emails: change both.
  // Leave grievanceOfficer and phone empty until the compliance officer supplies them; empty
  // values are not shown.
  firm: {
    name: 'Sampadha',
    registration: 'SEBI-registered Research Analyst (Corporate), registration number INH000031107',
    riskWarning:
      'Investment in securities market are subject to market risks. Read all the related documents carefully before investing.',
    sebiNote:
      'Registration granted by SEBI and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors.',
    contactEmail: 'reach@sampadha.com',
    grievanceOfficer: '',
    phone: '',
    scoresUrl: 'https://scores.sebi.gov.in',
    odrUrl: 'https://smartodr.in',
  },
};
