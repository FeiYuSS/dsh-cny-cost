/**
 * Official pricing snapshot watcher for the dsh-cny-cost bundle.
 *
 * DeepSeek publishes the machine-readable source of the pricing page at
 * `https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md`, so a change can
 * be detected without parsing the rendered docs site:
 *
 * - `parsePricingFacts` extracts the priced model rows, the peak/off-peak rule,
 *   the model aliases, the Search/Fetch fees and the deduction rules into a
 *   canonical JSON object;
 * - `evaluatePricingMarkdown` compares a new download with the last
 *   acknowledged snapshot and reports human-readable changes;
 * - `buildPricingUpdatePrompt` turns a pending change into the user message
 *   that starts a fresh session where the agent researches the new rules and
 *   updates this bundled snapshot.
 *
 * The module is pure apart from `node:crypto` for the content hash, so
 * `node --test` covers it without a Host or network access.
 */
import { createHash } from 'node:crypto';

/** Default machine-readable source (Chinese page, prices in CNY). */
export const DEFAULT_PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md';

/** Where the agent should look for the official rule while updating. */
export const PRICING_RULE_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';

const BUCKET_KEYS = ['inputCacheHit', 'inputCacheMiss', 'output'];
const PERIOD_KEYS = ['idle', 'peak'];

const BUCKET_LABELS = {
  inputCacheHit: '输入·缓存命中',
  inputCacheMiss: '输入·缓存未命中',
  output: '输出',
};
const PERIOD_LABELS = { idle: '空闲', peak: '高峰' };

const BUCKET_MATCHERS = [
  ['inputCacheHit', /缓存命中|cache hit/i],
  ['inputCacheMiss', /缓存未命中|cache miss/i],
  ['output', /输出|output/i],
];
const PERIOD_MATCHERS = [
  ['idle', /空闲|off[- ]?peak/i],
  ['peak', /高峰|peak/i],
];

const PRICE_CELL = /^\s*(?:([$¥])\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(元|美元)?\s*$/i;

/** Collapse whitespace so formatting-only edits do not look like rule changes. */
export function normalizeMarkdown(markdown) {
  return String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** Stable content hash of the whole pricing document (formatting-insensitive). */
export function contentHashOf(markdown) {
  return createHash('sha256').update(normalizeMarkdown(markdown), 'utf8').digest('hex');
}

function splitRow(line) {
  const cells = line.split('|');
  if (cells.length < 2) return null;
  return cells.slice(1, -1).map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseTables(markdown) {
  const lines = normalizeMarkdown(markdown).split('\n');
  const tables = [];
  let current = null;
  for (const line of lines) {
    if (!line.startsWith('|')) {
      current = null;
      continue;
    }
    const cells = splitRow(line);
    if (cells === null) continue;
    if (current === null) {
      current = { rows: [] };
      tables.push(current);
    }
    if (!isSeparatorRow(cells)) current.rows.push(cells);
  }
  return tables;
}

function footnoteMap(markdown) {
  const lines = normalizeMarkdown(markdown).split('\n');
  const footnotes = new Map();
  for (const line of lines) {
    const match = /^\((\d+)\)\s*(.*)$/.exec(line);
    if (match) footnotes.set(Number(match[1]), match[2].trim());
  }
  return footnotes;
}

function sectionText(markdown, headingPattern) {
  const lines = normalizeMarkdown(markdown).split('\n');
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (headingPattern.test(lines[index])) {
      start = index;
      break;
    }
  }
  if (start === -1) return '';
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^#{1,6}\s/.test(line) || line === '***') break;
    body.push(line);
  }
  return body.join(' ').trim();
}

/** Normalize one bucket label or period label from a pricing row. */
function matchLabel(matchers, text) {
  for (const [key, pattern] of matchers) {
    if (pattern.test(text)) return key;
  }
  return null;
}

function parsePriceCell(cell) {
  const match = PRICE_CELL.exec(cell);
  if (!match) return null;
  const value = Number(match[2].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const currency = match[1] === '$' || match[3] === '美元' ? 'USD' : match[1] === '¥' || match[3] === '元' ? 'CNY' : null;
  return { value, currency };
}

/** Strip a trailing footnote marker such as `deepseek-flash(1)` or `(1)`. */
function cleanModelName(cell) {
  return cell.replace(/\(\d+\)\s*$/, '').trim();
}

/**
 * Parse the machine-readable pricing markdown into canonical facts.
 * Unknown sections are ignored; the whole-document hash still covers them.
 *
 * @param {string} markdown downloaded `.md` source.
 * @returns {object} canonical facts used for diffing.
 */
export function parsePricingFacts(markdown) {
  const tables = parseTables(markdown);
  const footnotes = footnoteMap(markdown);

  const pricedTable = tables.find((table) => table.rows.some((row) => {
    const first = row[0] ?? '';
    return /^价格|^PRICING/i.test(first);
  }));
  if (pricedTable === undefined || pricedTable.rows.length === 0) {
    throw new Error('pricing markdown: no priced model table found');
  }

  const header = pricedTable.rows[0];
  if (header.length < 4) throw new Error('pricing markdown: unexpected model table header');
  const modelNames = header.slice(3).map(cleanModelName);

  const facts = { currency: null, models: {}, peakRule: '', aliases: '', extras: {}, deduction: '' };

  for (const row of pricedTable.rows.slice(1)) {
    const first = row[0] ?? '';
    if (!/^价格|^PRICING/i.test(first)) continue;
    const bucket = matchLabel(BUCKET_MATCHERS, row[1] ?? '');
    const period = matchLabel(PERIOD_MATCHERS, row[2] ?? '');
    if (bucket === null || period === null) continue;
    for (let index = 0; index < modelNames.length; index += 1) {
      const model = modelNames[index];
      if (model === '') continue;
      const parsed = parsePriceCell(row[3 + index] ?? '');
      if (parsed === null) continue;
      if (facts.currency === null && parsed.currency !== null) facts.currency = parsed.currency;
      const entry = facts.models[model] ?? { prices: {} };
      const prices = entry.prices;
      for (const key of BUCKET_KEYS) prices[key] ??= {};
      prices[bucket][period] = parsed.value;
      facts.models[model] = entry;
    }
  }

  for (const row of pricedTable.rows) {
    if ((row[0] ?? '').trim() === '模型版本' || /^MODEL VERSION/i.test(row[0] ?? '')) {
      for (let index = 0; index < modelNames.length; index += 1) {
        const model = modelNames[index];
        if (model === '' || facts.models[model] === undefined) continue;
        const value = cleanModelName(row[3 + index] ?? '');
        if (value !== '') facts.models[model].version = value;
      }
    }
  }

  for (const table of tables) {
    if (table === pricedTable) continue;
    const headerRow = table.rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
    if (!headerRow.includes('api') || !headerRow.includes('价格') && !headerRow.includes('price')) continue;
    for (const row of table.rows.slice(1)) {
      const name = (row[0] ?? '').trim();
      const lower = name.toLowerCase();
      if (lower !== 'search' && lower !== 'fetch') continue;
      const price = parsePriceCell(row[2] ?? '');
      if (price === null) continue;
      facts.extras[lower] = { unit: (row[1] ?? '').trim(), price: price.value, currency: price.currency ?? facts.currency };
    }
  }

  for (const [, text] of footnotes) {
    if (/高峰|peak hours|off[- ]?peak/i.test(text) && facts.peakRule === '') facts.peakRule = text;
    else if (/模型名|model name|legacy names/i.test(text) && facts.aliases === '') facts.aliases = text;
  }
  if (facts.peakRule === '') facts.peakRule = sectionText(markdown, /^##\s*.*(时段|peak|off-peak)/i);
  if (facts.aliases === '') facts.aliases = sectionText(markdown, /^##\s*.*(模型名|model names?)/i);
  facts.deduction = sectionText(markdown, /^##\s*.*(扣费|deduction|billing rules?)/i);

  return facts;
}

function formatMoney(value, currency) {
  if (typeof value !== 'number') return String(value);
  const suffix = currency === 'USD' ? ' USD' : ' 元';
  return String(value) + suffix;
}

/**
 * Structured differences between two parsed fact objects.
 * @returns {{hasChanges: boolean, changes: object[]}}
 */
export function diffPricingFacts(previous, next) {
  const changes = [];
  if (!previous || typeof previous !== 'object') return { hasChanges: false, changes };

  const previousModels = previous.models ?? {};
  const nextModels = next.models ?? {};
  const currency = next.currency ?? previous.currency ?? 'CNY';

  for (const model of Object.keys(nextModels).sort()) {
    if (previousModels[model] === undefined) {
      changes.push({ id: 'model.added.' + model, kind: 'model', text: `新增计费模型：${model}` });
    }
  }
  for (const model of Object.keys(previousModels).sort()) {
    if (nextModels[model] === undefined) {
      changes.push({ id: 'model.removed.' + model, kind: 'model', text: `移除计费模型：${model}` });
    }
  }

  for (const model of Object.keys(nextModels).sort()) {
    const before = previousModels[model];
    const after = nextModels[model];
    if (before === undefined || after === undefined) continue;
    for (const bucket of BUCKET_KEYS) {
      for (const period of PERIOD_KEYS) {
        const from = before.prices?.[bucket]?.[period];
        const to = after.prices?.[bucket]?.[period];
        if (typeof to !== 'number' || typeof from !== 'number' || Math.abs(to - from) < 1e-9) continue;
        changes.push({
          id: `price.${model}.${bucket}.${period}`,
          kind: 'price',
          model,
          bucket,
          period,
          from,
          to,
          text: `${model} · ${BUCKET_LABELS[bucket]} · ${PERIOD_LABELS[period]}：${formatMoney(from, currency)} → ${formatMoney(to, currency)} / 百万 tokens`,
        });
      }
    }
    if ((before.version ?? '') !== (after.version ?? '') && after.version) {
      changes.push({
        id: `version.${model}`,
        kind: 'model',
        text: `${model} 模型版本：${before.version ?? '未知'} → ${after.version}`,
      });
    }
  }

  if ((previous.peakRule ?? '') !== (next.peakRule ?? '') && next.peakRule !== '') {
    changes.push({
      id: 'rule.peak',
      kind: 'rule',
      from: previous.peakRule ?? '',
      to: next.peakRule,
      text: '高峰/空闲时段规则有变化',
    });
  }
  if ((previous.aliases ?? '') !== (next.aliases ?? '') && next.aliases !== '') {
    changes.push({
      id: 'rule.aliases',
      kind: 'rule',
      from: previous.aliases ?? '',
      to: next.aliases,
      text: '模型名 / 别名说明有变化',
    });
  }
  const feeKeys = ['search', 'fetch'];
  for (const key of feeKeys) {
    const before = previous.extras?.[key];
    const after = next.extras?.[key];
    if (before === undefined && after === undefined) continue;
    if (before === undefined || after === undefined) {
      changes.push({
        id: `fee.${key}`,
        kind: 'fee',
        text: `${key === 'search' ? 'Search' : 'Fetch'} 计费项${after === undefined ? '被移除' : '新增'}`,
      });
      continue;
    }
    if (before.price !== after.price || before.unit !== after.unit) {
      changes.push({
        id: `fee.${key}`,
        kind: 'fee',
        from: before.price,
        to: after.price,
        text: `${key === 'search' ? 'Search' : 'Fetch'} 价格：${formatMoney(before.price, before.currency ?? currency)} → ${formatMoney(after.price, after.currency ?? currency)}（${after.unit}）`,
      });
    }
  }
  if ((previous.deduction ?? '') !== (next.deduction ?? '') && next.deduction !== '') {
    changes.push({ id: 'rule.deduction', kind: 'rule', text: '扣费规则说明有变化' });
  }

  return { hasChanges: changes.length > 0, changes };
}

/**
 * Compare one downloaded document with the last acknowledged snapshot.
 *
 * @param {object|null} previous last acknowledged snapshot
 *   (`{facts, hash, checkedAt, sourceUrl}`) or null on first observation.
 * @param {string} markdown downloaded pricing markdown.
 * @param {{checkedAt?: string, sourceUrl?: string}} [meta] observation metadata.
 * @returns {object} `{kind, changed, snapshot, changes, reason}` where `kind`
 *   is `'pricing'` for parsed price/rule changes, `'document'` when only the
 *   document text changed, or `'unchanged'`; on first observation `changed` is
 *   false and `snapshot` is the new baseline.
 */
export function evaluatePricingMarkdown(previous, markdown, meta = {}) {
  const facts = parsePricingFacts(markdown);
  const snapshot = {
    facts,
    hash: contentHashOf(markdown),
    checkedAt: meta.checkedAt ?? new Date().toISOString(),
    sourceUrl: meta.sourceUrl ?? DEFAULT_PRICING_URL,
  };
  if (previous === null || previous === undefined) {
    return { changed: false, kind: 'baseline', snapshot, changes: [], reason: '首次建立官方定价快照' };
  }
  const diff = diffPricingFacts(previous.facts, facts);
  if (diff.hasChanges) {
    return { changed: true, kind: 'pricing', snapshot, changes: diff.changes, reason: '官方定价内容有变化' };
  }
  if (previous.hash !== snapshot.hash) {
    return {
      changed: true,
      kind: 'document',
      snapshot,
      changes: [{
        id: 'document',
        kind: 'document',
        text: '官方定价文档内容有变化（价格表未解析出差异，可能涉及计费方式或说明）',
      }],
      reason: '官方定价文档有更新',
    };
  }
  return { changed: false, kind: 'unchanged', snapshot, changes: [], reason: '与上次快照一致' };
}

/**
 * User message that starts the rule-update session. The session must run with
 * the plugin checkout as its working directory so the agent can edit
 * `logic.js`, the tests and the docs.
 *
 * @param {object} options
 * @param {object[]} options.changes detected changes from `evaluatePricingMarkdown`.
 * @param {string} options.checkedAt detection time (ISO).
 * @param {string} options.sourceUrl pricing markdown URL.
 * @param {string} [options.pluginDir] plugin checkout shown to the agent.
 * @param {string} [options.repoUrl] public repository.
 * @returns {string} user message.
 */
export function buildPricingUpdatePrompt(options) {
  const {
    changes = [],
    checkedAt = new Date().toISOString(),
    sourceUrl = DEFAULT_PRICING_URL,
    pluginDir = '',
    repoUrl = 'https://github.com/FeiYuSS/dsh-cny-cost',
  } = options ?? {};
  const lines = [
    '请更新 dsh-cny-cost 插件的 DeepSeek 官方计费规则快照。',
    '',
    '## 背景',
    `插件 host 半侧的官方定价检查器在 ${checkedAt} 发现官方定价页内容有变化：`,
    `- 机器可读来源：${sourceUrl}`,
    `- 官方价格页：${PRICING_RULE_URL}`,
    '- 当前插件内置快照：2026-11-10（logic.js 的 DEFAULT_RATE_DATE / DEFAULT_FAMILIES / DEFAULT_MODELS / DEFAULT_HOLIDAYS）',
  ];
  if (pluginDir) lines.push(`- 本机插件源码目录：${pluginDir}`);
  if (repoUrl) lines.push(`- 公开仓库：${repoUrl}`);
  lines.push('', '## 检测到的变化', '');
  if (changes.length === 0) lines.push('- （未列出的文档级变化，请直接以官方最新页面为准）');
  for (const change of changes) {
    lines.push(`- ${change.text}`);
    if (change.kind === 'rule' && change.from && change.to) {
      lines.push(`  - 旧：${change.from}`);
      lines.push(`  - 新：${change.to}`);
    }
  }
  lines.push(
    '',
    '## 任务',
    '1. 打开上面的机器可读来源与官方价格页，逐项核对：模型列表与别名、缓存命中/未命中/输出单价、高峰/空闲时段规则、法定节假日、Search/Fetch 计费单位，以及任何计费方式变化。',
    '2. 修改插件源码 logic.js：DEFAULT_RATE_DATE、DEFAULT_FAMILIES、DEFAULT_MODELS，节假日有变化时更新 DEFAULT_HOLIDAYS；若计费方式变化，同步调整 periodOf/bucketsOf/view 逻辑。',
    '3. 更新 test/logic.test.mjs 的期望值，补充或修改覆盖新规则的用例；运行 npm run check，确认全部测试与 locale/包一致性检查通过。',
    '4. 更新 README.md / README.en.md 的「计价依据」表格与维护说明、CHANGELOG.md 的变更条目。',
    '5. 汇报：改了哪些文件、新旧价格对照、测试结果。**在我说「发布」之前不要 git push，也不要发 npm。**',
    '',
    '完成后请把「检测到的变化」与官方页面逐条对上，遇到无法确认的差异先来问我。',
  );
  return lines.join('\n');
}
