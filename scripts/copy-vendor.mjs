// Copies browser builds of third-party libraries into the sites so they ship with the app (no CDN).
import { copyFileSync, mkdirSync } from 'node:fs';

const copies = [
  ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'Sampadha-mah/vendor/supabase.js'],
  ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'Sampadha-v2/vendor/supabase.js'],
  // SheetJS (Apache-2.0) from cdn.sheetjs.com, for reading the weekly CSV/XLS/XLSX master.
  ['node_modules/xlsx/dist/xlsx.full.min.js', 'Sampadha-v2/vendor/xlsx.full.min.js'],
];
for (const [from, to] of copies) {
  mkdirSync(to.slice(0, to.lastIndexOf('/')), { recursive: true });
  copyFileSync(from, to);
  console.log('Copied ' + from + ' -> ' + to);
}
