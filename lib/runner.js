/**
 * The suite runner: every scenario against every target.
 *
 * Scenarios within a target run concurrently up to `concurrency`, but targets run
 * one after another. Hammering a local endpoint with eight parallel requests
 * measures your GPU's queueing behaviour, not the model's -- and latency gates
 * would then fail for reasons that have nothing to do with the agent.
 */

import { createProvider } from './providers/index.js';
import { runScenario } from './agent/loop.js';
import { evaluateRun } from './gates/evaluate.js';

const DEFAULT_CONCURRENCY = 4;

/**
 * @param {object} options
 * @param {object[]} options.scenarios
 * @param {object[]} options.targets
 * @param {number} [options.concurrency]
 * @param {(event: object) => void} [options.onResult] progress callback
 * @returns {Promise<object>} suite result
 */
async function runSuite({ scenarios, targets, concurrency = DEFAULT_CONCURRENCY, onResult }) {
  const startedAt = new Date();
  const results = [];

  for (const target of targets) {
    const provider = createProvider(target);

    for (const batch of chunk(scenarios, concurrency)) {
      const batchResults = await Promise.all(
        batch.map(async (scenario) => {
          const run = await runScenario({ scenario, target, provider });
          const evaluated = evaluateRun(scenario, run);
          onResult?.(evaluated);
          return evaluated;
        }),
      );
      results.push(...batchResults);
    }
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    targets: targets.map(({ name, provider, model }) => ({ name, provider, model })),
    scenarioIds: scenarios.map((scenario) => scenario.id),
    results,
    summary: summarise(results),
  };
}

function summarise(results) {
  const passed = results.filter((result) => result.passed).length;
  const errored = results.filter((result) => result.stoppedBecause === 'error').length;
  const knownCosts = results.map((r) => r.costUsd).filter((cost) => cost !== null);

  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    errored,
    // null rather than 0 when nothing had a known price: see lib/trace/cost.js.
    totalCostUsd: knownCosts.length ? knownCosts.reduce((a, b) => a + b, 0) : null,
    totalDurationMs: results.reduce((total, result) => total + result.durationMs, 0),
  };
}

function chunk(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export { runSuite };
