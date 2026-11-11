/**
 * Download DeepSeek's machine-readable pricing source and write the static
 * snapshot the browser half polls.
 *
 * The browser cannot fetch `api-docs.deepseek.com` directly: the docs host
 * sends no CORS header, so a page-side `fetch` is blocked even though command
 * line tools retrieve the same URL fine. This script runs in CI instead and
 * commits only the extracted facts + document hash, so the runtime stays a
 * plain static file served by raw.githubusercontent.com (which allows CORS).
 *
 * Usage: node scripts/sync-pricing-mirror.mjs [--check]
 * Exit code 0 = up to date or written; 2 = stale under `--check`; 1 = error.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PRICING_URL, contentHashOf, parsePricingFacts } from '../pricing-watch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, '..', 'pricing', 'official-zh.json');
const checkOnly = process.argv.includes('--check');

async function main() {
  const response = await fetch(DEFAULT_PRICING_URL, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'user-agent': 'dsh-cny-cost-mirror/1.0 (+https://github.com/FeiYuSS/dsh-cny-cost)',
      accept: 'text/markdown,text/plain;q=0.9,*/*;q=0.5',
    },
  });
  if (!response.ok) throw new Error(`官方定价页返回 HTTP ${response.status}`);
  const markdown = await response.text();
  const facts = parsePricingFacts(markdown);
  const hash = contentHashOf(markdown);

  let existing = null;
  try {
    existing = JSON.parse(await fs.readFile(output, 'utf8'));
  } catch {
    existing = null;
  }

  if (existing !== null && existing.hash === hash) {
    console.log(`pricing mirror already up to date (${hash.slice(0, 12)})`);
    return;
  }
  if (checkOnly) {
    console.log(`pricing mirror is stale (official ${hash.slice(0, 12)})`);
    process.exitCode = 2;
    return;
  }

  const snapshot = {
    version: 1,
    sourceUrl: DEFAULT_PRICING_URL,
    fetchedAt: new Date().toISOString(),
    hash,
    facts,
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`wrote ${output} (${hash.slice(0, 12)})`);
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
