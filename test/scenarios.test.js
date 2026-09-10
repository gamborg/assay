import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normaliseScenario, ScenarioError } from '../lib/scenarios/schema.js';
import { loadScenarios } from '../lib/scenarios/load.js';

test('applies defaults to a minimal scenario', () => {
  const scenario = normaliseScenario({ id: 'a', prompt: 'hello' });

  assert.equal(scenario.maxSteps, 6);
  assert.deepEqual(scenario.tools, []);
  assert.deepEqual(scenario.expect, []);
});

test('rewrites single-key assertion mappings into {type, value}', () => {
  const scenario = normaliseScenario({
    id: 'a',
    prompt: 'hello',
    expect: [{ toolCalled: 'get_weather' }, { maxSteps: 2 }],
  });

  assert.deepEqual(scenario.expect, [
    { type: 'toolCalled', value: 'get_weather' },
    { type: 'maxSteps', value: 2 },
  ]);
});

test('rejects a typo in a field name rather than ignoring it', () => {
  assert.throws(
    () => normaliseScenario({ id: 'a', prompt: 'hi', tolls: ['x'] }),
    /unknown field "tolls"/,
  );
});

test('rejects an assertion with more than one key', () => {
  assert.throws(
    () => normaliseScenario({ id: 'a', prompt: 'hi', expect: [{ toolCalled: 'x', maxSteps: 2 }] }),
    /exactly one key/,
  );
});

test('names the file in the error so a bad scenario is findable', () => {
  try {
    normaliseScenario({ prompt: 'no id' }, { file: 'broken.yaml' });
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof ScenarioError);
    assert.match(error.message, /^broken\.yaml: /);
  }
});

test('loads the bundled scenarios and keeps ids unique', async () => {
  const scenarios = await loadScenarios('./scenarios');

  assert.ok(scenarios.length >= 6);
  assert.equal(new Set(scenarios.map((s) => s.id)).size, scenarios.length);
  for (const scenario of scenarios) {
    assert.ok(scenario.expect.length > 0, `${scenario.id} has no gates`);
  }
});
