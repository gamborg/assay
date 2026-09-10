/**
 * Adapter for any OpenAI-compatible /chat/completions endpoint.
 *
 * One adapter covers Ollama, vLLM, LM Studio, llama.cpp's server and OpenAI
 * itself, because they all speak the same wire format. Raw fetch rather than a
 * vendor SDK: the surface we use is four fields wide, and a local endpoint is
 * precisely where you do not want an SDK's opinions about auth and retries.
 *
 * Local models are the interesting case for a harness. They are where the cheap
 * half of a routing decision lives, and they are where a scenario that "works"
 * against a frontier model tends to fall apart.
 */

const DEFAULT_MAX_TOKENS = 4096;

function createOpenAiCompatibleProvider(target) {
  const baseUrl = (
    target.baseUrl ??
    process.env[target.baseUrlEnv ?? 'LOCAL_BASE_URL'] ??
    'http://localhost:11434/v1'
  ).replace(/\/+$/, '');

  const apiKey = target.apiKey ?? process.env[target.apiKeyEnv ?? 'LOCAL_API_KEY'] ?? 'not-needed';

  return {
    name: target.name,
    provider: target.provider ?? 'openai-compatible',
    model: target.model,

    async complete({ system, messages, tools }) {
      const body = {
        model: target.model,
        max_tokens: target.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: toOpenAiMessages(system, messages),
        ...(tools.length > 0 ? { tools: tools.map(toOpenAiTool) } : {}),
      };

      if (typeof target.temperature === 'number') {
        body.temperature = target.temperature;
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          `${baseUrl} returned ${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 400)}` : ''}`,
        );
      }

      const payload = await response.json();
      const message = payload.choices?.[0]?.message ?? {};

      return {
        content: (message.content ?? '').trim(),
        toolCalls: (message.tool_calls ?? []).map(fromOpenAiToolCall),
        usage: {
          inputTokens: payload.usage?.prompt_tokens ?? 0,
          outputTokens: payload.usage?.completion_tokens ?? 0,
        },
        stopReason: payload.choices?.[0]?.finish_reason ?? 'unknown',
      };
    },
  };
}

function toOpenAiTool(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toOpenAiMessages(system, messages) {
  const out = system ? [{ role: 'system', content: system }] : [];

  for (const message of messages) {
    if (message.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      });
      continue;
    }

    if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      });
      continue;
    }

    out.push({ role: 'user', content: message.content });
  }

  return out;
}

/**
 * Arguments arrive as a JSON string, and smaller models emit malformed JSON often
 * enough that a crash here would be indistinguishable from a harness bug. Surface
 * it as a tool call with a parse error instead, so the trace shows what happened.
 */
function fromOpenAiToolCall(call) {
  const raw = call.function?.arguments ?? '{}';

  try {
    return { id: call.id, name: call.function?.name, arguments: JSON.parse(raw) };
  } catch {
    return {
      id: call.id,
      name: call.function?.name,
      arguments: {},
      argumentParseError: raw,
    };
  }
}

export { createOpenAiCompatibleProvider };
