/**
 * Comparing two suite runs.
 *
 * The question a regression suite answers is not "how many passed" but "what
 * changed". A suite that drops from 20 passes to 20 passes while swapping which
 * two scenarios fail is a red flag that a headline number hides.
 *
 * Results are keyed by scenario+target, because the same scenario passing on one
 * model and failing on another is the normal case, not an edge case.
 */

function compareRuns(baseline, current) {
  const before = index(baseline?.results ?? []);
  const after = index(current.results);

  const regressions = [];
  const fixes = [];
  const unchanged = [];
  const added = [];
  const removed = [];

  for (const [key, result] of after) {
    const previous = before.get(key);

    if (!previous) {
      added.push(describe(key, result));
      continue;
    }

    if (previous.passed && !result.passed) {
      regressions.push(describe(key, result, previous));
    } else if (!previous.passed && result.passed) {
      fixes.push(describe(key, result, previous));
    } else {
      unchanged.push(describe(key, result, previous));
    }
  }

  for (const [key, result] of before) {
    if (!after.has(key)) removed.push(describe(key, result));
  }

  return {
    regressions,
    fixes,
    added,
    removed,
    unchanged,
    // The exit-code question, in one field.
    hasRegressions: regressions.length > 0,
  };
}

function index(results) {
  return new Map(results.map((result) => [`${result.scenarioId}@${result.target.name}`, result]));
}

function describe(key, result, previous) {
  const [scenarioId, targetName] = key.split('@');

  return {
    key,
    scenarioId,
    target: targetName,
    passed: result.passed,
    wasPassing: previous?.passed ?? null,
    failedChecks: (result.checks ?? []).filter((check) => !check.passed).map((check) => check.type),
    durationDeltaMs: previous ? result.durationMs - previous.durationMs : null,
    costDeltaUsd:
      previous && previous.costUsd !== null && result.costUsd !== null
        ? result.costUsd - previous.costUsd
        : null,
  };
}

export { compareRuns };
