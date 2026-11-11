/**
 * Static check: every `t('key')` or `t("key")` used in client.js has a matching
 * key in both locale blocks, and no key is left unused.
 *
 * Usage: node scripts/check-locale-keys.mjs [path-to-client.js]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? path.join(here, '..', 'client.js');
const src = fs.readFileSync(file, 'utf8');

const used = new Set();
for (const match of src.matchAll(/\bt\('([^']+)'/g)) used.add(match[1]);
for (const match of src.matchAll(/\bt\("([^"]+)"/g)) used.add(match[1]);

const enStart = src.indexOf('en: {');
const zhStart = src.indexOf('zh: {');
if (enStart === -1 || zhStart === -1) throw new Error('locale blocks not found');
const enBlock = src.slice(enStart, zhStart);
const zhBlock = src.slice(zhStart, src.indexOf('const FAMILY_LABEL'));

function keysOf(block) {
  const keys = new Set();
  for (const line of block.split('\n')) {
    const match = line.match(/^\s*(?:'([^']+)'|([A-Za-z][A-Za-z0-9.]*)):\s*'/);
    if (match) keys.add(match[1] ?? match[2]);
  }
  return keys;
}

const en = keysOf(enBlock);
const zh = keysOf(zhBlock);

// Dynamic keys built by concatenation, e.g. t('bucket.' + bucket).
const usedPrefixes = [...used].filter((key) => key.endsWith('.'));
for (const prefix of usedPrefixes) used.delete(prefix);

const missingEn = [...used].filter((key) => !en.has(key));
const missingZh = [...used].filter((key) => !zh.has(key));
const unusedEn = [...en].filter((key) => !used.has(key) && !usedPrefixes.some((prefix) => key.startsWith(prefix)));
const unusedZh = [...zh].filter((key) => !used.has(key) && !usedPrefixes.some((prefix) => key.startsWith(prefix)));

console.log('used', used.size, '| en', en.size, '| zh', zh.size);
console.log('missing in en:', missingEn);
console.log('missing in zh:', missingZh);
console.log('unused in en:', unusedEn);
console.log('unused in zh:', unusedZh);
const ok = missingEn.length === 0 && missingZh.length === 0 && unusedEn.length === 0 && unusedZh.length === 0;
console.log(ok ? 'LOCALE CHECK PASSED' : 'LOCALE CHECK FAILED');
process.exitCode = ok ? 0 : 1;
