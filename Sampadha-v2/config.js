// Public browser configuration. The publishable key is safe to ship: access is enforced by
// Row Level Security and server-side functions in Postgres, not by hiding this key.
// NEVER put the secret / service_role key in this folder.
window.SAMPADHA_CONFIG = {
  supabaseUrl: 'https://nxtyswlxnmekpvlfuucg.supabase.co',
  supabaseKey: 'sb_publishable_mJg6cVoioce1RDgBrncqEQ_s5Xn6V6A',
  // The eSign service only returns signers to HTTPS addresses; local copies use the live site.
  liveSiteUrl: 'https://racrm.fintecindia.com',
};
