// Copies browser builds of third-party libraries into the sites so they ship with the app (no CDN).
import { copyFileSync, mkdirSync } from 'node:fs';

const copies = [
  ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'Sampadha-mah/vendor/supabase.js'],
  ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'Sampadha-v2/vendor/supabase.js'],
  // SheetJS (Apache-2.0) from cdn.sheetjs.com, for reading the weekly CSV/XLS/XLSX master.
  ['node_modules/xlsx/dist/xlsx.full.min.js', 'Sampadha-v2/vendor/xlsx.full.min.js'],
  // Newsreader (display serif) and Mona Sans (interface), both SIL OFL 1.1, self-hosted so clients'
  // browsers never call a font CDN. Variable fonts: one file per subset covers every weight.
  ['node_modules/@fontsource-variable/newsreader/LICENSE', 'Sampadha-v2/vendor/fonts/LICENSE-Newsreader.txt'],
  ['node_modules/@fontsource-variable/mona-sans/LICENSE', 'Sampadha-v2/vendor/fonts/LICENSE-Mona-Sans.txt'],
  ...['latin', 'latin-ext'].flatMap((subset) => [
    [
      `node_modules/@fontsource-variable/newsreader/files/newsreader-${subset}-opsz-normal.woff2`,
      `Sampadha-v2/vendor/fonts/newsreader-${subset}.woff2`,
    ],
    [
      `node_modules/@fontsource-variable/mona-sans/files/mona-sans-${subset}-wght-normal.woff2`,
      `Sampadha-v2/vendor/fonts/mona-sans-${subset}.woff2`,
    ],
  ]),
];
for (const [from, to] of copies) {
  mkdirSync(to.slice(0, to.lastIndexOf('/')), { recursive: true });
  copyFileSync(from, to);
  console.log('Copied ' + from + ' -> ' + to);
}
