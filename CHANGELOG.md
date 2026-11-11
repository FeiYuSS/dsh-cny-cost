# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-11

### Added

- Official pricing auto-check, implemented entirely in the browser half:
  - a GitHub Actions job mirrors the official `pricing.md` into
    `pricing/official-zh.json` hourly (the official docs site sends no CORS
    header, so a page cannot fetch it directly);
  - the client polls that static snapshot, diffs prices/model aliases/peak
    rules/Search-Fetch fees against the acknowledged baseline and reports
    every change;
  - a global dialog (DSH UI primitives, with a token-styled fallback) asks
    before starting an update session;
  - confirming creates a new session with a prepared prompt that makes the
    agent re-check the official page, update `logic.js` defaults, tests and
    docs, and report back without publishing;
  - a “Token pricing” tab under Settings → Built-in plugins configures the
    switch, the interval (1 hour – 30 days), check-now and manual rule update,
    and shows check/mirror/pending state.
- `pricing-watch.js` pure parser/diff/prompt helpers shared by CI and tests;
  the browser half embeds the same logic, and a test extracts and compares it.
- `scripts/sync-pricing-mirror.mjs` and the `pricing-mirror` workflow.

### Notes

- Runtime stays self-contained: no new Host API, no self-hosted service.
  Pricing-watch settings live in the browser's localStorage.
- Detection latency is bounded by the hourly mirror sync; the settings tab
  warns when the mirror is older than 7 days.

## [0.1.0] - 2026-11-11

### Added

- Composer-dock cost pill showing the theoretical CNY cost of the current
  session, with hover reading and a click-through detail panel.
- Per-turn cost pill at the end of the completed-turn action row.
- Detail panels with per-model, per-period pricing formulas
  (`tokens × price = subtotal`), period split, per-turn table, and the
  pricing snapshot date.
- Official DeepSeek pricing groups (`deepseek-flash`, `deepseek-v4-pro`) with
  peak/off-peak windows, PRC statutory holidays, and configurable overrides.
- Host-side session projections (`deepseekTokenCost`, `deepseekTurnCost`)
  that fold the committed session log with the same replacement semantics as
  the host `tokenUsage` projection, in integer nanoyuan.
- Zero runtime dependencies; pure pricing/fold logic covered by
  `node --test test/logic.test.mjs` (21 tests).
- Locale files (`en`, `zh`) and static locale-key / package-consistency checks.

### Notes

- Published as `dsh-cny-cost`. Earlier development snapshots used the working
  name `dsh-token-cost`, which belongs to an unrelated npm package; the final
  package, cordis row id (`cny-cost`) and client loader id are all renamed to
  avoid collisions.
- Pricing is stored at 0.001 CNY per million tokens (1 nanoyuan per token);
  finer configured prices are rejected at activation instead of being rounded.
- Usage buckets are kept verbatim from the log, so the priced token totals
  always equal the host `tokenUsage` projection.
