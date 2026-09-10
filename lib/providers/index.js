/**
 * The provider seam.
 *
 * Everything above this line -- the agent loop, the gates, the reports -- speaks
 * one neutral message format and never imports a vendor SDK. Everything below it
 * is an adapter. Adding a vendor means adding one file here and nothing else.
 *
 * That boundary is the point of the harness: if swapping models requires touching
 * the evaluation logic, you are not evaluating the model, you are evaluating your
 * integration.
 *
 * ## Neutral message format
 *
 *   { role: 'user',      content: string }
 *   { role: 'assistant', content: string, toolCalls?: ToolCall[] }
 *   { role: 'tool',      toolCallId: string, name: string, content: string }
 *
 *   ToolCall = { id: string, name: string, arguments: object }
 *
 * ## Provider contract
 *
 *   complete({ system, messages, tools }) => {
 *     content: string,
 *     toolCalls: ToolCall[],
 *     usage: { inputTokens, outputTokens },
 *     stopReason: string,
 *   }
 *
 * Providers do not retry, do not log and do not throw vendor error types across
 * the seam -- they translate, and nothing else.
 */

import { createAnthropicProvider } from './anthropic.js';
import { createOpenAiCompatibleProvider } from './openaiCompatible.js';
import { createMockProvider } from './mock.js';

const FACTORIES = {
  anthropic: createAnthropicProvider,
  'openai-compatible': createOpenAiCompatibleProvider,
  local: createOpenAiCompatibleProvider,
  mock: createMockProvider,
};

/**
 * @param {{name: string, provider: string, model: string}} target
 * @returns {{name: string, model: string, complete: Function}}
 */
function createProvider(target) {
  const factory = FACTORIES[target.provider];

  if (!factory) {
    throw new Error(
      `unknown provider "${target.provider}" for target "${target.name}" ` +
        `(available: ${Object.keys(FACTORIES).join(', ')})`,
    );
  }

  return factory(target);
}

function availableProviders() {
  return Object.keys(FACTORIES);
}

export { createProvider, availableProviders };
