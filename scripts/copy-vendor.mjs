// Copies the browser build of supabase-js into the site so it ships with the app (no CDN).
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('Sampadha-mah/vendor', { recursive: true });
copyFileSync(
  'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
  'Sampadha-mah/vendor/supabase.js',
);
console.log('Copied supabase-js to Sampadha-mah/vendor/supabase.js');
