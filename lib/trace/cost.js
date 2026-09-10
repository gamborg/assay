/**
 * Cost estimation.
 *
 * Prices are USD per million tokens, current as of 2026-09. They are a snapshot,
 * not a source of truth --
 * they move, and a harness that silently reports stale numbers is worse than one
 * that admits it does not know. Unknown models report `null` rather than zero,
 * so a missing price never masquerades as a free run.
 *
 * Override per target with `pricing: { input, output }` in the config.
 */

const PRICE_TABLE = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Anything served from your own hardware has no per-token price. */
const FREE_PROVIDERS = new Set(['mock', 'local']);

/**
 * @param {{model: string, provider: string, pricing?: {input: number, output: number}}} target
 * @param {{inputTokens: number, outputTokens: number}} usage
 * @returns {number|null} estimated USD, or null when the price is unknown
 */
function estimateCostUsd(target, usage) {
  if (!usage) return null;
  if (FREE_PROVIDERS.has(target.provider) || target.local === true) return 0;

  const price = target.pricing ?? findPrice(target.model);
  if (!price) return null;

  const input = (usage.inputTokens ?? 0) * price.input;
  const output = (usage.outputTokens ?? 0) * price.output;
  return (input + output) / 1_000_000;
}

/** Model ids carry date suffixes and vendor prefixes; match on the longest known stem. */
function findPrice(model) {
  if (!model) return null;
  const id = String(model).toLowerCase();

  return (
    Object.entries(PRICE_TABLE)
      .filter(([stem]) => id.includes(stem))
      .sort((a, b) => b[0].length - a[0].length)
      .map(([, price]) => price)[0] ?? null
  );
}

function sumUsage(entries) {
  return entries.reduce(
    (total, usage) => ({
      inputTokens: total.inputTokens + (usage?.inputTokens ?? 0),
      outputTokens: total.outputTokens + (usage?.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
}

export { estimateCostUsd, sumUsage, PRICE_TABLE };
