/**
 * Loading scenarios from disk.
 *
 * Accepts a single file or a directory. YAML and JSON are both fine -- the YAML
 * parser handles JSON, so there is exactly one code path.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { normaliseScenario, ScenarioError } from './schema.js';

const SCENARIO_EXTENSIONS = new Set(['.yaml', '.yml', '.json']);

/**
 * Load every scenario reachable from `target`.
 *
 * @param {string} target path to a scenario file or a directory of them
 * @returns {Promise<object[]>} scenarios sorted by id, each carrying `sourceFile`
 */
async function loadScenarios(target) {
  const files = await collectScenarioFiles(target);

  if (files.length === 0) {
    throw new ScenarioError(`no scenario files found at ${target}`);
  }

  const scenarios = [];
  for (const file of files) {
    scenarios.push(...(await loadScenarioFile(file)));
  }

  assertUniqueIds(scenarios);
  return scenarios.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * A file may hold one scenario, or a `scenarios:` list. Both shapes exist in the
 * wild and supporting both costs four lines.
 */
async function loadScenarioFile(file) {
  const source = await readFile(file, 'utf8');

  let parsed;
  try {
    parsed = parseYaml(source);
  } catch (cause) {
    throw new ScenarioError(`could not parse: ${cause.message}`, { file: basename(file) });
  }

  const raw = Array.isArray(parsed?.scenarios) ? parsed.scenarios : [parsed];

  return raw.map((entry) => ({
    ...normaliseScenario(entry, { file: basename(file) }),
    sourceFile: file,
  }));
}

async function collectScenarioFiles(target) {
  const info = await stat(target).catch(() => null);

  if (!info) {
    throw new ScenarioError(`path does not exist: ${target}`);
  }

  if (info.isFile()) {
    return [target];
  }

  const entries = await readdir(target, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && SCENARIO_EXTENSIONS.has(extname(entry.name)))
    .map((entry) => join(target, entry.name))
    .sort();
}

/** Duplicate ids would silently overwrite each other in every report downstream. */
function assertUniqueIds(scenarios) {
  const seen = new Map();

  for (const scenario of scenarios) {
    const previous = seen.get(scenario.id);
    if (previous) {
      throw new ScenarioError(
        `duplicate scenario id "${scenario.id}" in ${basename(previous)} and ${basename(scenario.sourceFile)}`,
      );
    }
    seen.set(scenario.id, scenario.sourceFile);
  }
}

export { loadScenarios, loadScenarioFile };
