/**
 * The agent loop.
 *
 * Deliberately small: request, execute any tool calls, repeat until the model
 * stops asking for tools or we hit `maxSteps`. It is not trying to be a
 * framework. It is trying to be a loop simple enough that when a scenario fails,
 * you can be confident the failure is the agent's and not the harness's.
 *
 * Every branch writes to the trace. Assertions never see the model -- they see
 * the trace.
 */

import { Trace } from '../trace/trace.js';
import { estimateCostUsd, sumUsage } from '../trace/cost.js';
import { resolveTools } from './tools.js';

const MAX_TOOL_RESULT_CHARS = 8000;

/**
 * Run one scenario against one target.
 *
 * @param {object} options
 * @param {object} options.scenario normalised scenario
 * @param {object} options.target target config (used for cost + reporting)
 * @param {object} options.provider from `createProvider`
 * @param {() => number} [options.clock] injectable for deterministic tests
 * @returns {Promise<object>} run record; never throws for agent-side failures
 */
async function runScenario({ scenario, target, provider, clock }) {
  const trace = new Trace(clock ? { clock } : {});
  const tools = resolveTools(scenario.tools);
  const messages = [{ role: 'user', content: scenario.prompt }];
  const usages = [];
  const toolCalls = [];

  trace.record('run_start', {
    scenario: scenario.id,
    target: target.name,
    model: provider.model,
    tools: scenario.tools,
  });

  let output = '';
  let steps = 0;
  let stoppedBecause = 'max_steps';
  let error = null;

  try {
    while (steps < scenario.maxSteps) {
      steps += 1;
      trace.record('model_request', { step: steps, messageCount: messages.length });

      const response = await provider.complete({
        system: scenario.system,
        messages,
        tools,
      });

      usages.push(response.usage);
      trace.record('model_response', {
        step: steps,
        stopReason: response.stopReason,
        text: response.content,
        toolCalls: response.toolCalls.map(({ id, name, arguments: args }) => ({ id, name, args })),
        usage: response.usage,
      });

      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      if (response.toolCalls.length === 0) {
        output = response.content;
        stoppedBecause = 'end_turn';
        break;
      }

      // Parallel tool calls are the norm; results all go back in one batch so the
      // model is not nudged into serialising future turns.
      for (const call of response.toolCalls) {
        const record = await executeToolCall({ call, tools, trace, step: steps });
        toolCalls.push(record);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: record.resultText,
        });
      }
    }
  } catch (cause) {
    // A provider blowing up is a legitimate evaluation outcome, not a crash:
    // "this model cannot complete this scenario" is exactly what we want to
    // record. The suite keeps going.
    stoppedBecause = 'error';
    error = { message: cause.message };
    trace.record('run_error', { message: cause.message });
  }

  const usage = sumUsage(usages);
  const durationMs = trace.durationMs;

  trace.record('run_end', { stoppedBecause, steps, durationMs });

  return {
    scenarioId: scenario.id,
    target: { name: target.name, provider: provider.provider, model: provider.model },
    output,
    steps,
    stoppedBecause,
    error,
    toolCalls,
    usage,
    costUsd: estimateCostUsd({ ...target, model: provider.model }, usage),
    durationMs,
    trace: trace.toJSON(),
  };
}

/**
 * Tool failures are fed back to the model rather than aborting the run -- an
 * agent that recovers from a bad tool result is behaving well, and a scenario
 * should be able to assert on exactly that.
 */
async function executeToolCall({ call, tools, trace, step }) {
  const tool = tools.find((candidate) => candidate.name === call.name);

  trace.record('tool_call', { step, name: call.name, arguments: call.arguments });

  if (!tool) {
    const resultText = JSON.stringify({
      error: `tool "${call.name}" is not available in this scenario`,
    });
    trace.record('tool_result', { step, name: call.name, error: true, result: resultText });
    return { step, name: call.name, arguments: call.arguments, ok: false, resultText };
  }

  try {
    const result = await tool.handler(call.arguments ?? {});
    const resultText = truncate(JSON.stringify(result));
    trace.record('tool_result', { step, name: call.name, error: false, result: resultText });
    return { step, name: call.name, arguments: call.arguments, ok: true, result, resultText };
  } catch (cause) {
    const resultText = JSON.stringify({ error: cause.message });
    trace.record('tool_result', { step, name: call.name, error: true, result: resultText });
    return { step, name: call.name, arguments: call.arguments, ok: false, resultText };
  }
}

function truncate(text) {
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}... [truncated]`
    : text;
}

export { runScenario };
