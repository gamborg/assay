import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runScenario } from '../lib/agent/loop.js';
import { createProvider } from '../lib/providers/index.js';
import { normaliseScenario } from '../lib/scenarios/schema.js';

/** A clock that advances 100ms per read keeps latency assertions deterministic. */
function fakeClock(stepMs = 100) {
  let now = 0;
  return () => (now += stepMs);
}

function mockTarget(script) {
  return { name: 'mock', provider: 'mock', model: 'mock', script };
}

test('executes a tool call and feeds the result back to the model', async () => {
  const target = mockTarget([
    { toolCalls: [{ name: 'get_weather', arguments: { city: 'Copenhagen' } }] },
    { content: 'It is 12C and raining.' },
  ]);

  const run = await runScenario({
    scenario: normaliseScenario({ id: 't', prompt: 'weather?', tools: ['get_weather'] }),
    target,
    provider: createProvider(target),
    clock: fakeClock(),
  });

  assert.equal(run.stoppedBecause, 'end_turn');
  assert.equal(run.steps, 2);
  assert.deepEqual(run.toolCalls.map((c) => c.name), ['get_weather']);
  assert.equal(run.toolCalls[0].result.tempC, 12);
  assert.equal(run.output, 'It is 12C and raining.');
});

test('records every step in the trace in order', async () => {
  const target = mockTarget([
    { toolCalls: [{ name: 'get_weather', arguments: { city: 'Aarhus' } }] },
    { content: 'done' },
  ]);

  const run = await runScenario({
    scenario: normaliseScenario({ id: 't', prompt: 'x', tools: ['get_weather'] }),
    target,
    provider: createProvider(target),
    clock: fakeClock(),
  });

  assert.deepEqual(run.trace.map((event) => event.type), [
    'run_start',
    'model_request',
    'model_response',
    'tool_call',
    'tool_result',
    'model_request',
    'model_response',
    'run_end',
  ]);
});

test('stops at maxSteps instead of looping forever', async () => {
  const target = mockTarget(
    Array.from({ length: 10 }, () => ({
      toolCalls: [{ name: 'get_weather', arguments: { city: 'Aarhus' } }],
    })),
  );

  const run = await runScenario({
    scenario: normaliseScenario({ id: 't', prompt: 'x', tools: ['get_weather'], maxSteps: 3 }),
    target,
    provider: createProvider(target),
    clock: fakeClock(),
  });

  assert.equal(run.steps, 3);
  assert.equal(run.stoppedBecause, 'max_steps');
});

test('a tool the scenario did not grant is reported back, not crashed on', async () => {
  const target = mockTarget([
    { toolCalls: [{ name: 'calculator', arguments: { expression: '1+1' } }] },
    { content: 'I cannot do that here.' },
  ]);

  const run = await runScenario({
    scenario: normaliseScenario({ id: 't', prompt: 'x', tools: ['get_weather'] }),
    target,
    provider: createProvider(target),
    clock: fakeClock(),
  });

  assert.equal(run.stoppedBecause, 'end_turn');
  assert.equal(run.toolCalls[0].ok, false);
  assert.match(run.toolCalls[0].resultText, /not available in this scenario/);
});

test('a provider failure becomes a recorded outcome, not a thrown exception', async () => {
  const provider = {
    name: 'broken',
    provider: 'mock',
    model: 'mock',
    complete: async () => {
      throw new Error('endpoint refused connection');
    },
  };

  const run = await runScenario({
    scenario: normaliseScenario({ id: 't', prompt: 'x' }),
    target: { name: 'broken', provider: 'mock' },
    provider,
    clock: fakeClock(),
  });

  assert.equal(run.stoppedBecause, 'error');
  assert.match(run.error.message, /refused connection/);
  assert.ok(run.trace.some((event) => event.type === 'run_error'));
});
