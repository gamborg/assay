import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRun } from '../lib/gates/evaluate.js';
import { normaliseScenario } from '../lib/scenarios/schema.js';

function run(overrides = {}) {
  return {
    scenarioId: 'test',
    output: 'It is 12C and raining in Copenhagen.',
    steps: 2,
    stoppedBecause: 'end_turn',
    error: null,
    toolCalls: [{ name: 'get_weather', arguments: { city: 'Copenhagen' } }],
    durationMs: 1200,
    costUsd: 0.0012,
    ...overrides,
  };
}

function check(expect, overrides) {
  const scenario = normaliseScenario({ id: 'test', prompt: 'x', expect });
  return evaluateRun(scenario, run(overrides));
}

test('passes when every gate passes', () => {
  const result = check([
    { toolCalled: 'get_weather' },
    { toolNotCalled: 'web_search' },
    { outputContains: '12' },
    { maxSteps: 3 },
    { latencyUnderMs: 5000 },
    { completes: true },
  ]);

  assert.equal(result.passed, true);
});

test('a single failing gate fails the run', () => {
  const result = check([{ toolCalled: 'get_weather' }, { toolCalled: 'calculator' }]);

  assert.equal(result.passed, false);
  assert.equal(result.checks.filter((c) => !c.passed).length, 1);
});

test('toolCalledWith matches a subset of arguments, case-insensitively', () => {
  assert.equal(
    check([{ toolCalledWith: { tool: 'get_weather', args: { city: 'copenhagen' } } }]).passed,
    true,
  );
  assert.equal(
    check([{ toolCalledWith: { tool: 'get_weather', args: { city: 'Aarhus' } } }]).passed,
    false,
  );
});

test('an unknown cost fails a cost gate instead of quietly passing', () => {
  const result = check([{ costUnderUsd: 0.01 }], { costUsd: null });

  assert.equal(result.passed, false);
  assert.match(result.checks[0].detail, /unknown/);
});

test('an errored run fails even when its assertions would pass', () => {
  const result = check([{ maxSteps: 10 }], {
    stoppedBecause: 'error',
    error: { message: 'endpoint refused connection' },
  });

  assert.equal(result.checks[0].passed, true);
  assert.equal(result.passed, false);
});

test('an unknown assertion type is a failure, not a silent skip', () => {
  const result = check([{ vibeCheck: true }]);

  assert.equal(result.passed, false);
  assert.match(result.checks[0].detail, /unknown assertion/);
});
