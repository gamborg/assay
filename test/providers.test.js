import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createProvider } from '../lib/providers/index.js';
import { createOpenAiCompatibleProvider } from '../lib/providers/openaiCompatible.js';

test('rejects an unknown provider by name, listing the real ones', () => {
  assert.throws(
    () => createProvider({ name: 't', provider: 'openai-ish' }),
    /unknown provider "openai-ish"/,
  );
});

test('OpenAI-compatible adapter translates tools, messages and usage', async () => {
  let captured;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    captured = { url, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'the answer',
              tool_calls: [
                { id: 'c1', function: { name: 'calculator', arguments: '{"expression":"1+1"}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 40, completion_tokens: 9 },
      }),
    };
  };

  try {
    const provider = createOpenAiCompatibleProvider({
      name: 'local',
      provider: 'local',
      model: 'test-model',
      baseUrl: 'http://localhost:8000/v1/',
    });

    const response = await provider.complete({
      system: 'be brief',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c0', name: 'x', arguments: {} }] },
        { role: 'tool', toolCallId: 'c0', name: 'x', content: '{"ok":true}' },
      ],
      tools: [{ name: 'calculator', description: 'maths', parameters: { type: 'object' } }],
    });

    // Trailing slash on baseUrl must not produce a double slash.
    assert.equal(captured.url, 'http://localhost:8000/v1/chat/completions');
    assert.equal(captured.body.messages[0].role, 'system');
    assert.equal(captured.body.messages[3].tool_call_id, 'c0');
    assert.equal(captured.body.tools[0].type, 'function');
    assert.equal(captured.body.tools[0].function.name, 'calculator');

    assert.deepEqual(response.toolCalls, [
      { id: 'c1', name: 'calculator', arguments: { expression: '1+1' } },
    ]);
    assert.deepEqual(response.usage, { inputTokens: 40, outputTokens: 9 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('malformed tool arguments surface as a parse error rather than throwing', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [{ id: 'c1', function: { name: 'calculator', arguments: '{"expr' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
  });

  try {
    const provider = createOpenAiCompatibleProvider({ name: 'local', model: 'm', baseUrl: 'http://x/v1' });
    const response = await provider.complete({ messages: [], tools: [] });

    assert.deepEqual(response.toolCalls[0].arguments, {});
    assert.equal(response.toolCalls[0].argumentParseError, '{"expr');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an HTTP error names the endpoint so a wrong baseUrl is obvious', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    text: async () => 'no such model',
  });

  try {
    const provider = createOpenAiCompatibleProvider({ name: 'local', model: 'm', baseUrl: 'http://localhost:9/v1' });
    await assert.rejects(
      () => provider.complete({ messages: [], tools: [] }),
      /http:\/\/localhost:9\/v1 returned 404 Not Found: no such model/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
