/**
 * Applying a scenario's gates to a run.
 *
 * A run is `passed` only when every assertion passes. There is no partial credit
 * and no weighting: a gate that sometimes lets things through is not a gate.
 *
 * A run that errored (the provider threw) always fails, whatever its assertions
 * say. That is an infrastructure failure rather than a behavioural one, and the
 * reports keep the two apart -- "the model chose wrong" and "the endpoint was
 * down" need different people to look at them.
 */

import { assertions, assertionTypes } from './assertions.js';

/**
 * @param {object} scenario
 * @param {object} run result from `runScenario`
 * @returns {object} run, annotated with `checks` and `passed`
 */
function evaluateRun(scenario, run) {
  const checks = scenario.expect.map(({ type, value }) => {
    const check = assertions.get(type);

    if (!check) {
      return {
        type,
        value,
        passed: false,
        detail: `unknown assertion "${type}" (available: ${assertionTypes().join(', ')})`,
      };
    }

    try {
      return { type, value, ...check(value, run) };
    } catch (cause) {
      return { type, value, passed: false, detail: `assertion threw: ${cause.message}` };
    }
  });

  return {
    ...run,
    checks,
    passed: checks.every((check) => check.passed) && run.stoppedBecause !== 'error',
  };
}

export { evaluateRun };
