/**
 * Host half of the `dsh-cny-cost` bundle.
 *
 * Registers two session projections that fold the committed session log into
 * theoretical CNY cost under the official DeepSeek pricing:
 *
 * - `deepseekTokenCost`: whole-session aggregates (cost, token buckets, peak /
 *   idle split, per-model split) consumed by the composer cost chip.
 * - `deepseekTurnCost`: one record per completed turn, published on
 *   `turn/end`, consumed by the per-turn cost line in the chat flow.
 *
 * Both units are client-visible (`wire.view`) and excluded from session
 * summaries (`summary: false`) because no session-list row renders them.
 *
 * The projections fold pure JSON state over committed events; pricing and
 * fold rules live in `logic.js` so `node --test` covers them without a Host.
 *
 * @module dsh-cny-cost
 */
import {
  normalizeConfig,
  initTokenCost,
  foldTokenCost,
  viewTokenCost,
  validateTokenCostState,
  validateTokenCostView,
  initTurnCost,
  foldTurnCost,
  viewTurnCost,
  validateTurnCostState,
  validateTurnCostView,
} from './logic.js';

export const inject = ['sessionProjections'];

/**
 * Activate the bundle: validate config and install both projection units on
 * this plugin's fiber (the fiber releases them when the plugin unloads).
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context.
 * @param {unknown} config row config from the profile patch, may be undefined.
 * @returns {Promise<void>}
 */
export async function apply(ctx, config) {
  let cfg;
  try {
    cfg = normalizeConfig(config);
  } catch (error) {
    ctx.logger.error(error);
    throw error;
  }

  await ctx.sessionProjections.register({
    key: 'deepseekTokenCost',
    stateVersion: 1,
    // The projection registry only calls `.parse` on these schemas; plain
    // validators keep this bundle dependency-free in a linked install.
    stateSchema: { parse: validateTokenCostState },
    init: () => initTokenCost(),
    apply: (state, event) => foldTokenCost(state, event, cfg),
    wire: {
      viewSchema: { parse: validateTokenCostView },
      view: (state) => viewTokenCost(state, cfg),
      summary: false,
    },
  });

  await ctx.sessionProjections.register({
    key: 'deepseekTurnCost',
    // v2 records the closing Assistant message id so the chat action row can
    // attach the per-turn cost pill to `conversation.chat.assistant-actions`.
    stateVersion: 2,
    stateSchema: { parse: validateTurnCostState },
    init: () => initTurnCost(),
    apply: (state, event) => foldTurnCost(state, event, cfg),
    wire: {
      viewSchema: { parse: validateTurnCostView },
      view: (state) => viewTurnCost(state, cfg),
      summary: false,
    },
  });

  ctx.logger.info(
    `cny-cost: pricing ${cfg.rateDate} installed (models: ${Object.keys(cfg.models).join(', ')})`,
  );
}
