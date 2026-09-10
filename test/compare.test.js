import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareRuns } from '../lib/regression/compare.js';

function suite(results) {
  return { results };
}

function result(scenarioId, targetName, passed, extra = {}) {
  return {
    scenarioId,
    target: { name: targetName },
    passed,
    checks: [{ type: 'toolCalled', passed }],
    durationMs: 1000,
    costUsd: 0.001,
    ...extra,
  };
}

test('a pass turning into a fail is a regression', () => {
  const diff = compareRuns(
    suite([result('a', 'frontier', true)]),
    suite([result('a', 'frontier', false)]),
  );

  assert.equal(diff.hasRegressions, true);
  assert.equal(diff.regressions[0].scenarioId, 'a');
  assert.deepEqual(diff.regressions[0].failedChecks, ['toolCalled']);
});

test('a fail turning into a pass is a fix, not a regression', () => {
  const diff = compareRuns(
    suite([result('a', 'frontier', false)]),
    suite([result('a', 'frontier', true)]),
  );

  assert.equal(diff.hasRegressions, false);
  assert.equal(diff.fixes.length, 1);
});

test('the same scenario on two targets is compared separately', () => {
  const diff = compareRuns(
    suite([result('a', 'frontier', true), result('a', 'local', true)]),
    suite([result('a', 'frontier', true), result('a', 'local', false)]),
  );

  assert.equal(diff.regressions.length, 1);
  assert.equal(diff.regressions[0].target, 'local');
  assert.equal(diff.unchanged.length, 1);
});

test('an equal pass count still surfaces a swapped failure', () => {
  const diff = compareRuns(
    suite([result('a', 'x', true), result('b', 'x', false)]),
    suite([result('a', 'x', false), result('b', 'x', true)]),
  );

  assert.equal(diff.regressions.length, 1);
  assert.equal(diff.fixes.length, 1);
  assert.equal(diff.hasRegressions, true);
});

test('new and removed scenarios are reported, not silently dropped', () => {
  const diff = compareRuns(suite([result('old', 'x', true)]), suite([result('new', 'x', true)]));

  assert.deepEqual(diff.added.map((e) => e.scenarioId), ['new']);
  assert.deepEqual(diff.removed.map((e) => e.scenarioId), ['old']);
  assert.equal(diff.hasRegressions, false);
});

test('reports latency and cost deltas for unchanged results', () => {
  const diff = compareRuns(
    suite([result('a', 'x', true, { durationMs: 1000, costUsd: 0.001 })]),
    suite([result('a', 'x', true, { durationMs: 1600, costUsd: 0.003 })]),
  );

  assert.equal(diff.unchanged[0].durationDeltaMs, 600);
  assert.ok(Math.abs(diff.unchanged[0].costDeltaUsd - 0.002) < 1e-9);
});
