/**
 * The assertion registry.
 *
 * Each assertion is a pure function of (value, run) -> { passed, detail }. New
 * assertion types are added here and become available in every scenario file
 * immediately; nothing else in the harness needs to know they exist.
 *
 * The bias throughout is towards asserting on *behaviour* -- which tool, how many
 * steps, how long -- rather than on exact output text. Asserting that a model
 * produces one exact sentence is how eval suites become brittle and get deleted
 * six weeks later.
 */

/** @type {Map<string, (value: unknown, run: object) => {passed: boolean, detail: string}>} */
const assertions = new Map();

function registerAssertion(type, check) {
  assertions.set(type, check);
}

function assertionTypes() {
  return [...assertions.keys()].sort();
}

registerAssertion('toolCalled', (value, run) => {
  const called = run.toolCalls.map((call) => call.name);
  return {
    passed: called.includes(value),
    detail: called.length ? `called: ${called.join(', ')}` : 'no tools were called',
  };
});

registerAssertion('toolNotCalled', (value, run) => {
  const called = run.toolCalls.map((call) => call.name);
  return {
    passed: !called.includes(value),
    detail: called.length ? `called: ${called.join(', ')}` : 'no tools were called',
  };
});

registerAssertion('toolCalledWith', (value, run) => {
  const { tool, args = {} } = value ?? {};
  const matches = run.toolCalls.filter(
    (call) => call.name === tool && subsetMatches(args, call.arguments ?? {}),
  );
  return {
    passed: matches.length > 0,
    detail: matches.length
      ? `matched ${matches.length} call(s)`
      : `no call to "${tool}" with ${JSON.stringify(args)}`,
  };
});

registerAssertion('toolCallCount', (value, run) => {
  const { tool, max, min = 0 } = normaliseCountSpec(value);
  const count = run.toolCalls.filter((call) => !tool || call.name === tool).length;
  return {
    passed: count >= min && (max === undefined || count <= max),
    detail: `${count} call(s)${tool ? ` to ${tool}` : ''}`,
  };
});

registerAssertion('outputContains', (value, run) => {
  const needles = Array.isArray(value) ? value : [value];
  const haystack = run.output.toLowerCase();
  const missing = needles.filter((needle) => !haystack.includes(String(needle).toLowerCase()));
  return {
    passed: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(', ')}` : 'all substrings present',
  };
});

registerAssertion('outputNotContains', (value, run) => {
  const needles = Array.isArray(value) ? value : [value];
  const haystack = run.output.toLowerCase();
  const present = needles.filter((needle) => haystack.includes(String(needle).toLowerCase()));
  return {
    passed: present.length === 0,
    detail: present.length ? `unexpectedly present: ${present.join(', ')}` : 'none present',
  };
});

registerAssertion('outputMatches', (value, run) => {
  const pattern = new RegExp(value, 'i');
  return {
    passed: pattern.test(run.output),
    detail: `pattern ${pattern} against ${run.output.length} chars of output`,
  };
});

registerAssertion('maxSteps', (value, run) => ({
  passed: run.steps <= value,
  detail: `took ${run.steps} step(s), limit ${value}`,
}));

registerAssertion('latencyUnderMs', (value, run) => ({
  passed: run.durationMs <= value,
  detail: `${run.durationMs}ms, limit ${value}ms`,
}));

registerAssertion('costUnderUsd', (value, run) => {
  if (run.costUsd === null) {
    // Unknown pricing must not silently pass a cost gate -- that is exactly the
    // kind of quiet green that makes an eval suite worthless.
    return { passed: false, detail: 'cost is unknown for this model; add `pricing` to the target' };
  }
  return {
    passed: run.costUsd <= value,
    detail: `$${run.costUsd.toFixed(6)}, limit $${value}`,
  };
});

registerAssertion('completes', (value, run) => {
  const wanted = value !== false;
  const completed = run.stoppedBecause === 'end_turn';
  return {
    passed: completed === wanted,
    detail: `run stopped because: ${run.stoppedBecause}${run.error ? ` (${run.error.message})` : ''}`,
  };
});

/** Recursive subset match, so `args` in a scenario can name only the fields that matter. */
function subsetMatches(expected, actual) {
  return Object.entries(expected).every(([key, value]) => {
    const candidate = actual?.[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return subsetMatches(value, candidate ?? {});
    }
    if (typeof value === 'string' && typeof candidate === 'string') {
      return value.toLowerCase() === candidate.toLowerCase();
    }
    return JSON.stringify(value) === JSON.stringify(candidate);
  });
}

/** `toolCallCount: 2` and `toolCallCount: {tool: x, max: 2}` should both work. */
function normaliseCountSpec(value) {
  if (typeof value === 'number') return { max: value, min: 0 };
  return value ?? {};
}

export { assertions, registerAssertion, assertionTypes };
