/**
 * Deterministic provider for testing the harness itself.
 *
 * A scripted list of responses, replayed in order. This exists so that the test
 * suite can assert on gate logic and trace shape without spending a token or
 * depending on a network -- and so that a contributor can run `npm test` on a
 * plane.
 */

function createMockProvider(target) {
  const script = [...(target.script ?? [])];
  let step = 0;

  return {
    name: target.name,
    provider: 'mock',
    model: target.model ?? 'mock',

    async complete() {
      const response = script[step] ?? { content: '(mock provider ran out of script)' };
      step += 1;

      return {
        content: response.content ?? '',
        toolCalls: (response.toolCalls ?? []).map((call, index) => ({
          id: call.id ?? `mock-call-${step}-${index}`,
          name: call.name,
          arguments: call.arguments ?? {},
        })),
        usage: response.usage ?? { inputTokens: 100, outputTokens: 20 },
        stopReason: response.toolCalls?.length ? 'tool_use' : 'end_turn',
      };
    },
  };
}

export { createMockProvider };
