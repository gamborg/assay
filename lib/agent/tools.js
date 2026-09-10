/**
 * Fixture tools.
 *
 * Tools used during evaluation are deliberately deterministic fakes. A harness
 * that calls the real weather API cannot tell you whether a run failed because
 * the model regressed or because it rained differently today. Determinism here
 * is the whole point: the only variable we want in a run is the agent.
 *
 * Real integrations belong behind the same interface -- see `registerTool` --
 * so a team can evaluate against their own stubs without forking this file.
 */

/** @type {Map<string, object>} */
const registry = new Map();

/**
 * Register a tool the agent may be given.
 *
 * @param {object} tool
 * @param {string} tool.name
 * @param {string} tool.description shown to the model; wording affects tool choice
 * @param {object} tool.parameters JSON Schema for the arguments
 * @param {(args: object) => unknown} tool.handler deterministic implementation
 */
function registerTool(tool) {
  for (const field of ['name', 'description', 'parameters', 'handler']) {
    if (!tool?.[field]) {
      throw new Error(`tool is missing "${field}"`);
    }
  }
  registry.set(tool.name, tool);
  return tool;
}

/**
 * Resolve the tool names a scenario asked for.
 *
 * @param {string[]} names
 * @returns {object[]}
 */
function resolveTools(names) {
  return names.map((name) => {
    const tool = registry.get(name);
    if (!tool) {
      throw new Error(
        `unknown tool "${name}" (registered: ${[...registry.keys()].join(', ') || 'none'})`,
      );
    }
    return tool;
  });
}

function listTools() {
  return [...registry.values()].map(({ name, description }) => ({ name, description }));
}

const FIXED_WEATHER = {
  copenhagen: { tempC: 12, condition: 'light rain', windMs: 7 },
  aarhus: { tempC: 11, condition: 'overcast', windMs: 9 },
  singapore: { tempC: 31, condition: 'thunderstorms', windMs: 3 },
  rotterdam: { tempC: 14, condition: 'clear', windMs: 5 },
};

registerTool({
  name: 'get_weather',
  description: 'Get the current weather for a city. Use this instead of guessing.',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name, e.g. "Copenhagen"' },
    },
    required: ['city'],
  },
  handler: ({ city }) => {
    const key = String(city ?? '').trim().toLowerCase();
    const reading = FIXED_WEATHER[key];
    if (!reading) {
      return { error: `no weather station for "${city}"`, knownCities: Object.keys(FIXED_WEATHER) };
    }
    return { city, ...reading };
  },
});

const SHIPMENTS = {
  MAEU1234567: { status: 'in transit', vessel: 'Maersk Sentosa', etaDays: 6, port: 'Rotterdam' },
  MAEU7654321: { status: 'discharged', vessel: 'Maersk Halifax', etaDays: 0, port: 'Aarhus' },
};

registerTool({
  name: 'lookup_shipment',
  description: 'Look up the status of a container shipment by its container number.',
  parameters: {
    type: 'object',
    properties: {
      containerNumber: { type: 'string', description: 'Container number, e.g. MAEU1234567' },
    },
    required: ['containerNumber'],
  },
  handler: ({ containerNumber }) => {
    const key = String(containerNumber ?? '').trim().toUpperCase();
    const shipment = SHIPMENTS[key];
    if (!shipment) {
      return { error: `unknown container "${containerNumber}"` };
    }
    return { containerNumber: key, ...shipment };
  },
});

registerTool({
  name: 'web_search',
  description: 'Search the public web for general information.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
    },
    required: ['query'],
  },
  // Intentionally useless. Scenarios use this as a distractor to check whether
  // the agent reaches for a specific tool or a generic one.
  handler: ({ query }) => ({
    query,
    results: [{ title: 'No high-quality result found', snippet: '', url: '' }],
  }),
});

registerTool({
  name: 'calculator',
  description: 'Evaluate an arithmetic expression over numbers, + - * / and parentheses.',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'e.g. "(120 * 3) / 4"' },
    },
    required: ['expression'],
  },
  handler: ({ expression }) => {
    const source = String(expression ?? '');
    // Whitelist rather than trusting the model's input: this runs locally and a
    // scenario file is not a trust boundary we want to lean on.
    if (!/^[\d\s+\-*/().]+$/.test(source)) {
      return { error: 'expression may only contain numbers, + - * / and parentheses' };
    }
    try {
      const result = Function(`"use strict"; return (${source});`)();
      return Number.isFinite(result) ? { expression: source, result } : { error: 'not a finite number' };
    } catch {
      return { error: 'could not evaluate expression' };
    }
  },
});

export { registerTool, resolveTools, listTools, registry };
