/**
 * Deterministic provider for testing the harness itself.
 *
 * Replays a scripted list of responses. This exists so the test suite can assert
 * on gate logic and trace shape without spending a token or depending on a
 * network -- and so a contributor can run the whole pipeline on a plane, which is
 * the difference between a repo people try and a repo people star.
 *
 * Two shapes:
 *   script:  [...]                        one script, replayed for every scenario
 *   scripts: { <scenarioId>: [...] }      a script per scenario
 */

function createMockProvider(target) {
  const shared = target.script ?? null;
  const perScenario = target.scripts ?? {};
  const cursors = new Map();

  return {
    name: target.name,
    provider: 'mock',
    model: target.model ?? 'mock',

    async complete({ scenarioId }) {
      const script = perScenario[scenarioId] ?? shared ?? [];
      const step = cursors.get(scenarioId) ?? 0;
      cursors.set(scenarioId, step + 1);

      const response = script[step] ?? {
        content: `(mock provider has no script step ${step} for "${scenarioId}")`,
      };

      const toolCalls = (response.toolCalls ?? []).map((call, index) => ({
        id: call.id ?? `mock-${scenarioId}-${step}-${index}`,
        name: call.name,
        arguments: call.arguments ?? {},
      }));

      return {
        content: response.content ?? '',
        toolCalls,
        usage: response.usage ?? { inputTokens: 100, outputTokens: 20 },
        stopReason: toolCalls.length ? 'tool_use' : 'end_turn',
      };
    },
  };
}

export { createMockProvider };
