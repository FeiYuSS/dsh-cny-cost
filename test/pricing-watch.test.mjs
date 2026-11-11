import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPricingUpdatePrompt,
  contentHashOf,
  diffPricingFacts,
  evaluatePricingMarkdown,
  normalizeMarkdown,
  parsePricingFacts,
} from '../pricing-watch.js';

/** Synthetic official pricing document mirroring the published markdown shape. */
const BASE_MARKDOWN = [
  '# 模型 & 价格',
  '',
  '下表所列模型价格以“百万 tokens”为单位。',
  '',
  '***',
  '',
  '## 模型细节',
  '',
  '| 模型 | 模型 | 模型 | deepseek-flash(1) | deepseek-v4-pro |',
  '| --- | --- | --- | --- | --- |',
  '| BASE URL (OpenAI 格式) | BASE URL (OpenAI 格式) | BASE URL (OpenAI 格式) | <https://api.deepseek.com> | <https://api.deepseek.com> |',
  '| 模型版本 | 模型版本 | 模型版本 | DeepSeek-V4.1-Flash-1017 | DeepSeek-V4-Pro-0813 |',
  '| 价格(2) | 百万tokens输入 / （缓存命中） | 空闲时段 | 0.02元 | 0.15元 |',
  '| 价格(2) | 百万tokens输入 / （缓存命中） | 高峰时段 | 0.04元 | 0.30元 |',
  '| 价格(2) | 百万tokens输入 / （缓存未命中） | 空闲时段 | 1元 | 4.5元 |',
  '| 价格(2) | 百万tokens输入 / （缓存未命中） | 高峰时段 | 2元 | 9.0元 |',
  '| 价格(2) | 百万tokens输出 | 空闲时段 | 4元 | 13.5元 |',
  '| 价格(2) | 百万tokens输出 | 高峰时段 | 8元 | 27.0元 |',
  '',
  '(1) 模型名请使用 `deepseek-flash`。旧模型名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 仍可调用。',
  '',
  '(2) 空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段为**空闲**（半价）。',
  '',
  '***',
  '',
  '## 网页搜索与抓取价格',
  '',
  '| API | 计费单位 | 价格 |',
  '| --- | --- | --- |',
  '| Search | 每 1,000 次成功请求 | 5元 |',
  '| Fetch | 每 1,000 次成功请求 | 5元 |',
  '',
  '***',
  '',
  '## 扣费规则',
  '',
  '模型调用费用 = token 消耗量 × 模型单价；Search 和 Fetch 按上表中的成功请求次数计费。',
  '当充值余额与赠送余额同时存在时，优先扣减赠送余额。',
  '',
].join('\n');

function withPrice(markdown, from, to) {
  assert.ok(markdown.includes(from), 'fixture must contain ' + from);
  return markdown.replace(from, to);
}

test('parses the priced model table, rules and fees', () => {
  const facts = parsePricingFacts(BASE_MARKDOWN);
  assert.equal(facts.currency, 'CNY');
  assert.deepEqual(facts.models['deepseek-flash'].prices, {
    inputCacheHit: { idle: 0.02, peak: 0.04 },
    inputCacheMiss: { idle: 1, peak: 2 },
    output: { idle: 4, peak: 8 },
  });
  assert.equal(facts.models['deepseek-v4-pro'].prices.output.peak, 27);
  assert.equal(facts.models['deepseek-flash'].version, 'DeepSeek-V4.1-Flash-1017');
  assert.match(facts.peakRule, /9:00 - 12:00/);
  assert.match(facts.aliases, /deepseek-v4-flash/);
  assert.deepEqual(facts.extras.search, { unit: '每 1,000 次成功请求', price: 5, currency: 'CNY' });
  assert.match(facts.deduction, /备用金|充值余额/);
});

test('formatting-only edits keep the normalized content hash', () => {
  const reformatted = BASE_MARKDOWN.replace(/\|/g, '|  ');
  assert.equal(normalizeMarkdown(reformatted), normalizeMarkdown(BASE_MARKDOWN));
  assert.equal(contentHashOf(reformatted), contentHashOf(BASE_MARKDOWN));
});

test('evaluate establishes a baseline once, then reports unchanged', () => {
  const first = evaluatePricingMarkdown(null, BASE_MARKDOWN, {
    checkedAt: '2026-11-11T08:00:00.000Z',
    sourceUrl: 'https://example.test/pricing.md',
  });
  assert.equal(first.changed, false);
  assert.equal(first.kind, 'baseline');
  assert.equal(first.snapshot.checkedAt, '2026-11-11T08:00:00.000Z');
  assert.equal(first.snapshot.sourceUrl, 'https://example.test/pricing.md');

  const again = evaluatePricingMarkdown(first.snapshot, BASE_MARKDOWN);
  assert.equal(again.changed, false);
  assert.equal(again.kind, 'unchanged');
});

test('a price change is reported with model, bucket, period, old and new value', () => {
  const baseline = evaluatePricingMarkdown(null, BASE_MARKDOWN).snapshot;
  const changed = withPrice(BASE_MARKDOWN, '| 8元 |', '| 10元 |');
  const result = evaluatePricingMarkdown(baseline, changed);
  assert.equal(result.changed, true);
  assert.equal(result.kind, 'pricing');
  const price = result.changes.find((change) => change.kind === 'price');
  assert.ok(price, 'a price change must be reported');
  assert.equal(price.model, 'deepseek-flash');
  assert.equal(price.bucket, 'output');
  assert.equal(price.period, 'peak');
  assert.equal(price.from, 8);
  assert.equal(price.to, 10);
  assert.match(price.text, /deepseek-flash · 输出 · 高峰/);
  assert.match(price.text, /8 元 → 10 元/);
});

test('model changes, peak rule changes and fee changes are all detected', () => {
  const baseline = evaluatePricingMarkdown(null, BASE_MARKDOWN).snapshot;

  const addedModel = BASE_MARKDOWN
    .replace('| 模型 | 模型 | 模型 | deepseek-flash(1) | deepseek-v4-pro |', '| 模型 | 模型 | 模型 | deepseek-flash(1) | deepseek-v4-pro | deepseek-v5 |')
    .replace(/(\| 价格\(2\) \| 百万tokens输出 \| 高峰时段 \| 8元 \| 27\.0元 \|)/, '$1 54元 |');
  const modelResult = evaluatePricingMarkdown(baseline, addedModel);
  assert.ok(modelResult.changes.some((change) => change.id.startsWith('model.added.')));

  const ruleChanged = BASE_MARKDOWN.replace('9:00 - 12:00', '8:00 - 12:00');
  const ruleResult = evaluatePricingMarkdown(baseline, ruleChanged);
  assert.ok(ruleResult.changes.some((change) => change.id === 'rule.peak'));

  const feeChanged = BASE_MARKDOWN.replace('| Search | 每 1,000 次成功请求 | 5元 |', '| Search | 每 1,000 次成功请求 | 6元 |');
  const feeResult = evaluatePricingMarkdown(baseline, feeChanged);
  assert.ok(feeResult.changes.some((change) => change.id === 'fee.search'));
});

test('a prose-only change reports a document-level change', () => {
  const baseline = evaluatePricingMarkdown(null, BASE_MARKDOWN).snapshot;
  const prose = BASE_MARKDOWN.replace('下表所列模型价格以“百万 tokens”为单位。', '下表所列模型价格以“百万 tokens”为单位，价格可能随时调整。');
  const result = evaluatePricingMarkdown(baseline, prose);
  assert.equal(result.changed, true);
  assert.equal(result.kind, 'document');
  assert.equal(result.changes[0].kind, 'document');
});

test('the update prompt carries the source, changes and working instructions', () => {
  const baseline = evaluatePricingMarkdown(null, BASE_MARKDOWN).snapshot;
  const changed = withPrice(BASE_MARKDOWN, '| 4元 |', '| 5元 |');
  const result = evaluatePricingMarkdown(baseline, changed);
  const prompt = buildPricingUpdatePrompt({
    changes: result.changes,
    checkedAt: '2026-11-11T08:00:00.000Z',
    sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md',
    pluginDir: 'C:\\src\\dsh-cny-cost',
    repoUrl: 'https://github.com/FeiYuSS/dsh-cny-cost',
  });
  assert.match(prompt, /官方计费规则/);
  assert.match(prompt, /2026-11-11T08:00:00\.000Z/);
  assert.match(prompt, /deepseek-flash · 输出 · 空闲/);
  assert.match(prompt, /C:\\src\\dsh-cny-cost/);
  assert.match(prompt, /logic\.js/);
  assert.match(prompt, /npm run check/);
  assert.match(prompt, /不要 git push/);
});
