/**
 * Independent end-to-end check for the installed `dsh-cny-cost` plugin.
 *
 * Decompresses one persisted session log, folds it twice - once through the
 * plugin's own `logic.js` and once through a small independently written
 * implementation that hard-codes the official rates - and compares both
 * against the persisted projection checkpoint rows (`tokenUsage` is host
 * authored, so it is the cross-check for token buckets).
 *
 * Usage: node scripts/verify-against-host.mjs <sessionId>
 *        (set DSH_HOME to your DSH home directory, e.g. %USERPROFILE%\.dsh)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  foldTokenCost,
  foldTurnCost,
  initTokenCost,
  initTurnCost,
  normalizeConfig,
} from '../logic.js';

const HOME = process.env.DSH_HOME;
if (!HOME) throw new Error('DSH_HOME is not set');

const sessionId = process.argv[2];
if (!sessionId) throw new Error('usage: node scripts/verify-against-host.mjs <sessionId> (DSH_HOME must point at your DSH home directory)');
const sessionsRoot = path.join(HOME, 'sessions');
const cachePath = path.join(HOME, 'storages', 'session_projcache', 'sessions', sessionId + '.json');

function findLog() {
  for (const dir of fs.readdirSync(sessionsRoot)) {
    const candidate = path.join(sessionsRoot, dir, sessionId, 'session.v4.jsonl.zstd');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('session log not found for ' + sessionId);
}

/** Session logs are concatenated single-frame zstd members, one per append. */
function readLog(file) {
  const buf = fs.readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  let at = buf.indexOf(magic);
  while (at !== -1) {
    starts.push(at);
    at = buf.indexOf(magic, at + 1);
  }
  const parts = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = index + 1 < starts.length ? starts[index + 1] : buf.length;
    parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)));
  }
  const lines = Buffer.concat(parts).toString('utf8').split(/\r?\n/).filter(Boolean);
  const header = JSON.parse(lines[0]);
  const events = lines.slice(1).map((line) => JSON.parse(line));
  return { header, events };
}

// ---------------------------------------------------------------------------
// Independently written reference implementation (do not share code with the
// plugin): official rates, Beijing peak rule, replacement fold.
// ---------------------------------------------------------------------------
const REF_RATES = {
  'deepseek-flash': { peak: { hit: 0.04, miss: 2, out: 8 }, idle: { hit: 0.02, miss: 1, out: 4 } },
  'deepseek-v4-flash': { peak: { hit: 0.04, miss: 2, out: 8 }, idle: { hit: 0.02, miss: 1, out: 4 } },
  'deepseek-v4-flash-vision-exp': { peak: { hit: 0.04, miss: 2, out: 8 }, idle: { hit: 0.02, miss: 1, out: 4 } },
  'deepseek-v4-pro': { peak: { hit: 0.3, miss: 9, out: 27 }, idle: { hit: 0.15, miss: 4.5, out: 13.5 } },
};

function refPeriod(timeMs) {
  const date = new Date(timeMs + 8 * 3600 * 1000);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return 'idle';
  const hour = date.getUTCHours();
  const peak = (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
  return peak ? 'peak' : 'idle';
}

function refUsage(event) {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage;
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined;
  const stream = event.data.stream;
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (record && record.type === 'chunk' && record.chunk && record.chunk.type === 'usage') return record.chunk.usage;
  }
  return undefined;
}

function refBuckets(usage) {
  const asInt = (value) => (typeof value === 'number' && value > 0 ? Math.round(value) : 0);
  return {
    hit: asInt(usage.cacheReadTokens),
    miss: asInt(usage.inputTokens),
    write: asInt(usage.cacheWriteTokens),
    out: asInt(usage.outputTokens),
  };
}

function newAcc() {
  return {
    costNano: 0,
    attempts: 0,
    tokens: { hit: 0, miss: 0, write: 0, out: 0 },
    peak: { attempts: 0, costNano: 0 },
    idle: { attempts: 0, costNano: 0 },
  };
}

function apply(acc, sample, sign) {
  acc.costNano += sign * sample.costNano;
  acc.attempts += sign;
  acc.tokens.hit += sign * sample.buckets.hit;
  acc.tokens.miss += sign * sample.buckets.miss;
  acc.tokens.write += sign * sample.buckets.write;
  acc.tokens.out += sign * sample.buckets.out;
  const period = acc[sample.period];
  period.attempts += sign;
  period.costNano += sign * sample.costNano;
}

function refFold(events, upToSeq) {
  let provider = null;
  let model = null;
  let last = null;
  const totals = newAcc();
  const turns = [];
  let open = null;

  for (const event of events) {
    if (upToSeq !== undefined && event.seq > upToSeq) break;
    if (event.type === 'request/header') {
      const config = event.data?.header?.config;
      if (config && config.provider && config.model) {
        provider = config.provider;
        model = config.model;
      }
      continue;
    }
    if (event.type === 'request/context') {
      if (event.data && event.data.provider && event.data.model) {
        provider = event.data.provider;
        model = event.data.model;
      }
      continue;
    }
    if (event.type === 'llm/retry-started') {
      if (last && last.turn === event.data.turn && last.step === event.data.step) last = null;
      continue;
    }
    if (event.type === 'turn/end') {
      if (open && open.turn === event.data.turn) {
        turns.push({ turn: open.turn, closeSeq: event.seq, acc: open.acc });
        open = null;
      }
      continue;
    }
    const usage = refUsage(event);
    if (!usage) continue;
    const data = event.data;
    const buckets = refBuckets(usage);
    const same = last !== null && last.turn === data.turn && last.step === data.step;
    if (same && last.buckets.hit === buckets.hit && last.buckets.miss === buckets.miss
      && last.buckets.write === buckets.write && last.buckets.out === buckets.out) continue;

    const period = refPeriod(event.time);
    const rate = model && REF_RATES[model] ? REF_RATES[model][period] : null;
    const costNano = rate === null
      ? 0
      : Math.round(buckets.hit * rate.hit * 1000) + Math.round(buckets.miss * rate.miss * 1000) + Math.round(buckets.out * rate.out * 1000);
    const sample = { turn: data.turn, step: data.step, buckets, period, costNano };

    if (same) apply(totals, last, -1);
    apply(totals, sample, 1);

    if (!open || open.turn !== data.turn) open = { turn: data.turn, acc: newAcc() };
    if (same && open.turn === last.turn) apply(open.acc, last, -1);
    apply(open.acc, sample, 1);

    last = sample;
  }

  return { provider, model, totals, turns, open };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const logFile = findLog();
const { events } = readLog(logFile);
const endSeq = events.length > 0 ? events[events.length - 1].seq : -1;
const checkpoint = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : null;
const rows = checkpoint ? checkpoint.record.rows : {};
const pluginCfg = normalizeConfig();

function foldPlugin(upToSeq) {
  let cost = initTokenCost();
  let turns = initTurnCost();
  for (const event of events) {
    if (upToSeq !== undefined && event.seq > upToSeq) break;
    cost = foldTokenCost(cost, event, pluginCfg);
    turns = foldTurnCost(turns, event, pluginCfg);
  }
  return { cost, turns };
}

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) {
    console.log('   actual  :', JSON.stringify(actual));
    console.log('   expected:', JSON.stringify(expected));
  }
}

console.log('log:', logFile);
console.log('events:', events.length, 'end seq:', endSeq);
if (rows.tokenUsage) {
  console.log('tokenUsage row seq:', rows.tokenUsage.seq, 'cost row seq:', rows.deepseekTokenCost?.seq, 'turn row seq:', rows.deepseekTurnCost?.seq);
}

const refFull = refFold(events, endSeq);
const pluginFull = foldPlugin(endSeq);

check('full log token buckets match', pluginFull.cost.totals.tokens, refFull.totals.tokens);
check('full log peak/idle attempts match', {
  peak: pluginFull.cost.totals.peak.attempts,
  idle: pluginFull.cost.totals.idle.attempts,
}, {
  peak: refFull.totals.peak.attempts,
  idle: refFull.totals.idle.attempts,
});
check('full log cost matches', pluginFull.cost.totals.costNano, refFull.totals.costNano);
check('full log closed-turn count matches', pluginFull.turns.turns.length, refFull.turns.length);
check('full log closed-turn costs match', pluginFull.turns.turns.map((turn) => [turn.turn, turn.closeSeq, turn.costNano]),
  refFull.turns.map((turn) => [turn.turn, turn.closeSeq, turn.acc.costNano]));

if (rows.deepseekTokenCost) {
  const row = rows.deepseekTokenCost;
  const watermarked = foldPlugin(row.seq);
  check('checkpoint state equals re-fold at its watermark (totals)', {
    costNano: watermarked.cost.totals.costNano,
    tokens: watermarked.cost.totals.tokens,
    pricedAttempts: watermarked.cost.totals.pricedAttempts,
    unpricedAttempts: watermarked.cost.totals.unpricedAttempts,
  }, {
    costNano: row.val.totals.costNano,
    tokens: row.val.totals.tokens,
    pricedAttempts: row.val.totals.pricedAttempts,
    unpricedAttempts: row.val.totals.unpricedAttempts,
  });
  if (rows.tokenUsage) {
    const usage = rows.tokenUsage.val.totals;
    check('priced buckets equal the host tokenUsage projection', {
      hit: row.val.totals.tokens.hit,
      miss: row.val.totals.tokens.miss,
      write: row.val.totals.tokens.write,
      out: row.val.totals.tokens.out,
    }, {
      hit: usage.cacheReadTokens,
      miss: usage.uncachedInputTokens,
      write: usage.cacheWriteTokens,
      out: usage.outputTokens,
    });
  }
}

if (rows.deepseekTurnCost) {
  const row = rows.deepseekTurnCost;
  const watermarked = foldPlugin(row.seq);
  check('checkpoint per-turn rows equal re-fold at their watermark',
    watermarked.turns.turns.map((turn) => [turn.turn, turn.closeSeq, turn.costNano, turn.tokens]),
    row.val.turns.map((turn) => [turn.turn, turn.closeSeq, turn.costNano, turn.tokens]));
}

console.log('');
console.log('current session cost (plugin fold, full log):',
  (pluginFull.cost.totals.costNano / 1e9).toFixed(9), 'CNY',
  '| peak attempts', pluginFull.cost.totals.peak.attempts,
  '| idle attempts', pluginFull.cost.totals.idle.attempts);
console.log('closed turns:', pluginFull.turns.turns.map((turn) => ({
  turn: turn.turn, closeSeq: turn.closeSeq, cny: (turn.costNano / 1e9).toFixed(9), period: turn.period,
})));
if (pluginFull.turns.open) {
  console.log('open turn:', pluginFull.turns.open.turn, 'cost so far', (pluginFull.turns.open.totals.costNano / 1e9).toFixed(9), 'CNY');
}
console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exitCode = failures === 0 ? 0 : 1;
