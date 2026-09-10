import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toAnthropicMessages, toAnthropicTool } from '../lib/providers/anthropic.js';

test('a tool definition becomes input_schema, not parameters', () => {
  const tool = toAnthropicTool({
    name: 'get_weather',
    description: 'weather',
    parameters: { type: 'object', properties: { city: { type: 'string' } } },
  });

  assert.deepEqual(Object.keys(tool).sort(), ['description', 'input_schema', 'name']);
  assert.equal(tool.input_schema.properties.city.type, 'string');
});

test('an assistant turn carries text and tool_use blocks together', () => {
  const [message] = toAnthropicMessages([
    {
      role: 'assistant',
      content: 'Let me check.',
      toolCalls: [{ id: 'c1', name: 'get_weather', arguments: { city: 'Aarhus' } }],
    },
  ]);

  assert.equal(message.role, 'assistant');
  assert.deepEqual(message.content, [
    { type: 'text', text: 'Let me check.' },
    { type: 'tool_use', id: 'c1', name: 'get_weather', input: { city: 'Aarhus' } },
  ]);
});

test('an assistant turn with no text emits only the tool_use block', () => {
  const [message] = toAnthropicMessages([
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'x', arguments: {} }] },
  ]);

  assert.equal(message.content.length, 1);
  assert.equal(message.content[0].type, 'tool_use');
});

test('tool results become user-role tool_result blocks', () => {
  const messages = toAnthropicMessages([
    { role: 'tool', toolCallId: 'c1', name: 'get_weather', content: '{"tempC":11}' },
  ]);

  assert.deepEqual(messages, [
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"tempC":11}' }],
    },
  ]);
});

test('parallel tool results are merged into ONE user turn', () => {
  // Splitting these across two user messages silently teaches the model to stop
  // making parallel tool calls, which is a behaviour change with no error.
  const messages = toAnthropicMessages([
    { role: 'assistant', content: '', toolCalls: [] },
    { role: 'tool', toolCallId: 'c1', name: 'a', content: '1' },
    { role: 'tool', toolCallId: 'c2', name: 'b', content: '2' },
    { role: 'tool', toolCallId: 'c3', name: 'c', content: '3' },
  ]);

  const userTurns = messages.filter((message) => message.role === 'user');
  assert.equal(userTurns.length, 1);
  assert.deepEqual(userTurns[0].content.map((block) => block.tool_use_id), ['c1', 'c2', 'c3']);
});

test('tool results from separate turns are not merged across an assistant turn', () => {
  const messages = toAnthropicMessages([
    { role: 'tool', toolCallId: 'c1', name: 'a', content: '1' },
    { role: 'assistant', content: 'thinking', toolCalls: [] },
    { role: 'tool', toolCallId: 'c2', name: 'b', content: '2' },
  ]);

  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'user']);
});

test('a plain user message passes through as a string', () => {
  assert.deepEqual(toAnthropicMessages([{ role: 'user', content: 'hello' }]), [
    { role: 'user', content: 'hello' },
  ]);
});

test('a full conversation round-trips in the order the API expects', () => {
  const messages = toAnthropicMessages([
    { role: 'user', content: 'weather in Aarhus?' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'get_weather', arguments: { city: 'Aarhus' } }],
    },
    { role: 'tool', toolCallId: 'c1', name: 'get_weather', content: '{"tempC":11}' },
    { role: 'assistant', content: 'It is 11C.', toolCalls: [] },
  ]);

  assert.deepEqual(messages.map((message) => message.role), [
    'user',
    'assistant',
    'user',
    'assistant',
  ]);
});
