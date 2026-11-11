# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  `node --test test/logic.test.mjs` (17 tests).
- Locale files (`en`, `zh`) and a static locale-key consistency check.
