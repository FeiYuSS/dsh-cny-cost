import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_HOLIDAYS,
  bucketsOf,
  costNanoOf,
  foldTokenCost,
  foldTurnCost,
  initTokenCost,
  initTurnCost,
  normalizeConfig,
  periodOf,
  priceFor,
  resolveFamily,
  usageOf,
  validateTokenCostState,
  validateTokenCostView,
  validateTurnCostState,
  validateTurnCostView,
  viewTokenCost,
  viewTurnCost,
} from '../logic.js';

const cfg = normalizeConfig();

/** Epoch milliseconds for one Beijing wall-clock instant (UTC+8, no DST). */
function beijing(y, month, day, hour, minute = 0) {
  return Date.UTC(y, month - 1, day, hour - 8, minute, 0, 0);
}

const PEAK_TUE = beijing(2026, 11, 10, 10, 0); // Tuesday, inside 09:00-12:00
const IDLE_TUE = beijing(2026, 11, 10, 12, 30); // Tuesday, lunch break

function header(seq, provider, model, time) {
  return { type: 'request/header', seq, time, data: { header: { config: { provider, model } } } };
}

function message(seq, turn, step, usage, time, messageId) {
  const data = { turn, step, usage, stream: [] };
  if (messageId !== undefined) data.message = { id: messageId };
  return { type: 'assistant/message', seq, time, data };
}

function attempt(seq, turn, step, usage, time) {
  return {
    type: 'assistant/attempt',
    seq,
    time,
    data: { turn, step, stream: [{ type: 'chunk', time, chunk: { type: 'usage', usage } }] },
  };
}

function usage(input, output, cacheRead = 0, cacheWrite = undefined) {
  const value = { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead };
  if (cacheWrite !== undefined) value.cacheWriteTokens = cacheWrite;
  return value;
}

function foldCost(events, config = cfg) {
  let state = initTokenCost();
  for (const event of events) state = foldTokenCost(state, event, config);
  return state;
}

function foldTurns(events, config = cfg) {
  let state = initTurnCost();
  for (const event of events) state = foldTurnCost(state, event, config);
  return state;
}

// ---------------------------------------------------------------------------
// Pricing table and period classification
// ---------------------------------------------------------------------------

test('peak/idle boundaries follow the official Beijing-time rule', () => {
  const cases = [
    [beijing(2026, 11, 10, 8, 59), 'idle'],
    [beijing(2026, 11, 10, 9, 0), 'peak'],
    [beijing(2026, 11, 10, 11, 59), 'peak'],
    [beijing(2026, 11, 10, 12, 0), 'idle'],
    [beijing(2026, 11, 10, 13, 59), 'idle'],
    [beijing(2026, 11, 10, 14, 0), 'peak'],
    [beijing(2026, 11, 10, 17, 59), 'peak'],
    [beijing(2026, 11, 10, 18, 0), 'idle'],
    [beijing(2026, 11, 10, 23, 30), 'idle'],
    [beijing(2026, 11, 10, 3, 0), 'idle'],
  ];
  for (const [time, expected] of cases) {
    assert.equal(periodOf(time, cfg), expected, new Date(time).toISOString());
  }
});

test('weekends and statutory holidays are idle for the whole day', () => {
  assert.equal(periodOf(beijing(2026, 11, 14, 10, 0), cfg), 'idle', 'Saturday');
  assert.equal(periodOf(beijing(2026, 11, 15, 10, 0), cfg), 'idle', 'Sunday');
  assert.equal(periodOf(beijing(2026, 10, 1, 10, 0), cfg), 'idle', 'National Day');
  assert.equal(periodOf(beijing(2026, 2, 17, 10, 0), cfg), 'idle', 'Spring Festival');
  assert.equal(periodOf(beijing(2026, 10, 8, 10, 0), cfg), 'peak', 'first workday after the holiday');
  assert.ok(DEFAULT_HOLIDAYS.includes('2026-10-01'));
});

test('periodMode override forces one class', () => {
  const peak = normalizeConfig({ periodMode: 'peak' });
  const idle = normalizeConfig({ periodMode: 'idle' });
  const weekend = beijing(2026, 11, 14, 10, 0);
  assert.equal(periodOf(weekend, peak), 'peak');
  assert.equal(periodOf(PEAK_TUE, idle), 'idle');
});

test('model aliases and nanoyuan prices match the official table', () => {
  assert.equal(resolveFamily('deepseek-flash', cfg), 'flash');
  assert.equal(resolveFamily('deepseek-v4-flash', cfg), 'flash');
  assert.equal(resolveFamily('deepseek-v4-flash-vision-exp', cfg), 'flash');
  assert.equal(resolveFamily('deepseek-v4-pro', cfg), 'pro');
  assert.equal(resolveFamily('gpt-5', cfg), null);

  assert.deepEqual(priceFor('deepseek-flash', 'peak', cfg), { hitN: 40, missN: 2000, outN: 8000, writeN: 0 });
  assert.deepEqual(priceFor('deepseek-flash', 'idle', cfg), { hitN: 20, missN: 1000, outN: 4000, writeN: 0 });
  assert.deepEqual(priceFor('deepseek-v4-pro', 'peak', cfg), { hitN: 300, missN: 9000, outN: 27000, writeN: 0 });
  assert.deepEqual(priceFor('deepseek-v4-pro', 'idle', cfg), { hitN: 150, missN: 4500, outN: 13500, writeN: 0 });
  assert.equal(priceFor('gpt-5', 'peak', cfg), null);

  // 1M hit + 1M miss + 1M output at flash peak = 0.04 + 2 + 8 CNY.
  const cost = costNanoOf({ hit: 1_000_000, miss: 1_000_000, write: 0, out: 1_000_000 }, priceFor('deepseek-flash', 'peak', cfg));
  assert.equal(cost, 10.04 * 1e9);
});

test('normalizeConfig fills defaults and rejects malformed input', () => {
  assert.equal(cfg.rateDate, '2026-11-10');
  assert.deepEqual(cfg.models, {
    'deepseek-flash': 'flash',
    'deepseek-v4-flash': 'flash',
    'deepseek-v4-flash-vision-exp': 'flash',
    'deepseek-v4-pro': 'pro',
  });
  assert.throws(() => normalizeConfig({ nope: 1 }), /unknown config key/);
  assert.throws(() => normalizeConfig({ models: { x: 'ghost' } }), /unknown family/);
  assert.throws(() => normalizeConfig({ holidays: ['2026/01/01'] }), /invalid date/);
  assert.throws(() => normalizeConfig({ families: { flash: { peak: { hit: -1 } } } }), /non-negative/);

  const custom = normalizeConfig({
    rateDate: '2027-01-01',
    families: { flash: { peak: { miss: 4 } } },
    writePrice: 0.5,
    holidays: ['2026-01-01'],
    periodMode: 'auto',
  });
  assert.equal(custom.rateDate, '2027-01-01');
  assert.equal(custom.families.flash.peak.miss, 4);
  assert.equal(custom.families.flash.peak.hit, 0.04, 'unspecified fields keep their defaults');
  assert.equal(priceFor('deepseek-flash', 'peak', custom).writeN, 500);
});

// ---------------------------------------------------------------------------
// Attempt extraction
// ---------------------------------------------------------------------------

test('usage extraction mirrors the host fold', () => {
  assert.deepEqual(bucketsOf(usage(10, 20, 30)), { hit: 30, miss: 10, write: 0, out: 20 });
  assert.deepEqual(bucketsOf(usage(10, 20, 30, 5)), { hit: 30, miss: 10, write: 5, out: 20 });

  const event = message(1, 1, 1, usage(1, 2, 3), PEAK_TUE);
  assert.deepEqual(usageOf(event), usage(1, 2, 3));

  const attemptEvent = attempt(2, 1, 1, usage(4, 5, 6), PEAK_TUE);
  assert.deepEqual(usageOf(attemptEvent), usage(4, 5, 6));

  assert.equal(usageOf({ type: 'step/start', seq: 3, time: PEAK_TUE, data: { turn: 1, step: 1 } }), undefined);
});

// ---------------------------------------------------------------------------
// Session-level fold
// ---------------------------------------------------------------------------

test('a settled attempt is priced at its own period and model', () => {
  const state = foldCost([
    header(1, 'deepseek-account', 'deepseek-flash', PEAK_TUE),
    message(2, 1, 1, usage(100, 200, 300), PEAK_TUE),
  ]);
  const totals = state.totals;
  assert.deepEqual(totals.tokens, { hit: 300, miss: 100, write: 0, out: 200 });
  assert.equal(totals.pricedAttempts, 1);
  assert.equal(totals.unpricedAttempts, 0);
  // 300*40 + 100*2000 + 200*8000 = 1_812_000 nanoyuan = 0.001812 CNY
  assert.equal(totals.costNano, 1_812_000);
  assert.equal(totals.peak.costNano, 1_812_000);
  assert.equal(totals.idle.costNano, 0);
  assert.equal(state.totals.models['deepseek-account\u0000deepseek-flash'].family, 'flash');

  const view = viewTokenCost(state, cfg);
  validateTokenCostView(view);
  assert.equal(view.rateDate, '2026-11-10');
  assert.equal(view.totals.costNano, 1_812_000);
  assert.equal(view.rates.length, 2);
});

test('a replacement sample within one attempt replaces instead of adding', () => {
  const state = foldCost([
    header(1, 'deepseek-account', 'deepseek-flash', PEAK_TUE),
    message(2, 1, 1, usage(100, 200, 300), PEAK_TUE),
    message(3, 1, 1, usage(10, 20, 30), PEAK_TUE),
  ]);
  assert.deepEqual(state.totals.tokens, { hit: 30, miss: 10, write: 0, out: 20 });
  assert.equal(state.totals.pricedAttempts, 1);
  assert.equal(state.totals.costNano, 1200 + 20000 + 160000);
});

test('identical repeated samples keep the state reference', () => {
  const events = [
    header(1, 'deepseek-account', 'deepseek-flash', PEAK_TUE),
    message(2, 1, 1, usage(100, 200, 300), PEAK_TUE),
  ];
  const state = foldCost(events);
  const same = foldTokenCost(state, message(3, 1, 1, usage(100, 200, 300), PEAK_TUE), cfg);
  assert.equal(same, state);
  const ignored = foldTokenCost(state, { type: 'tool/call', seq: 4, time: PEAK_TUE, data: {} }, cfg);
  assert.equal(ignored, state);
});

test('a retried attempt is billed separately', () => {
  const state = foldCost([
    header(1, 'deepseek-account', 'deepseek-flash', PEAK_TUE),
    message(2, 1, 1, usage(100, 200, 300), PEAK_TUE),
    { type: 'llm/retry-started', seq: 3, time: PEAK_TUE, data: { turn: 1, step: 1 } },
    attempt(4, 1, 1, usage(10, 20, 30), PEAK_TUE),
  ]);
  assert.deepEqual(state.totals.tokens, { hit: 330, miss: 110, write: 0, out: 220 });
  assert.equal(state.totals.pricedAttempts, 2);
});

test('non-official models count as unpriced and cost nothing', () => {
  const state = foldCost([
    header(1, 'openai', 'gpt-5', PEAK_TUE),
    message(2, 1, 1, usage(1000, 1000, 0), PEAK_TUE),
  ]);
  assert.equal(state.totals.costNano, 0);
  assert.equal(state.totals.pricedAttempts, 0);
  assert.equal(state.totals.unpricedAttempts, 1);
  assert.equal(viewTokenCost(state, cfg).totals.unpricedAttempts, 1);
});

test('model switch mid-session is priced per attempt', () => {
  const state = foldCost([
    header(1, 'deepseek-account', 'deepseek-flash', PEAK_TUE),
    message(2, 1, 1, usage(0, 1_000_000, 0), PEAK_TUE),
    header(3, 'deepseek-account', 'deepseek-v4-pro', IDLE_TUE),
    message(4, 2, 1, usage(0, 1_000_000, 0), IDLE_TUE),
  ]);
  // flash peak output 8 CNY + pro idle output 13.5 CNY
  assert.equal(state.totals.costNano, 21.5 * 1e9);
  assert.equal(state.totals.peak.attempts, 1);
  assert.equal(state.totals.idle.attempts, 1);
  assert.equal(viewTokenCost(state, cfg).models.length, 2);
});

test('token-cost state passes its own state validator', () => {
  const state = foldCost([
    header(1, 'deepseek-account', 'deepseek-flash', PEAK_TUE),
    message(2, 1, 1, usage(100, 200, 300), PEAK_TUE),
  ]);
  assert.equal(validateTokenCostState(state), state);
  assert.throws(() => validateTokenCostState({}), /state\.last|state\.totals/);
});

// ---------------------------------------------------------------------------
// Per-turn fold
// ---------------------------------------------------------------------------

test('turn records publish on turn/end with closing sequence', () => {
  const state = foldTurns([
    header(1, 'deepseek-account', 'deepseek-flash', PEAK_TUE),
    message(2, 1, 1, usage(100, 200, 300), PEAK_TUE, 'message-a'),
    message(3, 1, 2, usage(0, 1000, 0), PEAK_TUE, 'message-b'),
    { type: 'turn/end', seq: 4, time: PEAK_TUE, data: { turn: 1, reason: { kind: 'completed' } } },
  ]);
  assert.equal(state.turns.length, 1);
  const turn = state.turns[0];
  assert.equal(turn.turn, 1);
  assert.equal(turn.closeSeq, 4);
  assert.equal(turn.messageId, 'message-b');
  assert.equal(turn.attempts, 2);
  assert.equal(turn.period, 'peak');
  assert.equal(turn.family, 'flash');
  assert.equal(turn.costNano, 1_812_000 + (1_000 * 8_000));
  assert.deepEqual(turn.tokens, { hit: 300, miss: 100, write: 0, out: 1200 });

  const view = viewTurnCost(state, cfg);
  validateTurnCostView(view);
  assert.equal(view.turns[0].closeSeq, 4);
  assert.equal(view.turns[0].messageId, 'message-b');
});

test('turn/end for another turn does not publish the open turn', () => {
  const state = foldTurns([
    message(1, 1, 1, usage(1, 2, 3), PEAK_TUE),
    { type: 'turn/end', seq: 2, time: PEAK_TUE, data: { turn: 2, reason: { kind: 'completed' } } },
  ]);
  assert.equal(state.turns.length, 0);
  assert.equal(state.open.turn, 1);
});

test('turn replacement semantics and multi-turn ordering hold', () => {
  const state = foldTurns([
    header(1, 'deepseek-account', 'deepseek-flash', PEAK_TUE),
    message(2, 1, 1, usage(100, 200, 300), PEAK_TUE),
    message(3, 1, 1, usage(10, 20, 30), PEAK_TUE),
    { type: 'turn/end', seq: 4, time: PEAK_TUE, data: { turn: 1, reason: { kind: 'completed' } } },
    message(5, 2, 1, usage(0, 100, 0), IDLE_TUE),
    { type: 'turn/end', seq: 6, time: IDLE_TUE, data: { turn: 2, reason: { kind: 'completed' } } },
  ]);
  assert.equal(state.turns.length, 2);
  assert.deepEqual(state.turns[0].tokens, { hit: 30, miss: 10, write: 0, out: 20 });
  assert.equal(state.turns[0].costNano, 1200 + 20000 + 160000);
  assert.equal(state.turns[1].period, 'idle');
  assert.equal(state.turns[1].turn, 2);
  assert.equal(validateTurnCostState(state), state);
});

test('turn view exposes rates so the chat line can show formulas', () => {
  const state = foldTurns([
    header(1, 'deepseek-account', 'deepseek-flash', PEAK_TUE),
    message(2, 1, 1, usage(0, 1000, 0), PEAK_TUE),
    { type: 'turn/end', seq: 3, time: PEAK_TUE, data: { turn: 1, reason: { kind: 'completed' } } },
  ]);
  const view = viewTurnCost(state, cfg);
  const flash = view.rates.find((rate) => rate.family === 'flash');
  assert.equal(flash.peak.out, 8);
  assert.equal(flash.idle.out, 4);
});
