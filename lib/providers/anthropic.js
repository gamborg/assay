/**
 * Anthropic adapter, built on the official SDK.
 *
 * Translation notes that are easy to get wrong:
 *  - tool results are user-role content blocks, not a separate role
 *  - consecutive tool results must land in ONE user message, or the model learns
 *    to stop making parallel tool calls
 *  - `input_schema`, not `parameters`
 */

import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_MAX_TOKENS = 4096;

function createAnthropicProvider(target) {
  const model = target.model ?? DEFAULT_MODEL;
  const client = new Anthropic({
    apiKey: target.apiKey ?? process.env[target.apiKeyEnv ?? 'ANTHROPIC_API_KEY'],
  });

  return {
    name: target.name,
    provider: 'anthropic',
    model,

    async complete({ system, messages, tools }) {
      const response = await client.messages.create({
        model,
        max_tokens: target.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(system ? { system } : {}),
        ...(target.effort ? { output_config: { effort: target.effort } } : {}),
        ...(tools.length > 0 ? { tools: tools.map(toAnthropicTool) } : {}),
        messages: toAnthropicMessages(messages),
      });

      return {
        content: response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('')
          .trim(),
        toolCalls: response.content
          .filter((block) => block.type === 'tool_use')
          .map((block) => ({ id: block.id, name: block.name, arguments: block.input })),
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
        stopReason: response.stop_reason,
      };
    },
  };
}

function toAnthropicTool(tool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

/**
 * Collapse the neutral message list into Anthropic's content-block shape,
 * merging runs of tool results into a single user turn.
 */
function toAnthropicMessages(messages) {
  const out = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      };

      const previous = out.at(-1);
      if (previous?.role === 'user' && Array.isArray(previous.content)) {
        previous.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (message.role === 'assistant') {
      const content = [];
      if (message.content) {
        content.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      out.push({ role: 'assistant', content });
      continue;
    }

    out.push({ role: 'user', content: message.content });
  }

  return out;
}

// Exported for testing: this translation is the subtlest code in the adapter.
export { createAnthropicProvider, toAnthropicMessages, toAnthropicTool };
