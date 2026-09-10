/**
 * Public API.
 *
 * The CLI and the MCP server are both thin shells over these exports; anything
 * one of them can do, a Node program can do too.
 */

export { loadScenarios } from './scenarios/load.js';
export { normaliseScenario, ScenarioError } from './scenarios/schema.js';
export { loadConfig, selectTargets } from './config/config.js';
export { createProvider, availableProviders } from './providers/index.js';
export { registerTool, resolveTools, listTools } from './agent/tools.js';
export { runScenario } from './agent/loop.js';
export { runSuite } from './runner.js';
export { evaluateRun } from './gates/evaluate.js';
export { registerAssertion, assertionTypes } from './gates/assertions.js';
export { compareRuns } from './regression/compare.js';
export { saveRun, saveBaseline, loadBaseline, listRuns, loadRun } from './regression/store.js';
