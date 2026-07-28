// Next.js's `output: 'standalone'` build doesn't include static assets or the public
// folder by default — they have to be copied in manually. Run this after `next build`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const standaloneDir = path.join(root, '.next', 'standalone');

if (!fs.existsSync(standaloneDir)) {
  console.error('.next/standalone not found — run `next build` first.');
  process.exit(1);
}

fs.cpSync(path.join(root, '.next', 'static'), path.join(standaloneDir, '.next', 'static'), { recursive: true });
fs.cpSync(path.join(root, 'public'), path.join(standaloneDir, 'public'), { recursive: true });

console.log('Copied .next/static and public/ into .next/standalone.');
