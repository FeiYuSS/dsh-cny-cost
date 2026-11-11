/**
 * Pure pricing and session-log fold logic for the dsh-cny-cost plugin.
 *
 * This module has no imports so the Host plugin (`index.js`) and
 * `node --test` can share exactly the same code.
 *
 * The fold semantics mirror the host's `tokenUsage` projection
 * (@deepseek-ai/dsh-token-meter): one sample per settled model attempt,
 * a replacement sample within the same turn/step, and `llm/retry-started`
 * closing that replacement scope. Priced token buckets therefore always
 * equal the host's displayed token counts.
 */

/** Official pricing snapshot date shown in the detail panel. */
export const DEFAULT_RATE_DATE = '2026-11-10';

/**
 * CNY per 1,000,000 tokens, from the official DeepSeek pricing page
 * (https://api-docs.deepseek.com/zh-cn/quick_start/pricing/).
 * Idle price is half of the peak price.
 */
export const DEFAULT_FAMILIES = {
  flash: {
    peak: { hit: 0.04, miss: 2, out: 8 },
    idle: { hit: 0.02, miss: 1, out: 4 },
  },
  pro: {
    peak: { hit: 0.3, miss: 9, out: 27 },
    idle: { hit: 0.15, miss: 4.5, out: 13.5 },
  },
};

/** Official model id (and still-callable alias) -> rate family. */
export const DEFAULT_MODELS = {
  'deepseek-flash': 'flash',
  'deepseek-v4-flash': 'flash',
  'deepseek-v4-flash-vision-exp': 'flash',
  'deepseek-v4-pro': 'pro',
};

/**
 * Statutory holidays of the PRC in 2026 (国办发明电〔2025〕7号).
 * These days are off-peak for the whole day; weekend make-up workdays stay
 * weekends and are off-peak by the weekday rule already.
 */
export const DEFAULT_HOLIDAYS = [
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
  '2026-10-06', '2026-10-07',
];

const CONFIG_KEYS = new Set(['rateDate', 'models', 'families', 'writePrice', 'periodMode', 'holidays']);
const FAMILY_KEYS = new Set(['peak', 'idle']);
const BUCKET_KEYS = new Set(['hit', 'miss', 'out']);
const PERIOD_MODES = new Set(['auto', 'peak', 'idle']);
const HOLIDAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Internal prices are stored in nanoyuan per token. A price is given in CNY per
 * million tokens, so one unit step of 0.001 CNY/M is exactly one nanoyuan per
 * token; finer prices cannot be represented and are rejected instead of rounded.
 */
const NANO_PER_PRICE_STEP = 1000;

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
/** Peak windows in Beijing wall-clock hours: [start, end). */
const PEAK_WINDOWS = [[9, 12], [14, 18]];

function fail(message) {
  throw new Error(`cny-cost: ${message}`);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeNumber(value, fallback, what) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${what} must be a non-negative number`);
  }
  return value;
}

/**
 * Convert a CNY-per-million-token price into integer nanoyuan per token.
 * Prices finer than the storage resolution are rejected rather than rounded, so
 * the breakdown a user configures always matches the amount charged.
 */
function priceNanoOf(value, what) {
  const nano = value * NANO_PER_PRICE_STEP;
  if (Math.abs(nano - Math.round(nano)) > 1e-6) {
    fail(`${what} must be a multiple of 0.001 CNY per million tokens`);
  }
  return Math.round(nano);
}

function cloneFamily(family) {
  return {
    peak: { hit: family.peak.hit, miss: family.peak.miss, out: family.peak.out },
    idle: { hit: family.idle.hit, miss: family.idle.miss, out: family.idle.out },
  };
}

function checkKeys(object, allowed, what) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail(`unknown ${what} key "${key}"`);
  }
}

/**
 * Validate and normalize the plugin config, filling defaults.
 * @param {unknown} raw config object from the loader row, may be undefined.
 * @returns normalized config used by every fold and view.
 */
export function normalizeConfig(raw) {
  if (raw === undefined || raw === null) raw = {};
  if (!isPlainObject(raw)) fail('config must be an object');
  checkKeys(raw, CONFIG_KEYS, 'config');

  const rateDate = typeof raw.rateDate === 'string' && raw.rateDate.trim() !== ''
    ? raw.rateDate.trim()
    : DEFAULT_RATE_DATE;

  const writePrice = nonNegativeNumber(raw.writePrice, 0, 'writePrice');

  const periodMode = raw.periodMode === undefined || raw.periodMode === null ? 'auto' : raw.periodMode;
  if (!PERIOD_MODES.has(periodMode)) fail('periodMode must be auto, peak, or idle');

  const families = {};
  for (const name of Object.keys(DEFAULT_FAMILIES)) {
    families[name] = cloneFamily(DEFAULT_FAMILIES[name]);
  }
  if (raw.families !== undefined && raw.families !== null) {
    if (!isPlainObject(raw.families)) fail('families must be an object');
    for (const name of Object.keys(raw.families)) {
      const given = raw.families[name];
      if (!isPlainObject(given)) fail(`families.${name} must be an object`);
      checkKeys(given, FAMILY_KEYS, `families.${name}`);
      if (families[name] === undefined) {
        families[name] = { peak: { hit: 0, miss: 0, out: 0 }, idle: { hit: 0, miss: 0, out: 0 } };
      }
      for (const period of Object.keys(given)) {
        const rates = given[period];
        if (!isPlainObject(rates)) fail(`families.${name}.${period} must be an object`);
        checkKeys(rates, BUCKET_KEYS, `families.${name}.${period}`);
        for (const bucket of Object.keys(rates)) {
          families[name][period][bucket] = nonNegativeNumber(
            rates[bucket],
            families[name][period][bucket],
            `families.${name}.${period}.${bucket}`,
          );
        }
      }
    }
  }

  const models = { ...DEFAULT_MODELS };
  if (raw.models !== undefined && raw.models !== null) {
    if (!isPlainObject(raw.models)) fail('models must be an object');
    for (const model of Object.keys(raw.models)) {
      const family = raw.models[model];
      if (typeof family !== 'string' || family === '') fail(`models.${model} must name a rate family`);
      if (families[family] === undefined) fail(`models.${model} names unknown family "${family}"`);
      models[model] = family;
    }
  }

  let holidays = DEFAULT_HOLIDAYS;
  if (raw.holidays !== undefined && raw.holidays !== null) {
    if (!Array.isArray(raw.holidays)) fail('holidays must be an array of YYYY-MM-DD strings');
    for (const day of raw.holidays) {
      if (typeof day !== 'string' || !HOLIDAY_PATTERN.test(day)) {
        fail(`holidays contains an invalid date: ${String(day)}`);
      }
    }
    holidays = [...raw.holidays];
  }

  const priceNano = {};
  const rateView = [];
  for (const name of Object.keys(families).sort()) {
    const family = families[name];
    priceNano[name] = {};
    for (const period of ['peak', 'idle']) {
      priceNano[name][period] = {
        hitN: priceNanoOf(family[period].hit, `families.${name}.${period}.hit`),
        missN: priceNanoOf(family[period].miss, `families.${name}.${period}.miss`),
        outN: priceNanoOf(family[period].out, `families.${name}.${period}.out`),
        writeN: priceNanoOf(writePrice, 'writePrice'),
      };
    }
    rateView.push({
      family: name,
      write: writePrice,
      peak: { ...family.peak },
      idle: { ...family.idle },
    });
  }

  return {
    rateDate,
    writePrice,
    periodMode,
    families,
    models,
    holidays,
    holidaySet: new Set(holidays),
    priceNano,
    rateView,
  };
}

/**
 * Classify one request time as peak or idle under the official rule.
 * @param {number} timeMs epoch milliseconds of the request.
 * @param {ReturnType<typeof normalizeConfig>} cfg normalized config.
 * @returns {'peak' | 'idle'}
 */
export function periodOf(timeMs, cfg) {
  if (cfg.periodMode === 'peak') return 'peak';
  if (cfg.periodMode === 'idle') return 'idle';
  const beijing = new Date(timeMs + BEIJING_OFFSET_MS);
  const weekday = beijing.getUTCDay();
  if (weekday === 0 || weekday === 6) return 'idle';
  const hour = beijing.getUTCHours();
  let inWindow = false;
  for (const [start, end] of PEAK_WINDOWS) {
    if (hour >= start && hour < end) {
      inWindow = true;
      break;
    }
  }
  if (!inWindow) return 'idle';
  const day = beijing.toISOString().slice(0, 10);
  return cfg.holidaySet.has(day) ? 'idle' : 'peak';
}

/**
 * Resolve the rate family of one model id.
 * @returns {string | null} family name, or null for a non-official model.
 */
export function resolveFamily(model, cfg) {
  if (typeof model !== 'string') return null;
  return cfg.models[model] ?? null;
}

/**
 * Resolve nanoyuan (1e-9 CNY) prices per token for one model and period.
 * @returns {{ hitN: number, missN: number, writeN: number, outN: number } | null}
 */
export function priceFor(model, period, cfg) {
  const family = resolveFamily(model, cfg);
  if (family === null) return null;
  const table = cfg.priceNano[family];
  return table === undefined ? null : table[period];
}

/**
 * One provider usage counter, kept exactly as the host `tokenUsage` projection
 * keeps it (`value ?? 0`) so the priced buckets stay equal to the token counts
 * the host displays, including fractional or negative correction samples.
 * @param {unknown} value raw usage field from the session log.
 * @returns {number} usage count.
 */
function usageCount(value) {
  if (value === undefined || value === null) return 0;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Provider usage buckets in the host's tokenUsage shape. */
export function bucketsOf(usage) {
  return {
    hit: usageCount(usage.cacheReadTokens),
    miss: usageCount(usage.inputTokens),
    write: usageCount(usage.cacheWriteTokens),
    out: usageCount(usage.outputTokens),
  };
}

function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (record && record.type === 'chunk' && record.chunk && record.chunk.type === 'usage') {
      return record.chunk.usage;
    }
  }
  return undefined;
}

/** The usage one settled model attempt reports, mirroring the host fold. */
export function usageOf(event) {
  const data = event.data;
  if (data === undefined || data === null) return undefined;
  if (event.type === 'assistant/message' && data.usage !== undefined) return data.usage;
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined;
  return lastStreamUsage(data.stream);
}

/** Cost in nanoyuan for one bucket sample under one resolved price. */
export function costNanoOf(buckets, price) {
  return (buckets.hit * price.hitN)
    + (buckets.miss * price.missN)
    + (buckets.write * price.writeN)
    + (buckets.out * price.outN);
}

function zeroBuckets() {
  return { hit: 0, miss: 0, write: 0, out: 0 };
}

function zeroPeriod() {
  return { attempts: 0, costNano: 0, tokens: zeroBuckets() };
}

function zeroTotals() {
  return {
    costNano: 0,
    pricedAttempts: 0,
    unpricedAttempts: 0,
    tokens: zeroBuckets(),
    peak: zeroPeriod(),
    idle: zeroPeriod(),
    models: {},
  };
}

function cloneBuckets(buckets) {
  return { hit: buckets.hit, miss: buckets.miss, write: buckets.write, out: buckets.out };
}

function clonePeriod(period) {
  return { attempts: period.attempts, costNano: period.costNano, tokens: cloneBuckets(period.tokens) };
}

function cloneTotals(totals) {
  const models = {};
  for (const key of Object.keys(totals.models)) {
    const model = totals.models[key];
    models[key] = {
      provider: model.provider,
      model: model.model,
      family: model.family,
      attempts: model.attempts,
      costNano: model.costNano,
      tokens: cloneBuckets(model.tokens),
      peak: clonePeriod(model.peak),
      idle: clonePeriod(model.idle),
    };
  }
  return {
    costNano: totals.costNano,
    pricedAttempts: totals.pricedAttempts,
    unpricedAttempts: totals.unpricedAttempts,
    tokens: cloneBuckets(totals.tokens),
    peak: clonePeriod(totals.peak),
    idle: clonePeriod(totals.idle),
    models,
  };
}

function addBuckets(target, buckets, sign) {
  target.hit += sign * buckets.hit;
  target.miss += sign * buckets.miss;
  target.write += sign * buckets.write;
  target.out += sign * buckets.out;
}

function bucketsEqual(left, right) {
  return left.hit === right.hit
    && left.miss === right.miss
    && left.write === right.write
    && left.out === right.out;
}

function modelKey(sample) {
  return `${sample.provider ?? ''}\u0000${sample.model ?? ''}`;
}

function applySample(totals, sample, sign) {
  totals.costNano += sign * sample.costNano;
  if (sample.family === null) totals.unpricedAttempts += sign;
  else totals.pricedAttempts += sign;
  addBuckets(totals.tokens, sample.buckets, sign);

  const period = sample.period === 'peak' ? totals.peak : totals.idle;
  period.attempts += sign;
  period.costNano += sign * sample.costNano;
  addBuckets(period.tokens, sample.buckets, sign);

  const key = modelKey(sample);
  let entry = totals.models[key];
  if (entry === undefined) {
    if (sign < 0) fail('internal subtract of an unknown model bucket');
    entry = {
      provider: sample.provider ?? '',
      model: sample.model ?? '',
      family: sample.family,
      attempts: 0,
      costNano: 0,
      tokens: zeroBuckets(),
      peak: zeroPeriod(),
      idle: zeroPeriod(),
    };
    totals.models[key] = entry;
  }
  entry.attempts += sign;
  entry.costNano += sign * sample.costNano;
  addBuckets(entry.tokens, sample.buckets, sign);
  const entryPeriod = sample.period === 'peak' ? entry.peak : entry.idle;
  entryPeriod.attempts += sign;
  entryPeriod.costNano += sign * sample.costNano;
  addBuckets(entryPeriod.tokens, sample.buckets, sign);
  if (entry.attempts <= 0) delete totals.models[key];
}

function buildSample(state, event, data, buckets, cfg) {
  const period = periodOf(event.time, cfg);
  const family = resolveFamily(state.model, cfg);
  const price = family === null ? null : (cfg.priceNano[family]?.[period] ?? null);
  return {
    turn: data.turn,
    step: data.step,
    buckets: cloneBuckets(buckets),
    period,
    provider: state.provider,
    model: state.model,
    family: price === null ? null : family,
    costNano: price === null ? 0 : costNanoOf(buckets, price),
  };
}

/** Route tracking shared by both projection units. */
function trackRoute(state, event) {
  if (event.type === 'request/header') {
    const config = event.data?.header?.config;
    if (!config || typeof config.provider !== 'string' || typeof config.model !== 'string') return state;
    if (state.provider === config.provider && state.model === config.model) return state;
    return { ...state, provider: config.provider, model: config.model };
  }
  if (event.type === 'request/context') {
    const data = event.data;
    if (!data || typeof data.provider !== 'string' || typeof data.model !== 'string') return state;
    if (state.provider === data.provider && state.model === data.model) return state;
    return { ...state, provider: data.provider, model: data.model };
  }
  return state;
}

/** Session-level cost state: whole-log aggregate of priced attempts. */
export function initTokenCost() {
  return { provider: null, model: null, last: null, totals: zeroTotals() };
}

/**
 * Fold one committed event into the session-level cost aggregate.
 * Returns the same state reference for events that change nothing.
 */
export function foldTokenCost(state, event, cfg) {
  const routed = trackRoute(state, event);
  if (routed !== state) return routed;

  if (event.type === 'llm/retry-started') {
    const data = event.data ?? {};
    if (state.last !== null && state.last.turn === data.turn && state.last.step === data.step) {
      return { ...state, last: null };
    }
    return state;
  }
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state;

  const usage = usageOf(event);
  if (usage === undefined) return state;
  const data = event.data ?? {};
  const buckets = bucketsOf(usage);
  const sameAttempt = state.last !== null && state.last.turn === data.turn && state.last.step === data.step;
  if (sameAttempt && bucketsEqual(state.last.buckets, buckets)) return state;

  const totals = cloneTotals(state.totals);
  if (sameAttempt) applySample(totals, state.last, -1);
  const sample = buildSample(state, event, data, buckets, cfg);
  applySample(totals, sample, 1);
  return { ...state, last: sample, totals };
}

/** Per-turn cost state: one published record per completed turn. */
export function initTurnCost() {
  return { provider: null, model: null, last: null, open: null, turns: [] };
}

function finishTurn(open, closeSeq) {
  const totals = open.totals;
  const families = [];
  for (const key of Object.keys(totals.models)) {
    const family = totals.models[key].family;
    if (typeof family === 'string' && !families.includes(family)) families.push(family);
  }
  const attempts = totals.peak.attempts + totals.idle.attempts;
  let period = 'none';
  if (totals.peak.attempts > 0 && totals.idle.attempts > 0) period = 'mixed';
  else if (totals.peak.attempts > 0) period = 'peak';
  else if (totals.idle.attempts > 0) period = 'idle';
  return {
    turn: open.turn,
    closeSeq,
    messageId: open.lastMessageId ?? null,
    costNano: totals.costNano,
    tokens: cloneBuckets(totals.tokens),
    attempts,
    pricedAttempts: totals.pricedAttempts,
    unpricedAttempts: totals.unpricedAttempts,
    period,
    family: families.length === 0 ? null : (families.length === 1 ? families[0] : 'mixed'),
    peak: { attempts: totals.peak.attempts, costNano: totals.peak.costNano, tokens: cloneBuckets(totals.peak.tokens) },
    idle: { attempts: totals.idle.attempts, costNano: totals.idle.costNano, tokens: cloneBuckets(totals.idle.tokens) },
  };
}

/**
 * Fold one committed event into the per-turn cost list.
 * A turn record is published when its `turn/end` event is folded.
 */
export function foldTurnCost(state, event, cfg) {
  const routed = trackRoute(state, event);
  if (routed !== state) return routed;

  if (event.type === 'llm/retry-started') {
    const data = event.data ?? {};
    if (state.last !== null && state.last.turn === data.turn && state.last.step === data.step) {
      return { ...state, last: null };
    }
    return state;
  }
  if (event.type === 'turn/end') {
    const data = event.data ?? {};
    if (state.open === null || state.open.turn !== data.turn) return state;
    return {
      ...state,
      open: null,
      turns: [...state.turns, finishTurn(state.open, event.seq)],
    };
  }
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state;

  const usage = usageOf(event);
  if (usage === undefined) return state;
  const data = event.data ?? {};
  const buckets = bucketsOf(usage);
  const sameAttempt = state.last !== null && state.last.turn === data.turn && state.last.step === data.step;
  if (sameAttempt && bucketsEqual(state.last.buckets, buckets)) return state;

  let open = state.open;
  if (open !== null && open.turn !== data.turn) {
    // Defensive: a new turn arrived without its predecessor closing in this log.
    open = null;
  }
  open = open === null
    ? { turn: data.turn, lastMessageId: null, totals: zeroTotals() }
    : { turn: open.turn, lastMessageId: open.lastMessageId ?? null, totals: cloneTotals(open.totals) };
  if (event.type === 'assistant/message' && data.message !== undefined && data.message !== null) {
    const messageId = data.message.id;
    if (typeof messageId === 'string' && messageId !== '') open.lastMessageId = messageId;
  }
  if (sameAttempt) applySample(open.totals, state.last, -1);
  const sample = buildSample(state, event, data, buckets, cfg);
  applySample(open.totals, sample, 1);
  return { ...state, last: sample, open };
}

function periodView(period) {
  return {
    attempts: period.attempts,
    costNano: period.costNano,
    tokens: cloneBuckets(period.tokens),
  };
}

/** Client-facing view of the session-level cost aggregate. */
export function viewTokenCost(state, cfg) {
  const totals = state.totals;
  const models = [];
  for (const key of Object.keys(totals.models).sort()) {
    const model = totals.models[key];
    models.push({
      provider: model.provider,
      model: model.model,
      family: model.family,
      attempts: model.attempts,
      costNano: model.costNano,
      tokens: cloneBuckets(model.tokens),
      peak: periodView(model.peak),
      idle: periodView(model.idle),
    });
  }
  return {
    rateDate: cfg.rateDate,
    currency: 'CNY',
    totals: {
      costNano: totals.costNano,
      pricedAttempts: totals.pricedAttempts,
      unpricedAttempts: totals.unpricedAttempts,
      tokens: cloneBuckets(totals.tokens),
    },
    periods: {
      peak: periodView(totals.peak),
      idle: periodView(totals.idle),
    },
    models,
    rates: cfg.rateView,
  };
}

/** Client-facing view of the per-turn cost list. */
export function viewTurnCost(state, cfg) {
  return {
    rateDate: cfg.rateDate,
    rates: cfg.rateView,
    currentTurn: state.open === null ? null : state.open.turn,
    turns: state.turns.map((turn) => ({
      turn: turn.turn,
      closeSeq: turn.closeSeq,
      messageId: turn.messageId ?? null,
      costNano: turn.costNano,
      tokens: cloneBuckets(turn.tokens),
      attempts: turn.attempts,
      pricedAttempts: turn.pricedAttempts,
      unpricedAttempts: turn.unpricedAttempts,
      period: turn.period,
      family: turn.family,
      peak: periodView(turn.peak),
      idle: periodView(turn.idle),
    })),
  };
}

function assertObject(value, what) {
  if (!isPlainObject(value)) fail(`${what} must be an object`);
}

function assertNumber(value, what) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} must be a finite number`);
}

function assertNonNegativeInt(value, what) {
  assertNumber(value, what);
  if (value < 0 || !Number.isInteger(value)) fail(`${what} must be a non-negative integer`);
}

function assertBucketsShape(buckets, what) {
  assertObject(buckets, what);
  for (const key of ['hit', 'miss', 'write', 'out']) assertNumber(buckets[key], `${what}.${key}`);
}

function assertPeriodShape(period, what) {
  assertObject(period, what);
  assertNonNegativeInt(period.attempts, `${what}.attempts`);
  assertNumber(period.costNano, `${what}.costNano`);
  assertBucketsShape(period.tokens, `${what}.tokens`);
}

function assertFamily(value, what) {
  if (value !== null && typeof value !== 'string') fail(`${what} must be a string or null`);
}

function assertSample(sample, what) {
  if (sample === null) return;
  assertObject(sample, what);
  assertNonNegativeInt(sample.turn, `${what}.turn`);
  assertNonNegativeInt(sample.step, `${what}.step`);
  assertNumber(sample.costNano, `${what}.costNano`);
  assertBucketsShape(sample.buckets, `${what}.buckets`);
  if (sample.period !== 'peak' && sample.period !== 'idle') fail(`${what}.period is invalid`);
  assertFamily(sample.family, `${what}.family`);
}

function assertOptionalId(value, what) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string') fail(`${what} must be a string or null`);
}

function assertTotalsShape(totals, what) {
  assertObject(totals, what);
  assertNumber(totals.costNano, `${what}.costNano`);
  assertNonNegativeInt(totals.pricedAttempts, `${what}.pricedAttempts`);
  assertNonNegativeInt(totals.unpricedAttempts, `${what}.unpricedAttempts`);
  assertBucketsShape(totals.tokens, `${what}.tokens`);
  assertPeriodShape(totals.peak, `${what}.peak`);
  assertPeriodShape(totals.idle, `${what}.idle`);
  assertObject(totals.models, `${what}.models`);
  for (const key of Object.keys(totals.models)) {
    const model = totals.models[key];
    const where = `${what}.models[${JSON.stringify(key)}]`;
    assertObject(model, where);
    if (typeof model.provider !== 'string') fail(`${where}.provider must be a string`);
    if (typeof model.model !== 'string') fail(`${where}.model must be a string`);
    assertFamily(model.family, `${where}.family`);
    assertNonNegativeInt(model.attempts, `${where}.attempts`);
    assertNumber(model.costNano, `${where}.costNano`);
    assertBucketsShape(model.tokens, `${where}.tokens`);
    assertPeriodShape(model.peak, `${where}.peak`);
    assertPeriodShape(model.idle, `${where}.idle`);
  }
}

function assertTurnRecordShape(turn, what) {
  assertObject(turn, what);
  assertNonNegativeInt(turn.turn, `${what}.turn`);
  assertNonNegativeInt(turn.closeSeq, `${what}.closeSeq`);
  assertOptionalId(turn.messageId, `${what}.messageId`);
  assertNumber(turn.costNano, `${what}.costNano`);
  assertBucketsShape(turn.tokens, `${what}.tokens`);
  assertNonNegativeInt(turn.attempts, `${what}.attempts`);
  assertNonNegativeInt(turn.pricedAttempts, `${what}.pricedAttempts`);
  assertNonNegativeInt(turn.unpricedAttempts, `${what}.unpricedAttempts`);
  if (!TURN_PERIODS.has(turn.period)) fail(`${what}.period is invalid`);
  assertFamily(turn.family, `${what}.family`);
  assertPeriodShape(turn.peak, `${what}.peak`);
  assertPeriodShape(turn.idle, `${what}.idle`);
}

const TURN_PERIODS = new Set(['peak', 'idle', 'mixed', 'none']);

/**
 * Shape validation for the session-level unit state (checkpoint restore path).
 * The projection registry only calls `.parse`, so this is a plain validator.
 */
export function validateTokenCostState(state) {
  assertObject(state, 'state');
  assertSample(state.last, 'state.last');
  assertTotalsShape(state.totals, 'state.totals');
  return state;
}

/** Shape validation for the per-turn unit state (checkpoint restore path). */
export function validateTurnCostState(state) {
  assertObject(state, 'state');
  assertSample(state.last, 'state.last');
  if (state.open !== null) {
    assertObject(state.open, 'state.open');
    assertNonNegativeInt(state.open.turn, 'state.open.turn');
    assertOptionalId(state.open.lastMessageId, 'state.open.lastMessageId');
    assertTotalsShape(state.open.totals, 'state.open.totals');
  }
  if (!Array.isArray(state.turns)) fail('state.turns must be an array');
  for (const turn of state.turns) assertTurnRecordShape(turn, 'state.turns[]');
  return state;
}

function assertRates(rates) {
  if (!Array.isArray(rates)) fail('view.rates must be an array');
  for (const rate of rates) {
    assertObject(rate, 'view.rates[]');
    if (typeof rate.family !== 'string') fail('view.rates[].family must be a string');
    assertNumber(rate.write, 'view.rates[].write');
    assertObject(rate.peak, 'view.rates[].peak');
    assertObject(rate.idle, 'view.rates[].idle');
    for (const period of ['peak', 'idle']) {
      for (const bucket of ['hit', 'miss', 'out']) {
        assertNumber(rate[period][bucket], `view.rates[].${period}.${bucket}`);
      }
    }
  }
}

/** Shape validation for the session-level client view. */
export function validateTokenCostView(view) {
  assertObject(view, 'view');
  if (typeof view.rateDate !== 'string') fail('view.rateDate must be a string');
  if (view.currency !== 'CNY') fail('view.currency must be CNY');
  assertObject(view.totals, 'view.totals');
  assertNumber(view.totals.costNano, 'view.totals.costNano');
  assertNonNegativeInt(view.totals.pricedAttempts, 'view.totals.pricedAttempts');
  assertNonNegativeInt(view.totals.unpricedAttempts, 'view.totals.unpricedAttempts');
  assertBucketsShape(view.totals.tokens, 'view.totals.tokens');
  assertObject(view.periods, 'view.periods');
  assertPeriodShape(view.periods.peak, 'view.periods.peak');
  assertPeriodShape(view.periods.idle, 'view.periods.idle');
  if (!Array.isArray(view.models)) fail('view.models must be an array');
  for (const model of view.models) {
    const what = 'view.models[]';
    assertObject(model, what);
    if (typeof model.provider !== 'string') fail(`${what}.provider must be a string`);
    if (typeof model.model !== 'string') fail(`${what}.model must be a string`);
    assertFamily(model.family, `${what}.family`);
    assertNonNegativeInt(model.attempts, `${what}.attempts`);
    assertNumber(model.costNano, `${what}.costNano`);
    assertBucketsShape(model.tokens, `${what}.tokens`);
    assertPeriodShape(model.peak, `${what}.peak`);
    assertPeriodShape(model.idle, `${what}.idle`);
  }
  assertRates(view.rates);
  return view;
}

/** Shape validation for the per-turn client view. */
export function validateTurnCostView(view) {
  assertObject(view, 'view');
  if (typeof view.rateDate !== 'string') fail('view.rateDate must be a string');
  assertRates(view.rates);
  if (!Array.isArray(view.turns)) fail('view.turns must be an array');
  for (const turn of view.turns) {
    const what = 'view.turns[]';
    assertObject(turn, what);
    assertNonNegativeInt(turn.turn, `${what}.turn`);
    assertNonNegativeInt(turn.closeSeq, `${what}.closeSeq`);
    assertOptionalId(turn.messageId, `${what}.messageId`);
    assertNumber(turn.costNano, `${what}.costNano`);
    assertBucketsShape(turn.tokens, `${what}.tokens`);
    assertNonNegativeInt(turn.attempts, `${what}.attempts`);
    assertNonNegativeInt(turn.pricedAttempts, `${what}.pricedAttempts`);
    assertNonNegativeInt(turn.unpricedAttempts, `${what}.unpricedAttempts`);
    if (!TURN_PERIODS.has(turn.period)) fail(`${what}.period is invalid`);
    assertFamily(turn.family, `${what}.family`);
    assertPeriodShape(turn.peak, `${what}.peak`);
    assertPeriodShape(turn.idle, `${what}.idle`);
  }
  return view;
}
