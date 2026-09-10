/**
 * Scenario validation.
 *
 * A scenario is the unit of evaluation: one task given to an agent, plus the
 * behaviour we expect back. Validation is hand-rolled rather than delegated to
 * a schema library so that error messages can name the scenario and the field,
 * which is what you actually want at 23:00 with a typo in a YAML file.
 */

const REQUIRED = ['id', 'prompt'];

/** Fields we accept at the top level. Anything else is a typo until proven otherwise. */
const KNOWN = new Set([
  'id',
  'description',
  'system',
  'prompt',
  'tools',
  'maxSteps',
  'expect',
  'tags',
]);

const DEFAULTS = {
  maxSteps: 6,
  tools: [],
  expect: [],
  tags: [],
};

class ScenarioError extends Error {
  constructor(message, { file } = {}) {
    super(file ? `${file}: ${message}` : message);
    this.name = 'ScenarioError';
    this.file = file;
  }
}

/**
 * Validate a raw parsed scenario and return it with defaults applied.
 *
 * @param {unknown} raw parsed YAML/JSON object
 * @param {{file?: string}} context used only to make errors traceable
 * @returns {object} normalised scenario
 */
function normaliseScenario(raw, context = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ScenarioError('scenario must be a mapping', context);
  }

  for (const field of REQUIRED) {
    if (typeof raw[field] !== 'string' || raw[field].trim() === '') {
      throw new ScenarioError(`missing required string field "${field}"`, context);
    }
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN.has(key)) {
      throw new ScenarioError(
        `unknown field "${key}" (known: ${[...KNOWN].join(', ')})`,
        context,
      );
    }
  }

  const scenario = { ...DEFAULTS, ...raw };

  if (!Array.isArray(scenario.tools) || scenario.tools.some((t) => typeof t !== 'string')) {
    throw new ScenarioError('"tools" must be a list of tool names', context);
  }

  if (!Number.isInteger(scenario.maxSteps) || scenario.maxSteps < 1) {
    throw new ScenarioError('"maxSteps" must be a positive integer', context);
  }

  if (!Array.isArray(scenario.expect)) {
    throw new ScenarioError('"expect" must be a list of assertions', context);
  }

  scenario.expect = scenario.expect.map((entry, index) =>
    normaliseAssertion(entry, index, context),
  );

  return scenario;
}

/**
 * Each assertion is written as a single-key mapping, e.g. `- toolCalled: get_weather`.
 * That keeps the YAML readable and keeps the assertion registry open for extension
 * without touching this file.
 */
function normaliseAssertion(entry, index, context) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new ScenarioError(`expect[${index}] must be a mapping like "toolCalled: name"`, context);
  }

  const keys = Object.keys(entry);
  if (keys.length !== 1) {
    throw new ScenarioError(
      `expect[${index}] must have exactly one key, found ${keys.length} (${keys.join(', ')})`,
      context,
    );
  }

  return { type: keys[0], value: entry[keys[0]] };
}

export { normaliseScenario, ScenarioError };
