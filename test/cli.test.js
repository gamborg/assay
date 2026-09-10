import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, asList } from '../lib/cli/args.js';
import { loadConfig, selectTargets } from '../lib/config/config.js';

test('parses long flags in both spellings and collects repeats', () => {
  const { positional, flags } = parseArgs([
    'run', './scenarios', '--target', 'local', '--target=frontier', '--json',
  ]);

  assert.deepEqual(positional, ['run', './scenarios']);
  assert.deepEqual(asList(flags.target), ['local', 'frontier']);
  assert.equal(flags.json, true);
});

test('a bare flag before another flag is a boolean, not a value', () => {
  const { flags } = parseArgs(['--trace', '--config', 'a.yaml']);

  assert.equal(flags.trace, true);
  assert.equal(flags.config, 'a.yaml');
});

test('loads the demo config and expands environment variables', async () => {
  process.env.ASSAY_TEST_MODEL = 'test-model-from-env';
  const config = await loadConfig('./examples/demo.config.yaml');

  assert.equal(config.targets.length, 2);
  assert.equal(config.targets[0].provider, 'mock');
  delete process.env.ASSAY_TEST_MODEL;
});

test('selecting an unknown target lists the configured ones', async () => {
  const config = await loadConfig('./examples/demo.config.yaml');

  assert.throws(
    () => selectTargets(config, ['nope']),
    /unknown target "nope" \(configured: scripted-good, scripted-small\)/,
  );
});

test('selecting no target means every target', async () => {
  const config = await loadConfig('./examples/demo.config.yaml');

  assert.equal(selectTargets(config, []).length, 2);
});
