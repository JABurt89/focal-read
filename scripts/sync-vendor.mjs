import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const vendorDir = resolve(root, 'vendor');

mkdirSync(vendorDir, { recursive: true });

const files = [
  ['node_modules/jszip/dist/jszip.min.js', 'vendor/jszip.min.js'],
  ['node_modules/pdfjs-dist/build/pdf.min.mjs', 'vendor/pdf.min.mjs'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'vendor/pdf.worker.min.mjs'],
];

for (const [srcRel, destRel] of files) {
  const src = resolve(root, srcRel);
  const dest = resolve(root, destRel);
  copyFileSync(src, dest);
  console.log(`Copied ${srcRel} -> ${destRel}`);
}
