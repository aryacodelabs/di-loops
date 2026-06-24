/**
 * Copies vis-network into media/ for the webview graph (PR 13).
 * Run after: npm install vis-network
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const visRoot = join(root, 'node_modules', 'vis-network');
const mediaDir = join(root, 'media');

const copies = [
  {
    src: join(visRoot, 'standalone', 'umd', 'vis-network.min.js'),
    dest: join(mediaDir, 'vis-network.bundle.js'),
  },
  {
    src: join(visRoot, 'dist', 'dist', 'vis-network.min.css'),
    dest: join(mediaDir, 'vis-network.bundle.css'),
  },
];

if (!existsSync(visRoot)) {
  console.error('vis-network not installed. Run: npm install vis-network --save-dev');
  process.exit(1);
}

mkdirSync(mediaDir, { recursive: true });

for (const { src, dest } of copies) {
  if (!existsSync(src)) {
    console.error(`Missing vis-network asset: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, dest);
  console.log(`Bundled → ${dest}`);
}

const licensePath = join(visRoot, 'LICENSE-APACHE-2.0');
const licenseOut = join(mediaDir, 'vis-network.LICENSE.txt');
if (existsSync(licensePath)) {
  copyFileSync(licensePath, licenseOut);
  console.log(`Bundled → ${licenseOut}`);
} else {
  const pkg = JSON.parse(readFileSync(join(visRoot, 'package.json'), 'utf8'));
  const fallback = `${pkg.name} ${pkg.version}\nLicense: ${pkg.license ?? 'see package'}`;
  writeFileSync(licenseOut, fallback);
  console.log(`Wrote license stub → ${licenseOut}`);
}