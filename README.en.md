# dsh-cny-cost · live token cost for DeepSeek Harness

[![CI](https://github.com/FeiYuSS/dsh-cny-cost/actions/workflows/ci.yml/badge.svg)](https://github.com/FeiYuSS/dsh-cny-cost/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web plugin that turns
session token usage of **DeepSeek official models** into a **theoretical CNY cost** using the
official peak/off-peak pricing. The cost is shown in three places:

| Where | What |
|---|---|
| Composer dock (`conversation.composer.dock`) | a `¥0.0123` cost pill next to the host usage statistics; hover for a reading bubble, click for the session cost detail |
| Completed-turn action row (`conversation.chat.assistant-actions`) | a `¥0.0042` pill at the end of the copy/like/usage/time row; hover for this-turn/total/buckets/period, click for the turn detail |
| Detail panels | total cost, per-model × per-period formulas (`tokens × price = subtotal`), period split, per-turn table, pricing snapshot and caveats |

Non-official models are not priced; mixed sessions price only the official calls and report the
unpriced call count in the panel. The bundled `zh` and `en` locales are selected from the
Harness UI language.

## Pricing

Source: <https://api-docs.deepseek.com/zh-cn/quick_start/pricing/> (built-in snapshot
**2026-11-10**), CNY per million tokens.

| Model | Input · cache hit (off-peak/peak) | Input · cache miss (off-peak/peak) | Output (off-peak/peak) |
|---|---|---|---|
| `deepseek-flash` (also `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`) | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| `deepseek-v4-pro` | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / 27.0 |

- **Peak**: Beijing time, Monday to Friday (PRC statutory holidays excluded), 09:00–12:00 and
  14:00–18:00; everything else is **off-peak** (half price).
- Cost = cache-hit input + cache-miss input + output; cache writes are not priced by default
  (`writePrice: 0`). Reasoning tokens are already part of output tokens. Search/Fetch per-request
  fees are not token based and are not included.
- Amounts are accumulated in integer nanoyuan (1 CNY = 1e9 nanoyuan); each request is classified
  by the completion timestamp recorded in the session log.
- Prices and holidays are manual snapshots in `logic.js` (`DEFAULT_FAMILIES`,
  `DEFAULT_HOLIDAYS`) and must be refreshed when DeepSeek changes prices or publishes the next
  year's holiday schedule. Configured prices are stored at 0.001 CNY/M resolution; finer prices
  are rejected instead of silently rounded.

## Install

This package is a standard DSH bundle, so the `cordis.patch.yml` declared by
`dsh.bundle.patch` is applied automatically when it is installed — do not copy its `insert`
entry into your profile patch.

### From GitHub (recommended)

Enter this spec in the Plugins page install box (the HTTPS repository URL works too):

```text
github:FeiYuSS/dsh-cny-cost
```

Or with the CLI (`<profile>` is your profile name, for example `desktop`):

```text
dsh plugin --profile <profile> add github:FeiYuSS/dsh-cny-cost
```

DSH installs it as a git dependency through pnpm and enables the bundle. Refresh the Harness page
once after the first install so the browser half loads. To upgrade a third-party bundle,
uninstall and install the new version.

### From a local directory (development)

Install an absolute directory path (or a `file:` / `link:` absolute path), for example:

```text
C:\Users\you\src\dsh-cny-cost
```

There is no build step; reinstall or wait for HMR after editing the source.

## Configuration

Override the plugin `config` in the profile patch (the object replaces the default; unset fields
keep their default values):

```yaml
- id: cny-cost
  name: dsh-cny-cost
  config:
    rateDate: '2026-11-10'
    models:
      deepseek-flash: flash
      deepseek-v4-flash: flash
      deepseek-v4-flash-vision-exp: flash
      deepseek-v4-pro: pro
    families:
      flash:
        peak: { hit: 0.04, miss: 2, out: 8 }
        idle: { hit: 0.02, miss: 1, out: 4 }
      pro:
        peak: { hit: 0.30, miss: 9, out: 27 }
        idle: { hit: 0.15, miss: 4.5, out: 13.5 }
    writePrice: 0
    periodMode: auto        # auto | peak | idle
    # holidays replaces the built-in table as a whole (not merged):
    # holidays:
    #   - '2026-01-01'
```

Config changes restart the plugin and re-fold the session log; typos are rejected at activation
with a clear log message.

## Token consistency

The plugin registers two host-side session projections (`deepseekTokenCost`, `deepseekTurnCost`)
that fold committed session log events. The fold mirrors the host
`@deepseek-ai/dsh-token-meter` `tokenUsage` projection: repeated usage samples in the same
turn/step replace each other, `llm/retry-started` closes the replacement scope, and
`assistant/attempt` uses the last usage chunk in the stream. As a result the priced
hit/miss/write/output buckets equal the token counts shown by the host; session token totals
include unpriced non-official calls, but the cost only prices configured models.

## Known limits

- The number is a **theoretical cost**, not a bill; actual charges come from the provider usage
  and official settlement.
- Boundary requests are classified by completion time; a second-level skew is possible.
- Make-up working weekends (调休) are still counted as weekends/off-peak, because only the
  holiday table is modelled; use `periodMode: peak` for a conservative estimate.
- Sub-agents are separate sessions with their own cost; forked sessions include the copied
  history (matching the host `tokenUsage` projection).
- Compressed/pruned history is still billed (whole-session accounting), and attempts without a
  usage report are not billed.

## Development

Pure pricing and fold logic lives in `logic.js` with no dependencies:

```text
npm test                  # node --test test/logic.test.mjs
npm run check:locale      # every t('key') exists in both locale blocks
npm run check:package     # package name, patch row, loader id and exports agree
npm run check             # all of the above
```

`scripts/verify-against-host.mjs` cross-checks the plugin fold against an independent reference
implementation and the host's persisted `tokenUsage` checkpoint (set `DSH_HOME` to your DSH home):

```text
DSH_HOME="$HOME/.dsh" node scripts/verify-against-host.mjs <sessionId>
```

## Contributing

Issues and pull requests are welcome. Run `npm run check` before opening a pull request; CI runs
the same checks on Node 22 and 24.

## License

[MIT](./LICENSE)
