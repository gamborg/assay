/**
 * assay as an MCP server.
 *
 * The interesting direction. Building an agent *with* MCP is now unremarkable;
 * exposing an evaluation harness *to* an agent means the agent can check its own
 * work -- change a prompt, run the suite, read the trace of what failed, iterate.
 *
 * Two design decisions worth stating, because both are about limiting blast radius:
 *
 * 1. Read and run, never write. There is no tool here that edits a scenario or
 *    promotes a baseline. An agent that can rewrite the test it is being judged
 *    against will eventually rewrite the test it is being judged against.
 *
 * 2. Traces are returned only when asked for, by scenario. Returning every trace
 *    from every run would fill the caller's context with exactly the material it
 *    needs room to reason about.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadScenarios } from '../scenarios/load.js';
import { loadConfig, selectTargets } from '../config/config.js';
import { runSuite } from '../runner.js';
import { listTools as listFixtureTools } from '../agent/tools.js';
import { assertionTypes } from '../gates/assertions.js';
import { loadBaseline } from '../regression/store.js';
import { compareRuns } from '../regression/compare.js';

const TOOLS = [
  {
    name: 'list_scenarios',
    description:
      'List the evaluation scenarios available, with their gates and tags. Start here to find out what can be run.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Only scenarios carrying this tag' },
      },
    },
  },
  {
    name: 'run_scenarios',
    description:
      'Run scenarios against configured model targets and return pass/fail with the reason for every failed gate. Costs real tokens against real models; prefer naming specific scenario ids over running everything.',
    inputSchema: {
      type: 'object',
      properties: {
        scenarioIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Scenario ids to run. Omit to run all of them.',
        },
        targets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Target names to run against. Omit to run all configured targets.',
        },
        includeTrace: {
          type: 'boolean',
          description:
            'Include the full step-by-step trace for each run. Verbose -- use get_trace on a single failing scenario instead.',
        },
      },
    },
  },
  {
    name: 'get_trace',
    description:
      'Run one scenario against one target and return its full trace: every model turn, tool call, tool result and timing. Use this to diagnose why a gate failed.',
    inputSchema: {
      type: 'object',
      properties: {
        scenarioId: { type: 'string' },
        target: { type: 'string' },
      },
      required: ['scenarioId'],
    },
  },
  {
    name: 'compare_to_baseline',
    description:
      'Run scenarios and diff the outcome against the recorded baseline, reporting regressions and fixes rather than a raw pass count.',
    inputSchema: {
      type: 'object',
      properties: {
        scenarioIds: { type: 'array', items: { type: 'string' } },
        targets: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'describe_harness',
    description:
      'Describe what this harness can assert on and which fixture tools scenarios may grant. Read this before writing or amending a scenario.',
    inputSchema: { type: 'object', properties: {} },
  },
];

/**
 * @param {{configFile?: string}} options
 */
function createAssayServer({ configFile } = {}) {
  const server = new Server(
    { name: 'assay', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      return asToolResult(await dispatch(name, args, configFile));
    } catch (error) {
      // MCP errors are for protocol failures. A scenario that cannot be found is
      // information the caller can act on, so it comes back as content.
      return asToolResult({ error: error.message }, true);
    }
  });

  return server;
}

async function dispatch(name, args, configFile) {
  switch (name) {
    case 'list_scenarios':
      return listScenariosTool(args, configFile);
    case 'run_scenarios':
      return runScenariosTool(args, configFile);
    case 'get_trace':
      return getTraceTool(args, configFile);
    case 'compare_to_baseline':
      return compareTool(args, configFile);
    case 'describe_harness':
      return {
        assertions: assertionTypes(),
        fixtureTools: listFixtureTools(),
        scenarioFormat:
          'id, prompt, optional system/description/tags, tools (fixture tool names), maxSteps, ' +
          'and expect: a list of single-key mappings such as "- toolCalled: get_weather".',
      };
    default:
      throw new Error(`unknown tool "${name}"`);
  }
}

async function listScenariosTool({ tag }, configFile) {
  const config = await loadConfig(configFile);
  const scenarios = await loadScenarios(config.scenarios);

  return {
    targets: config.targets.map(({ name, provider, model }) => ({ name, provider, model })),
    scenarios: scenarios
      .filter((scenario) => !tag || scenario.tags.includes(tag))
      .map(({ id, description, tags, tools, expect }) => ({
        id,
        description: description?.trim(),
        tags,
        tools,
        gates: expect.map((entry) => entry.type),
      })),
  };
}

async function runScenariosTool({ scenarioIds, targets, includeTrace }, configFile) {
  const { suite } = await execute({ scenarioIds, targets, configFile });

  return {
    summary: suite.summary,
    results: suite.results.map((result) => summariseResult(result, includeTrace)),
  };
}

async function getTraceTool({ scenarioId, target }, configFile) {
  const { suite } = await execute({
    scenarioIds: [scenarioId],
    targets: target ? [target] : undefined,
    configFile,
  });

  const result = suite.results[0];
  if (!result) throw new Error(`scenario "${scenarioId}" produced no result`);

  return {
    ...summariseResult(result, true),
    // Failed gates first: it is the question the caller actually has.
    failedGates: result.checks.filter((check) => !check.passed),
  };
}

async function compareTool({ scenarioIds, targets }, configFile) {
  const baseline = await loadBaseline();
  if (!baseline) {
    throw new Error('no baseline recorded; run `assay baseline` first');
  }

  const { suite } = await execute({ scenarioIds, targets, configFile });
  const diff = compareRuns(baseline, suite);

  return { summary: suite.summary, ...diff };
}

async function execute({ scenarioIds, targets, configFile }) {
  const config = await loadConfig(configFile);
  const selected = selectTargets(config, targets);
  const all = await loadScenarios(config.scenarios);

  const scenarios = scenarioIds?.length
    ? scenarioIds.map((id) => {
        const scenario = all.find((candidate) => candidate.id === id);
        if (!scenario) {
          throw new Error(`unknown scenario "${id}" (available: ${all.map((s) => s.id).join(', ')})`);
        }
        return scenario;
      })
    : all;

  return { suite: await runSuite({ scenarios, targets: selected }) };
}

function summariseResult(result, includeTrace) {
  return {
    scenarioId: result.scenarioId,
    target: result.target.name,
    model: result.target.model,
    passed: result.passed,
    stoppedBecause: result.stoppedBecause,
    steps: result.steps,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    toolCalls: result.toolCalls.map(({ name, arguments: args }) => ({ name, args })),
    output: result.output,
    checks: result.checks,
    ...(result.error ? { error: result.error } : {}),
    ...(includeTrace ? { trace: result.trace } : {}),
  };
}

function asToolResult(payload, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function startStdioServer({ configFile } = {}) {
  const server = createAssayServer({ configFile });
  await server.connect(new StdioServerTransport());
  return server;
}

export { createAssayServer, startStdioServer, TOOLS };
