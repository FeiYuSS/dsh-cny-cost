import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_FAMILIES, DEFAULT_MODELS } from '../logic.js';
import { diffPricingFacts as nodeDiff } from '../pricing-watch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const clientSource = fs.readFileSync(path.join(repoRoot, 'client.js'), 'utf8');
const mirror = JSON.parse(fs.readFileSync(path.join(repoRoot, 'pricing', 'official-zh.json'), 'utf8'));

/** Extract the browser-embedded pure pricing watcher from client.js. */
function loadEmbedded() {
  const start = clientSource.indexOf('//<<<pricing-watch');
  const end = clientSource.indexOf('//>>>pricing-watch');
  assert.ok(start !== -1 && end > start, 'client.js must keep the pricing-watch markers');
  const block = clientSource.slice(start, end);
  const evaluate = new Function(block + '\nreturn PRICING_WATCH;');
  return evaluate();
}

const embedded = loadEmbedded();

test('the committed pricing mirror is a valid extracted snapshot', () => {
  assert.equal(mirror.version, 1);
  assert.equal(mirror.sourceUrl, 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md');
  assert.match(mirror.hash, /^[a-f0-9]{64}$/);
  const models = Object.keys(mirror.facts.models);
  assert.ok(models.includes('deepseek-flash'));
  assert.ok(models.includes('deepseek-v4-pro'));
  for (const model of models) {
    for (const bucket of ['inputCacheHit', 'inputCacheMiss', 'output']) {
      for (const period of ['idle', 'peak']) {
        assert.equal(typeof mirror.facts.models[model].prices[bucket][period], 'number', `${model} ${bucket} ${period}`);
      }
    }
  }
  assert.equal(typeof mirror.facts.peakRule, 'string');
  assert.equal(mirror.facts.extras.search.price, 5);
});

test('the embedded snapshot is a well-formed baseline', () => {
  assert.match(embedded.BUNDLED.hash, /^[a-f0-9]{64}$/);
  assert.equal(embedded.BUNDLED.facts.currency, 'CNY');
  assert.ok(Object.keys(embedded.BUNDLED.facts.models).length >= 2);
});

test('the embedded snapshot matches the pricing rules in logic.js', () => {
  const mapping = {
    'deepseek-flash': 'flash',
    'deepseek-v4-pro': 'pro',
  };
  for (const [model, family] of Object.entries(mapping)) {
    const facts = embedded.BUNDLED.facts.models[model];
    assert.ok(facts, model + ' must be in the bundled snapshot');
    const rates = DEFAULT_FAMILIES[family];
    assert.equal(facts.prices.inputCacheHit.peak, rates.peak.hit, model + ' cache-hit peak');
    assert.equal(facts.prices.inputCacheHit.idle, rates.idle.hit, model + ' cache-hit idle');
    assert.equal(facts.prices.inputCacheMiss.peak, rates.peak.miss, model + ' cache-miss peak');
    assert.equal(facts.prices.inputCacheMiss.idle, rates.idle.miss, model + ' cache-miss idle');
    assert.equal(facts.prices.output.peak, rates.peak.out, model + ' output peak');
    assert.equal(facts.prices.output.idle, rates.idle.out, model + ' output idle');
  }
  assert.ok(Object.keys(DEFAULT_MODELS).length >= 4);
});

test('the embedded diff matches the Node diff implementation', () => {
  const previous = structuredClone(embedded.BUNDLED.facts);
  const next = structuredClone(previous);
  next.models['deepseek-flash'].prices.output.peak = 10;
  next.extras.search.price = 6;
  const embeddedChanges = embedded.diffPricingFacts(previous, next);
  const nodeChanges = nodeDiff(previous, next);
  assert.equal(embeddedChanges.hasChanges, true);
  assert.deepEqual(
    embeddedChanges.changes.map((change) => change.text),
    nodeChanges.changes.map((change) => change.text),
  );
});

test('the update prompt names the official source, changes and verification steps', () => {
  const prompt = embedded.buildPrompt({
    changes: [{
      id: 'price.x',
      kind: 'price',
      text: 'deepseek-flash · 输出 · 高峰：8 元 → 10 元 / 百万 tokens',
    }],
    detectedAt: '2026-11-11T09:00:00.000Z',
    fetchedAt: '2026-11-11T08:30:00.000Z',
  });
  assert.match(prompt, /api-docs\.deepseek\.com\/zh-cn\/quick_start\/pricing\.md/);
  assert.match(prompt, /deepseek-flash · 输出 · 高峰/);
  assert.match(prompt, /logic\.js/);
  assert.match(prompt, /npm run check/);
  assert.match(prompt, /不要 git push/);
  assert.match(prompt, /2026-11-11T09:00:00\.000Z/);
  assert.match(prompt, /raw\.githubusercontent\.com/);
});

test('client.js module loads and registers its slots without browser services', () => {
  const registrations = [];
  const captured = { definition: null };
  const fakeWindow = {
    __ModuleLoader__: { load: (definition) => { captured.definition = definition; } },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  const fakeDocument = {
    head: { appendChild: () => {} },
    querySelector: () => null,
    createElement: () => ({ setAttribute: () => {}, textContent: '' }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const fakeRequire = (spec) => {
    if (spec === 'react' || spec === 'react-dom') return {};
    throw new Error('unexpected require ' + spec);
  };

  const load = new Function('window', 'document', 'navigator', 'require', clientSource);
  load(fakeWindow, fakeDocument, {}, fakeRequire);
  assert.ok(captured.definition, 'client.js must register a module definition');
  assert.equal(captured.definition.id, 'dsh-cny-cost');

  const exports = captured.definition.factory(fakeRequire);
  assert.deepEqual(exports.inject.slice(0, 3), ['slots', 'sessions', 'locale']);

  const ctx = {
    slots: {
      inject: (name, register) => { register(); return () => {}; },
      register: (options) => { registrations.push(options.name); return () => {}; },
    },
    get: () => undefined,
    effect: (callback) => { callback(); return () => {}; },
  };
  exports.apply(ctx);
  assert.deepEqual(registrations.sort(), [
    'conversation.chat.assistant-actions',
    'conversation.composer.dock',
    'settings.plugins.tab',
    'shell.overlay',
  ]);
});
