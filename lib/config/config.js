/**
 * Harness configuration: which targets to run scenarios against.
 *
 * A "target" is a named model configuration. Naming them is what makes routing
 * legible -- reports compare `frontier` against `local`, not two opaque model ids
 * that both need decoding.
 *
 * Environment variables are expanded as `${VAR}` so config files stay committable.
 */

import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

const DEFAULT_CONFIG = {
  scenarios: './scenarios',
  targets: [
    {
      name: 'opus',
      provider: 'anthropic',
      model: 'claude-opus-5',
    },
  ],
};

/**
 * @param {string|undefined} file path to assay.config.yaml
 * @returns {Promise<{scenarios: string, targets: object[]}>}
 */
async function loadConfig(file) {
  if (!file) return DEFAULT_CONFIG;

  const source = await readFile(file, 'utf8');
  const config = expandEnv(parseYaml(source) ?? {});

  if (!Array.isArray(config.targets) || config.targets.length === 0) {
    throw new Error(`${file}: "targets" must be a non-empty list`);
  }

  for (const target of config.targets) {
    if (!target.name || !target.provider) {
      throw new Error(`${file}: every target needs a "name" and a "provider"`);
    }
  }

  return { ...DEFAULT_CONFIG, ...config };
}

/**
 * Select a subset of targets by name, so `--target local` works without editing
 * the config file.
 */
function selectTargets(config, names) {
  if (!names || names.length === 0) return config.targets;

  return names.map((name) => {
    const target = config.targets.find((candidate) => candidate.name === name);
    if (!target) {
      throw new Error(
        `unknown target "${name}" (configured: ${config.targets.map((t) => t.name).join(', ')})`,
      );
    }
    return target;
  });
}

function expandEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
  }
  if (Array.isArray(value)) return value.map(expandEnv);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandEnv(v)]));
  }
  return value;
}

export { loadConfig, selectTargets, DEFAULT_CONFIG };
