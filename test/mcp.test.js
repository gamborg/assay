import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Client,
} from '@modelcontextprotocol/sdk/client/index.js';
import {
  InMemoryTransport,
} from '@modelcontextprotocol/sdk/inMemory.js';

import { createAssayServer } from '../lib/mcp/server.js';

const CONFIG = './examples/demo.config.yaml';

/** Wire a client straight to the server in-process -- no subprocess, no flake. */
async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createAssayServer({ configFile: CONFIG });
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

function payload(result) {
  return JSON.parse(result.content[0].text);
}

test('advertises its tools', async () => {
  const { client, close } = await connect();
  try {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, [
      'compare_to_baseline',
      'describe_harness',
      'get_trace',
      'list_scenarios',
      'run_scenarios',
    ]);
    // Every tool needs a description; an agent picks tools by reading them.
    assert.ok(tools.every((tool) => tool.description.length > 40));
  } finally {
    await close();
  }
});

test('exposes no tool that mutates scenarios or baselines', async () => {
  const { client, close } = await connect();
  try {
    const { tools } = await client.listTools();
    const mutating = tools.filter((tool) => /write|edit|update|delete|set_|promote/i.test(tool.name));

    assert.deepEqual(mutating, []);
  } finally {
    await close();
  }
});

test('lists scenarios with their gates, and filters by tag', async () => {
  const { client, close } = await connect();
  try {
    const all = payload(await client.callTool({ name: 'list_scenarios', arguments: {} }));
    assert.ok(all.scenarios.length >= 6);
    assert.ok(all.scenarios[0].gates.length > 0);
    assert.equal(all.targets.length, 2);

    const tagged = payload(
      await client.callTool({ name: 'list_scenarios', arguments: { tag: 'honesty' } }),
    );
    assert.ok(tagged.scenarios.length < all.scenarios.length);
    assert.ok(tagged.scenarios.every((scenario) => scenario.tags.includes('honesty')));
  } finally {
    await close();
  }
});

test('runs a named scenario and reports the failing gate', async () => {
  const { client, close } = await connect();
  try {
    const result = payload(
      await client.callTool({
        name: 'run_scenarios',
        arguments: {
          scenarioIds: ['weather-prefers-specific-tool'],
          targets: ['scripted-small'],
        },
      }),
    );

    assert.equal(result.summary.total, 1);
    assert.equal(result.results[0].passed, false);
    assert.ok(result.results[0].checks.some((check) => check.type === 'toolNotCalled' && !check.passed));
    // Traces are opt-in; the default response must stay small.
    assert.equal(result.results[0].trace, undefined);
  } finally {
    await close();
  }
});

test('get_trace returns the trace and puts failed gates first', async () => {
  const { client, close } = await connect();
  try {
    const result = payload(
      await client.callTool({
        name: 'get_trace',
        arguments: { scenarioId: 'weather-prefers-specific-tool', target: 'scripted-small' },
      }),
    );

    assert.ok(Array.isArray(result.trace));
    assert.ok(result.trace.some((event) => event.type === 'tool_call'));
    assert.ok(result.failedGates.length > 0);
  } finally {
    await close();
  }
});

test('an unknown scenario comes back as actionable content, not a protocol error', async () => {
  const { client, close } = await connect();
  try {
    const response = await client.callTool({
      name: 'run_scenarios',
      arguments: { scenarioIds: ['does-not-exist'] },
    });

    assert.equal(response.isError, true);
    assert.match(payload(response).error, /unknown scenario "does-not-exist"/);
  } finally {
    await close();
  }
});

test('describe_harness tells a caller what it can assert on', async () => {
  const { client, close } = await connect();
  try {
    const result = payload(await client.callTool({ name: 'describe_harness', arguments: {} }));

    assert.ok(result.assertions.includes('toolCalled'));
    assert.ok(result.fixtureTools.some((tool) => tool.name === 'get_weather'));
  } finally {
    await close();
  }
});
